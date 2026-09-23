import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { augmentDOIsViaWorker } from "../../src/shared/messages";
import { augmentDOIsDetailed } from "../../src/shared/doi-augment";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("augmentDOIsViaWorker unanswered titles", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("omits titles the worker could not get an answer for", async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "FLORA_AUGMENT_RESULT",
      results: { "Answered Paper": "10.1234/found", "Unanswered Paper": null },
      unanswered: ["Unanswered Paper"],
    });

    const result = await augmentDOIsViaWorker(["Answered Paper", "Unanswered Paper"]);

    expect(result.get("Answered Paper")).toBe("10.1234/found");
    expect(result.has("Unanswered Paper")).toBe(false);
  });

  it("keeps a confirmed no-match in the map", async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "FLORA_AUGMENT_RESULT",
      results: { "No Match Paper": null },
      unanswered: [],
    });

    const result = await augmentDOIsViaWorker(["No Match Paper"]);

    expect(result.has("No Match Paper")).toBe(true);
    expect(result.get("No Match Paper")).toBeNull();
  });
});

describe("augmentDOIsDetailed answered flag", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports answered:false when neither platform responded", async () => {
    server.use(
      http.get("https://api.crossref.org/works", () => HttpResponse.error()),
      http.get("https://api.openalex.org/works", () => HttpResponse.error())
    );

    const outcomes = await augmentDOIsDetailed(["An Offline Title"]);

    expect(outcomes.get("An Offline Title")).toMatchObject({ doi: null, answered: false });
  });

  it("reports answered:true for a genuine no-match", async () => {
    server.use(
      http.get("https://api.crossref.org/works", () => HttpResponse.json({ message: { items: [] } })),
      http.get("https://api.openalex.org/works", () => HttpResponse.json({ results: [] }))
    );

    const outcomes = await augmentDOIsDetailed(["A Genuinely Unknown Title"]);

    expect(outcomes.get("A Genuinely Unknown Title")).toMatchObject({ doi: null, answered: true });
  });

  it("returns the answered titles and leaves the rest unanswered when the request is aborted", async () => {
    const fast = "A Paper That Answers Quickly About Things";
    const slow = "A Paper Whose Platform Never Answers At All";
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      if (decodeURIComponent(url).includes("Answers Quickly")) {
        return Promise.resolve(Response.json({message: {items: [{DOI: "10.1234/fast", title: [fast]}]}}));
      }
      return new Promise((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), {once: true}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = augmentDOIsDetailed([fast, slow], controller.signal);
    // Both platform gates space their starts, so wait until each title's query is out.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {timeout: 2000});
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new DOMException("Worker request deadline reached", "AbortError"));

    const outcomes = await pending;
    expect(outcomes.get(fast)).toMatchObject({doi: "10.1234/fast", answered: true});
    expect(outcomes.get(slow)).toMatchObject({doi: null, answered: false});
  });
});
