/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://github.com/forrtproject/chromium-extension/issues/new?title=Issue" }
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueUrl } from "@shared/debug-report";

const REPORT = "### Debug log (1 entry)\n```\n12:00:00.000  [example.com] INFO   hello\n```";

/** An issue body carrying a URL-trimmed log, i.e. what the tab actually opens with. */
function issueBody(): string {
  const link = issueUrl({
    domain: "example.com",
    report: {
      environment: ["Extension: ORE 1.0"],
      settings: [],
      entries: Array.from({ length: 400 }, (_, i) => ({
        t: i,
        level: "log" as const,
        ctx: "example.com",
        msg: `trimmed entry ${i}`,
      })),
    },
  });
  return new URL(link.url).searchParams.get("body")!;
}

function renderForm(value: string): HTMLTextAreaElement {
  document.body.innerHTML = `<form><textarea name="issue[body]"></textarea></form>`;
  const field = document.querySelector("textarea")!;
  field.value = value;
  return field;
}

/** Let the module's promise chain and any MutationObserver callbacks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  sendMessage = vi.fn().mockResolvedValue({
    type: "FLORA_TAKE_REPORT_RESULT",
    report: REPORT,
  });
  chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GitHub issue autofill", () => {
  it("upgrades the URL-trimmed log to the full report", async () => {
    const field = renderForm(issueBody());
    expect(field.value).toContain("trimmed entry 399");

    await import("../../src/content-github/index");
    await settle();

    expect(field.value).toContain("**What happened?**");
    expect(field.value).toContain("12:00:00.000  [example.com] INFO   hello");
    expect(field.value).not.toContain("trimmed entry 399");
  });

  it("fires an input event so a React-controlled field keeps the text", async () => {
    const field = renderForm(issueBody());
    const events: string[] = [];
    field.addEventListener("input", () => events.push("input"));
    field.addEventListener("change", () => events.push("change"));

    await import("../../src/content-github/index");
    await settle();

    expect(events).toEqual(["input", "change"]);
  });

  it("waits for a form that renders after the script runs", async () => {
    await import("../../src/content-github/index");
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();

    const field = renderForm(issueBody());
    await settle();

    expect(field.value).toContain("INFO   hello");
  });

  it("claims the report only once a field exists to hold it", async () => {
    vi.useFakeTimers();

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(20_000);

    // No form ever appeared — the report stays parked for the next attempt
    // rather than being consumed into a page that can't display it.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("leaves the body alone when no report is parked", async () => {
    sendMessage.mockResolvedValue({ type: "FLORA_TAKE_REPORT_RESULT", report: null });
    const original = issueBody();
    const field = renderForm(original);

    await import("../../src/content-github/index");
    await settle();

    expect(field.value).toBe(original);
  });

  it("skips a hidden textarea in favour of the real one", async () => {
    document.body.innerHTML = `
      <form>
        <textarea name="issue[body]" style="display: none"></textarea>
        <textarea aria-label="Comment body"></textarea>
      </form>`;
    const [hidden, visible] = Array.from(document.querySelectorAll("textarea"));
    visible.value = issueBody();

    await import("../../src/content-github/index");
    await settle();

    expect(hidden.value).toBe("");
    expect(visible.value).toContain("### Debug log");
  });

  it("says so on the page when the form reverts the insertion", async () => {
    vi.useFakeTimers();
    const field = renderForm(issueBody());
    // Stand in for a React re-render discarding an uncontrolled write.
    field.addEventListener("input", () => {
      setTimeout(() => {
        field.value = issueBody();
      }, 0);
    });

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(12_000);

    expect(document.body.textContent).toContain("couldn't fill in the full debug log");
  });

  it("follows the field when a re-render swaps the textarea out", async () => {
    vi.useFakeTimers();
    const first = renderForm(issueBody());
    first.addEventListener("input", () => {
      setTimeout(() => {
        const replacement = first.cloneNode() as HTMLTextAreaElement;
        replacement.value = issueBody();
        first.replaceWith(replacement);
      }, 0);
    });

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(12_000);

    const live = document.querySelector("textarea")!;
    expect(live).not.toBe(first);
    expect(live.value).toContain(REPORT);
    expect(document.body.textContent).toContain("attached the debug log");
  });

  it("puts the report back when the form reverts it once", async () => {
    vi.useFakeTimers();
    const field = renderForm(issueBody());
    let reverts = 1;
    field.addEventListener("input", () => {
      if (reverts-- <= 0) return;
      setTimeout(() => {
        field.value = issueBody();
      }, 0);
    });

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(12_000);

    expect(field.value).toContain(REPORT);
    expect(document.body.textContent).toContain("attached the debug log");
  });

  it("gives up quietly when the form leaves the page mid-insert", async () => {
    vi.useFakeTimers();
    renderForm(issueBody());

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(300);
    document.body.innerHTML = "";
    await vi.advanceTimersByTimeAsync(12_000);

    expect(document.body.textContent).toBe("");
  });

  it("says so on the page when the form never appears", async () => {
    vi.useFakeTimers();

    await import("../../src/content-github/index");
    await vi.advanceTimersByTimeAsync(35_000);

    // The report was peeked at, not consumed — it stays parked for a retry.
    expect(sendMessage).toHaveBeenCalledWith({ type: "FLORA_PEEK_REPORT" });
    expect(document.body.textContent).toContain("couldn't fill in the full debug log");
  });

  it("does not append a second copy if the form re-renders", async () => {
    const field = renderForm(issueBody());

    await import("../../src/content-github/index");
    await settle();
    const filled = field.value;

    vi.resetModules();
    await import("../../src/content-github/index");
    await settle();

    expect(field.value).toBe(filled);
  });
});
