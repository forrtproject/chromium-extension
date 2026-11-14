import {showToast} from "./toast";
import {FLORA_ROOT_SELECTOR} from "./flora-ui";
import {t} from "./i18n";

const CHECK_INTERVAL_MS = 2000;

export function showUpdatedToast(): void {
    showToast(t("notice.updated.message", "ORE was updated — reload this page to run checks."), {
        // i18n: toast button that reloads the page; keep short.
        action: {label: t("notice.updated.reload", "Reload"), onClick: () => location.reload()},
    });
}

export function watchForExtensionUpdate(): void {
    const check = (): void => {
        if (chrome.runtime?.id) return;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", check);
        if (document.querySelector(FLORA_ROOT_SELECTOR)) showUpdatedToast();
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
}
