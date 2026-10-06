export function webUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        const {protocol} = new URL(value);
        return protocol === "https:" || protocol === "http:" ? value : null;
    } catch {
        return null;
    }
}
