import {describe, expect, it} from "vitest";
import {plainTitle} from "../../src/shared/plain-title";

describe("plainTitle", () => {
    it.each([
        ["A&amp;nbsp;replication study", "A replication study"],
        ["<i>Fusobacterium nucleatum</i> infection", "Fusobacterium nucleatum infection"],
        ["&lt;em&gt;Drosophila melanogaster&lt;/em&gt; to high", "Drosophila melanogaster to high"],
        ["<scp>DNA</scp> barcoding", "DNA barcoding"],
        ["Nunn &amp; Wantchekon", "Nunn & Wantchekon"],
        ["High<i>Δ</i><sup>9</sup>-Tetrahydrocannabinol", "High Δ9-Tetrahydrocannabinol"],
        ["Yielding<i>Cannabis sativa</i>L.", "Yielding Cannabis sativa L."],
        ["CO<sub>2</sub> uptake", "CO2 uptake"],
        ["<i>p</i>-values", "p-values"],
        ["&#916;9 and &#x394;9", "Δ9 and Δ9"],
        ["IQ < 70 and > 50", "IQ < 70 and > 50"],
        ["  spaced \n  out title  ", "spaced out title"],
        ["&constructor; and &__proto__;", "&constructor; and &__proto__;"],
        ["", ""],
        [null, ""],
        [undefined, ""],
    ])("%j becomes %j", (raw, expected) => {
        expect(plainTitle(raw)).toBe(expected);
    });
});
