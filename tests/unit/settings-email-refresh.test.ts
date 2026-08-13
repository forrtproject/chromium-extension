import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { augmentDOIs, _resetAugmentCachesForTesting } from "../../src/shared/doi-augment";
import { fetchOpenAccess, _resetOpenAccessCacheForTesting } from "../../src/shared/openaccess";
import { getSettings, _resetSettingsCacheForTesting } from "../../src/shared/settings";

const CROSSREF_URL = "https://api.crossref.org/works";
const OPENALEX_URL = "https://api.openalex.org/works";
const UNPAYWALL_URL = "https://api.unpaywall.org/v2/*";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function announceSettings(email: string): void {
  const listeners = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls.map(
    (call) => call[0] as Listener
  );
  for (const listener of listeners) listener({ flora_settings: { newValue: { email } } }, "sync");
}

describe("settings email changes take effect immediately", () => {
  beforeEach(async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_settings: { email: "typo@exampl.com" },
    });
    _resetSettingsCacheForTesting();
    _resetAugmentCachesForTesting();
    _resetOpenAccessCacheForTesting();
    await getSettings();
  });

  it("sends the corrected email to Crossref and OpenAlex", async () => {
    const mailtos: string[] = [];
    server.use(
      http.get(CROSSREF_URL, ({ request }) => {
        mailtos.push(new URL(request.url).searchParams.get("mailto") ?? "");
        return HttpResponse.json({ message: { items: [] } });
      }),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );

    await augmentDOIs(["A Paper Before The Fix"]);
    expect(mailtos.at(-1)).toBe("typo@exampl.com");

    announceSettings("fixed@example.com");

    await augmentDOIs(["A Paper After The Fix"]);
    expect(mailtos.at(-1)).toBe("fixed@example.com");
  });

  it("sends the corrected email to Unpaywall", async () => {
    const emails: string[] = [];
    server.use(
      http.get(UNPAYWALL_URL, ({ request }) => {
        emails.push(new URL(request.url).searchParams.get("email") ?? "");
        return HttpResponse.json({ is_oa: false });
      })
    );

    await fetchOpenAccess("10.1000/before");
    expect(emails.at(-1)).toBe("typo@exampl.com");

    announceSettings("fixed@example.com");

    await fetchOpenAccess("10.1000/after");
    expect(emails.at(-1)).toBe("fixed@example.com");
  });
});
