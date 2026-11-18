import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({ lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})) }));

import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

const DOI = "10.1234/backdrop" as DoiString;

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
const absent = (wrapper: HTMLElement) => wrapper.querySelector<HTMLElement>("[data-flora-segment]:not([data-flora-present])")!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("indicator pill on a dark page", () => {
  it("drops the white face and lightens the empty segments", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    host("rgb(24, 24, 27)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true);
    expect(face(wrapper).style.background).toBe("transparent");
    expect(absent(wrapper).style.color).toBe("rgba(255, 255, 255, 0.6)");
  });

  it("stays white on a light page", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    host("rgb(250, 250, 250)").appendChild(wrapper);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(false);
    expect(face(wrapper).style.background).not.toBe("transparent");
  });

  it("looks past transparent and faint ancestors to the colour actually behind it", async () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    const faint = document.createElement("span");
    faint.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    faint.appendChild(wrapper);
    host("rgb(10, 10, 10)").appendChild(faint);
    await nextFrame();
    expect(face(wrapper).hasAttribute("data-flora-dark")).toBe(true);
  });

  it("keeps a segment redrawn after its lookup light-on-dark", async () => {
    const wrapper = createIndicatorPill({ doi: DOI, oaStatus: Promise.resolve({ isOa: false, url: null }) });
    host("rgb(24, 24, 27)").appendChild(wrapper);
    await nextFrame();
    await vi.waitFor(() => expect(wrapper.querySelector("[data-flora-oa-segment]")!.hasAttribute("data-flora-pending")).toBe(false));
    const oa = wrapper.querySelector<HTMLElement>("[data-flora-oa-segment]")!;
    expect(oa.style.color).toBe("rgba(255, 255, 255, 0.6)");
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
