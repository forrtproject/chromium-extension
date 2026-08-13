export function serializeWithRerun(run: () => Promise<void>): () => Promise<void> {
    let inFlight: Promise<void> | null = null;
    let rerunQueued = false;

    return function scan(): Promise<void> {
        if (inFlight) {
            rerunQueued = true;
            return inFlight;
        }
        inFlight = (async () => {
            try {
                do {
                    rerunQueued = false;
                    await run();
                } while (rerunQueued);
            } finally {
                inFlight = null;
                rerunQueued = false;
            }
        })();
        return inFlight;
    };
}
