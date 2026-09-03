import type { DoiString } from "./types";
import { createDoiSetViaWorker } from "./messages";

export const ATLAS_BASE = "https://forrt.org/flora-replication-atlas/";

const MAX_DOI_URL_LENGTH = 2500;

export function atlasDoiUrl(dois: readonly string[]): string {
    return `${ATLAS_BASE}?doi=${encodeURIComponent(dois.join(","))}`;
}

export function atlasSetUrl(setId: string): string {
    return `${ATLAS_BASE}?set=${encodeURIComponent(setId)}`;
}

export function needsAtlasSet(dois: readonly string[]): boolean {
    return atlasDoiUrl(dois).length > MAX_DOI_URL_LENGTH;
}

const setIds = new Map<string, Promise<string | null>>();

function setIdFor(dois: readonly DoiString[]): Promise<string | null> {
    const key = dois.join(",");
    const known = setIds.get(key);
    if (known) return known;

    const pending = createDoiSetViaWorker([...dois]).then((setId) => {
        if (!setId) setIds.delete(key);
        return setId;
    });
    setIds.set(key, pending);
    return pending;
}

export function bindAtlasLink(
    anchor: HTMLAnchorElement | null | undefined,
    dois: readonly DoiString[]
): void {
    if (!anchor || dois.length === 0) return;

    anchor.href = atlasDoiUrl(dois);
    if (!needsAtlasSet(dois)) return;

    let settled = false;
    const pending = setIdFor(dois).then((setId) => {
        settled = true;
        if (setId) anchor.href = atlasSetUrl(setId);
        return anchor.href;
    });

    anchor.addEventListener("click", (event) => {
        if (settled) return;
        const reserved = window.open("", "_blank");
        if (!reserved) return;
        event.preventDefault();
        reserved.opener = null;
        void pending.then((url) => reserved.location.replace(url));
    });
}
