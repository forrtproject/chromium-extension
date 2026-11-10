import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {watchForExtensionUpdate} from "../../src/shared/update-notice";

const toast = () => document.querySelector("[data-flora-toast-message]");

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
});

afterEach(() => {
    chrome.runtime.id = "test-extension-id";
    vi.useRealTimers();
});

it("asks for a reload once the extension is updated on a page ORE has marked up", () => {
    document.body.innerHTML = `<span data-flora-ui></span>`;
    watchForExtensionUpdate();
    vi.advanceTimersByTime(5000);
    expect(toast()).toBeNull();

    (chrome.runtime as {id?: string}).id = undefined;
    vi.advanceTimersByTime(2000);
    expect(toast()?.getAttribute("data-flora-toast-message")).toBe("ORE was updated — reload this page to run checks.");
    expect([...toast()!.querySelectorAll("button")].map((b) => b.textContent)).toContain("Reload");
    toast()!.remove();
    vi.advanceTimersByTime(10_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(toast()).toBeNull();
});

it("checks as soon as the tab is shown again", () => {
    document.body.innerHTML = `<span data-flora-ui></span>`;
    watchForExtensionUpdate();
    (chrome.runtime as {id?: string}).id = undefined;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(toast()).not.toBeNull();
});

it("stays quiet on pages where ORE showed nothing", () => {
    watchForExtensionUpdate();
    (chrome.runtime as {id?: string}).id = undefined;
    vi.advanceTimersByTime(2000);
    expect(toast()).toBeNull();
    document.body.innerHTML = `<span data-flora-ui></span>`;
    vi.advanceTimersByTime(10_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(toast()).toBeNull();
});
