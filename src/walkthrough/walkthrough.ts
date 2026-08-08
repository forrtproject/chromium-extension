import {installOfflineFixtures, mountDemos} from "./demos";

const TOTAL = 9;
let current = 0;

function activate(n: number): void {
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
  next.textContent = current === TOTAL - 1 ? "Open Settings →" : "Next →";

  const fill = document.getElementById("progress-fill");
  if (fill) fill.style.width = `${((current + 1) / TOTAL) * 100}%`;

  document.querySelector(".wt-card")?.scrollTo({top: 0});
}

function finish(): void {
  chrome.runtime.openOptionsPage();
  window.close();
}

installOfflineFixtures();

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prev-btn")?.addEventListener("click", () => activate(current - 1));

  document.getElementById("next-btn")?.addEventListener("click", () => {
    if (current === TOTAL - 1) finish();
    else activate(current + 1);
  });

  document.querySelectorAll<HTMLElement>(".wt-dot").forEach((dot) => {
    dot.addEventListener("click", () => activate(parseInt(dot.dataset.step ?? "0", 10)));
  });

  document.getElementById("skip-btn")?.addEventListener("click", finish);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") activate(current + 1);
    if (e.key === "ArrowLeft") activate(current - 1);
  });

  activate(0);
});
