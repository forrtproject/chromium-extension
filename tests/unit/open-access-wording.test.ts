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
            for (const line of text.split("\n")) {
                if (/free\s+cop(y|ies)/i.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
