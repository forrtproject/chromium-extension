// @vitest-environment-options {"url":"https://ukc-word-edit.officeapps.live.com/we/wordeditorframe.aspx"}
import {beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {isWordOnline, wordReferenceElements, wordAnnotationTarget, positionWordAnnotations} from "../../src/shared/word-online";
import {beginDomScanPass, findReferenceEntries, extractDoiOccurrences} from "../../src/shared/doi-extractor";
import {resolveReferenceDois, renderResolvedReferences} from "../../src/content-general/references";
import {injectRetractionInfo} from "../../src/shared/doi-retraction";
import {editorTitle, editorContentSnapshot} from "../../src/shared/document-editor";
import {startDomListener} from "../../src/content-general/dom-listener";
import type {DoiString} from "../../src/shared/types";

vi.mock("../../src/shared/settings", () => ({getSettings: vi.fn().mockResolvedValue({email: "test@example.com"})}));
vi.mock("../../src/shared/openaccess", () => ({fetchOpenAccess: vi.fn().mockResolvedValue(null)}));
vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn().mockResolvedValue(null)}));

const doi = "10.1111/j.1467-9280.2009.02426.x" as DoiString;
const paragraph = `<p class="Paragraph" paraid="61">Jostmann, Nils B., Daniël Lakens, and Thomas W. Schubert. ‘Weight as an Embodiment of Importance’. Psychological Science 20 (2009): 1169–74. <a href="https://doi.org/${doi}">https://doi.org/${doi}</a>.</p>`;
beforeEach(() => {
    document.body.innerHTML = `<div id="WACViewPanel"><div contenteditable="true">${paragraph}</div><div aria-hidden="true">${paragraph}</div></div>`;
    beginDomScanPass();
});

