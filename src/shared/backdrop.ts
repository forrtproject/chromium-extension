export type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

const LIGHT_CANVAS: Rgb = [255, 255, 255];
const DARK_CANVAS: Rgb = [18, 18, 18];

const clamp255 = (v: number): number => Math.min(255, Math.max(0, v * 255));
const encodeSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const decodeSrgb = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function fromLinear(r: number, g: number, b: number): Rgb {
    return [clamp255(encodeSrgb(r)), clamp255(encodeSrgb(g)), clamp255(encodeSrgb(b))];
}

function oklabToRgb(l: number, a: number, b: number): Rgb {
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return fromLinear(
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    );
}

function labToRgb(l: number, a: number, b: number): Rgb {
    const fy = (l + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
    const x = 0.96422 * inv(fx);
    const y = l > 8 ? fy ** 3 : l / (24389 / 27);
    const z = 0.82521 * inv(fz);
    return fromLinear(
        3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z,
        -0.978795502912089 * x + 1.916254567259524 * y + 0.03344273116131949 * z,
        0.07195537988411677 * x - 0.2289768264158322 * y + 1.405386058324125 * z,
    );
}

function component(token: string | undefined, percentScale: number): number {
    if (!token || token === "none") return 0;
    return token.endsWith("%") ? (parseFloat(token) / 100) * percentScale : parseFloat(token);
}

/** Any computed CSS colour (rgb, oklab/oklch, lab/lch, color()) as sRGB 0–255 plus alpha. */
export function parseCssColor(css: string): Rgba | null {
    const match = /^([a-z-]+)\((.*)\)$/i.exec(css.trim());
    if (!match) return css.trim() === "transparent" ? [0, 0, 0, 0] : null;
    const fn = match[1].toLowerCase();
    const [channels, alphaToken] = match[2].split("/");
    const tokens = channels.split(/[\s,]+/).filter(Boolean);
    let alpha = alphaToken !== undefined ? component(alphaToken.trim(), 1) : 1;
    let rgb: Rgb;
    switch (fn) {
        case "rgb":
        case "rgba":
            rgb = [component(tokens[0], 255), component(tokens[1], 255), component(tokens[2], 255)];
            if (tokens[3] !== undefined) alpha = component(tokens[3], 1);
            break;
        case "oklab":
            rgb = oklabToRgb(component(tokens[0], 1), component(tokens[1], 0.4), component(tokens[2], 0.4));
            break;
        case "oklch": {
            const h = (component(tokens[2], 1) * Math.PI) / 180;
            const c = component(tokens[1], 0.4);
            rgb = oklabToRgb(component(tokens[0], 1), c * Math.cos(h), c * Math.sin(h));
            break;
        }
        case "lab":
            rgb = labToRgb(component(tokens[0], 100), component(tokens[1], 125), component(tokens[2], 125));
            break;
        case "lch": {
            const h = (component(tokens[2], 1) * Math.PI) / 180;
            const c = component(tokens[1], 150);
            rgb = labToRgb(component(tokens[0], 100), c * Math.cos(h), c * Math.sin(h));
            break;
        }
        case "color": {
            const [space, ...values] = tokens;
            const [r, g, b] = values.map((v) => component(v, 1));
            // Wide-gamut spaces are read as sRGB: close enough to tell dark from light.
            rgb = space === "srgb-linear" ? fromLinear(r, g, b) : [clamp255(r), clamp255(g), clamp255(b)];
            break;
        }
        default:
            return null;
    }
    if ([...rgb, alpha].some(Number.isNaN)) return null;
    return [rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, alpha))];
}

export function blend(top: Rgb, alpha: number, under: Rgb): Rgb {
    return [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)) as unknown as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
    return 0.2126 * decodeSrgb(r / 255) + 0.7152 * decodeSrgb(g / 255) + 0.0722 * decodeSrgb(b / 255);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

export function isDark([r, g, b]: Rgb): boolean {
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function canvasColor(): Rgb {
    const scheme = getComputedStyle(document.documentElement).colorScheme ?? "";
    if (scheme.includes("only light") || !scheme.includes("dark")) return LIGHT_CANVAS;
    const dark = !scheme.includes("light") || matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? DARK_CANVAS : LIGHT_CANVAS;
}

let backdropCache: WeakMap<Element, Rgb> | null = null;

/** The colour actually painted behind `el`: its ancestors' backgrounds composited over the canvas. */
export function backdropColor(el: Element): Rgb {
    if (!backdropCache) {
        backdropCache = new WeakMap();
        setTimeout(() => { backdropCache = null; }, 0);
    }
    const layers: Array<[Element, Rgba | null]> = [];
    let base: Rgb | undefined;
    for (let node = el.parentElement; node; node = node.parentElement) {
        base = backdropCache.get(node);
        if (base) break;
        const color = parseCssColor(getComputedStyle(node).backgroundColor);
        layers.push([node, color && color[3] > 0 ? color : null]);
        if (color && color[3] >= 1) break;
    }
    let result = base ?? canvasColor();
    for (let i = layers.length - 1; i >= 0; i--) {
        const [node, color] = layers[i];
        if (color) result = blend([color[0], color[1], color[2]], color[3], result);
        backdropCache.set(node, result);
    }
    return result;
}

const THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-mode", "data-color-mode", "data-color-scheme", "data-bs-theme"];

const rechecks = new WeakMap<Element, () => void>();
const followers = new Set<WeakRef<Element>>();
let pruneAt = 64;
let themeObserver: MutationObserver | null = null;
const changedRoots = new Set<Node>();
let recheckQueued = false;

function pruneCollected(): void {
    for (const ref of followers) if (!ref.deref()) followers.delete(ref);
    pruneAt = Math.max(64, followers.size * 2);
}

function recheckThemes(): void {
    recheckQueued = false;
    backdropCache = null;
    const roots = [...changedRoots];
    changedRoots.clear();
    for (const ref of followers) {
        const el = ref.deref();
        if (!el) {
            followers.delete(ref);
            continue;
        }
        if (el.isConnected && roots.some((root) => root.contains(el))) rechecks.get(el)?.();
    }
}

function queueRecheck(roots: Iterable<Node>): void {
    for (const root of roots) changedRoots.add(root);
    if (recheckQueued) return;
    recheckQueued = true;
    requestAnimationFrame(recheckThemes);
}

function observer(): MutationObserver {
    if (themeObserver) return themeObserver;
    themeObserver = new MutationObserver((mutations) => queueRecheck(mutations.map((m) => m.target)));
    if (typeof matchMedia === "function") {
        matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => queueRecheck([document.documentElement]));
    }
    return themeObserver;
}

/**
 * Run `recheck` now and again whenever a theme attribute changes on `el` or any
 * ancestor, or the OS scheme flips. Held weakly: a removed pill is not kept alive.
 */
export function followPageTheme(el: Element, recheck: () => void): void {
    const watcher = observer();
    for (let node = el.parentElement; node; node = node.parentElement) {
        watcher.observe(node, {attributes: true, attributeFilter: THEME_ATTRIBUTES});
    }
    if (!rechecks.has(el)) followers.add(new WeakRef(el));
    rechecks.set(el, recheck);
    if (followers.size >= pruneAt) pruneCollected();
    recheck();
}
