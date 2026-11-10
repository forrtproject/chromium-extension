// @vitest-environment-options {"url":"https://docs.google.com/document/d/test-document/edit"}
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {startDomListener} from "../../src/content-general/dom-listener";

let observer: MutationObserver | undefined;
const scanWholePage = vi.fn();

beforeEach(() => {
    vi.useFakeTimers();
    scanWholePage.mockClear();
});

afterEach(() => {
    observer?.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

it("leaves same-page Docs edits to the canvas reader, even ones that add DOI text", async () => {
    observer = startDomListener({scanWholePage, getLastUrl: () => location.href});
    for (let i = 0; i < 60; i++) document.body.appendChild(document.createElement("div"));
    document.body.insertAdjacentHTML("beforeend", "<p>See https://doi.org/10.1037/h0054651</p>");
    await Promise.resolve();
    vi.advanceTimersByTime(2000);
    expect(scanWholePage).not.toHaveBeenCalled();
});

it("still scans when the user switches to another Docs tab", () => {
    const navigation = Object.assign(new EventTarget(), {currentEntry: {key: "first", url: location.href}});
    vi.stubGlobal("navigation", navigation);
    const scannedUrl = location.href;
    observer = startDomListener({scanWholePage, getLastUrl: () => scannedUrl});
    history.replaceState(null, "", "?tab=t.next");
    navigation.currentEntry = {key: "second", url: location.href};
    navigation.dispatchEvent(new Event("currententrychange"));
    vi.advanceTimersByTime(300);
    expect(scanWholePage).toHaveBeenCalledTimes(1);
    history.replaceState(null, "", scannedUrl);
});
