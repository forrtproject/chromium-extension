import { describe, it, expect, beforeEach, vi, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({ email: "test@example.com", citationStyle: "apa" }),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));

import { fetchCitationDetailed, _resetCitationCacheForTesting } from "../../src/shared/citation";

const CROSSREF = "https://api.crossref.org/works/*";
const DOI_ORG = "https://doi.org/*";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("citation failure reasons", () => {
    beforeEach(() => {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        _resetCitationCacheForTesting();
    });

    it("cleans escaped markup out of citations cached before the fix", async () => {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
            flora_citation_blob: {
                "10.1000/old|apa": {
                    v: {text: "Smith &amp; Jones. &lt;i&gt;Fly&lt;/i&gt;.", html: "Smith &amp;amp; Jones. &lt;i&gt;Fly&lt;/i&gt;."},
                    t: Date.now(),
                },
            },
        });

        const outcome = await fetchCitationDetailed("10.1000/old", "apa");

        expect(outcome.citation).toEqual({text: "Smith & Jones. Fly.", html: "Smith &amp; Jones. <i>Fly</i>."});
    });

    it("keeps legacy entries with real emphasis intact", async () => {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
            flora_citation_blob: {
                "10.1000/real|apa": {v: {text: "Smith & Jones. Fly.", html: "Smith &amp; Jones. <i>Fly</i>."}, t: Date.now()},
            },
        });

        const outcome = await fetchCitationDetailed("10.1000/real", "apa");

        expect(outcome.citation).toEqual({text: "Smith & Jones. Fly.", html: "Smith &amp; Jones. <i>Fly</i>."});
    });

    it("returns a legacy reference-manager export exactly as it was cached", async () => {
        const ris = "TY  - JOUR\nTI  - A &#10; B &amp; C\nER  -";
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
            flora_citation_blob: {"10.1000/ris|ris": {v: {text: ris, html: null}, t: Date.now()}},
        });

        const outcome = await fetchCitationDetailed("10.1000/ris", "ris");

        expect(outcome.citation).toEqual({text: ris, html: null});
    });

    it("copies the same text and rich text on a cache hit as on the first copy", async () => {
        let requests = 0;
        server.use(http.get(CROSSREF, () => {
            requests++;
            return HttpResponse.text("Ray, O. (2004). &lt;i&gt;Fly &amp;amp; worm&lt;/i&gt; at p &lt; 0.05. <i>J</i>, 59.");
        }));

        const first = await fetchCitationDetailed("10.1000/hit", "apa");
        const second = await fetchCitationDetailed("10.1000/hit", "apa");

        expect(first.citation).toEqual({
            text: "Ray, O. (2004). Fly & worm at p < 0.05. J, 59.",
            html: "Ray, O. (2004). <i>Fly &amp; worm</i> at p &lt; 0.05. <i>J</i>, 59.",
        });
        expect(second.citation).toEqual(first.citation);
        expect(requests).toBe(1);
    });

    it("reports unreachable when nothing answers", async () => {
        server.use(
            http.get(CROSSREF, () => HttpResponse.error()),
            http.get(DOI_ORG, () => HttpResponse.error())
        );

        const outcome = await fetchCitationDetailed("10.1000/x", "apa");

        expect(outcome.citation).toBeNull();
        expect(outcome.reachable).toBe(false);
    });

    it("reports unreachable during a 5xx outage", async () => {
        server.use(
            http.get(CROSSREF, () => new HttpResponse(null, { status: 503 })),
            http.get(DOI_ORG, () => new HttpResponse(null, { status: 503 }))
        );

        const outcome = await fetchCitationDetailed("10.1000/x", "apa");

        expect(outcome.reachable).toBe(false);
    });

    it("reports reachable when the service answers that it has no such citation", async () => {
        server.use(
            http.get(CROSSREF, () => new HttpResponse(null, { status: 404 })),
            http.get(DOI_ORG, () => new HttpResponse(null, { status: 404 }))
        );

        const outcome = await fetchCitationDetailed("10.1000/x", "apa");

        expect(outcome.citation).toBeNull();
        expect(outcome.reachable).toBe(true);
    });

    it("returns the citation when Crossref renders one", async () => {
        server.use(
            http.get(CROSSREF, () => HttpResponse.text("Smith, J. (2020). A paper. Journal.")),
            http.get(DOI_ORG, () => new HttpResponse(null, { status: 404 }))
        );

        const outcome = await fetchCitationDetailed("10.1000/x", "apa");

        expect(outcome.citation?.text).toContain("Smith");
        expect(outcome.reachable).toBe(true);
    });
});
