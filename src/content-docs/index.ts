import {installDocsCanvasCapture} from './canvas';
if (/^\/document\/(?:u\/\d+\/)?d\/[\w-]+\//.test(location.pathname)) {
    let cleanup: (() => void) | undefined;
    const start = () => { cleanup ??= installDocsCanvasCapture(); };
    start();
    document.addEventListener('flora-docs-start-capture', start);
    document.addEventListener('flora-docs-stop-capture', () => { cleanup?.(); cleanup = undefined; });
}
