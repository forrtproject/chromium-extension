const NAMED_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", thinsp: " ", ensp: " ", emsp: " ",
    ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};
const TAG = /<\/?([a-z][a-z0-9]*)[^<>]*>/gi;
const TIGHT_TAGS = new Set(["sub", "sup"]);

function stripTags(text: string): string {
    return text
        .replace(TAG, (_tag, name: string) => (TIGHT_TAGS.has(name.toLowerCase()) ? "" : "\u0000"))
        .replace(/\u0000+/g, (run: string, offset: number, whole: string) =>
            /\p{L}/u.test(whole[offset - 1] ?? "") && /\p{L}/u.test(whole[offset + run.length] ?? "") ? " " : "");
}

export function decodeEntities(raw: string): string {
    return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        if (entity[0] === "#") {
            const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}

export function plainTitle(raw: string | null | undefined): string {
    let text = raw ?? "";
    for (let pass = 0; pass < 3; pass++) {
        const next = decodeEntities(stripTags(text));
        if (next === text) break;
        text = next;
    }
    return stripTags(text).replace(/[\s ]+/g, " ").trim();
}
