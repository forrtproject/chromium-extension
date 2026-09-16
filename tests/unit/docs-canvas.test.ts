import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDocsCanvasCapture, DOCS_TEXT_EVENT, DOCS_REQUEST_EVENT } from '../../src/content-docs/canvas';
let cleanup: () => void;
let restoreWidth: PropertyDescriptor;
let restoreHeight: PropertyDescriptor;
let canvas: HTMLCanvasElement;
let ctx: FakeContext;
let events: {
    width: number;
    height: number;
    runs: {
        text: string;
        x: number;
        y: number;
    }[];
}[];
class FakeContext {
    canvas: HTMLCanvasElement;
    globalAlpha = 1;
    fillStyle = '#ffffff';
    font = '16px Arial';
    textAlign = 'left';
    direction = 'ltr';
    constructor(c: HTMLCanvasElement) { this.canvas = c; }
    fillText = vi.fn();
    measureText = vi.fn((text: string) => ({ width: text.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }));
    clearRect = vi.fn();
    fillRect = vi.fn();
    getTransform() { return { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }; }
}
// Prototype methods mirror browser canvas methods so wrappers preserve receivers.
function installFake() {
    Object.assign(FakeContext.prototype, {
        fillText: vi.fn(), measureText: vi.fn((text: string) => ({ width: text.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 })),
        clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
    });
    vi.stubGlobal('CanvasRenderingContext2D', FakeContext);
}
beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<canvas class="kix-canvas-tile-content" width="800" height="1000"></canvas>';
    canvas = document.querySelector('canvas')!;
    events = [];
    canvas.addEventListener(DOCS_TEXT_EVENT, e => events.push(JSON.parse((e as CustomEvent).detail)));
    restoreWidth = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    restoreHeight = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')!;
    installFake();
    cleanup = installDocsCanvasCapture();
    ctx = new FakeContext(canvas);
    // Use the patched prototype, not the convenience mock fields.
    for (const name of ['fillText', 'measureText', 'clearRect', 'fillRect'])
        delete (ctx as unknown as Record<string, unknown>)[name];
});
afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', restoreWidth);
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', restoreHeight);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
describe('Docs canvas capture', () => {
    it('restores methods and dimensions and stops publication on cleanup', () => {
        const wrapped = CanvasRenderingContext2D.prototype.fillText;
        ctx.fillText('paper', 20, 30);
        cleanup();
        expect(CanvasRenderingContext2D.prototype.fillText).not.toBe(wrapped);
        expect(Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')).toEqual(restoreWidth);
        ctx.fillText('later', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events).toEqual([]);
    });
    it('preserves patches installed later while making this wrapper inert', () => {
        const wrapper = CanvasRenderingContext2D.prototype.fillText;
        const later = vi.fn(function(this: CanvasRenderingContext2D, ...args: [string, number, number]) { wrapper.apply(this, args); });
        CanvasRenderingContext2D.prototype.fillText = later;
        cleanup();
        expect(CanvasRenderingContext2D.prototype.fillText).toBe(later);
        ctx.fillText('later', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events).toEqual([]);
    });
    it('preserves the draw call and publishes transformed text bounds', () => {
        ctx.fillText('10.1234/paper', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toEqual([{ text: '10.1234/paper', x: 50, y: 56, width: 208, height: 32 }]);
    });
    it('deduplicates redraws and invalidates cleared text', () => {
        ctx.fillText('paper', 20, 30);
        ctx.fillText('paper', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toHaveLength(1);
        ctx.clearRect(0, 0, 800, 1000);
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toEqual([]);
    });
    it('clears captured text when the bitmap is reset by resizing', () => {
        ctx.fillText('paper', 20, 30);
        canvas.width = 800;
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toEqual([]);
    });
    it('replays captured text when the isolated content script becomes ready', () => {
        ctx.fillText('paper', 20, 30);
        document.dispatchEvent(new Event(DOCS_REQUEST_EVENT));
        expect(events.at(-1)?.runs[0].text).toBe('paper');
    });
    it('captures text painted before a canvas is attached and classified', async () => {
        canvas.remove();
        canvas.className = '';
        ctx.fillText('10.1234/detached', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events).toEqual([]);
        canvas.className = 'kix-canvas-tile-content';
        document.body.append(canvas);
        await Promise.resolve();
        expect(events.at(-1)?.runs[0].text).toBe('10.1234/detached');
    });
    it('transfers backing-canvas text through cropped and scaled drawImage', () => {
        const backing = document.createElement('canvas');
        backing.width = 800;
        backing.height = 1000;
        const backingCtx = new FakeContext(backing);
        for (const name of ['fillText', 'measureText', 'clearRect', 'fillRect'])
            delete (backingCtx as unknown as Record<string, unknown>)[name];
        backingCtx.fillText('paper', 20, 30); // backing bounds: 50,56,80,32
        vi.advanceTimersByTime(110);
        (ctx as unknown as CanvasRenderingContext2D).drawImage(backing, 0, 0, 400, 500, 10, 20, 200, 250);
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toEqual([{text: 'paper', x: 80, y: 116, width: 80, height: 32}]);
        ctx.clearRect(0, 0, 800, 1000);
        vi.advanceTimersByTime(110);
        expect(events.at(-1)?.runs).toEqual([]);
    });
    it('does not publish toolbar canvas text', () => {
        canvas.className = 'toolbar';
        ctx.fillText('Account', 20, 30);
        vi.advanceTimersByTime(110);
        expect(events).toEqual([]);
    });
});
