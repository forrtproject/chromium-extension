import { afterEach, describe, expect, it, vi } from "vitest";
import { backdropColor, contrastRatio, followPageTheme, isDark, parseCssColor } from "../../src/shared/backdrop";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const flush = async () => {
  await Promise.resolve();
  await nextFrame();
};

describe("followPageTheme", () => {
  function nested() {
    const theme = document.createElement("div");
    const article = document.createElement("article");
    const pill = document.createElement("span");
    article.appendChild(pill);
    theme.appendChild(article);
    document.body.appendChild(theme);
    return { theme, article, pill };
  }

  it("rechecks when a theme class changes on an intermediate ancestor", async () => {
    const { theme, pill } = nested();
    const recheck = vi.fn();
    followPageTheme(pill, recheck);
    expect(recheck).toHaveBeenCalledTimes(1);
    theme.classList.add("dark");
    await flush();
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it("leaves pills outside the changed subtree alone", async () => {
    const first = nested();
    const second = nested();
    const firstCheck = vi.fn();
    const secondCheck = vi.fn();
    followPageTheme(first.pill, firstCheck);
    followPageTheme(second.pill, secondCheck);
    first.theme.setAttribute("data-theme", "dark");
    await flush();
    expect(firstCheck).toHaveBeenCalledTimes(2);
    expect(secondCheck).toHaveBeenCalledTimes(1);
  });

  it("does not recheck a pill that has left the page", async () => {
    const { theme, pill } = nested();
    const recheck = vi.fn();
    followPageTheme(pill, recheck);
    pill.remove();
    theme.classList.add("dark");
    document.body.classList.add("dark");
    await flush();
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("ignores attributes that cannot change a theme", async () => {
    const { theme, pill } = nested();
    const recheck = vi.fn();
    followPageTheme(pill, recheck);
    theme.setAttribute("aria-busy", "true");
    await flush();
    expect(recheck).toHaveBeenCalledTimes(1);
  });
});

const near = (actual: readonly number[] | null, expected: number[], tolerance = 2) => {
  expect(actual).not.toBeNull();
  actual!.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(tolerance));
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("parseCssColor", () => {
  it("reads rgb and rgba in both comma and space syntax", () => {
    near(parseCssColor("rgb(24, 24, 27)"), [24, 24, 27, 1], 0);
    near(parseCssColor("rgba(0, 0, 0, 0.5)"), [0, 0, 0, 0.5], 0);
    near(parseCssColor("rgb(10 20 30 / 0.25)"), [10, 20, 30, 0.25], 0);
  });

  it("converts oklab and oklch to sRGB", () => {
    near(parseCssColor("oklch(0.6279 0.2577 29.23)"), [255, 0, 0, 1], 3);
    near(parseCssColor("oklab(0 0 0)"), [0, 0, 0, 1]);
    near(parseCssColor("oklch(1 0 0)"), [255, 255, 255, 1]);
    near(parseCssColor("oklch(0.2 0.02 250 / 0.5)")?.slice(3) ?? null, [0.5], 0);
  });

  it("converts lab and lch to sRGB", () => {
    near(parseCssColor("lab(54.29 80.8 69.89)"), [255, 0, 0, 1], 3);
    near(parseCssColor("lch(100 0 0)"), [255, 255, 255, 1]);
    near(parseCssColor("lab(0 0 0)"), [0, 0, 0, 1]);
  });

  it("reads color() spaces", () => {
    near(parseCssColor("color(srgb 0.1 0.1 0.1)"), [25.5, 25.5, 25.5, 1], 1);
    near(parseCssColor("color(display-p3 1 1 1 / 0.4)"), [255, 255, 255, 0.4], 0);
  });

  it("returns null for what it cannot read", () => {
    expect(parseCssColor("currentcolor")).toBeNull();
    expect(parseCssColor("hsl(0 0% 0%)")).toBeNull();
  });
});

describe("backdropColor", () => {
  it("classifies an opaque dark OKLCH background as dark", () => {
    const host = document.createElement("div");
    const child = document.createElement("span");
    host.appendChild(child);
    document.body.appendChild(host);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
      el === host ? ({ backgroundColor: "oklch(0.2 0.01 260)" } as CSSStyleDeclaration) : real(el, pseudo));
    expect(isDark(backdropColor(child))).toBe(true);
  });

  it("composites a translucent layer over what lies beneath", () => {
    const host = document.createElement("div");
    host.style.backgroundColor = "rgb(255, 255, 255)";
    const veil = document.createElement("div");
    veil.style.backgroundColor = "rgba(40, 40, 40, 0.5)";
    const child = document.createElement("span");
    veil.appendChild(child);
    host.appendChild(veil);
    document.body.appendChild(host);
    near(backdropColor(child), [147.5, 147.5, 147.5], 1);
    expect(isDark(backdropColor(child))).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });
});
