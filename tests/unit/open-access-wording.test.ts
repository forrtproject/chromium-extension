import {describe, expect, it} from "vitest";
import {readdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..", "..", "src");

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : /\.(ts|html)$/.test(name) ? [full] : [];
    });
}

// Unpaywall results are called "Open access" / "open-access version", never "free copy".
describe("open-access wording", () => {
    it("shows no 'free copy' or 'free copies' to readers", () => {
        const offenders: string[] = [];
        for (const file of files(SRC)) {
            let text = readFileSync(file, "utf-8").replace(/<!--[\s\S]*?-->/g, "");
            // Code comments are not shown to readers.
            if (file.endsWith(".ts")) text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
            // Collapse whitespace so a phrase wrapped across source lines still matches,
            // and allow one word between ("a free, legal copy").
            text = text.replace(/\s+/g, " ");
            for (const match of text.matchAll(/free(,?\s+\w+)?,?\s+cop(y|ies)/gi)) {
                offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
