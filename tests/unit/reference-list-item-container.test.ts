import {describe, expect, it} from "vitest";
import {beginDomScanPass, findReferenceEntries} from "../../src/shared/doi-extractor";

describe("a list item as the reference container", () => {
    it("keeps the citation items nested inside it", () => {
        document.body.innerHTML = `<ul>
            <li class="references"><h2>References</h2><ol>
              <li>Smith J. Title. Journal. 2020. doi:10.1234/first</li>
              <li>Jones K. Another. 2021. doi:10.5678/second</li>
            </ol></li>
          </ul>`;
        beginDomScanPass();
        const entries = findReferenceEntries(document);
        expect(entries.map((e) => e.element.tagName)).toEqual(["LI", "LI"]);
        expect(entries.map((e) => e.dois)).toEqual([["10.1234/first"], ["10.5678/second"]]);
    });
});