describe("Word Online", () => {
    it("reads an input title and detects same-URL content changes", () => {
        const title = document.createElement('input'); title.id = 'documentTitle'; title.value = 'My document'; document.body.append(title);
        expect(editorTitle()).toBe('My document');
        const previous = editorContentSnapshot();
        document.querySelector('.Paragraph')!.textContent = 'An edited reference';
        expect(editorContentSnapshot()).not.toBe(previous);
    });
    it("injects only into Word frames, leaving arbitrary iframes excluded", () => {
        const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
        expect(manifest.content_scripts.find((s: {matches: string[]}) => s.matches.includes("<all_urls>")).all_frames).toBe(false);
        expect(manifest.content_scripts.some((s: {matches: string[]; all_frames: boolean}) => s.all_frames && s.matches.includes("https://*.officeapps.live.com/we/wordeditorframe.aspx*"))).toBe(true);
        expect(isWordOnline()).toBe(true);
        expect(isWordOnline("https://evilofficeapps.live.com/we/wordeditorframe.aspx")).toBe(false);
        expect(isWordOnline("https://ukc-word-edit.officeapps.live.com/proxy.aspx")).toBe(false);
    });

    it("finds a reference without a References heading and deduplicates hidden Word copies", () => {
        const entries = findReferenceEntries(document);
        expect(entries).toHaveLength(1);
        expect(entries[0].doi).toBe(doi);
        expect(entries[0].element.isConnected).toBe(false);
        expect(extractDoiOccurrences(document)).toHaveLength(1);
    });

    it("resolves and renders indicators and notices without changing Word content", async () => {
        const editor = document.querySelector("#WACViewPanel")!;
        const before = editor.outerHTML;
        const refs = await resolveReferenceDois();
        expect(refs).toHaveLength(1);
        renderResolvedReferences(refs, new Map([[doi, {doi, originDoi: doi, kind: "retraction"}]]), new Map());
        injectRetractionInfo(editor.querySelector("p")!, {doi, originDoi: doi, kind: "retraction"});
        expect(document.querySelectorAll(".flora-word-annotation .flora-indicator-pill")).toHaveLength(1);
        expect(document.querySelector(".flora-word-annotation [data-flora-notice-doi]")).toBeNull();
        expect(document.querySelector('[data-flora-marker-state="warning"]')).not.toBeNull();
        expect(editor.outerHTML).toBe(before);
        expect(await resolveReferenceDois()).toEqual([]);
    });

    it("invalidates a paragraph after an edit and removes stale annotations", async () => {
        const refs = await resolveReferenceDois();
        renderResolvedReferences(refs, new Map(), new Map());
        document.querySelector("p")!.textContent = "This paragraph no longer contains a citation.";
        expect(wordReferenceElements(document)).toHaveLength(0);
        expect(document.querySelector(".flora-word-annotation")).toBeNull();
    });

    it("tracks the paragraph geometry and hides badges outside the editor viewport", () => {
        const copy = wordReferenceElements(document)[0];
        const source = document.querySelector("p")!;
        const rect = {top: 200, bottom: 250, right: 600, height: 50};
        vi.spyOn(source, "getBoundingClientRect").mockImplementation(() => rect as DOMRect);
        vi.spyOn(document.querySelector("#WACViewPanel")!, "getBoundingClientRect").mockReturnValue({top: 150, bottom: 700} as DOMRect);
        const row = wordAnnotationTarget(copy)!;
        expect(row.style.left).toBe("612px");
        expect(row.style.top).toBe("200px");
        expect(row.hidden).toBe(false);
        rect.top = 20; rect.bottom = 70;
        positionWordAnnotations();
        expect(row.hidden).toBe(true);
    });

    it("scans navigation without waiting for the previous document's throttle", () => {
        vi.useFakeTimers();
        const navigation = Object.assign(new EventTarget(), {currentEntry: {key: 'first'}});
        vi.stubGlobal('navigation', navigation);
        const scan = vi.fn();
        // The page-navigation listener has already synchronized the URL.
        const observer = startDomListener({scanWholePage: scan, getLastUrl: () => location.href});
        try {
            navigation.currentEntry = {key: 'second'};
            navigation.dispatchEvent(new Event('currententrychange'));
            vi.advanceTimersByTime(300);
            expect(scan).toHaveBeenCalledTimes(1);
            navigation.currentEntry = {key: 'third'};
            navigation.dispatchEvent(new Event('currententrychange'));
            vi.advanceTimersByTime(300);
            expect(scan).toHaveBeenCalledTimes(2);
        } finally {
            observer.disconnect();
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });

    it("rescans edits to an existing text node", async () => {
        const scan = vi.fn();
        const observer = startDomListener({scanWholePage: scan, getLastUrl: () => location.href});
        document.querySelector("p")!.firstChild!.textContent = "Changed citation text";
        await vi.waitFor(() => expect(scan).toHaveBeenCalled(), {timeout: 3000});
        observer.disconnect();
    });

    it("skips a rescan when Word re-renders a paragraph without changing its text", async () => {
        vi.useFakeTimers();
        const scan = vi.fn();
        const observer = startDomListener({scanWholePage: scan, getLastUrl: () => location.href});
        try {
            const p = document.querySelector("p")!;
            p.firstChild!.textContent = "Changed citation text";
            await vi.advanceTimersByTimeAsync(2000);
            expect(scan).toHaveBeenCalledTimes(1);

            for (let i = 0; i < 5; i++) {
                p.replaceChildren(...[...p.childNodes].map((node) => node.cloneNode(true)));
                await vi.advanceTimersByTimeAsync(2000);
            }
            expect(scan).toHaveBeenCalledTimes(1);
        } finally {
            observer.disconnect();
            vi.useRealTimers();
        }
    });

    it("rescans when Word re-renders a reference with the same text but a different link", async () => {
        vi.useFakeTimers();
        const scan = vi.fn();
        const observer = startDomListener({scanWholePage: scan, getLastUrl: () => location.href});
        try {
            const p = document.querySelector("p")!;
            p.firstChild!.textContent = "Changed citation text";
            await vi.advanceTimersByTimeAsync(2000);
            expect(scan).toHaveBeenCalledTimes(1);

            const link = p.querySelector("a")!.cloneNode(true) as HTMLAnchorElement;
            link.setAttribute("href", "https://doi.org/10.1037/a0029709");
            p.replaceChild(link, p.querySelector("a")!);
            await vi.advanceTimersByTimeAsync(2000);
            expect(scan).toHaveBeenCalledTimes(2);
        } finally {
            observer.disconnect();
            vi.useRealTimers();
        }
    });

    it("waits for a pause in typing before rescanning", async () => {
        vi.useFakeTimers();
        const scan = vi.fn();
        const observer = startDomListener({scanWholePage: scan, getLastUrl: () => location.href});
        try {
            const text = document.querySelector("p")!.firstChild!;
            for (let i = 0; i < 10; i++) {
                text.textContent = `Typing ${"x".repeat(i)}`;
                await vi.advanceTimersByTimeAsync(400);
            }
            expect(scan, "no rescan while the author keeps typing").not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1600);
            expect(scan).toHaveBeenCalledTimes(1);
        } finally {
            observer.disconnect();
            vi.useRealTimers();
        }
    });
});
