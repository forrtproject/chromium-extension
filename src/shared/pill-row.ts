export const PILL_ROW_CLASS = "flora-pill-row";

const PILL_ROW_STYLE =
    "display: block !important; line-height: 0 !important; margin: 4px 0 2px 0 !important;"
    + " padding: 0 !important; text-indent: 0 !important; text-align: start !important;"
    + " float: none !important; width: auto !important;";

export function pillRow(pill: HTMLElement): HTMLElement {
    const row = document.createElement("span");
    row.className = PILL_ROW_CLASS;
    row.setAttribute("data-flora-ui", "");
    row.style.cssText = PILL_ROW_STYLE;
    pill.style.setProperty("margin-inline-start", "0", "important");
    row.appendChild(pill);
    return row;
}
