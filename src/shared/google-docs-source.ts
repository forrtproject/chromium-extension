/** Read the current document tab without depending on rendered canvas pages. */
export function googleDocsExportUrl(pageUrl: string): string {
    const page = new URL(pageUrl);
    const match = page.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)\//);
    if (page.origin !== 'https://docs.google.com' || !match) throw new Error('Not a Google document');
    const url = new URL(page.pathname.slice(0, page.pathname.indexOf(match[1]) + match[1].length) + '/export', page.origin);
    url.searchParams.set('format', 'txt');
    for (const key of ['tab', 'authuser']) {
        const value = page.searchParams.get(key);
        if (value) url.searchParams.set(key, value);
    }
    return url.href;
}
export async function fetchGoogleDocsText(pageUrl: string, signal?: AbortSignal): Promise<string> {
    // Authenticate to Docs, but omit cookies on its cross-origin download redirect.
    // The export server permits wildcard CORS, which rejects credentialed requests.
    const response = await fetch(googleDocsExportUrl(pageUrl), {credentials: 'same-origin', signal});
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('text/plain')) {
        throw new Error('Google Docs text export unavailable');
    }
    return (await response.text()).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
}
