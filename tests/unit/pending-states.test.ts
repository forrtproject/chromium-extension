import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSettings = vi.fn();
vi.mock("../../src/shared/settings", () => ({
    getSettings: (...a: unknown[]) => mockGetSettings(...a),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));

const mockLookupPubPeer = vi.fn();
vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: (...a: unknown[]) => mockLookupPubPeer(...a),
}));

import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";
import type { OpenAccessStatus } from "../../src/shared/openaccess";

const DOI = "10.1000/pending" as DoiString;

function rowText(pill: HTMLElement, attr: string): string {
    return pill.querySelector(`[${attr}]`)?.textContent ?? "";
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe("pending lookups are not shown as negatives", () => {
    beforeEach(() => {
        mockGetSettings.mockResolvedValue({ email: "test@example.com", citationStyle: "apa" });
        mockLookupPubPeer.mockReturnValue(new Promise(() => {}));
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        document.body.innerHTML = "";
    });

    it("shows Checking while the OA lookup is in flight", () => {
        const pill = createIndicatorPill({
            doi: DOI,
            oaStatus: new Promise<OpenAccessStatus | null>(() => {}),
            retraction: null,
        });

        expect(rowText(pill, "data-flora-oa-row")).toContain("Checking");
        expect(rowText(pill, "data-flora-oa-row")).not.toContain("Not confirmed");
    });

    it("shows Checking while the PubPeer lookup is in flight", () => {
        const pill = createIndicatorPill({ doi: DOI, oaStatus: null, retraction: null });

        expect(rowText(pill, "data-flora-pubpeer-row")).toContain("Checking");
        expect(rowText(pill, "data-flora-pubpeer-row")).not.toContain("No discussion");
    });

    it("settles to the negative once the OA lookup answers", async () => {
        const oa = deferred<OpenAccessStatus | null>();
        const pill = createIndicatorPill({ doi: DOI, oaStatus: oa.promise, retraction: null });

        oa.resolve(null);
        await vi.waitFor(() =>
            expect(rowText(pill, "data-flora-oa-row")).toContain("Not confirmed open access")
        );
    });

    it("settles rather than hanging on Checking when a lookup rejects", async () => {
        const oa = deferred<OpenAccessStatus | null>();
        const pill = createIndicatorPill({ doi: DOI, oaStatus: oa.promise, retraction: null });

        oa.reject(new Error("network down"));
        await vi.waitFor(() =>
            expect(rowText(pill, "data-flora-oa-row")).not.toContain("Checking")
        );
    });

    it("shows no OA row pending state when no lookup was started", () => {
        const pill = createIndicatorPill({ doi: DOI, oaStatus: null, retraction: null });

        expect(rowText(pill, "data-flora-oa-row")).not.toContain("Checking");
    });
});

describe("open access without a contact email", () => {
    beforeEach(() => {
        mockLookupPubPeer.mockReturnValue(new Promise(() => {}));
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        document.body.innerHTML = "";
    });

    it("blames the missing setting, not the paper", async () => {
        mockGetSettings.mockResolvedValue({ email: "", citationStyle: "apa" });
        const oa = deferred<OpenAccessStatus | null>();
        const pill = createIndicatorPill({ doi: DOI, oaStatus: oa.promise, retraction: null });

        oa.resolve(null);

        await vi.waitFor(() => {
            const text = rowText(pill, "data-flora-oa-row");
            expect(text).toContain("Add your email in Settings");
            expect(text).not.toContain("Not confirmed open access");
        });
    });

    it("offers a way to reach Settings", async () => {
        mockGetSettings.mockResolvedValue({ email: "", citationStyle: "apa" });
        const oa = deferred<OpenAccessStatus | null>();
        const pill = createIndicatorPill({ doi: DOI, oaStatus: oa.promise, retraction: null });

        oa.resolve(null);

        await vi.waitFor(() =>
            expect(pill.querySelector("[data-flora-oa-row] button")).not.toBeNull()
        );
    });
});
