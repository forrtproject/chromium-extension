import {Browser as BrowserName, computeExecutablePath, detectBrowserPlatform, install} from "@puppeteer/browsers";
import puppeteer, {type Browser, type Page} from "puppeteer-core";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {refreshPublishers} from "./publishers";

declare const chrome: any;

interface Publisher {
    id: string;
    publisher: string;
    url: string;
    domain?: string;
    doisInFred?: number;
}

type Verdict = "pass" | "fail" | "blocked" | "timeout" | "no-doi" | "error";

interface Result {
    id: string;
    publisher: string;
    url: string;
    domain: string;
    doisInFred: number | null;
    finalUrl: string;
    verdict: Verdict;
    reason: string;
    httpStatus: number | null;
    pageTitle: string;
    pageDoi: string | null;
    titlePill: boolean;
    indicatorPills: number;
    noticePills: number;
    reportPanel: boolean;
    nothingFound: boolean;
    doneIn: string | null;
    loadMs: number;
    oreErrors: string[];
    oreLog: string[];
    screenshot: string | null;
    referenceScreenshot: string | null;
    panelScreenshot: string | null;
    attempts: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const OUTPUT_DIR = path.join(HERE, "output");
const SNAPSHOT_DIR = path.join(OUTPUT_DIR, "snapshots");
const CHROME_BUILD = "152.0.7977.75";
const VIEWPORT = {width: 1280, height: 900};
const NAVIGATION_TIMEOUT_MS = 45_000;
const SETTLE_TIMEOUT_MS = 75_000;
const IDLE_GIVE_UP_MS = 20_000;
const DEFAULT_CHECK_WAIT_S = 20;
const PAUSE_BETWEEN_PAGES_MS = 4_000;
const BLOCK_PATTERN = /just a moment|verify you are human|are you a robot|unusual traffic|access denied|captcha|attention required|request unsuccessful|bot detection/i;

const args = process.argv.slice(2);
const headed = !args.includes("--headless") && !process.env.CI;
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",");
const refresh = args.includes("--refresh");
const csvPath = args.find((a) => a.startsWith("--csv="))?.slice("--csv=".length);
const top = Number(args.find((a) => a.startsWith("--top="))?.slice("--top=".length)) || null;
const checkWaitArg = args.find((a) => a.startsWith("--check-wait="))?.slice("--check-wait=".length);
const checkWaitMs = headed ? Math.max(0, Number(checkWaitArg ?? DEFAULT_CHECK_WAIT_S) || 0) * 1000 : 0;
const profileDir = args.find((a) => a.startsWith("--profile="))?.slice("--profile=".length)
    ?? (headed ? path.join(HERE, ".profile") : undefined);

async function ensureChrome(): Promise<string> {
    if (!detectBrowserPlatform()) throw new Error("Unsupported platform for Chrome for Testing");
    const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
    const execPath = computeExecutablePath({browser: BrowserName.CHROME, buildId: CHROME_BUILD, cacheDir});
    if (!existsSync(execPath)) {
        console.log(`Installing Chrome for Testing (${CHROME_BUILD}) …`);
        await install({browser: BrowserName.CHROME, buildId: CHROME_BUILD, cacheDir});
    }
    return execPath;
}

