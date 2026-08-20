import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    offerErrorReport,
    reportCodeError,
    installErrorReporting,
    _resetErrorReportingForTesting,
} from "../../src/shared/error-report";
import { dismissToast } from "../../src/shared/toast";
import { _resetDebugForTesting, recentDebugEntries, setDebug } from "../../src/shared/debug";
import { issueUrl, collectDebugReport } from "../../src/shared/debug-report";

function toast(): HTMLElement | null {
    return document.getElementById("flora-alert-toast");
}

function actionButton(): HTMLButtonElement | null {
    return [...(toast()?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent === "Report it"
    ) as HTMLButtonElement | undefined ?? null;
}

describe("offering to report a crash", () => {
    beforeEach(() => {
        _resetErrorReportingForTesting();
        _resetDebugForTesting();
        dismissToast();
        document.body.innerHTML = "";
    });
    afterEach(() => {
        dismissToast();
        vi.unstubAllGlobals();
    });

    it("shows a toast with a report action that stays up", () => {
        offerErrorReport({ message: "TypeError: x is not a function", where: "references.ts" });

        expect(toast()?.textContent).toContain("ORE hit an error on this page.");
        expect(actionButton()).not.toBeNull();
        expect(toast()!.style.pointerEvents).toBe("auto");
    });

    it("offers the same crash only once", () => {
        const crash = { message: "TypeError: x is not a function", where: "references.ts" };

        offerErrorReport(crash);
        dismissToast();
        offerErrorReport(crash);

        expect(toast()).toBeNull();
    });

    it("stops offering after a handful of distinct crashes", () => {
        for (let i = 0; i < 5; i++) {
            offerErrorReport({ message: `Error ${i}` });
            dismissToast();
        }
        offerErrorReport({ message: "Error 99" });

        expect(toast()).toBeNull();
    });

    it("opens the prefilled issue form on click", async () => {
        const open = vi.fn().mockReturnValue({});
        vi.stubGlobal("open", open);

        offerErrorReport({ message: "TypeError: x is not a function", where: "references.ts" });
        actionButton()!.click();
        await vi.waitFor(() => expect(open).toHaveBeenCalled());

        const url = new URL(open.mock.calls[0][0] as string);
        expect(url.origin + url.pathname).toBe("https://github.com/forrtproject/chromium-extension/issues/new");
        expect(url.searchParams.get("title")).toContain("TypeError: x is not a function");
        expect(url.searchParams.get("body")).toContain("references.ts");
        expect(url.searchParams.get("labels")).toBe("bug");
    });

    it("logs the failure and offers it in one call", () => {
        setDebug(true);
        reportCodeError("Rendering replication results failed", new Error("boom"));

        expect(toast()).not.toBeNull();
        expect(recentDebugEntries().at(-1)?.msg).toContain("Rendering replication results failed");
    });

    it("routes uncaught errors through the same offer", () => {
        installErrorReporting();

        offerErrorReport({ message: "Uncaught ReferenceError: nope" });

        expect(toast()?.textContent).toContain("ORE hit an error");
    });
});

describe("the report a crash carries", () => {
    beforeEach(() => {
        _resetDebugForTesting();
    });

    it("titles the issue with the error and labels it a bug", () => {
        const link = issueUrl({ error: { message: "TypeError: x is not a function" } });
        const params = new URL(link.url).searchParams;

        expect(params.get("title")).toBe("TypeError: x is not a function");
        expect(params.get("labels")).toBe("bug");
    });

    it("says Error only when the message does not name one", () => {
        const named = issueUrl({ error: { message: "Error: boom" } });
        const bare = issueUrl({ error: { message: "the pass gave up" } });

        expect(new URL(named.url).searchParams.get("title")).toBe("Error: boom");
        expect(new URL(bare.url).searchParams.get("title")).toBe("Error: the pass gave up");
    });

    it("trims a stack-length message out of the title", () => {
        const link = issueUrl({ error: { message: "E".repeat(200) } });

        expect(new URL(link.url).searchParams.get("title")!.length).toBeLessThan(100);
    });

    it("puts the error and the log tail in the issue body", () => {
        const entries = Array.from({ length: 8 }, (_, i) => ({
            t: 1_700_000_000_000 + i,
            level: "log" as const,
            ctx: "example.com",
            msg: `step ${i}`,
        }));
        const link = issueUrl({
            domain: "example.com",
            report: { environment: ["Extension: ORE 1.0"], settings: [], entries },
            error: { message: "TypeError: x is not a function", stack: "at renderResolvedReferences" },
        });
        const body = new URL(link.url).searchParams.get("body")!;

        expect(link.embedded).toBe(true);
        expect(body).toContain("ORE hit an error");
        expect(body).toContain("### Error");
        expect(body).toContain("renderResolvedReferences");
        expect(body).toContain("step 7");
    });

    it("falls back to the in-memory tail when debug mode never persisted a log", async () => {
        setDebug(false);
        reportCodeError("References: marking up failed", new Error("boom"));

        const data = await collectDebugReport({ error: { message: "boom" } });

        expect(data.entries.map((e) => e.msg).join("\n")).toContain("References: marking up failed");
        expect(data.environment.join("\n")).toContain("in-memory tail");
        expect(data.error?.message).toBe("boom");
    });
});
