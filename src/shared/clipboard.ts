// Chrome leaves `clipboard.writeText` pending indefinitely — neither resolving
// nor rejecting — while the document lacks focus. A caller waiting on it to
// report the outcome would wait forever, so every write is raced against this
// deadline and falls back to the textarea path, which has no focus requirement.
const CLIPBOARD_DEADLINE_MS = 1200;

const TIMED_OUT = Symbol("clipboard-timeout");

function withDeadline<T>(promise: Promise<T>): Promise<T | typeof TIMED_OUT> {
    return Promise.race([
        promise,
        new Promise<typeof TIMED_OUT>((resolve) =>
            setTimeout(() => resolve(TIMED_OUT), CLIPBOARD_DEADLINE_MS)
        ),
    ]);
}

/** Copy via a hidden textarea — no focus or permission requirement. */
function writeViaTextarea(value: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("data-flora-ui", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        /* nothing more we can do */
    }
    ta.remove();
    return copied;
}

/**
 * Copy `value`, falling back to a hidden textarea where the async clipboard
 * API is blocked, absent, or stalled. Resolves to whether the copy actually
 * landed, so the toast reports a genuine failure rather than confirming a copy
 * that never happened.
 */
export function writeClipboard(value: string): Promise<boolean> {
    if (!navigator.clipboard?.writeText) return Promise.resolve(writeViaTextarea(value));
    return withDeadline(navigator.clipboard.writeText(value))
        .then((outcome) => (outcome === TIMED_OUT ? writeViaTextarea(value) : true))
        .catch(() => writeViaTextarea(value));
}

/**
 * Put both flavours of the same content on the clipboard: a word processor
 * takes the HTML and keeps the italics, a plain-text editor takes the text.
 * Falls back to text alone where `ClipboardItem` is unavailable or the write
 * is blocked (non-secure contexts, Firefox without the pref).
 */
export function writeRichClipboard(html: string, text: string): Promise<boolean> {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        return writeClipboard(text);
    }
    const item = new ClipboardItem({
        "text/html": new Blob([html], {type: "text/html"}),
        "text/plain": new Blob([text], {type: "text/plain"}),
    });
    return withDeadline(navigator.clipboard.write([item]))
        .then((outcome) => (outcome === TIMED_OUT ? writeClipboard(text) : true))
        .catch(() => writeClipboard(text));
}
