/**
 * Render the toolbar icons (the FORRT tower, tinted per state) to PNGs in
 * assets/icons/. Gray is the manifest default; maroon marks tabs where ORE is
 * active. Run with `npx tsx scripts/make-icons.ts`; Chrome for Testing is
 * fetched into ~/.cache/puppeteer if missing.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer-core";
import { Browser as BrowserName, computeExecutablePath, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";

const LOGO = "data:image/svg+xml;base64," + readFileSync("assets/forrt-logo.svg").toString("base64");
const SIZES = [16, 32, 48, 128];
const TOWER = 1;
const VARIANTS = { gray: "#9aa0a6", maroon: "#853953" } as const;

function draw(size: number, tint: string, overlay = ""): string {
  return `return (async () => {
    const c = document.createElement("canvas"); c.width = c.height = ${size};
    const ctx = c.getContext("2d");
    const img = new Image(); img.src = "${LOGO}"; await img.decode();
    const src = document.createElement("canvas"); src.width = img.naturalWidth * 4; src.height = img.naturalHeight * 4;
    const sctx = src.getContext("2d");
    sctx.drawImage(img, 0, 0, src.width, src.height);
    const alpha = sctx.getImageData(0, 0, src.width, src.height).data;
    let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      if (alpha[(y * src.width + x) * 4 + 3] > 16) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, scale = ${size * TOWER} / Math.max(cw, ch);
    const w = cw * scale, h = ch * scale;
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const octx = off.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(src, x0, y0, cw, ch, 0, 0, w, h);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = "${tint}"; octx.fillRect(0, 0, w, h);
    ctx.drawImage(off, (${size} - w) / 2, (${size} - h) / 2);
    ${overlay}
    return c.toDataURL("image/png");
  })();`;
}

const PIP = 0.58;

function drawBlocked(size: number): string {
  const d = size * PIP, mid = size - d / 2, r = d / 2, inner = r - size * 0.045;
  return draw(size, VARIANTS.gray, `
    ctx.fillStyle = "${VARIANTS.maroon}";
    ctx.beginPath(); ctx.arc(${mid}, ${mid}, ${r}, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(${mid}, ${mid}, ${inner}, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "${VARIANTS.maroon}";
    ctx.lineWidth = ${Math.max(1.2, size * 0.09)}; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(${mid - inner * 0.6}, ${mid - inner * 0.6});
    ctx.lineTo(${mid + inner * 0.6}, ${mid + inner * 0.6});
    ctx.stroke();`);
}

const platform = detectBrowserPlatform()!;
const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
const buildId = await resolveBuildId(BrowserName.CHROME, platform, "stable");
const executablePath = computeExecutablePath({ browser: BrowserName.CHROME, buildId, cacheDir });
if (!existsSync(executablePath)) await install({ browser: BrowserName.CHROME, buildId, cacheDir });

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const jobs: [string, (size: number) => string][] = [
  ...Object.entries(VARIANTS).map(([name, tint]) =>
    [name, (size: number) => draw(size, tint)] as [string, (size: number) => string]),
  ["blocked", drawBlocked],
];
for (const [name, body] of jobs) {
  for (const size of SIZES) {
    const dataUrl: string = await page.evaluate(new Function(body(size)) as () => Promise<string>);
    const file = path.join("assets", "icons", `${name}-${size}.png`);
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", file);
  }
}
await browser.close();
