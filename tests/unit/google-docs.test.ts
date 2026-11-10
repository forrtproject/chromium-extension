// @vitest-environment-options {"url":"https://docs.google.com/document/d/test-document/edit"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleDocsContentSnapshot, isReferenceCandidate, setGoogleDocsText, docsParagraphs, isGoogleDocs, startGoogleDocs, googleDocsReferenceElements, googleDocsAnnotationTarget, googleDocsAnnotatedReferences } from "../../src/shared/google-docs";
import { DOCS_TEXT_EVENT } from "../../src/content-docs/canvas";
import { validateDOIs } from "../../src/shared/doi-validate";
import { markerColumnLeft } from "../../src/shared/editor-marker";
import { beginDomScanPass, findReferenceEntries } from "../../src/shared/doi-extractor";
import { resolveReferenceDois, renderResolvedReferences } from "../../src/content-general/references";
vi.mock("../../src/shared/google-docs-source", () => ({fetchGoogleDocsText: vi.fn().mockRejectedValue(new Error("offline")), googleDocsExportUrl: (url: string) => url}));
vi.mock("../../src/shared/doi-validate", () => ({ validateDOIs: vi.fn(async (dois: string[]) => new Map(dois.map((doi) => [doi, !doi.startsWith("10.9999/")]))) }));
vi.mock("../../src/shared/pubpeer-api", () => ({ lookupPubPeerForDoi: vi.fn().mockResolvedValue(null) }));
vi.mock("../../src/shared/settings", () => ({ getSettings: vi.fn().mockResolvedValue({ email: 'test@example.com' }) }));
vi.mock("../../src/shared/openaccess", () => ({ fetchOpenAccess: vi.fn().mockResolvedValue(null), deferredOpenAccess: () => () => Promise.resolve(null) }));
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
    it('keeps the full-document revision stable across canvas redraws', () => {
        setGoogleDocsText('A full document with 10.1234/example');
        const revision = googleDocsContentSnapshot();
        emit({width: 816, height: 1056, runs});
        emit({width: 816, height: 1056, runs: []});
        expect(googleDocsContentSnapshot()).toBe(revision);
        setGoogleDocsText('Changed full document with 10.1234/other');
        expect(googleDocsContentSnapshot()).toBeGreaterThan(revision);
    });
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
        try {
            history.replaceState(null, '', '?tab=t.next');
            expect(googleDocsReferenceElements(document)).toEqual([]);
            expect(googleDocsAnnotatedReferences()).toEqual([]);
        } finally { history.replaceState(null, '', original); }
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
        expect(findReferenceEntries(document).flatMap(e => e.dois)).toEqual([DOI, '10.1037/h0054651']);
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
        expect(findReferenceEntries(document).flatMap(e => e.dois)).toEqual([DOI, '10.1037/h0054651']);
        const refs = await resolveReferenceDois();
        renderResolvedReferences(refs, new Map(), new Map());
        expect(document.querySelectorAll('.flora-docs-annotation [data-flora-marker]')).toHaveLength(2);
        expect(canvas.outerHTML).toBe(original);
        expect(googleDocsAnnotatedReferences()).toHaveLength(2);
    });
    it.each([
        ['a DOI in ordinary prose', 'We relied on the dataset at 10.5281/zenodo.123456 for this analysis.'],
        ['an APA reference without a DOI', 'Bem, D. J. (2011). Feeling the future: Experimental evidence for anomalous retroactive influences.'],
        ['a Vancouver reference without a DOI', 'Bem DJ. Feeling the future: experimental evidence for anomalous retroactive influences. J Pers Soc Psychol. 2011;100(3):407-25.'],
        ['a numbered reference without a DOI', '[12] Bem, D. J. Feeling the future: experimental evidence for anomalous retroactive influences, 2011.'],
    ])('treats %s as something to check', (_label, text) => {
        expect(isReferenceCandidate(text)).toBe(true);
    });
    it('ignores ordinary prose with no DOI', () => {
        expect(isReferenceCandidate('The study ran for most of 2011 and we discuss its limitations at length below.')).toBe(false);
    });
    describe('while the user types', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());
        const body = (text: string) => ({ text, x: 90, y: 20, width: 600, height: 16 });

        it('waits for typing to stop before scanning a new reference', () => {
            const typing = 'Bem, D. J. (2011). Feeling the future. https://doi.org/10.1037/a00215';
            emit({ width: 816, height: 1056, runs });
            vi.advanceTimersByTime(0);
            scan.mockClear();
            emit({ width: 816, height: 1056, runs: [...runs, {...runs[3], y: 260, text: typing}] });
            vi.advanceTimersByTime(1000);
            emit({ width: 816, height: 1056, runs: [...runs, {...runs[3], y: 260, text: typing + '24'}] });
            vi.advanceTimersByTime(1000);
            expect(scan).not.toHaveBeenCalled();
            vi.advanceTimersByTime(500);
            expect(scan).toHaveBeenCalledTimes(1);
        });

        it('does not rescan or redraw pills when only non-reference text changes', async () => {
            emit({ width: 816, height: 1056, runs });
            const refs = await resolveReferenceDois();
            renderResolvedReferences(refs, new Map(), new Map());
            const marker = document.querySelector('.flora-docs-annotation [data-flora-marker]');
            const revision = googleDocsContentSnapshot();
            for (const typed of ['I', 'In', 'Int', 'Intro']) {
                emit({ width: 816, height: 1056, runs: [...runs, body(typed)] });
                vi.advanceTimersByTime(200);
            }
            vi.advanceTimersByTime(2000);
            expect(scan).not.toHaveBeenCalled();
            expect(googleDocsContentSnapshot()).toBe(revision);
            expect(marker?.isConnected).toBe(true);
        });

        it('keeps rendered pills when Docs swaps in a new canvas with the same text', async () => {
            emit({ width: 816, height: 1056, runs });
            const refs = await resolveReferenceDois();
            renderResolvedReferences(refs, new Map(), new Map());
            const markers = [...document.querySelectorAll('.flora-docs-annotation [data-flora-marker]')];
            const old = document.querySelector('canvas')!;
            const fresh = document.createElement('canvas');
            fresh.className = 'kix-canvas-tile-content';
            old.replaceWith(fresh);
            await Promise.resolve();
            emit({ width: 816, height: 1056, runs });
            vi.advanceTimersByTime(0);
            expect(markers.every(marker => marker.isConnected)).toBe(true);
            expect(googleDocsAnnotatedReferences()).toHaveLength(2);
            vi.advanceTimersByTime(2000);
            expect(scan).not.toHaveBeenCalled();
        });

        it('keeps the pill and skips the rescan when only the text around a DOI changes', async () => {
            const sentence = (lead: string) => ({ text: `${lead} as shown by https://doi.org/10.1037/a0021524 in that study.`, x: 90, y: 260, width: 600, height: 16 });
            emit({ width: 816, height: 1056, runs: [...runs, sentence('Earlier work')] });
            const refs = await resolveReferenceDois();
            renderResolvedReferences(refs, new Map(), new Map());
            const marker = document.querySelector('.flora-docs-annotation [data-flora-doi="10.1037/a0021524"]');
            expect(marker).not.toBeNull();
            emit({ width: 816, height: 1056, runs: [...runs, sentence('Much earlier work')] });
            vi.advanceTimersByTime(2000);
            expect(scan).not.toHaveBeenCalled();
            expect(marker!.isConnected).toBe(true);
        });

        it('rescans once an edited reference settles', async () => {
            emit({ width: 816, height: 1056, runs });
            await resolveReferenceDois();
            emit({ width: 816, height: 1056, runs: [runs[0], runs[1], runs[2], {...runs[3], text: 'Stroop, J. R. (1935). Studies of interference. https://doi.org/10.1037/h0054652'}] });
            vi.advanceTimersByTime(1500);
            expect(scan).toHaveBeenCalledTimes(1);
        });
    });
    it('does not mark a DOI that doi.org does not know', async () => {
        emit({ width: 816, height: 1056, runs: [...runs, { text: '10.9999/not-a-real-doi-12345', x: 90, y: 260, width: 300, height: 16 }] });
        const refs = await resolveReferenceDois();
        renderResolvedReferences(refs, new Map(), new Map());
        expect(refs.map(ref => ref.doi)).not.toContain('10.9999/not-a-real-doi-12345');
        expect(document.querySelector('[data-flora-doi="10.9999/not-a-real-doi-12345"]')).toBeNull();
        expect(validateDOIs).toHaveBeenCalledWith(expect.arrayContaining(['10.9999/not-a-real-doi-12345']));
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
    describe('splitting a page into references', () => {
        const line = (text: string, y: number, x = 139, height = 19) => ({text, x, y, width: 600, height});
        const starts = (lines: ReturnType<typeof line>[]) => docsParagraphs(lines).map(p => p.text.slice(0, 12));
        const doiCount = (text: string) => text.match(/10\.\d{4,}\//g)?.length ?? 0;

        it('keeps indented references apart from the title and body above them', () => {
            const paragraphs = docsParagraphs([
                line('Replication in Psychology', 102, 96, 34),
                line('The replication debate turned on a handful of findings', 157, 96),
                line('from several well known studies.', 179, 96),
                line('References', 215, 96, 22),
                line('Bargh, J. A. (1996). Automaticity of social behavior.', 250),
                line('https://doi.org/10.1037/0022-3514.71.2.230', 272),
                line('Bem, D. J. (2011). Feeling the future.', 308),
                line('https://doi.org/10.1037/a0021524', 330),
            ]);
            expect(paragraphs.filter(p => doiCount(p.text) > 0).map(p => [p.text.slice(0, 5), doiCount(p.text)])).toEqual([['Bargh', 1], ['Bem, ', 1]]);
            expect(paragraphs[0].text).toBe('Replication in Psychology');
            expect(paragraphs.find(p => p.text.startsWith('Bargh'))!.y).toBe(250);
        });
        it('does not read a wrapped author name as a new reference', () => {
            expect(starts([
                line('Hagger, M. S., Chatzisarantis, N. L. D., Anggono, C. O.,', 100),
                line('Batailler, C., et al. (2016). A multilab replication.', 122),
                line('https://doi.org/10.1177/1745691616652873', 144),
                line('Ranehill, E., Dreber, A., Sul, S., &', 180),
                line('Weber, R. A. (2015). Assessing the robustness.', 202),
                line('https://doi.org/10.1177/0956797614553946', 224),
            ])).toEqual(['Hagger, M. S', 'Ranehill, E.']);
        });
        it('starts a new reference after a finished DOI when the next author is an organization', () => {
            const paragraphs = docsParagraphs([
                line('Doyen, S. (2012). Behavioral priming.', 100),
                line('https://doi.org/10.1371/journal.pone.0029081', 122),
                line('Open Science Collaboration. (2015). Estimating reproducibility.', 144),
                line('https://doi.org/10.1126/science.aac4716', 166),
            ]);
            expect(paragraphs.map(p => doiCount(p.text))).toEqual([1, 1]);
        });
        it('still joins a DOI that wraps onto the next line', () => {
            const paragraphs = docsParagraphs([
                line('Bargh, J. A. (1996). Automaticity. https://doi.org/10.1037/0022-', 100),
                line('3514.71.2.230', 122),
                line('Bem, D. J. (2011). Feeling the future. https://doi.org/10.1037/a0021524', 144),
            ]);
            expect(paragraphs).toHaveLength(2);
            expect(paragraphs[0].text).toContain('10.1037/0022-3514.71.2.230');
        });
        it('keeps DOIs listed one per line as separate DOIs', () => {
            const paragraphs = docsParagraphs([
                line('10.1126/science.1201068', 100),
                line('10.9999/not-a-real-doi-12345', 122),
                line('10.1037/a0021524', 144),
            ]);
            expect(paragraphs.map(p => p.text)).toEqual(['10.1126/science.1201068', '10.9999/not-a-real-doi-12345', '10.1037/a0021524']);
        });
        it('keeps the two DOIs of one reference together', () => {
            const paragraphs = docsParagraphs([
                line('Smith, J. (2020). Original https://doi.org/10.1234/first and', 100),
                line('corrected version https://doi.org/10.1234/second', 122),
            ]);
            expect(paragraphs).toHaveLength(1);
            expect(doiCount(paragraphs[0].text)).toBe(2);
        });
    });
    describe('a reference that crosses a page break', () => {
        const WHOLE = 'Wakefield, A. J., Murch, S. H. (1998). Ileal-lymphoid-nodular hyperplasia in children. The Lancet, 351(9103), 637–641. https://doi.org/10.1016/S0140-6736(97)11096-0';
        const pageEnd = {text: 'Wakefield, A. J., Murch, S. H. (1998). Ileal-lymphoid-nodular hyperplasia in children. The', x: 139, y: 887, width: 600, height: 19};
        const pageStart = [
            {text: 'Lancet, 351(9103), 637–641.', x: 139, y: 99, width: 300, height: 19},
            {text: 'https://doi.org/10.1016/S0140-6736(97)11096-0', x: 139, y: 121, width: 400, height: 19},
        ];
        function twoPages(): [HTMLCanvasElement, HTMLCanvasElement] {
            const first = document.querySelector('canvas')!;
            const second = document.createElement('canvas');
            second.className = 'kix-canvas-tile-content';
            first.after(second);
            return [first, second];
        }
        const emitOn = (canvas: HTMLCanvasElement, snapshot: unknown) => canvas.dispatchEvent(new CustomEvent(DOCS_TEXT_EVENT, {bubbles: true, detail: JSON.stringify(snapshot)}));

        it('marks the first page with the whole reference and adds nothing on the next', () => {
            const [first, second] = twoPages();
            setGoogleDocsText(WHOLE);
            emitOn(first, {width: 816, height: 1056, runs: [pageEnd]});
            emitOn(second, {width: 816, height: 1056, runs: pageStart});
            const onCanvas = googleDocsReferenceElements(document).filter(el => googleDocsAnnotationTarget(el));
            expect(onCanvas.map(el => el.textContent)).toEqual([WHOLE]);
            expect(document.querySelectorAll('.flora-docs-annotation')).toHaveLength(1);
        });
        it('finds the DOI even while the next page is not rendered', () => {
            const [first] = twoPages();
            setGoogleDocsText(WHOLE);
            emitOn(first, {width: 816, height: 1056, runs: [pageEnd]});
            expect(googleDocsReferenceElements(document).filter(el => googleDocsAnnotationTarget(el)).map(el => el.textContent)).toEqual([WHOLE]);
        });
        it('falls back to the rendered text when the export is unavailable', () => {
            const [, second] = twoPages();
            setGoogleDocsText('');
            emitOn(second, {width: 816, height: 1056, runs: pageStart});
            expect(googleDocsReferenceElements(document).map(el => el.textContent)).toEqual(['Lancet, 351(9103), 637–641. https://doi.org/10.1016/S0140-6736(97)11096-0']);
        });
    });
    describe('the marker column', () => {
        afterEach(() => vi.unstubAllGlobals());
        it('stays clear of the FORRT tab on a narrow window', () => {
            vi.stubGlobal('innerWidth', 1280);
            expect(markerColumnLeft(1129)).toBe(1094);
        });
        it('stays beside the page on a wide window', () => {
            vi.stubGlobal('innerWidth', 1920);
            expect(markerColumnLeft(1129)).toBe(1129);
        });
        it('keeps a row with several pills on screen', () => {
            vi.stubGlobal('innerWidth', 1280);
            expect(markerColumnLeft(1129, 223) + 223).toBeLessThanOrEqual(1280 - 28);
        });
    });
    it('rejects malformed bridge snapshots and events from unrelated canvas elements', () => {
        emit({ width: 816, height: 1056, runs: [{ text: 'bad', x: 0, y: 0, width: -1, height: 16 }] });
        expect(googleDocsReferenceElements(document)).toEqual([]);
        document.querySelector('canvas')!.className = 'toolbar';
        emit({ width: 816, height: 1056, runs });
        expect(googleDocsReferenceElements(document)).toEqual([]);
    });
});
