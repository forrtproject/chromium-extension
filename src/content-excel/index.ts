import {installCanvasCapture, EXCEL_TEXT_EVENT, EXCEL_REQUEST_EVENT} from '../content-docs/canvas';
if (/^\/x\/_layouts\//i.test(location.pathname)) {
    let cleanup: (() => void) | undefined;
    const start = () => { cleanup ??= installCanvasCapture({
        tile: 'canvas.ewr-sheettable', textEvent: EXCEL_TEXT_EVENT, requestEvent: EXCEL_REQUEST_EVENT,
        label: 'Excel for the web',
    }); };
    start();
    document.addEventListener('flora-excel-start-capture', start);
    document.addEventListener('flora-excel-stop-capture', () => { cleanup?.(); cleanup = undefined; });
}
