import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { startDomListener } from "../../src/content-general/dom-listener";

function setHidden(hidden: boolean): void {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("refocus rescans only when something was missed", () => {
    let scanWholePage: ReturnType<typeof vi.fn>;
    let observer: MutationObserver;

    beforeEach(() => {
        document.body.innerHTML = "";
        setHidden(false);
        scanWholePage = vi.fn();
        observer = startDomListener({ scanWholePage, getLastUrl: () => location.href });
        scanWholePage.mockClear();
    });

    afterEach(() => {
        observer.disconnect();
    });

    it("does not rescan on a plain tab switch", () => {
        setHidden(true);
        setHidden(false);

        expect(scanWholePage).not.toHaveBeenCalled();
    });

    it("rescans when the page changed while hidden", async () => {
        setHidden(true);

        const added = document.createElement("p");
        added.textContent = "10.1038/nature12373";
        document.body.appendChild(added);
        await new Promise((r) => setTimeout(r, 0));

        setHidden(false);

        expect(scanWholePage).toHaveBeenCalledTimes(1);
    });

    it("does not rescan again on the next refocus", async () => {
        setHidden(true);
        document.body.appendChild(document.createElement("p"));
        await new Promise((r) => setTimeout(r, 0));
        setHidden(false);
        scanWholePage.mockClear();

        setHidden(true);
        setHidden(false);

        expect(scanWholePage).not.toHaveBeenCalled();
    });
});
