/**
 * @vitest-environment-options { "url": "https://github.com/forrtproject/chromium-extension/issues/new?title=x" }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    debugError,
    debugLog,
    flushDebugLog,
    recentDebugEntries,
    setDebug,
    setDebugSink,
    _resetDebugForTesting,
} from "../../src/shared/debug";
import { isOwnRepoUrl, isIssueFormUrl } from "../../src/shared/debug-report";

describe("filing a report does not log itself", () => {
    beforeEach(() => {
        _resetDebugForTesting();
    });
    afterEach(() => {
        setDebugSink(null);
        _resetDebugForTesting();
        vi.unstubAllGlobals();
    });

    it("captures nothing while the reader is on ORE's own issue tracker", () => {
        const sink = vi.fn();
        setDebugSink(sink);
        setDebug(true);

        debugLog("General: Extracted DOIs: 0");
        debugError(new Error("something on the issue page"));
        flushDebugLog();

        expect(sink).not.toHaveBeenCalled();
        expect(recentDebugEntries()).toHaveLength(0);
    });

    it("recognises the repo and its issue form", () => {
        expect(isOwnRepoUrl(location.href)).toBe(true);
        expect(isIssueFormUrl(location.href)).toBe(true);
        expect(isOwnRepoUrl("https://github.com/forrtproject/chromium-extension/issues/42")).toBe(true);
        expect(isOwnRepoUrl("https://github.com/someone/else/issues/new")).toBe(false);
        expect(isOwnRepoUrl("https://www.tandfonline.com/doi/full/10.1080/x")).toBe(false);
    });
});
