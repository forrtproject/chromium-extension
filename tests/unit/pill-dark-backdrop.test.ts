import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({ lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})) }));

import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

const DOI = "10.1234/backdrop" as DoiString;
const DARK_ABSENT = "rgba(255,255,255,0.6)";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function host(background: string): HTMLElement {
  const outer = document.createElement("div");
  outer.style.backgroundColor = background;
  const inner = document.createElement("p");
  outer.appendChild(inner);
  document.body.appendChild(outer);
  return inner;
}

const face = (wrapper: HTMLElement) => wrapper.querySelector<HTMLElement>("[data-flora-segments]")!;
const absentColor = (wrapper: HTMLElement) => face(wrapper).style.getPropertyValue("--flora-absent");

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("indicator pill on a dark page", () => {
  it("drops the white face and lightens the empty segments", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    host("rgb(24, 24, 27)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true);
    expect(face(wrapper).style.background).toBe("transparent");
    expect(absentColor(wrapper)).toBe(DARK_ABSENT);
    const absent = wrapper.querySelector<HTMLElement>("[data-flora-segment]:not([data-flora-present])")!;
    expect(absent.style.color).toContain("--flora-absent");
  });

  it("stays white on a light page", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    host("rgb(250, 250, 250)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false);
    expect(face(wrapper).style.background).not.toBe("transparent");
    expect(absentColor(wrapper)).toBe("");
  });

  it("gives the pill its own dark fill where see-through text would be too faint", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    host("rgb(90, 90, 90)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true);
    expect(face(wrapper).style.background).toBe("rgb(28, 28, 31)");
  });

  it("composites translucent ancestors instead of reading only the topmost one", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    const veil = document.createElement("span");
    veil.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    veil.appendChild(wrapper);
    host("rgb(10, 10, 10)").appendChild(veil);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true);
  });

  it("follows the page when it switches theme, both ways", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false);

    document.body.style.backgroundColor = "rgb(20, 20, 20)";
    await vi.waitFor(() => expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true));
    expect(absentColor(wrapper)).toBe(DARK_ABSENT);

    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    await vi.waitFor(() => expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false));
    expect(face(wrapper).style.background).toMatch(/^(#ffffff|rgb\(255, 255, 255\))$/);
    expect(absentColor(wrapper)).toBe("");
  });

  it("keeps a segment redrawn after its lookup light-on-dark", async () => {
    const wrapper = createIndicatorPill({ doi: DOI, oaStatus: Promise.resolve({ isOa: false, url: null }) });
    host("rgb(24, 24, 27)").appendChild(wrapper);
    await nextFrame();
    await vi.waitFor(() => expect(wrapper.querySelector("[data-flora-oa-segment]")!.hasAttribute("data-flora-pending")).toBe(false));
    expect(wrapper.querySelector<HTMLElement>("[data-flora-oa-segment]")!.style.color).toContain("--flora-absent");
    expect(absentColor(wrapper)).toBe(DARK_ABSENT);
  });

  it("leaves the Word margin marker alone", async () => {
    const wrapper = createIndicatorPill({ doi: DOI, presentation: "marker" });
    host("rgb(24, 24, 27)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false);
  });

  it("does nothing for a pill that was never put on the page", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false);
  });
});
