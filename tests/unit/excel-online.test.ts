import {describe, expect, it} from "vitest";
import {isExcelOnline} from "../../src/shared/excel-online";
import {isWordOnline} from "../../src/shared/word-online";

const EDITOR = "https://excel.officeapps.live.com/x/_layouts/xlviewerinternal.aspx?unified=1&ui=en-US";

describe("Excel for the web", () => {
    it("recognises the editor frame the grid actually lives in", () => {
        expect(isExcelOnline(EDITOR)).toBe(true);
    });

    it("recognises the other /x/_layouts entry points", () => {
        expect(isExcelOnline("https://excel.officeapps.live.com/x/_layouts/xlviewer.aspx?id=1")).toBe(true);
        expect(isExcelOnline("https://uk-002.officeapps.live.com/x/_layouts/XlEditor.aspx")).toBe(true);
    });

    it("is not the shell the reader navigates to", () => {
        expect(isExcelOnline("https://excel.cloud.microsoft/open/onedrive/?docId=1")).toBe(false);
    });

    it("does not answer for Word, and Word does not answer for it", () => {
        const word = "https://ukc-word-edit.officeapps.live.com/we/wordeditorframe.aspx?ui=en-US";
        expect(isExcelOnline(word)).toBe(false);
        expect(isWordOnline(EDITOR)).toBe(false);
    });

    it("ignores a lookalike host", () => {
        expect(isExcelOnline("https://officeapps.live.com.evil.test/x/_layouts/xlviewer.aspx")).toBe(false);
        expect(isExcelOnline("http://excel.officeapps.live.com/x/_layouts/xlviewer.aspx")).toBe(false);
    });
});

import {excelRows} from "../../src/shared/excel-online";
import {extractDOIsFromText} from "../../src/shared/doi-extractor";

const cell = (text: string, x: number, y: number) => ({text, x, y, width: text.length * 7, height: 14});

describe("reading the Excel grid back off the canvas", () => {
    it("rebuilds a row from the cells painted across it", () => {
        expect(excelRows([
            cell("10.1002/bdm.2178", 240, 71),
            cell("Klein et al.", 20, 71),
            cell("Study", 20, 31),
            cell("DOI", 240, 31),
        ])).toEqual(["Study DOI", "Klein et al. 10.1002/bdm.2178"]);
    });

    it("keeps neighbouring cells apart so they cannot fuse into a false DOI", () => {
        const rows = excelRows([cell("10.1177", 20, 40), cell("2515245918810225", 200, 40)]);
        expect(rows).toEqual(["10.1177 2515245918810225"]);
        expect(extractDOIsFromText(rows.join("\n")), "a split pair is not a DOI").toEqual([]);
    });

    it("groups by painted line, not by exact pixel", () => {
        expect(excelRows([cell("A", 20, 40), cell("B", 120, 43), cell("C", 20, 90)]))
            .toEqual(["A B", "C"]);
    });

    it("yields the DOIs a sheet actually carries", () => {
        const text = excelRows([
            cell("Klein et al.", 20, 71), cell("10.1177/2515245918810225", 240, 71),
            cell("Gneezy", 20, 111), cell("10.1002/bdm.2178", 240, 111),
        ]).join("\n");
        expect(extractDOIsFromText(text)).toEqual(["10.1177/2515245918810225", "10.1002/bdm.2178"]);
    });

    it("drops blank rows rather than reporting empty cells", () => {
        expect(excelRows([cell("   ", 20, 40), cell("real", 20, 90)])).toEqual(["real"]);
    });
});
