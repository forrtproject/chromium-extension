import type {DoiString} from "@shared/types";

export class SeenDois {
    private seen = new Set<DoiString>();

    hasUnseen(dois: readonly DoiString[]): boolean {
        return dois.some((doi) => !this.seen.has(doi));
    }

    mark(dois: readonly DoiString[]): void {
        for (const doi of dois) this.seen.add(doi);
    }

    clear(): void {
        this.seen.clear();
    }
}
