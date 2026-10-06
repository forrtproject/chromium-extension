import {describe, expect, it} from "vitest";
import {webUrl} from "../../src/shared/web-url";

describe("webUrl", () => {
    it("returns the destination it validated, not the raw text", () => {
        expect(webUrl("https:repo.example.org/paper.pdf")).toBe("https://repo.example.org/paper.pdf");
    });

    it("rejects anything but http(s)", () => {
        expect(webUrl("javascript:alert(1)")).toBeNull();
        expect(webUrl("data:text/html,x")).toBeNull();
        expect(webUrl("not a url")).toBeNull();
    });
});
