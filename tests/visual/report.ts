// Package captured images into a portable review page (no hosting required).
import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

type Result = {name: string; status: string; detail?: string; changed?: boolean};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]!));
const STYLE = `<style>body{font:16px system-ui;margin:2rem;color:#222}section{border-top:1px solid #aaa;padding:1rem 0}.shots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.shots.single{grid-template-columns:minmax(0,1fr);max-width:900px}.overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}.overview figure{margin:0}.overview figcaption{font-weight:600;margin:.35rem 0}.overview a{color:inherit}img{width:100%;border:1px solid #aaa}h3{font-size:1.2rem}pre{background:#f2f2f2;padding:.75rem;white-space:pre-wrap}</style>`;
const write = (dir: string, html: string) => writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Visual PR review</title>
${STYLE}
${html}`);

export function writeReport(dir: string): void {
  mkdirSync(dir, {recursive: true});
  let results: Result[];
  try {
    results = JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8"));
  } catch (err) {
    // No capture results means there are no screenshots to compare, so say that
    // instead of rendering empty before/after columns.
    write(dir, `<h1>Visual PR review</h1><p>The capture results are unavailable, so no screenshots can be shown. See the capture job log for the original error.</p>
<pre>${escape(err instanceof Error ? err.message : String(err))}</pre>`);
    return;
  }
  const picture = (name: string, kind: string) => {
    const file = path.join(dir, `${name}.${kind}.png`);
    if (!existsSync(file)) return `<p>${escape(kind)} unavailable</p>`;
    return `<img alt="${escape(name)} ${kind}" src="data:image/png;base64,${readFileSync(file).toString("base64")}">`;
  };
  // Missing comparison baselines remain capture failures, but the captured image
  // can still be inspected as a new visual rather than beside empty columns.
  const isNew = (r: Result) => !existsSync(path.join(dir, `${r.name}.before.png`)) &&
    existsSync(path.join(dir, `${r.name}.actual.png`));
  const changed = results.filter(r => (r.changed || r.status === "fail") && !isNew(r));
  const added = results.filter(isNew);
  const unchanged = results.filter(r => r.status === "pass" && !r.changed && !isNew(r));
  const row = (r: Result, kinds: string[]) => `<section><h3>${escape(r.name)} — ${escape(r.detail ?? r.status)}</h3><div class="shots ${kinds.length === 1 ? "single" : ""}">${kinds.map((kind) => `<div><h4>${kind === "actual" ? "PR" : kind}</h4>${picture(r.name, kind)}</div>`).join("")}</div></section>`;
  const unchangedCards = unchanged.map(r => {
    const name = encodeURIComponent(r.name);
    return `<figure><a href="${name}.actual.png">${picture(r.name, "actual")}</a><figcaption>${escape(r.name)}</figcaption><a href="${name}.before.png">base PNG</a> · <a href="${name}.actual.png">PR PNG</a></figure>`;
  }).join("");
  write(dir, `<h1>Visual PR review</h1><p>Inspect placement, clipping, readability, and missing badges. Open the PNG files for full resolution.</p>
<p>Captured ${results.length} fixture${results.length === 1 ? "" : "s"}: ${changed.length} changed, ${added.length} new, ${unchanged.length} unchanged.</p>
<p>Coverage is limited to the saved fixtures listed below. Live sites and interactions outside those fixtures are not tested.</p>
${changed.length ? `<h2>Changed visuals</h2>${changed.map(r => row(r, ["before", "actual", "diff"])).join("")}` : ""}
${added.length ? `<h2>New visuals</h2>${added.map(r => row(r, ["actual"])).join("")}` : ""}
${!changed.length && !added.length && unchanged.length === results.length ? "<p>All captured fixtures match the base pixel for pixel.</p>" : ""}
${unchanged.length ? `<h2>Captured visuals (unchanged)</h2><div class="overview">${unchangedCards}</div>` : ""}`);
}

// Run directly: `npx tsx tests/visual/report.ts [output-dir]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeReport(path.resolve(process.argv[2] ?? "tests/visual/output"));
}
