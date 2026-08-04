/**
 * Bot-check interstitial detection.
 *
 * Cloudflare serves its "Verify you are human" / "Just a moment…" challenge at
 * the article's own URL. The DOI in that URL still resolves, so FLoRA would
 * otherwise render a pill over a page the reader is only passing through —
 * and over a document whose text is a challenge, not a paper. Nothing here is
 * worth annotating: once the challenge clears, the real document loads and the
 * content script runs again from scratch.
 */

/**
 * Markers unique to the challenge/block document itself. Cloudflare's own
 * pages carry one of these; an ordinary page behind Cloudflare carries none.
 */
const CHALLENGE_SELECTORS = [
    "#challenge-form",
    "#challenge-running",
    "#challenge-stage",
    "#challenge-error-title",
    "#cf-challenge-running",
    "#cf-please-wait",
    ".cf-browser-verification",
    // Block/rate-limit pages (error 1015, 1020, …) rather than a challenge.
    "#cf-wrapper #cf-error-details",
];

const CHALLENGE_TITLES = [
    /^just a moment/i,
    /^attention required/i,
    /^access denied/i,
    /^verify you are human/i,
    /^one more step/i,
    /^checking your browser/i,
];

/**
 * True when this document is a bot check rather than the page that was asked
 * for. Pass a document for testing; defaults to the live one.
 */
export function isBotCheckPage(doc: Document = document): boolean {
    if (CHALLENGE_SELECTORS.some((sel) => doc.querySelector(sel))) return true;

    // Cloudflare injects its detection script into ordinary pages too (Bot
    // Fight Mode), so the script on its own says nothing about this document —
    // paired with a challenge title it does.
    const hasChallengeScript = !!doc.querySelector('script[src*="/cdn-cgi/challenge-platform/"]');
    if (!hasChallengeScript) return false;
    const title = doc.title.trim();
    return CHALLENGE_TITLES.some((pattern) => pattern.test(title));
}
