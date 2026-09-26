/** Shared presentation for references in document editors. */
import { isWordOnline, wordReferenceElements, wordAnnotationTarget, wordAnnotatedReferences } from "./word-online";
import { googleDocsContentSnapshot, isGoogleDocs, googleDocsReferenceElements, googleDocsAnnotationTarget, googleDocsAnnotatedReferences } from "./google-docs";
export const isDocumentEditor = (url = location.href): boolean => isWordOnline(url) || isGoogleDocs(url);
export const editorReferenceElements = (doc: Document): HTMLElement[] => isGoogleDocs(doc.URL) ? googleDocsReferenceElements(doc) : wordReferenceElements(doc);
export const editorAnnotationTarget = (target: Element): HTMLElement | null => isGoogleDocs(target.ownerDocument.URL) ? googleDocsAnnotationTarget(target) : wordAnnotationTarget(target);
export const editorAnnotatedReferences = () => isGoogleDocs() ? googleDocsAnnotatedReferences() : wordAnnotatedReferences();
export function editorTitle(): string {
    if (isGoogleDocs())
        return document.querySelector<HTMLInputElement>('.docs-title-input')?.value || document.title.replace(/ - Google Docs$/, '') || 'Google document';
    const title = document.querySelector('#documentTitle');
    return (title instanceof HTMLInputElement ? title.value : title?.textContent)?.trim() || 'Word document';
}

export function editorContentSnapshot(): string | number {
    if (isGoogleDocs()) return googleDocsContentSnapshot();
    return [...document.querySelectorAll('#WACViewPanel .Paragraph')].map(element =>
        [element.textContent, ...[...element.querySelectorAll('a[href]')].map(link => link.getAttribute('href'))].join(' ')).join('\n');
}
