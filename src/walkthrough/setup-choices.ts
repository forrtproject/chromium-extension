import {CITATION_FORMATS, citationFormat} from "../shared/citation";
import {debugError} from "../shared/debug";
import {getSettings, saveSettings} from "../shared/settings";
import {t} from "../shared/i18n";

const saveFailed = (): string => t("walkthrough.setup.saveFailed", "Couldn't save. Please try again.");

function showStatus(el: HTMLElement, message: string, isError = false): void {
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

export function mountSetupChoices(): {emailIsValid: () => boolean} {
  const emailForm = document.getElementById("wt-email-form") as HTMLFormElement;
  const emailInput = document.getElementById("wt-email-input") as HTMLInputElement;
  const emailStatus = document.getElementById("wt-email-status")!;
  const citationSelect = document.getElementById("wt-citation-select") as HTMLSelectElement;
  const citationStatus = document.getElementById("wt-citation-status")!;

  let savedEmail = "";

  for (const format of CITATION_FORMATS) {
    citationSelect.add(new Option(format.label, format.id));
  }

  void getSettings().then(({email, citationStyle}) => {
    savedEmail = email;
    emailInput.value = email;
    citationSelect.value = citationFormat(citationStyle).id;
  });

  const emailIsValid = (): boolean => {
    const valid = emailInput.checkValidity();
    if (valid) emailInput.removeAttribute("aria-invalid");
    else {
      emailInput.setAttribute("aria-invalid", "true");
      showStatus(emailStatus, t("walkthrough.setup.email.invalid", "That doesn't look like an email address."), true);
    }
    return valid;
  };

  const saveEmail = async (): Promise<void> => {
    if (!emailIsValid()) return;
    const email = emailInput.value.trim();
    if (email === savedEmail) {
      showStatus(emailStatus, "");
      return;
    }
    try {
      await saveSettings({email});
      savedEmail = email;
      showStatus(emailStatus, email
        ? t("walkthrough.setup.email.saved", "Email saved. Reload open tabs to use it for lookups.")
        : t("walkthrough.setup.email.removed", "Email removed. Title matching and open-access lookups need an email; other checks still work."));
    } catch (err) {
      debugError("Walkthrough: could not save the email —", err);
      showStatus(emailStatus, saveFailed(), true);
    }
  };

  emailInput.addEventListener("input", () => {
    if (!emailInput.hasAttribute("aria-invalid")) return;
    emailInput.removeAttribute("aria-invalid");
    showStatus(emailStatus, "");
  });
  emailInput.addEventListener("change", () => void saveEmail());
  emailForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveEmail();
  });

  citationSelect.addEventListener("change", async () => {
    const format = citationFormat(citationSelect.value);
    try {
      await saveSettings({citationStyle: format.id});
      // i18n: {style} is a citation style name such as "APA" or "Vancouver"
      showStatus(citationStatus, t("walkthrough.setup.citation.saved", "Citation style set to {style}.", {style: format.label}));
    } catch (err) {
      debugError("Walkthrough: could not save the citation style —", err);
      showStatus(citationStatus, saveFailed(), true);
    }
  });

  return {emailIsValid};
}
