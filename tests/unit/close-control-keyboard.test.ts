import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderSetupPrompt, renderSheetsModal } from "../../src/content-general/injector";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "" }),
  isSetupComplete: vi.fn().mockResolvedValue(false),
}));

function pressKey(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("setup prompt close control", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ dismissed: false });
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("closes on Enter", async () => {
    await renderSetupPrompt();
    const close = document.querySelector(".flora-setup-close");
    expect(close).not.toBeNull();

    pressKey(close!, "Enter");
    await tick();

    expect(document.getElementById("flora-setup-prompt")).toBeNull();
  });

  it("closes on Space", async () => {
    await renderSetupPrompt();
    const close = document.querySelector(".flora-setup-close")!;

    pressKey(close, " ");
    await tick();

    expect(document.getElementById("flora-setup-prompt")).toBeNull();
  });
});

describe("sheets modal close control", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("closes on Enter and reports the dismissal", () => {
    const onDismiss = vi.fn();
    renderSheetsModal([], [{ originDoi: "10.1/x", doi: "10.1/notice", kind: "retraction" }], {
      onDismiss,
      onSnooze: vi.fn(),
    });
    const close = document.querySelector(".flora-modal-close");
    expect(close).not.toBeNull();

    pressKey(close!, "Enter");

    expect(document.getElementById("flora-sheets-modal")).toBeNull();
    expect(onDismiss).toHaveBeenCalled();
  });
});
