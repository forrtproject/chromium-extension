import {installOfflineFixtures, mountDemos} from "./demos";
import {mountSiteCategoryPicker} from "../shared/site-category-picker";
import {openTourSample} from "../shared/tour-sample";
import {debugError} from "../shared/debug";
import {mountSetupChoices} from "./setup-choices";
import {initI18n, localizeDocument, t} from "../shared/i18n";

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
  next.textContent = current === TOTAL - 1
    ? t("walkthrough.nav.finish", "Finish")
    : t("walkthrough.nav.next", "Next →");

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

function numberSteps(): void {
  for (let n = 0; n < TOTAL; n++) {
    const label = document.querySelector<HTMLElement>(`#step-${n} .wt-step-num`);
    // i18n: progress label on each walkthrough screen, e.g. "3 of 9"
    if (label) label.textContent = t("walkthrough.stepCount", "{current} of {total}", {current: n + 1, total: TOTAL});
  }
}

// The language setting lives in chrome.storage.sync and the catalog is an
// extension file; the offline fixtures leave both reachable.
const i18nReady = initI18n();
installOfflineFixtures();

function render(): void {
  localizeDocument();
  numberSteps();
  ({emailIsValid} = mountSetupChoices());
  mountSiteCategoryPicker(document.getElementById("wt-site-categories")!);
  activate(0);
}

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

  const sampleError = document.getElementById("tour-sample-error");
  document.getElementById("tour-sample-btn")?.addEventListener("click", () => {
    if (sampleError) sampleError.hidden = true;
    openTourSample().catch((err) => {
      debugError("Walkthrough: could not open the sample article —", err);
      if (sampleError) sampleError.hidden = false;
    });
  });

  document.addEventListener("keydown", (e) => {
    if (finished) return;
    if (e.target instanceof Element && e.target.closest(
      "input, button, select, textarea, summary, [contenteditable], #wt-site-categories"
    )) return;
    if (e.key === "ArrowRight") activate(current + 1);
    if (e.key === "ArrowLeft") activate(current - 1);
  });

  i18nReady.then(render).catch((err) => debugError("Walkthrough: could not start —", err));
});
