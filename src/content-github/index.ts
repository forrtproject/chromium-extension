/**
 * Fills the debug report into ORE's own GitHub issue form.
 *
 * "Report an issue" parks the report in the service worker and opens the
 * prefilled new-issue page; this script claims the report and drops it into the
 * body field, so the user never has to paste anything. It runs only on the
 * extension's own repository and only on the new-issue route — everywhere else
 * it returns before touching the page.
 */

import { safeSendMessage, type TakeReportResponse } from "@shared/messages";
import { insertReportIntoIssueBody, isIssueFormUrl } from "@shared/debug-report";
import { debugLog } from "@shared/debug";
import { showToast } from "@shared/toast";

/**
 * Ordered from most to least specific. GitHub has had more than one issue form
 * in the wild — the classic Rails form and the newer React one, whose element
 * ids are generated — so the last entries match on shape rather than identity.
 */
const BODY_SELECTORS = [
  'textarea[name="issue[body]"]',
  "#issue_body",
  'textarea[aria-label="Comment body" i]',
  'textarea[aria-label*="body" i]',
  'textarea[placeholder*="description" i]',
  'textarea[placeholder*="comment" i]',
  "form textarea",
];

/**
 * How long to wait for the form to render. Generous: a slow first load of
 * GitHub's issue app is the difference between attaching the log and not.
 */
const FORM_TIMEOUT_MS = 30_000;

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return true;
  // offsetParent is also null for position:fixed elements, so a null result on
  // its own isn't proof the field is hidden — check the computed style before
  // skipping a perfectly usable textarea.
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

/**
 * Every textarea on the page, including ones inside open shadow roots — the
 * markdown editor is a web component, and a selector that stops at the light
 * DOM would never see its field.
 */
function allTextareas(root: ParentNode = document): HTMLTextAreaElement[] {
  const found: HTMLTextAreaElement[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (el instanceof HTMLTextAreaElement) found.push(el);
    if (el.shadowRoot) found.push(...allTextareas(el.shadowRoot));
  }
  return found;
}

function usable(el: HTMLTextAreaElement): boolean {
  return !el.disabled && !el.readOnly && isVisible(el);
}

function findBodyField(): HTMLTextAreaElement | null {
  const candidates = allTextareas();
  for (const selector of BODY_SELECTORS) {
    const match = candidates.find((el) => usable(el) && el.matches(selector));
    if (match) return match;
  }
  // Nothing matched by name or shape: fall back to the biggest usable field,
  // which on an issue form is the body.
  return (
    candidates
      .filter(usable)
      .sort((a, b) => b.rows * b.cols - a.rows * a.cols)[0] ?? null
  );
}

/**
 * Write to a field React may be controlling. Assigning `.value` alone updates
 * the DOM but not React's internal state, so the text vanishes on the next
 * render — going through the prototype setter and firing a bubbling `input`
 * event is what makes the change stick in both form implementations.
 */
function setFieldValue(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Resolve with the body field as soon as the form renders, or null on timeout. */
function waitForBodyField(): Promise<HTMLTextAreaElement | null> {
  const existing = findBodyField();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const field = findBodyField();
      if (!field) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(field);
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, FORM_TIMEOUT_MS);

    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const HOLD_CHECKS_MS = [250, 1000, 2500, 5000];

type HoldOutcome = "held" | "reverted" | "gone";

async function insertAndHold(report: string): Promise<HoldOutcome> {
  let held = false;
  for (const wait of HOLD_CHECKS_MS) {
    const field = findBodyField();
    if (!field) return "gone";
    if (!field.value.includes(report)) {
      const next = insertReportIntoIssueBody(field.value, report);
      if (next !== null) setFieldValue(field, next);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    const live = findBodyField();
    if (!live) return "gone";
    held = live.value.includes(report);
  }
  return held ? "held" : "reverted";
}

const UPLOAD_WAIT_MS = 10_000;

function pngFromDataUrl(dataUrl: string): Blob {
  const bytes = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type: "image/png" });
}

/** GitHub uploads a pasted image and writes its markdown into the body. */
async function pasteScreenshot(png: Blob): Promise<boolean> {
  const field = findBodyField();
  if (!field) return false;
  const before = field.value;
  const transfer = new DataTransfer();
  transfer.items.add(new File([png], "ore-screenshot.png", { type: "image/png" }));
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  const deadline = Date.now() + UPLOAD_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const value = findBodyField()?.value ?? "";
    if (value !== before && /!\[[^\]]*\]\(https:\/\/|<img\b/i.test(value.replace(before, ""))) return true;
  }
  return false;
}

async function attachScreenshot(dataUrl: string): Promise<boolean> {
  const png = pngFromDataUrl(dataUrl);
  if (await pasteScreenshot(png)) {
    debugLog("GitHub: screenshot attached to the issue form");
    return true;
  }
  debugLog("GitHub: screenshot upload not confirmed — offering it on the clipboard");
  showToast("ORE couldn't attach the screenshot by itself.", {
    tone: "info",
    action: {
      label: "Copy screenshot",
      onClick: async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
          showToast("Screenshot copied — paste it into the issue.", { duration: 5000 });
        } catch {
          showToast("Couldn't copy the screenshot.", { tone: "error" });
        }
      },
    },
  });
  return false;
}

async function fillIssueForm(): Promise<void> {
  if (!isIssueFormUrl(location.href)) return;

  const field = await waitForBodyField();
  if (!field) {
    // Never fail silently here: the URL may already carry a trimmed log, but
    // the user asked for the full one and deserves to know where it is.
    debugLog("GitHub: issue body field never appeared — leaving the report parked");
    const response = await safeSendMessage<TakeReportResponse>({ type: "FLORA_PEEK_REPORT" });
    if (response?.report) {
      showToast("ORE couldn't fill in the full debug log — it's on your clipboard, paste it in.", {
        tone: "error",
        duration: 8000,
      });
    }
    return;
  }

  // Claim the report only once a field exists to put it in. A sign-in redirect
  // or a timed-out form leaves it parked for the next attempt instead of
  // consuming it into a page that can't show it.
  const response = await safeSendMessage<TakeReportResponse>({ type: "FLORA_TAKE_REPORT" });
  const report = response?.report;
  if (!report) return;

  // Confirm it landed. Assigning to a React-controlled field can be reverted on
  // the next render, and a silently-reverted log is exactly the failure the
  // user can't see coming.
  const outcome = await insertAndHold(report);
  if (outcome === "held") {
    debugLog("GitHub: debug report inserted into the issue form");
    const withScreenshot = response?.screenshot ? await attachScreenshot(response.screenshot) : false;
    if (!response?.screenshot || withScreenshot) {
      showToast(withScreenshot ? "ORE attached the debug log and a screenshot to this issue." : "ORE attached the debug log to this issue.", { duration: 4000 });
    }
    return;
  }
  if (outcome === "gone") {
    debugLog("GitHub: issue form left the page before the report could be attached");
    return;
  }

  debugLog("GitHub: issue form rejected the inserted report");
  showToast("ORE couldn't fill in the full debug log — it's on your clipboard, paste it in.", {
    tone: "error",
    duration: 8000,
  });
}

void fillIssueForm();