async function launch(): Promise<Browser> {
    return puppeteer.launch({
        executablePath: await ensureChrome(),
        headless: !headed,
        defaultViewport: VIEWPORT,
        ...(profileDir ? {userDataDir: path.resolve(profileDir)} : {}),
        args: [
            ...(process.env.CI ? ["--no-sandbox"] : []),
            `--disable-extensions-except=${REPO_ROOT}`,
            `--load-extension=${REPO_ROOT}`,
            "--disable-features=DisableLoadExtensionCommandLineSwitch",
            "--no-first-run",
            "--no-default-browser-check",
            `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
        ],
    });
}

async function prepareExtension(browser: Browser): Promise<void> {
    const target = await browser.waitForTarget((t) =>
        t.type() === "service_worker" && t.url().endsWith("/dist/background.js"), {timeout: 20_000});
    const worker = await target.worker();
    if (!worker) throw new Error("ORE service worker not available");
    const readyBy = Date.now() + 15_000;
    while (!(await worker.evaluate("Boolean(globalThis.chrome?.runtime?.id && typeof chrome.storage?.local?.set === 'function')").catch(() => false))) {
        if (Date.now() > readyBy) throw new Error("ORE service worker did not finish starting");
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const email = process.env.ORE_TEST_EMAIL?.trim() ?? "";
    await worker.evaluate(async (contact: string) => {
        await chrome.storage.local.set({flora_debug: true});
        const sync: Record<string, unknown> = {flora_setup_remind_after: Date.now() + 86_400_000};
        if (contact) sync.flora_settings = {email: contact};
        await chrome.storage.sync.set(sync);
    }, email);
    if (!email) console.log("ORE_TEST_EMAIL not set — running without a contact email (open-access lookups stay off).");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const page of await browser.pages()) {
        if (page.url().startsWith("chrome-extension://")) await page.close();
    }
}

interface PageState {
    label: string;
    busy: boolean;
    titlePill: boolean;
    indicatorPills: number;
    noticePills: number;
    reportPanel: boolean;
    nothingFound: boolean;
    pageDoi: string | null;
    pageTitle: string;
    bodyText: string;
}

const EMPTY_STATE: PageState = {label: "", busy: false, titlePill: false, indicatorPills: 0, noticePills: 0,
    reportPanel: false, nothingFound: false, pageDoi: null, pageTitle: "", bodyText: ""};

const READ_STATE = `(() => {
    const pageDoi = ["citation_doi", "dc.identifier", "prism.doi"]
        .map((name) => (document.querySelector('meta[name="' + name + '" i]')?.content ?? "").trim())
        .map((value) => value.replace(/^(doi:|https?:\\/\\/(dx\\.)?doi\\.org\\/)/i, ""))
        .find((value) => /^10\\.\\d{4,9}\\//.test(value)) ?? null;
    return {
        label: document.querySelector("#flora-working-toast [data-flora-work-label]")?.textContent ?? "",
        busy: document.querySelector("[data-flora-tab-busy]") !== null,
        titlePill: document.querySelector("[data-flora-title-pill]") !== null,
        indicatorPills: document.querySelectorAll(".flora-indicator-pill").length,
        noticePills: document.querySelectorAll(".flora-notice-pill").length,
        reportPanel: document.getElementById("flora-pubpeer-panel") !== null,
        nothingFound: document.getElementById("flora-nothing-found") !== null,
        pageDoi,
        pageTitle: document.title,
        bodyText: (document.body?.innerText ?? "").slice(0, 3000),
    };
})()`;

const DISMISS_CONSENT = `(() => {
    const visible = (el) => el && el.getClientRects().length > 0;
    const known = ["#onetrust-reject-all-handler", "#onetrust-accept-btn-handler",
        "#CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
        "#didomi-notice-disagree-button", "#didomi-notice-agree-button", "#truste-consent-required",
        "#truste-consent-button", "button[data-testid='uc-deny-all-button']",
        "button[data-testid='uc-accept-all-button']", ".cc-deny", ".cc-allow"];
    let clicked = known.map((sel) => document.querySelector(sel)).find(visible);
    if (!clicked) {
        const label = /^(reject all( cookies)?|reject non-essential|decline( all)?|(use )?(only )?necessary( cookies)?( only)?|accept all( cookies)?|accept( cookies)?|i accept|i agree|agree|allow all( cookies)?|got it)$/i;
        const buttons = [...document.querySelectorAll("button, [role=button], a.button")]
            .filter((b) => visible(b) && label.test((b.textContent || "").trim().replace(/\\s+/g, " ")));
        clicked = buttons.find((b) => /reject|decline|necessary/i.test(b.textContent)) ?? buttons[0];
    }
    if (clicked) clicked.click();
    if (!document.getElementById("ore-live-consent-hide")) {
        const style = document.createElement("style");
        style.id = "ore-live-consent-hide";
        style.textContent = "#onetrust-consent-sdk,#CybotCookiebotDialog,#didomi-host,#truste-consent-track," +
            ".truste_overlay,.truste_box_overlay,#usercentrics-root,.cc-window,.fc-consent-root,#qc-cmp2-container," +
            "[id^='sp_message_container'],#cookie-banner,.cookie-banner,[id*='cookie-consent' i]," +
            "[class*='cookie-consent' i],[role=dialog][aria-label*='cookie' i],[role=dialog][aria-label*='privacy' i]" +
            "{display:none!important}#flora-working-toast{visibility:hidden!important}";
        document.documentElement.appendChild(style);
    }
    return Boolean(clicked);
})()`;

const SCROLL_TO_REFERENCES = `(() => {
    const heading = [...document.querySelectorAll("h1, h2, h3, h4, [role=heading]")]
        .find((h) => /^\\s*(references?|bibliography|literature cited|works cited|reference list|cited literature)\\s*$/i.test(h.textContent || ""));
    const section = heading ?? document.querySelector("#references, #bibliography, .ref-list, .references, [role=doc-bibliography]");
    const pill = [...document.querySelectorAll(".flora-indicator-pill")].find((p) => !p.hasAttribute("data-flora-title-pill"));
    const target = section ?? pill;
    if (!target) return false;
    target.scrollIntoView({block: "start"});
    window.scrollBy(0, -90);
    return true;
})()`;

const OPEN_REPORT = `(() => {
    const tab = document.querySelector("#flora-pubpeer-panel button[data-flora-tab]");
    if (!tab) return false;
    tab.click();
    return true;
})()`;

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBotWall(state: PageState, httpStatus: number | null): boolean {
    return (httpStatus !== null && httpStatus >= 400)
        || BLOCK_PATTERN.test(state.pageTitle)
        || BLOCK_PATTERN.test(state.bodyText.slice(0, 600));
}

function isBlocked(state: PageState, httpStatus: number | null): boolean {
    return isBotWall(state, httpStatus) || state.bodyText.trim().length < 40;
}

async function readState(page: Page): Promise<PageState> {
    return page.evaluate(READ_STATE) as Promise<PageState>;
}

async function dismissConsent(page: Page): Promise<void> {
    try {
        if (await page.evaluate(DISMISS_CONSENT)) await pause(700);
    } catch {
        await pause(500);
    }
}

async function waitForCheck(page: Page): Promise<boolean> {
    process.stdout.write(`bot check — waiting up to ${checkWaitMs / 1000} s … `);
    const started = Date.now();
    while (Date.now() - started < checkWaitMs) {
        await pause(1000);
        try {
            if (!isBotWall(await readState(page), null)) return true;
        } catch {
            continue;
        }
    }
    return false;
}

async function waitForOre(page: Page): Promise<{state: PageState; sawNothingFound: boolean; settled: boolean}> {
    const started = Date.now();
    let sawNothingFound = false;
    let state = EMPTY_STATE;
    while (Date.now() - started < SETTLE_TIMEOUT_MS) {
        try {
            state = await readState(page);
        } catch {
            await pause(1000);
            continue;
        }
        sawNothingFound ||= state.nothingFound;
        if (state.label.startsWith("Done in")) return {state, sawNothingFound, settled: true};
        const active = state.label !== "" || state.busy || state.indicatorPills > 0 || state.reportPanel;
        if (!active && Date.now() - started > IDLE_GIVE_UP_MS) return {state, sawNothingFound, settled: false};
        await pause(500);
    }
    return {state, sawNothingFound, settled: false};
}

async function capture(page: Page, file: string): Promise<string | null> {
    try {
        await dismissConsent(page);
        await page.screenshot({path: file, type: "jpeg", quality: 70});
        return path.basename(file);
    } catch {
        return null;
    }
}

function judge(result: Omit<Result, "verdict" | "reason" | "attempts">, settled: boolean, blocked: boolean): Pick<Result, "verdict" | "reason"> {
    if (blocked) return {verdict: "blocked", reason: "The site showed a bot check, an empty page or refused access, so ORE could not be tested."};
    const found = result.titlePill || result.indicatorPills > 0 || result.noticePills > 0 || result.reportPanel;
    if (!settled && !found) return {verdict: "timeout", reason: "ORE showed no activity before the time limit."};
    if (found && result.titlePill) return {verdict: "pass", reason: "ORE recognised the article and marked it up."};
    if (found) return {verdict: "pass", reason: "ORE marked up DOIs on the page, but placed no pill on the article title."};
    if (result.pageDoi) return {verdict: "fail", reason: `The page declares DOI ${result.pageDoi}, but ORE did not mark anything up.`};
    return {verdict: "no-doi", reason: "No DOI was found on the page, and ORE did not mark anything up."};
}

async function attempt(browser: Browser, entry: Publisher, attemptNumber: number): Promise<Result> {
    const page = await browser.newPage();
    const oreErrors: string[] = [];
    const oreLog: string[] = [];
    page.on("console", (message) => {
        const text = message.text();
        if (!text.startsWith("[FLoRA]")) return;
        oreLog.push(text.slice(8, 308));
        if (message.type() === "error" || message.type() === "warn") oreErrors.push(text.slice(0, 300));
    });

    const base = {
        id: entry.id, publisher: entry.publisher, url: entry.url, finalUrl: entry.url,
        domain: entry.domain ?? new URL(entry.url).hostname, doisInFred: entry.doisInFred ?? null,
        httpStatus: null as number | null, pageTitle: "", pageDoi: null as string | null,
        titlePill: false, indicatorPills: 0, noticePills: 0, reportPanel: false, nothingFound: false,
        doneIn: null as string | null, loadMs: 0, oreErrors, oreLog, screenshot: null as string | null,
        referenceScreenshot: null as string | null, panelScreenshot: null as string | null,
    };
    const shot = (suffix: string) => path.join(OUTPUT_DIR, `${entry.id}${suffix}.jpg`);

    const started = Date.now();
    try {
        const response = await page.goto(entry.url, {waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS});
        await page.bringToFront();
        base.httpStatus = response?.status() ?? null;
        base.loadMs = Date.now() - started;
        await pause(1500);
        const early = await readState(page).catch(() => EMPTY_STATE);
        if (isBotWall(early, base.httpStatus)) {
            const cleared = checkWaitMs > 0 && await waitForCheck(page);
            if (!cleared) {
                base.finalUrl = page.url();
                base.pageTitle = early.pageTitle;
                base.screenshot = await capture(page, shot(""));
                return {...base, ...judge(base, false, true), attempts: attemptNumber};
            }
            base.httpStatus = 200;
        }
        await dismissConsent(page);

        const {state, sawNothingFound, settled} = await waitForOre(page);
        base.finalUrl = page.url();
        base.pageTitle = state.pageTitle;
        base.pageDoi = state.pageDoi;
        base.titlePill = state.titlePill;
        base.indicatorPills = state.indicatorPills;
        base.noticePills = state.noticePills;
        base.reportPanel = state.reportPanel;
        base.nothingFound = sawNothingFound;
        base.doneIn = state.label.startsWith("Done in") ? state.label.replace("Done in ", "") : null;

        await page.evaluate("window.scrollTo(0, 0)");
        base.screenshot = await capture(page, shot(""));
        if (await page.evaluate(SCROLL_TO_REFERENCES)) {
            await pause(600);
            base.referenceScreenshot = await capture(page, shot(".references"));
        }
        if (await page.evaluate(OPEN_REPORT)) {
            await pause(800);
            base.panelScreenshot = await capture(page, shot(".panel"));
        }
        writeFileSync(path.join(SNAPSHOT_DIR, `${entry.id}.html`), await page.content());

        const verdict = judge(base, settled, isBlocked(state, base.httpStatus));
        const retried = attemptNumber > 1 && verdict.verdict === "pass" ? " Passed on the second attempt." : "";
        return {...base, ...verdict, reason: verdict.reason + retried, attempts: attemptNumber};
    } catch (err) {
        base.screenshot = await capture(page, shot(""));
        return {...base, verdict: "error", attempts: attemptNumber,
            reason: `The page could not be checked: ${(err as Error).message.split("\n")[0]}`};
    } finally {
        await page.close().catch(() => {});
    }
}

async function checkPublisher(browser: Browser, entry: Publisher): Promise<Result> {
    const first = await attempt(browser, entry, 1);
    if (!RETRY_VERDICTS.has(first.verdict)) return first;
    return attempt(browser, entry, 2);
}

const RETRY_VERDICTS = new Set<Verdict>(["timeout", "error", "fail", "no-doi"]);

const VERDICT_LABEL: Record<Verdict, string> = {
    pass: "Pass", fail: "Fail", blocked: "Blocked", timeout: "Timed out", "no-doi": "No DOI", error: "Error",
};

const VERDICT_COLOUR: Record<Verdict, string> = {
    pass: "#1f7a4d", fail: "#b42318", blocked: "#8a5a00", timeout: "#8a5a00", "no-doi": "#5f6368", error: "#b42318",
};

function escape(text: string): string {
    return text.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]!));
}

function image(file: string | null, alt: string): string {
    if (!file) return "";
    const data = readFileSync(path.join(OUTPUT_DIR, file)).toString("base64");
    return `<img alt="${escape(alt)}" src="data:image/jpeg;base64,${data}">`;
}

function writeReport(results: Result[], startedAt: Date, extensionVersion: string): string {
    const counts = results.reduce<Record<string, number>>((acc, r) => ({...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1}), {});
    const summary = (Object.keys(VERDICT_LABEL) as Verdict[])
        .filter((v) => counts[v])
        .map((v) => `<span class="chip" style="background:${VERDICT_COLOUR[v]}">${counts[v]} ${VERDICT_LABEL[v]}</span>`)
        .join(" ");
    const rows = results.map((r) => `<tr>
<td><a href="#${r.id}">${escape(r.domain)}</a><br><span class="sub">${escape(r.publisher)}</span></td>
<td class="num">${r.doisInFred ?? "—"}</td>
<td><span class="chip" style="background:${VERDICT_COLOUR[r.verdict]}">${VERDICT_LABEL[r.verdict]}</span></td>
<td>${r.titlePill ? "Yes" : "No"}</td>
<td class="num">${r.indicatorPills}</td>
<td class="num">${r.noticePills}</td>
<td>${r.reportPanel ? "Yes" : "No"}</td>
<td class="num">${escape(r.doneIn ?? "—")}</td>
<td class="num">${r.oreErrors.length}</td>
</tr>`).join("\n");
    const sections = results.map((r) => `<section id="${r.id}">
<h2>${escape(r.domain)} <span class="chip" style="background:${VERDICT_COLOUR[r.verdict]}">${VERDICT_LABEL[r.verdict]}</span></h2>
<p>${escape(r.reason)}</p>
<dl>
<dt>Publisher</dt><dd>${escape(r.publisher)}${r.doisInFred ? ` · ${r.doisInFred} DOI(s) in FReD` : ""}</dd>
<dt>URL</dt><dd><a href="${escape(r.url)}">${escape(r.url)}</a>${r.finalUrl !== r.url ? `<br>Redirected to ${escape(r.finalUrl)}` : ""}</dd>
<dt>Page</dt><dd>${escape(r.pageTitle || "—")} (HTTP ${r.httpStatus ?? "—"}, loaded in ${(r.loadMs / 1000).toFixed(1)} s)</dd>
<dt>Page DOI</dt><dd>${escape(r.pageDoi ?? "none declared")}</dd>
<dt>ORE</dt><dd>Title pill: ${r.titlePill ? "yes" : "no"} · ${r.indicatorPills} indicator pill(s) · ${r.noticePills} notice pill(s) · report: ${r.reportPanel ? "yes" : "no"}${r.nothingFound ? " · showed “Nothing found”" : ""} · finished in ${escape(r.doneIn ?? "—")}</dd>
${r.oreErrors.length ? `<dt>ORE warnings</dt><dd><pre>${escape(r.oreErrors.slice(0, 8).join("\n"))}</pre></dd>` : ""}
${r.verdict !== "pass" && r.oreLog.length ? `<dt>ORE log (last 15)</dt><dd><pre>${escape(r.oreLog.slice(-15).join("\n"))}</pre></dd>` : ""}
</dl>
<div class="shots">${image(r.screenshot, `${r.publisher} page`)}${image(r.referenceScreenshot, `${r.publisher} references`)}${image(r.panelScreenshot, `${r.publisher} report open`)}</div>
</section>`).join("\n");

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ORE publisher check</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328;margin:32px;max-width:1100px}
h1{font-size:24px;margin:0 0 4px;color:#612D53}h2{font-size:18px;margin:0 0 6px}
.meta{color:#5f6368;margin:0 0 16px}
.chip{display:inline-block;color:#fff;border-radius:10px;padding:1px 9px;font-size:12px;font-weight:600}
table{border-collapse:collapse;width:100%;margin:16px 0 8px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e4dce1}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5f6368}.num{text-align:right;font-variant-numeric:tabular-nums}
section{border-top:2px solid #e4dce1;padding:18px 0;break-inside:avoid-page}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:8px 0}dt{color:#5f6368}dd{margin:0;overflow-wrap:anywhere}
pre{white-space:pre-wrap;background:#f6f4f5;padding:8px;font-size:11px;margin:0}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:10px}.shots img{width:100%;border:1px solid #d0c7cc}
a{color:#853953}.sub{color:#5f6368;font-size:12px}
</style></head><body>
<h1>ORE publisher check</h1>
<p class="meta">ORE ${escape(extensionVersion)} · Chrome for Testing ${CHROME_BUILD} · ${escape(startedAt.toISOString().replace("T", " ").slice(0, 16))} UTC · ${results.length} publisher(s)</p>
<p>${summary}</p>
<table><thead><tr><th>Domain</th><th class="num">FReD DOIs</th><th>Result</th><th>Title pill</th><th class="num">Pills</th><th class="num">Notices</th><th>Report</th><th class="num">Finished in</th><th class="num">ORE warnings</th></tr></thead>
<tbody>${rows}</tbody></table>
${sections}
</body></html>`;
    const file = path.join(OUTPUT_DIR, "report.html");
    writeFileSync(file, html);
    return file;
}

async function writePdf(reportFile: string): Promise<string> {
    const printer = await puppeteer.launch({
        executablePath: await ensureChrome(),
        headless: true,
        args: process.env.CI ? ["--no-sandbox"] : [],
    });
    try {
        const page = await printer.newPage();
        await page.goto(`file://${reportFile}`, {waitUntil: "load"});
        const file = path.join(OUTPUT_DIR, "report.pdf");
        await page.pdf({path: file, format: "A4", printBackground: true, margin: {top: "12mm", bottom: "12mm", left: "10mm", right: "10mm"}});
        return file;
    } finally {
        await printer.close();
    }
}

async function main(): Promise<void> {
    if (!existsSync(path.join(REPO_ROOT, "dist", "background.js"))) {
        throw new Error("dist/ missing — run `npm run build` first");
    }
    if (refresh) await refreshPublishers(csvPath);
    const all: Publisher[] = JSON.parse(readFileSync(path.join(HERE, "publishers.json"), "utf8"));
    const chosen = only ? all.filter((p) => only.includes(p.id)) : all;
    const publishers = top ? chosen.slice(0, top) : chosen;
    if (publishers.length === 0) throw new Error(`No publishers match --only=${only?.join(",")}`);

    rmSync(OUTPUT_DIR, {recursive: true, force: true});
    mkdirSync(SNAPSHOT_DIR, {recursive: true});
    const version = JSON.parse(readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8")).version as string;
    const startedAt = new Date();

    const browser = await launch();
    const results: Result[] = [];
    try {
        await prepareExtension(browser);
        for (const entry of publishers) {
            process.stdout.write(`  ${(entry.domain ?? entry.publisher).slice(0, 34).padEnd(35)} `);
            if (results.length > 0) await pause(PAUSE_BETWEEN_PAGES_MS);
            const result = await checkPublisher(browser, entry);
            results.push(result);
            console.log(`${VERDICT_LABEL[result.verdict].padEnd(10)} ${result.reason}`);
        }
        writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));
        const reportFile = writeReport(results, startedAt, version);
        const pdfFile = await writePdf(reportFile);
        console.log(`\nReport: ${reportFile}\nPDF:    ${pdfFile}`);
    } finally {
        await browser.close();
    }
    if (results.some((r) => r.verdict === "fail" || r.verdict === "error")) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
