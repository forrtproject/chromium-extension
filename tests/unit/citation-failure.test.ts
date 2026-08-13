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
