export const MARKER_COLUMN_WIDTH = 150;
export const MARKER_EDGE_GAP = 8;
const PANEL_TAB_WIDTH = 28;

export function markerColumnLeft(columnLeft: number, rowWidth = 0): number {
    const width = Math.max(rowWidth, MARKER_COLUMN_WIDTH);
    return Math.max(0, Math.min(columnLeft, window.innerWidth - PANEL_TAB_WIDTH - width - MARKER_EDGE_GAP));
}
