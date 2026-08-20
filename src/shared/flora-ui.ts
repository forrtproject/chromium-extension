// Recognising FLoRA's own injected UI.
//
// Two passes need this: DOI extraction (don't rescan the DOI our own pill
// prints) and the page's DOM listener (don't treat our own rendering as a page
// change and rescan in a loop).

export const FLORA_UI_SELECTOR = "[data-flora-ui]";

const FLORA_OWNED_PARTS = [FLORA_UI_SELECTOR, '[id^="flora-"]'];

export const FLORA_OWNED_SELECTOR = FLORA_OWNED_PARTS.join(", ");

const FOCUS_STYLE_ID = "flora-focus-style";

export function ensureFocusStyle(): void {
    if (document.getElementById(FOCUS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FOCUS_STYLE_ID;
    const focused = FLORA_OWNED_PARTS.flatMap((part) => [
        `${part}:focus-visible`,
        `${part} :focus-visible`,
    ]);
    style.textContent =
        `${focused.join(", ")} { outline: 2px solid #853953; outline-offset: 2px; }`;
    (document.head ?? document.documentElement).appendChild(style);
}

export function owningElement(node: Node): Element | null {
    if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    return null;
}

/** True for nodes FLoRA injected itself. */
export function isFloraOwnedNode(node: Node): boolean {
    const el = owningElement(node);
    if (!el) return true;
    // getAttribute, not el.id: a page can shadow that convenience property —
    // a <form> with a field named "id" exposes the field as el.id, and calling
    // startsWith on it throws. The attribute is what FLORA_OWNED_SELECTOR reads.
    if ((el.getAttribute("id") ?? "").startsWith("flora-")) return true;
    for (const c of el.classList) {
        if (c.startsWith("flora-")) return true;
    }
    // Nodes swapped into a pill when its async lookups land carry no flora-
    // class of their own — they are only identifiable by an ancestor's marker.
    return el.closest(FLORA_OWNED_SELECTOR) !== null;
}

/** True when a mutation is a real page change rather than FLoRA's own rendering. */
export function isExternalMutation(m: MutationRecord): boolean {
    if (m.addedNodes.length === 0) return false;
    if ((m.target as Element).closest?.(FLORA_OWNED_SELECTOR)) return false;
    for (const node of m.addedNodes) {
        if (!isFloraOwnedNode(node)) return true;
    }
    return false;
}
