// @vitest-environment-options {"url":"https://docs.google.com/document/d/example/edit"}
import {expect, it, vi} from 'vitest';
const {install, cleanup} = vi.hoisted(() => {
    const cleanup = vi.fn();
    return {cleanup, install: vi.fn(() => cleanup)};
});
vi.mock('../../src/content-docs/canvas', () => ({installDocsCanvasCapture: install}));
it('can stop and restart capture without stacking installations', async () => {
    await import('../../src/content-docs/index');
    expect(install).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('flora-docs-stop-capture'));
    expect(cleanup).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('flora-docs-start-capture'));
    document.dispatchEvent(new Event('flora-docs-start-capture'));
    expect(install).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('flora-docs-stop-capture'));
    expect(cleanup).toHaveBeenCalledTimes(2);
});
