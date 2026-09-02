/**
 * Render the toolbar icons (a rounded square with a bold "F") to PNGs in
 * assets/icons/. Gray is the manifest default; maroon marks tabs where ORE is
 * active. Run with `npx tsx scripts/make-icons.ts`; Chrome for Testing is
 * fetched into ~/.cache/puppeteer if missing.
 */
import { existsSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer-core";
import { Browser as BrowserName, computeExecutablePath, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";

const SIZES = [16, 32, 48, 128];
const VARIANTS = { gray: ["#9aa0a6", "#eceff1"], maroon: ["#853953", "#ffffff"] } as const;

function draw(size: number, fill: string, letter: string): string {
  return `
    const c = document.createElement("canvas"); c.width = c.height = ${size};
    const ctx = c.getContext("2d");
    ctx.fillStyle = "${fill}"; ctx.beginPath();
    ctx.roundRect(0.5, 0.5, ${size} - 1, ${size} - 1, ${size} * 0.22); ctx.fill();
    ctx.fillStyle = "${letter}";
    ctx.font = "bold ${Math.round(size * 0.68)}px -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("F", ${size} / 2, ${size} * 0.56);
    return c.toDataURL("image/png");`;
}

const platform = detectBrowserPlatform()!;
const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
const buildId = await resolveBuildId(BrowserName.CHROME, platform, "stable");
const executablePath = computeExecutablePath({ browser: BrowserName.CHROME, buildId, cacheDir });
if (!existsSync(executablePath)) await install({ browser: BrowserName.CHROME, buildId, cacheDir });

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
for (const [name, [fill, letter]] of Object.entries(VARIANTS)) {
  for (const size of SIZES) {
    const dataUrl: string = await page.evaluate(new Function(draw(size, fill, letter)) as () => string);
    const file = path.join("assets", "icons", `${name}-${size}.png`);
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", file);
  }
}
await browser.close();
