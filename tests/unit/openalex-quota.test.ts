import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {http, HttpResponse} from "msw";
import {setupServer} from "msw/node";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({email: "test@example.com", openalexKey: ""}),
}));

// Matching, not pacing, is under test.
vi.mock("../../src/shared/request-gate", () => ({
    RequestGate: class {
        fetch<T>(url: string, init: RequestInit | undefined, read: (response: Response) => Promise<T>) {
            return fetch(url, init).then(read);
        }
    },
}));

import {
    OPENALEX_RESERVE_CREDITS, _resetOpenAlexQuotaForTesting, noteOpenAlexResponse, openAlexAvailable,
    openAlexTitleLimit, releaseTitleSearch, reserveTitleSearch, withOpenAlexKey,
} from "../../src/shared/openalex-quota";
import {_resetAugmentCachesForTesting, augmentDOIs, currentOpenAlexTitleLimit, fetchTitleByDoi} from "../../src/shared/doi-augment";
import {getSettings} from "../../src/shared/settings";
import {redactDebugText} from "../../src/shared/debug-redact";

const budget = (remaining: number, resetSeconds = 3600, status = 200) =>
    new Response(null, {status, headers: {"x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(resetSeconds)}});

const server = setupServer();
beforeAll(() => server.listen({onUnhandledRequest: "bypass"}));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
    _resetOpenAlexQuotaForTesting();
    _resetAugmentCachesForTesting();
    vi.mocked(getSettings).mockResolvedValue({email: "test@example.com", openalexKey: ""} as any);
});

describe("OpenAlex budget", () => {
    it("sends one title search while the budget is unknown", async () => {
        expect(await reserveTitleSearch(false)).toBe(true);
        expect(await reserveTitleSearch(false)).toBe(false);
        releaseTitleSearch();
        expect(await reserveTitleSearch(false)).toBe(true);
    });

    it("keeps the reserve for id lookups, counting searches still in flight", async () => {
        noteOpenAlexResponse(budget(OPENALEX_RESERVE_CREDITS + 20), false);
        expect(await reserveTitleSearch(false)).toBe(true);
        expect(await reserveTitleSearch(false)).toBe(true);
        expect(await reserveTitleSearch(false)).toBe(false);
        expect(await openAlexTitleLimit(false)).toBeNull();
        noteOpenAlexResponse(budget(OPENALEX_RESERVE_CREDITS + 5), false);
        expect(await openAlexTitleLimit(false)).toMatchObject({keyed: false});
        expect(await openAlexAvailable(false)).toBe(true);
    });

    it("treats a daily 429 as used up until the reset, and a key's budget separately", async () => {
        noteOpenAlexResponse(budget(0, 7200, 429), false);
        expect(await openAlexAvailable(false)).toBe(false);
        expect(await reserveTitleSearch(false)).toBe(false);
        // A newly added key has its own budget.
        expect(await openAlexAvailable(true)).toBe(true);
        expect(await openAlexTitleLimit(true)).toBeNull();
    });

    it("ignores a short per-second 429", async () => {
        noteOpenAlexResponse(new Response(null, {status: 429, headers: {"retry-after": "1"}}), false);
        expect(await openAlexAvailable(false)).toBe(true);
    });

    it("forgets the budget once it has reset", async () => {
        noteOpenAlexResponse(budget(0, 0, 429), false);
        expect(await openAlexAvailable(false)).toBe(true);
    });

    it("adds the key to requests and keeps it out of debug reports", () => {
        expect(withOpenAlexKey("https://api.openalex.org/works?filter=x", "")).toBe("https://api.openalex.org/works?filter=x");
        const url = withOpenAlexKey("https://api.openalex.org/works?filter=x", "SECRET1");
        expect(url).toBe("https://api.openalex.org/works?filter=x&api_key=SECRET1");
        expect(redactDebugText(`GET ${url} failed`)).not.toContain("SECRET1");
    });
});

describe("title matching with the OpenAlex budget", () => {
    const crossrefHit = (doi: string, title: string) => HttpResponse.json({message: {items: [{DOI: doi, title: [title]}]}});

    it("sends the key, not an email, to OpenAlex", async () => {
        vi.mocked(getSettings).mockResolvedValue({email: "test@example.com", openalexKey: "KEY123"} as any);
        const urls: string[] = [];
        server.use(
            http.get("https://api.openalex.org/works", ({request}) => {
                urls.push(request.url);
                return HttpResponse.json({results: []}, {headers: {"x-ratelimit-remaining": "9000", "x-ratelimit-reset": "3600"}});
            }),
            http.get("https://api.crossref.org/works", () => HttpResponse.json({message: {items: []}})),
        );
        await augmentDOIs(["Some Paper About Something Specific"]);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain("api_key=KEY123");
        expect(urls[0]).not.toMatch(/mailto=/);
    });

    it("matches with Crossref alone once OpenAlex is down to its reserve, and reports it", async () => {
        noteOpenAlexResponse(budget(OPENALEX_RESERVE_CREDITS + 5), false);
        let openalexHits = 0;
        server.use(
            http.get("https://api.openalex.org/works", () => {
                openalexHits++;
                return HttpResponse.json({results: []});
            }),
            http.get("https://api.crossref.org/works", ({request}) => {
                const q = new URL(request.url).searchParams.get("query.title") ?? "";
                return q.includes("Second") ? crossrefHit("10.1000/two", "Second Paper On Memory Effects") : crossrefHit("10.1000/one", "First Paper On Memory Effects");
            }),
        );
        const results = await augmentDOIs(["First Paper On Memory Effects", "Second Paper On Memory Effects"]);
        expect(openalexHits).toBe(0);
        expect(results.get("First Paper On Memory Effects")).toBe("10.1000/one");
        expect(results.get("Second Paper On Memory Effects")).toBe("10.1000/two");
        expect(await currentOpenAlexTitleLimit()).toMatchObject({keyed: false});
    });

    it("skips OpenAlex for a DOI's title once the budget is used up", async () => {
        noteOpenAlexResponse(budget(0, 7200, 429), false);
        let openalexHits = 0;
        server.use(
            http.get("https://api.crossref.org/works/*", () => new HttpResponse(null, {status: 503})),
            http.get("https://api.openalex.org/works/*", () => {
                openalexHits++;
                return HttpResponse.json({title: "x"});
            }),
        );
        expect(await fetchTitleByDoi("10.1000/xyz", null)).toBeNull();
        expect(openalexHits).toBe(0);
    });
});
