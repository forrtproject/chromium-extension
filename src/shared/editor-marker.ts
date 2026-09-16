export const MARKER_COLUMN_WIDTH = 124;
export const MARKER_EDGE_GAP = 8;

export function markerColumnLeft(columnLeft: number): number {
    return Math.max(0, Math.min(columnLeft, window.innerWidth - MARKER_COLUMN_WIDTH - MARKER_EDGE_GAP));
}
