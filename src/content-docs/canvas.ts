/** Read-only text/geometry capture for Google Docs' canvas renderer.
 * Runs at document_start in MAIN. Never edits document content or calls Google
 * internals. Only document tiles publish snapshots, and nothing leaves the tab. */
export interface CanvasRun {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
export const DOCS_TEXT_EVENT = "flora-docs-rendered-text";
export const DOCS_REQUEST_EVENT = "flora-docs-request-text";
const TILE = "canvas.kix-canvas-tile-content";
const MAX_RUNS = 4000;
export function installDocsCanvasCapture(): () => void {
    const snapshots = new WeakMap<HTMLCanvasElement, CanvasRun[]>();
    const timers = new Map<HTMLCanvasElement, ReturnType<typeof setTimeout>>();
    let active = true;
    const restore: (() => void)[] = [];
    const proto = CanvasRenderingContext2D.prototype;
    const originals = {fillText: proto.fillText, clearRect: proto.clearRect, fillRect: proto.fillRect, drawImage: proto.drawImage};
    const measure = proto.measureText;
    const publish = (canvas: HTMLCanvasElement) => {
        timers.delete(canvas);
        if (!active || !canvas.isConnected || !canvas.matches(TILE))
            return;
        canvas.dispatchEvent(new CustomEvent(DOCS_TEXT_EVENT, { bubbles: true, detail: JSON.stringify({
                width: canvas.width, height: canvas.height, runs: snapshots.get(canvas) ?? [],
            }) }));
    };
    const changed = (canvas: HTMLCanvasElement) => {
        if (canvas.isConnected && canvas.matches(TILE) && !timers.has(canvas))
            timers.set(canvas, setTimeout(() => publish(canvas), 100));
    };
    const bounds = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
        const m = ctx.getTransform();
        const points = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => ({ x: m.a * a + m.c * b + m.e, y: m.b * a + m.d * b + m.f }));
        const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
        return { x: left, y: top, width: Math.max(...points.map(p => p.x)) - left, height: Math.max(...points.map(p => p.y)) - top };
    };
    const erase = (canvas: HTMLCanvasElement, box: Omit<CanvasRun, "text">) => {
        const runs = snapshots.get(canvas);
        if (!runs)
            return;
        snapshots.set(canvas, runs.filter(r => r.x + r.width <= box.x || r.x >= box.x + box.width || r.y + r.height <= box.y || r.y >= box.y + box.height));
        changed(canvas);
    };
    const fillText = proto.fillText;
    proto.fillText = function (text, x, y, maxWidth) {
        const result = maxWidth === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, maxWidth);
        if (!active) return result;
        try {
            const canvas = this.canvas;
            if (!(canvas instanceof HTMLCanvasElement) || !text.trim() || this.globalAlpha === 0)
                return result;
            const metric = measure.call(this, text);
            const fontSize = parseFloat(this.font.match(/[\d.]+px/)?.[0] ?? "16");
            const ascent = metric.actualBoundingBoxAscent || fontSize * .8;
            const descent = metric.actualBoundingBoxDescent || fontSize * .2;
            let width = metric.width;
            if (maxWidth !== undefined)
                width = Math.min(width, maxWidth);
            const align = this.textAlign;
            if (align === "center")
                x -= width / 2;
            else if (align === "right" || align === "end" && this.direction !== "rtl" || align === "start" && this.direction === "rtl")
                x -= width;
            const box = bounds(this, x, y - ascent, width, ascent + descent);
            if (!Object.values(box).every(Number.isFinite))
                return result;
            const runs = snapshots.get(canvas) ?? [];
            // Repainting the same text must not duplicate a citation.
            const previous = runs.findIndex(r => Math.abs(r.x - box.x) < .5 && Math.abs(r.y - box.y) < .5);
            const run = { text, ...box };
            if (previous >= 0)
                runs[previous] = run;
            else if (runs.length < MAX_RUNS)
                runs.push(run);
            snapshots.set(canvas, runs);
            changed(canvas);
        }
        catch { /* Capture must never interrupt Docs painting. */ }
        return result;
    };
    const clearRect = proto.clearRect;
    proto.clearRect = function (x, y, w, h) {
        const result = clearRect.call(this, x, y, w, h);
        if (!active) return result;
        try {
            erase(this.canvas, bounds(this, x, y, w, h));
        }
        catch { }
        return result;
    };
    const fillRect = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
        const result = fillRect.call(this, x, y, w, h);
        if (!active) return result;
        try {
            // Opaque page/background repaint replaces earlier text. Selection
            // highlights are typically drawn on a separate canvas.
            if (this.globalAlpha === 1 && typeof this.fillStyle === "string" && /^#[0-9a-f]{6}$/i.test(this.fillStyle))
                erase(this.canvas, bounds(this, x, y, w, h));
        }
        catch { }
        return result;
    };
    // Resizing a canvas clears its bitmap, including a same-value assignment.
    for (const property of ["width", "height"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
        if (!descriptor?.set)
            continue;
        const patched: PropertyDescriptor = {
            ...descriptor,
            set(this: HTMLCanvasElement, value: number) {
                descriptor.set!.call(this, value);
                if (active && snapshots.has(this)) {
                    snapshots.set(this, []);
                    changed(this);
                }
            },
        };
        Object.defineProperty(HTMLCanvasElement.prototype, property, patched);
        restore.push(() => {
            if (Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property)?.set === patched.set)
                Object.defineProperty(HTMLCanvasElement.prototype, property, descriptor);
        });
    }
    // Docs can paint into a detached backing canvas and copy that bitmap into
    // the visible tile. Keep backing snapshots weakly, publishing only real tiles.
    const drawImage = proto.drawImage;
    proto.drawImage = function (this: CanvasRenderingContext2D, source: CanvasImageSource, ...args: number[]) {
        const result = Reflect.apply(drawImage, this, [source, ...args]);
        if (!active) return result;
        try {
            if (!(source instanceof HTMLCanvasElement) || !snapshots.has(source)) return result;
            const runs = [...snapshots.get(source)!];
            let sx = 0, sy = 0, sw = source.width, sh = source.height;
            let dx = args[0], dy = args[1], dw = sw, dh = sh;
            if (args.length === 4) [dx, dy, dw, dh] = args;
            if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
            if (!sw || !sh || this.globalAlpha === 0) return result;
            const target = snapshots.get(this.canvas) ?? [];
            for (const run of runs) {
                const left = Math.max(run.x, sx), top = Math.max(run.y, sy);
                const right = Math.min(run.x + run.width, sx + sw), bottom = Math.min(run.y + run.height, sy + sh);
                if (right <= left || bottom <= top) continue;
                const box = bounds(this, dx + (left - sx) * dw / sw, dy + (top - sy) * dh / sh,
                    (right - left) * dw / sw, (bottom - top) * dh / sh);
                const previous = target.findIndex(r => Math.abs(r.x - box.x) < .5 && Math.abs(r.y - box.y) < .5);
                const copied = {text: run.text, ...box};
                if (previous >= 0) target[previous] = copied;
                else if (target.length < MAX_RUNS) target.push(copied);
            }
            snapshots.set(this.canvas, target);
            changed(this.canvas);
        } catch { /* Capture must never interrupt Docs painting. */ }
        return result;
    } as typeof proto.drawImage;
    const replay = () => {
        for (const canvas of document.querySelectorAll<HTMLCanvasElement>(TILE)) publish(canvas);
    };
    const onRequest = () => {
        console.debug('[FLoRA] Google Docs canvas bridge ready; replaying visible tiles');
        replay();
    };
    document.addEventListener(DOCS_REQUEST_EVENT, onRequest);
    const observer = new MutationObserver(records => {
        // A canvas may acquire its tile class or join the document after drawing.
        if (records.some(record => record.type === 'attributes' || Array.from(record.addedNodes).some(node =>
            node instanceof Element && (node.matches(TILE) || node.querySelector(TILE))))) replay();
        for (const canvas of timers.keys()) if (!canvas.isConnected) {
            clearTimeout(timers.get(canvas));
            timers.delete(canvas);
        }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    for (const name of ['fillText', 'clearRect', 'fillRect', 'drawImage'] as const) {
        const wrapper = proto[name];
        restore.push(() => { if (proto[name] === wrapper) Object.assign(proto, {[name]: originals[name]}); });
    }
    return () => {
        active = false;
        for (const undo of restore) undo();
        observer.disconnect();
        document.removeEventListener(DOCS_REQUEST_EVENT, onRequest);
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
    };
}
