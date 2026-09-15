// @vitest-environment-options {"url":"https://docs.google.com/document/d/test-document/edit"}
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setGoogleDocsText, docsParagraphs, isGoogleDocs, startGoogleDocs, googleDocsReferenceElements, googleDocsAnnotationTarget, googleDocsAnnotatedReferences } from "../../src/shared/google-docs";
import { DOCS_TEXT_EVENT } from "../../src/content-docs/canvas";
import { beginDomScanPass, findReferenceEntries } from "../../src/shared/doi-extractor";
import { resolveReferenceDois, renderResolvedReferences } from "../../src/content-general/references";
vi.mock("../../src/shared/google-docs-source", () => ({fetchGoogleDocsText: vi.fn().mockRejectedValue(new Error("offline")), googleDocsExportUrl: (url: string) => url}));
vi.mock("../../src/shared/pubpeer-api", () => ({ lookupPubPeerForDoi: vi.fn().mockResolvedValue(null) }));
vi.mock("../../src/shared/settings", () => ({ getSettings: vi.fn().mockResolvedValue({ email: 'test@example.com' }) }));
vi.mock("../../src/shared/openaccess", () => ({ fetchOpenAccess: vi.fn().mockResolvedValue(null) }));
const DOI = '10.1111/j.1467-9280.2009.02426.x';
const scan = vi.fn();
const runs = [
    { text: 'Jostmann, N. B., Lakens, D., & Schubert, T. W. (2009). Weight as an embodiment of importance.', x: 90, y: 100, width: 600, height: 16 },
    { text: 'Psychological Science, 20, 1169–1174. https://doi.org/10.1111/j.1467-', x: 120, y: 132, width: 570, height: 16 },
    { text: '9280.2009.02426.x', x: 120, y: 164, width: 130, height: 16 },
    { text: 'Stroop, J. R. (1935). Studies of interference. https://doi.org/10.1037/h0054651', x: 90, y: 210, width: 600, height: 16 },
];
function emit(data: unknown) { document.querySelector('canvas')!.dispatchEvent(new CustomEvent(DOCS_TEXT_EVENT, { bubbles: true, detail: JSON.stringify(data) })); }
beforeEach(() => {
    document.body.innerHTML = '<div class="kix-appview"><div class="kix-appview-editor"><canvas class="kix-canvas-tile-content"></canvas></div></div>';
    setGoogleDocsText('');
    beginDomScanPass();
    startGoogleDocs(scan);
    scan.mockClear();
});
describe('Google Docs reference adapter', () => {
    it('joins an uppercase DOI continuation', () => {
        const paragraphs = docsParagraphs([
            {text: 'Smith, J. (2020). A reference https://doi.org/10.1234/ABC-', x: 90, y: 100, width: 500, height: 16},
            {text: 'DEF123', x: 120, y: 132, width: 100, height: 16},
        ]);
        expect(paragraphs[0].text).toContain('10.1234/ABC-DEF123');
    });
    it('does not return an old export immediately after tab navigation', () => {
        const original = location.href;
        setGoogleDocsText('Smith, J. (2020). A reference https://doi.org/10.1234/example');
        history.replaceState(null, '', '?tab=t.next');
        expect(googleDocsReferenceElements(document)).toEqual([]);
        expect(googleDocsAnnotatedReferences()).toEqual([]);
        history.replaceState(null, '', original);
    });
    it('finds and reports offscreen references without scrolling or a rendered canvas', async () => {
        document.querySelector('canvas')!.remove();
        const citation = `Stroop, J. R. (1935). Studies of interference. https://doi.org/10.1037/h0054651`;
        setGoogleDocsText('Title page\n\nReferences\n' + citation);
        const refs = await resolveReferenceDois();
        expect(refs.map(ref => ref.doi)).toEqual(['10.1037/h0054651']);
        renderResolvedReferences(refs, new Map(), new Map());
        expect(googleDocsAnnotatedReferences()).toEqual([{doi: '10.1037/h0054651', title: citation}]);
        expect(document.querySelector('.flora-docs-annotation')).toBeNull();
        // An unchanged export keeps resolved data; removing a citation removes it from the report.
        setGoogleDocsText(citation);
        expect(googleDocsAnnotatedReferences()).toHaveLength(1);
        setGoogleDocsText('Title page');
        expect(googleDocsAnnotatedReferences()).toEqual([]);
    });
    it('removes canvas bidi delimiters before extracting DOI lookup keys', () => {
        emit({width: 816, height: 1056, runs: runs.map(run => ({...run, text: '\u202a' + run.text + '\u202c'}))});
        expect(findReferenceEntries(document).map(e => e.doi)).toEqual([DOI, '10.1037/h0054651']);
    });
    it('orders mixed-font fragments by horizontal position', () => {
        const paragraphs = docsParagraphs([
            {text: 'Journal title', x: 200, y: 99, width: 100, height: 17},
            {text: 'Author (2020).', x: 90, y: 100, width: 105, height: 16},
        ]);
        expect(paragraphs[0].text).toBe('Author (2020). Journal title');
    });
    it('is restricted to Docs documents, including account-specific paths', () => {
        expect(isGoogleDocs()).toBe(true);
        expect(isGoogleDocs('https://docs.google.com/document/u/1/d/id/edit')).toBe(true);
        expect(isGoogleDocs('https://docs.google.com/spreadsheets/d/id/edit')).toBe(false);
        expect(isGoogleDocs('https://evil.test/document/d/id/edit')).toBe(false);
    });
    it('joins wrapped DOIs and keeps adjacent APA citations separate', () => {
        const paragraphs = docsParagraphs(runs);
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].text).toContain(DOI);
    });
    it('resolves canvas references through the existing pipeline without touching the canvas', async () => {
        const canvas = document.querySelector('canvas')!;
        const original = canvas.outerHTML;
        emit({ width: 816, height: 1056, runs });
        expect(findReferenceEntries(document).map(e => e.doi)).toEqual([DOI, '10.1037/h0054651']);
        const refs = await resolveReferenceDois();
        renderResolvedReferences(refs, new Map(), new Map());
        expect(document.querySelectorAll('.flora-docs-annotation [data-flora-marker]')).toHaveLength(2);
        expect(canvas.outerHTML).toBe(original);
        expect(googleDocsAnnotatedReferences()).toHaveLength(2);
        await vi.waitFor(() => expect(scan).toHaveBeenCalled());
    });
    it('preserves markers on an unchanged redraw, but removes edited references', () => {
        emit({ width: 816, height: 1056, runs });
        const old = googleDocsReferenceElements(document);
        googleDocsAnnotationTarget(old[0]);
        emit({ width: 816, height: 1056, runs });
        expect(googleDocsReferenceElements(document)[0]).toBe(old[0]);
        emit({ width: 816, height: 1056, runs: [] });
        expect(googleDocsReferenceElements(document)).toEqual([]);
        expect(document.querySelector('.flora-docs-annotation')).toBeNull();
    });
    it('aligns different-length references at the page margin at a different zoom', () => {
        vi.spyOn(document.querySelector('canvas')!, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, width: 408, height: 528 } as DOMRect);
        vi.spyOn(document.querySelector('.kix-appview-editor')!, 'getBoundingClientRect').mockReturnValue({ top: 80, bottom: 800 } as DOMRect);
        emit({ width: 816, height: 1056, runs });
        const refs = googleDocsReferenceElements(document);
        const row = googleDocsAnnotationTarget(refs[0])!;
        const secondRow = googleDocsAnnotationTarget(refs[1])!;
        expect(secondRow.style.left).toBe(row.style.left);
        expect(secondRow.style.top).toBe('205px');
        expect(row.style.top).toBe('150px');
        expect(row.style.left).toBe('620px');
        expect(row.style.visibility).toBe('visible');
    });
    it('rejects malformed bridge snapshots and events from unrelated canvas elements', () => {
        emit({ width: 816, height: 1056, runs: [{ text: 'bad', x: 0, y: 0, width: -1, height: 16 }] });
        expect(googleDocsReferenceElements(document)).toEqual([]);
        document.querySelector('canvas')!.className = 'toolbar';
        emit({ width: 816, height: 1056, runs });
        expect(googleDocsReferenceElements(document)).toEqual([]);
    });
});
