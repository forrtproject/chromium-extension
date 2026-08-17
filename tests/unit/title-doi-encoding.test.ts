import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { fetchTitleByDoi, _resetAugmentCachesForTesting } from "../../src/shared/doi-augment";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

// Pacing between real requests is not under test here.
vi.mock("../../src/shared/request-gate", () => ({
  RequestGate: class {
    fetch(url: string, init?: RequestInit) {
      return fetch(url, init);
    }
  },
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("fetchTitleByDoi DOI encoding", () => {
  beforeEach(() => {
    _resetAugmentCachesForTesting();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("percent-encodes # so the fragment reaches Crossref instead of truncating", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.crossref.org/works/*", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ message: { title: ["Fragment Paper"] } });
      })
    );

    const title = await fetchTitleByDoi("10.1000/456#789");

    expect(title).toBe("Fragment Paper");
    expect(seen[0]).toContain("456%23789");
  });

  it("percent-encodes ? so it cannot start the query string", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.crossref.org/works/*", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ message: { title: ["Question Paper"] } });
      })
    );

    const title = await fetchTitleByDoi("10.1000/what?x=1");

    expect(title).toBe("Question Paper");
    expect(seen[0]).toContain("what%3Fx%3D1");
    expect(seen[0]).toContain("mailto=test%40example.com");
  });

  it("keeps slashes as path separators for multi-slash DOIs", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.crossref.org/works/*", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ message: { title: ["Multi Slash"] } });
      })
    );

    await fetchTitleByDoi("10.6338/jda.202212/sp_17(4).0000");

    expect(seen[0]).toContain("/works/10.6338/jda.202212/");
  });

  it("encodes the DOI on the OpenAlex fallback too", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.crossref.org/works/*", () =>
        HttpResponse.json({}, { status: 500 })
      ),
      http.get("https://api.openalex.org/works/*", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ title: "Fallback Paper" });
      })
    );

    const title = await fetchTitleByDoi("10.1000/456#789");

    expect(title).toBe("Fallback Paper");
    expect(seen[0]).toContain("456%23789");
  });
});
