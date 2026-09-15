import {installDocsCanvasCapture} from './canvas';
if (/^\/document\/(?:u\/\d+\/)?d\/[\w-]+\//.test(location.pathname)) {
    const cleanup = installDocsCanvasCapture();
    document.addEventListener('flora-docs-stop-capture', cleanup, {once: true});
}
