// @vitest-environment-options {"url":"https://excel.officeapps.live.com/x/_layouts/xlviewerinternal.aspx?ui=en-US"}
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {startExcelOnline, excelOnlineText, excelContentRevision, excelRetainedRowCount, excelWorkbookKey, _resetExcelForTesting} from "../../src/shared/excel-online";
import {EXCEL_TEXT_EVENT} from "../../src/content-docs/canvas";
import {extractDOIsFromText} from "../../src/shared/doi-extractor";

const cell = (text: string, x: number, y: number) => ({text, x, y, width: text.length * 7, height: 14});

function paint(canvas: HTMLCanvasElement, runs: ReturnType<typeof cell>[]): void {
    canvas.dispatchEvent(new CustomEvent(EXCEL_TEXT_EVENT, {
        bubbles: true, detail: JSON.stringify({width: 768, height: 1024, runs}),
    }));
}

function tile(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = "ewr-sheettable";
    document.body.appendChild(canvas);
    return canvas;
}

beforeEach(() => {
    document.body.innerHTML = "";
    _resetExcelForTesting();
});

const SHEET_URL = location.href;
afterEach(() => {
    vi.useRealTimers();
    history.replaceState(null, "", SHEET_URL);
});

describe("what the Excel grid hands the scan", () => {
    it("turns painted cells into the DOIs the sheet carries", () => {
        startExcelOnline(() => {});
        paint(tile(), [
            cell("Study", 20, 31), cell("DOI", 240, 31),
            cell("Klein et al.", 20, 71), cell("10.1177/2515245918810225", 240, 71),
            cell("Gneezy", 20, 111), cell("10.1002/bdm.2178", 240, 111),
        ]);
        expect(extractDOIsFromText(excelOnlineText()))
            .toEqual(["10.1177/2515245918810225", "10.1002/bdm.2178"]);
    });

    it("merges every tile the grid is painted across", () => {
        startExcelOnline(() => {});
        paint(tile(), [cell("10.1177/2515245918810225", 240, 71)]);
        paint(tile(), [cell("10.1002/bdm.2178", 240, 71)]);
        expect(extractDOIsFromText(excelOnlineText())).toHaveLength(2);
    });

    it("keeps a DOI it has already seen when Excel recycles the tile", () => {
        startExcelOnline(() => {});
        const canvas = tile();
        paint(canvas, [cell("Klein et al.", 20, 71), cell("10.1002/bdm.2178", 240, 71)]);
        expect(excelOnlineText()).toContain("10.1002/bdm.2178");
        canvas.remove();
        expect(excelOnlineText(), "scrolling away must not un-find a DOI")
            .toContain("10.1002/bdm.2178");
    });

    it("accumulates across a scroll instead of sliding a window over the sheet", () => {
        startExcelOnline(() => {});
        const first = tile();
        paint(first, [cell("10.1177/2515245918810225", 240, 71)]);
        first.remove();
        paint(tile(), [cell("10.1002/bdm.2178", 240, 71)]);
        expect(extractDOIsFromText(excelOnlineText()).sort())
            .toEqual(["10.1002/bdm.2178", "10.1177/2515245918810225"]);
    });

    it("retains only rows that carry a DOI, so a big sheet cannot grow unbounded", () => {
        startExcelOnline(() => {});
        const canvas = tile();
        paint(canvas, [cell("Revenue", 20, 31), cell("42", 240, 31),
                       cell("Paper", 20, 71), cell("10.1002/bdm.2178", 240, 71)]);
        canvas.remove();
        expect(excelRetainedRowCount()).toBe(1);
        expect(excelOnlineText()).not.toContain("Revenue");
    });

    it("drops what it remembered when the frame opens another workbook", () => {
        startExcelOnline(() => {});
        paint(tile(), [cell("Paper", 20, 71), cell("10.1002/bdm.2178", 240, 71)]);
        expect(excelOnlineText()).toContain("10.1002/bdm.2178");

        history.replaceState(null, "", "/x/_layouts/xlviewerinternal.aspx?wopisrc=another-workbook");
        document.body.innerHTML = "";
        paint(tile(), [cell("Other", 20, 71), cell("10.1177/2515245918810225", 240, 71)]);

        expect(excelWorkbookKey()).toBe("another-workbook");
        expect(excelOnlineText(), "rows from the previous workbook are not this sheet's")
            .not.toContain("10.1002/bdm.2178");
        expect(excelOnlineText()).toContain("10.1177/2515245918810225");
    });

    it("runs after the workbook test on the URL it started with", () => {
        expect(excelWorkbookKey(), "a test must not leave the worker on another workbook")
            .not.toBe("another-workbook");
    });

    it("moves the revision on so a redraw retriggers the scan", () => {
        startExcelOnline(() => {});
        const before = excelContentRevision();
        paint(tile(), [cell("10.1002/bdm.2178", 240, 71)]);
        expect(excelContentRevision()).toBeGreaterThan(before);
    });

    it("refuses a malformed snapshot rather than trusting it", () => {
        startExcelOnline(() => {});
        const canvas = tile();
        canvas.dispatchEvent(new CustomEvent(EXCEL_TEXT_EVENT, {
            bubbles: true, detail: JSON.stringify({width: 0, height: 0, runs: [{text: 1}]}),
        }));
        expect(excelOnlineText()).toBe("");
    });

    it("notifies the scan when a tile lands", async () => {
        const onChange = vi.fn();
        vi.useFakeTimers();
        startExcelOnline(onChange);
        paint(tile(), [cell("10.1002/bdm.2178", 240, 71)]);
        await vi.advanceTimersByTimeAsync(400);
        expect(onChange).toHaveBeenCalled();
    });
});
