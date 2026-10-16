// DOI sets are encrypted here, before they leave the browser. The API stores only the
// ciphertext and IV; the key travels in the Atlas link's #fragment, which browsers never
// send to a server. The Atlas decrypts with the same parameters, so change them together.

const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Binds a ciphertext to this format, so it can't be mistaken for some other AES-GCM blob. */
const AAD = new TextEncoder().encode("flora-doi-set:v2");

export interface SealedSet {
    /** AES-256-GCM ciphertext with its 16-byte tag appended, unpadded base64url. */
    data: string;
    /** 12-byte IV, unpadded base64url. */
    iv: string;
    /** 32-byte key, unpadded base64url (43 characters). Never sent to the API. */
    key: string;
}

export function toBase64url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ISO 8601, seconds precision — `2026-08-27T10:14:02Z`. */
function isoSeconds(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function sealDoiSet(dois: readonly string[]): Promise<SealedSet> {
    const rawKey = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const plaintext = new TextEncoder().encode(
        JSON.stringify({ dois, created: isoSeconds(new Date()) })
    );
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: AAD },
        key,
        plaintext
    );
    return {
        data: toBase64url(new Uint8Array(ciphertext)),
        iv: toBase64url(iv),
        key: toBase64url(rawKey),
    };
}
