import {showToast} from "./toast";

const CHECK_INTERVAL_MS = 2000;

export function showUpdatedToast(): void {
    showToast("ORE was updated — reload this page to run checks.", {
        action: {label: "Reload", onClick: () => location.reload()},
    });
}

export function watchForExtensionUpdate(): void {
    const check = (): void => {
        if (chrome.runtime?.id) return;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", check);
        if (document.querySelector("[data-flora-ui]")) showUpdatedToast();
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
}
