import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchGoogleDocsText, googleDocsExportUrl} from '../../src/shared/google-docs-source';
afterEach(() => vi.unstubAllGlobals());
describe('Google Docs full text source', () => {
    it('preserves the document, account and selected tab in export requests', () => {
        expect(googleDocsExportUrl('https://docs.google.com/document/u/1/d/document-id/edit?tab=t.abc&authuser=1'))
            .toBe('https://docs.google.com/document/u/1/d/document-id/export?format=txt&tab=t.abc&authuser=1');
        expect(() => googleDocsExportUrl('https://example.com/document/d/id/edit')).toThrow();
    });
    it('uses same-origin credentials for the authenticated export and cookie-free redirect', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('\u202a10.1234/paper\u202c', {headers: {'content-type': 'text/plain; charset=utf-8'}}));
        vi.stubGlobal('fetch', fetcher);
        expect(await fetchGoogleDocsText('https://docs.google.com/document/d/id/edit')).toBe('10.1234/paper');
        expect(fetcher).toHaveBeenCalledWith('https://docs.google.com/document/d/id/export?format=txt', expect.objectContaining({credentials: 'same-origin'}));
    });
    it('rejects login HTML and denied exports rather than treating them as an empty document', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', {headers: {'content-type': 'text/html'}})));
        await expect(fetchGoogleDocsText('https://docs.google.com/document/d/id/edit')).rejects.toThrow('unavailable');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Denied', {status: 403})));
        await expect(fetchGoogleDocsText('https://docs.google.com/document/d/id/edit')).rejects.toThrow('unavailable');
    });
});
