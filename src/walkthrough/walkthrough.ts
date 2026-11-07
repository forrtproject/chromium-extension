import {installOfflineFixtures, mountDemos} from "./demos";
import {mountSiteCategoryPicker} from "../shared/site-category-picker";
import {openTourSample} from "../shared/tour-sample";
import {debugError} from "../shared/debug";
import {mountSetupChoices} from "./setup-choices";

const TOTAL = 9;
const SETUP_STEP = 7;
let current = 0;
let finished = false;
let emailIsValid: () => boolean = () => true;

function activate(n: number): void {
  if (current === SETUP_STEP && n !== SETUP_STEP && !emailIsValid()) {
    document.getElementById("wt-email-input")?.focus();
    return;
  }

  document.getElementById(`step-${current}`)?.classList.remove("is-active");
  document.querySelector<HTMLElement>(`.wt-dot[data-step="${current}"]`)?.classList.remove("active");

  current = Math.max(0, Math.min(TOTAL - 1, n));

  const stepEl = document.getElementById(`step-${current}`);
  stepEl?.classList.add("is-active");
  document.querySelector<HTMLElement>(`.wt-dot[data-step="${current}"]`)?.classList.add("active");

  if (stepEl) mountDemos(stepEl);

  const prev = document.getElementById("prev-btn") as HTMLButtonElement;
  const next = document.getElementById("next-btn") as HTMLButtonElement;
  prev.disabled = current === 0;
  next.textContent = current === TOTAL - 1 ? "Finish" : "Next →";

  const skip = document.getElementById("skip-btn");
  if (skip) skip.hidden = current >= SETUP_STEP;

  const fill = document.getElementById("progress-fill");
  if (fill) fill.style.width = `${((current + 1) / TOTAL) * 100}%`;

  document.querySelector(".wt-card")?.scrollTo({top: 0});
}

function showSuccess(): void {
  finished = true;
  document.getElementById(`step-${current}`)?.classList.remove("is-active");
  document.getElementById("wt-done")?.classList.add("is-active");
  document.querySelector<HTMLElement>(".wt-nav")!.hidden = true;
}

installOfflineFixtures();

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prev-btn")?.addEventListener("click", () => activate(current - 1));

  document.getElementById("next-btn")?.addEventListener("click", () => {
    if (current === TOTAL - 1) showSuccess();
    else activate(current + 1);
  });

  document.getElementById("done-close-btn")?.addEventListener("click", () => window.close());

  document.querySelectorAll<HTMLElement>(".wt-dot").forEach((dot) => {
    dot.addEventListener("click", () => activate(parseInt(dot.dataset.step ?? "0", 10)));
  });

  document.getElementById("skip-btn")?.addEventListener("click", () => activate(SETUP_STEP));

  ({emailIsValid} = mountSetupChoices());

  const sampleError = document.getElementById("tour-sample-error");
  document.getElementById("tour-sample-btn")?.addEventListener("click", () => {
    if (sampleError) sampleError.hidden = true;
    openTourSample().catch((err) => {
      debugError("Walkthrough: could not open the sample article —", err);
      if (sampleError) sampleError.hidden = false;
    });
  });

  mountSiteCategoryPicker(document.getElementById("wt-site-categories")!);

  document.addEventListener("keydown", (e) => {
    if (finished) return;
    if (e.target instanceof Element && e.target.closest(
      "input, button, select, textarea, summary, [contenteditable], #wt-site-categories"
    )) return;
    if (e.key === "ArrowRight") activate(current + 1);
    if (e.key === "ArrowLeft") activate(current - 1);
  });

  activate(0);
});
