/** Strip API contact parameters and email addresses from diagnostic text. */
export function redactDebugText(text: string): string {
  return text
    .replace(/([?&](?:mailto|email)=)[^&#\s"'<>]*/gi, "$1[redacted]")
    // Reports can contain URLs that were themselves encoded into another URL.
    .replace(/((?:%3f|%26)(?:mailto|email)%3d)(?:(?!%26|%23)[^\s"'<>])*/gi, "$1[redacted]")
    // A standalone address token can use the whole legal local-part set,
    // including the `/ & * = ?` that also punctuate URLs. Requiring the match
    // to start the token keeps it off URLs, whose scheme breaks the set.
    .replace(/(?<![^\s"'<>()[\],;])[a-z0-9.!#$%&'*+/=?^_`{|}~-]+(?:@|%40)[a-z0-9](?:[a-z0-9.-]|%2e)*/gi, "[redacted email]")
    // Inside a URL or other punctuation, match only the characters that cannot
    // be structure, so the surrounding path and parameters stay readable.
    .replace(/[a-z0-9.!#$%'+^_`{|}~-]+(?:@|%40)[a-z0-9](?:[a-z0-9.-]|%2e)*/gi, "[redacted email]");
}
