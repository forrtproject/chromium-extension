export const TOUR_SAMPLE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC3076932/";

const TOUR_REQUEST_KEY = "flora_page_tour_request";
const TOUR_REQUEST_TTL_MS = 5 * 60 * 1000;

export async function openTourSample(): Promise<void> {
    await chrome.storage.local.set({[TOUR_REQUEST_KEY]: Date.now() + TOUR_REQUEST_TTL_MS});
    await chrome.tabs.create({url: TOUR_SAMPLE_URL});
}

export async function isTourRequestedFor(href: string): Promise<boolean> {
    if (!href.startsWith(TOUR_SAMPLE_URL)) return false;
    const stored = await chrome.storage.local.get(TOUR_REQUEST_KEY);
    const expiresAt = stored[TOUR_REQUEST_KEY];
    return typeof expiresAt === "number" && expiresAt > Date.now();
}

export async function clearTourRequest(): Promise<void> {
    await chrome.storage.local.remove(TOUR_REQUEST_KEY);
}
