export const RELAY = "https://ore-translation-feedback.translation-feedback-worker.workers.dev";
const TURNSTILE_SITEKEY = "0x4AAAAAAGHA58g-Hyf0_z7d";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Turnstile {
  render(el: string | HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

export interface SendOptions {
  title: string;
  summary: Node[];
  messageRequired: boolean;
  defaultName: string;
  doneText: string;
  path: "/review" | "/feedback";
  payload: (fields: { name: string; email: string; message: string; website: string; turnstileToken: string }) => unknown;
  onSent: (name: string) => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let widget: string | null = null;
let token = "";
let current: SendOptions | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile?.render) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile"));
    document.head.append(s);
  });
}

function showError(text: string): void {
  const e = $("send-error");
  e.hidden = !text;
  e.textContent = text;
}

export function messageDraft(): string {
  return $<HTMLTextAreaElement>("send-message").value.trim();
}

export async function openSend(options: SendOptions): Promise<void> {
  current = options;
  $("send-title").textContent = options.title;
  $("send-summary").replaceChildren(...options.summary);
  $("send-optional").hidden = options.messageRequired;
  const name = $<HTMLInputElement>("send-name");
  if (!name.value) name.value = options.defaultName;
  $<HTMLFormElement>("send-form").hidden = false;
  $("send-done").hidden = true;
  showError("");
  $<HTMLDialogElement>("send-dialog").showModal();
  (name.value ? $<HTMLInputElement>("send-email") : name).focus();
  try {
    await loadTurnstile();
    widget ??= window.turnstile!.render("#send-turnstile", {
      sitekey: TURNSTILE_SITEKEY,
      callback: (t: string) => { token = t; },
      "expired-callback": () => { token = ""; },
    });
  } catch {
    showError("The spam check could not load. Use Download instead, or try again later.");
  }
}

async function submit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!current) return;
  const name = $<HTMLInputElement>("send-name").value.trim();
  const email = $<HTMLInputElement>("send-email").value.trim();
  const message = messageDraft();
  if (!name) return showError("Please enter your name.");
  if (!EMAIL.test(email)) return showError("Please enter a valid email address so we can reach you.");
  if (current.messageRequired && message.length < 3) return showError("Please write your feedback.");
  if (!token) return showError("Please wait for the check that you are not a bot to finish.");
  const button = $<HTMLButtonElement>("send-submit");
  button.disabled = true;
  showError("");
  try {
    const res = await fetch(`${RELAY}${current.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current.payload({ name, email, message, website: $<HTMLInputElement>("send-website").value, turnstileToken: token })),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "This could not be sent. Please try again.");
    $<HTMLTextAreaElement>("send-message").value = "";
    $("send-done-text").textContent = current.doneText;
    $<HTMLFormElement>("send-form").hidden = true;
    $("send-done").hidden = false;
    $("send-close").focus();
    current.onSent(name);
  } catch (err) {
    showError((err as Error).message || "This could not be sent. Please try again.");
  } finally {
    button.disabled = false;
    token = "";
    if (widget != null) window.turnstile?.reset(widget);
  }
}

$<HTMLFormElement>("send-form").addEventListener("submit", (e) => void submit(e));
$("send-cancel").addEventListener("click", () => $<HTMLDialogElement>("send-dialog").close());
$("send-close").addEventListener("click", () => $<HTMLDialogElement>("send-dialog").close());
