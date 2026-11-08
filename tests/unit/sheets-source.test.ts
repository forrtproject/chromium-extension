import {describe, expect, it, vi} from "vitest";
import {fetchSheetCsv, parseSheetsUrl, sheetRowsByDoi, sheetTabKey} from "../../src/content-general/sheets";
import {safeSendMessage} from "../../src/shared/messages";

vi.mock("../../src/shared/messages", () => ({safeSendMessage: vi.fn()}));

describe("active Sheets source", () => {
    it("exports the linked query tab and follows a newer fragment selection", () => {
        expect(parseSheetsUrl("https://docs.google.com/spreadsheets/d/book/edit?gid=42"))
            .toEqual({spreadsheetId: "book", gid: "42"});
        expect(parseSheetsUrl("https://docs.google.com/spreadsheets/u/0/d/book/edit?gid=42"))
            .toEqual({spreadsheetId: "book", gid: "42"});
        expect(parseSheetsUrl("https://docs.google.com/spreadsheets/d/book/edit?gid=42#gid=99"))
            .toEqual({spreadsheetId: "book", gid: "99"});
        expect(sheetTabKey(parseSheetsUrl("https://docs.google.com/spreadsheets/d/other/edit#gid=99")))
            .not.toBe(sheetTabKey(parseSheetsUrl("https://docs.google.com/spreadsheets/d/book/edit#gid=99")));
    });

    it("distinguishes an empty tab from an unavailable export, allowing retry", async () => {
        const tab = {spreadsheetId: "book", gid: "42"};
        vi.mocked(safeSendMessage).mockResolvedValueOnce({error: "HTTP 403"});
        await expect(fetchSheetCsv(tab)).rejects.toThrow("HTTP 403");
        vi.mocked(safeSendMessage).mockResolvedValueOnce({csv: ""});
        await expect(fetchSheetCsv(tab)).resolves.toEqual({csv: "", fullTab: false});
        vi.mocked(safeSendMessage).mockResolvedValueOnce({csv: "a", fullTab: true});
        await expect(fetchSheetCsv(tab)).resolves.toEqual({csv: "a", fullTab: true});
        expect(safeSendMessage).toHaveBeenLastCalledWith({type: "FLORA_SHEET_FETCH", ...tab});
    });
});

describe("sheetRowsByDoi", () => {
    it("numbers rows as the sheet does, counting blank rows and quoted line breaks", () => {
        const csv = [
            "Study,DOI",
            "\"Two-line\nnote\",10.1000/first",
            ",",
            "Later,https://doi.org/10.1000/SECOND",
            "Again,10.1000/first",
        ].join("\r\n");
        const rows = sheetRowsByDoi(csv);
        expect(rows.get("10.1000/first")).toBe(2);
        expect(rows.get("10.1000/second")).toBe(4);
    });
});
