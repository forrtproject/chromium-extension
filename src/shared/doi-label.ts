// Shared constants for FLoRA's inline pills.
//
// The DOI/Open Access/PubPeer/retraction indicators now render as one merged
// pill (see indicator-pill.ts); what remains here is the artwork and class
// name that the merged pill and the retraction notice pill both reference.

// Shared class for the inline notice pill (retraction or expression of concern).
// Exported so doi-retraction.ts can tag its wrapper.
export const FLORA_NOTICE_PILL_CLASS = "flora-notice-pill";

// Open padlock — shown inside the merged pill's Open Access segment and row.
export const OA_UNLOCK_SVG =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">` +
    `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
