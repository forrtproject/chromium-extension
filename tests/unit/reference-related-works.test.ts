import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({email: "test@example.com", cacheQuotaMb: 50}),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/doi-validate", () => ({
    validateDOIs: vi.fn(async (dois: string[]) => new Map(dois.map((d) => [d, true]))),
}));

import {findReferenceEntries, beginDomScanPass} from "../../src/shared/doi-extractor";
import {resolveReferenceDois} from "../../src/content-general/references";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function load(body: string): void {
    document.documentElement.innerHTML = `<head></head><body>${body}</body>`;
    beginDomScanPass();
}

describe("lists of other works are not references", () => {
    it("skips OJS citation-plugin entries but keeps the printed references", async () => {
        load(`<div id="citation-plugin"><h2>Cited by</h2><ul class="citations">
                <li>Citing A. A paper that cites this one. Journal. 2022. https://doi.org/10.1111/citing.1</li>
                <li>Citing B. Another paper that cites this one. Journal. 2023. https://doi.org/10.1111/citing.2</li>
              </ul></div>
              <section class="item references"><h2>References</h2><ol>
                <li>Smith J. A printed reference. Journal. 2020. https://doi.org/10.2222/printed.1</li>
                <li>Jones K. Another printed reference. Journal. 2021. https://doi.org/10.2222/printed.2</li>
              </ol></section>`);

        const resolved = await resolveReferenceDois();

        expect(resolved.map((r) => r.doi).sort()).toEqual(["10.2222/printed.1", "10.2222/printed.2"]);
    });

    it("returns nothing for a Wiley Citing Literature section", async () => {
        load(`<section id="cited-by"><h2>Citing Literature</h2><ul>
                <li>Citing A. A paper that cites this one. Journal. 2022. https://doi.org/10.1111/citing.1</li>
                <li>Citing B. Another paper that cites this one. Journal. 2023. https://doi.org/10.1111/citing.2</li>
              </ul></section>`);

        expect(await resolveReferenceDois()).toEqual([]);
    });
});

describe("repeated custom-element reference entries", () => {
    const citation = (n: number) => `<citation><div class="citation"><div><div class="csl-entry">
        <div class="csl-left-margin">${n}.</div><div class="csl-right-inline">Author ${n}. A cited work number ${n}. Journal. 2020. https://doi.org/10.3333/cite.${n}</div>
        </div></div><a class="scholar-lookup-link" href="#">Google Scholar</a></div></citation>`;

    it("returns every component as an entry", () => {
        load(`<div id="article-citations"><h2>References</h2>${citation(1)}${citation(2)}${citation(3)}</div>`);

        const entries = findReferenceEntries(document);

        expect(entries.map((e) => e.element.tagName)).toEqual(["CITATION", "CITATION", "CITATION"]);
        expect(entries.flatMap((e) => e.dois)).toEqual(["10.3333/cite.1", "10.3333/cite.2", "10.3333/cite.3"]);
    });

    it("resolves every component", async () => {
        load(`<div id="article-citations"><h2>References</h2>${citation(1)}${citation(2)}${citation(3)}</div>`);

        const resolved = await resolveReferenceDois();

        expect(resolved).toHaveLength(3);
    });

    it("skips an entry whose descendant is already marked", async () => {
        load(`<div id="article-citations"><h2>References</h2>${citation(1)}${citation(2)}${citation(3)}</div>`);
        document.querySelector(".csl-entry")!.setAttribute("data-flora-ref-processed", "true");

        const resolved = await resolveReferenceDois();

        expect(resolved.map((r) => r.doi)).toEqual(["10.3333/cite.2", "10.3333/cite.3"]);
    });

    it("keeps list items when empty custom elements sit inside them", () => {
        load(`<ol class="references">
            <li>Author 1. First cited work. Journal. 2020. https://doi.org/10.4444/a.1 <mjx-c></mjx-c><mjx-c></mjx-c></li>
            <li>Author 2. Second cited work. Journal. 2021. https://doi.org/10.4444/a.2 <mjx-c></mjx-c></li>
          </ol>`);

        expect(findReferenceEntries(document).map((e) => e.element.tagName)).toEqual(["LI", "LI"]);
    });
});
