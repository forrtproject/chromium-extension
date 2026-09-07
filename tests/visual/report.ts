// Package captured images into a portable review page (no hosting required).
import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import path from "node:path";

type Result = {name: string; status: string; detail?: string; changed?: boolean};

const dir = path.resolve(process.argv[2] ?? "tests/visual/output");
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]!));
const STYLE = `<style>body{font:16px system-ui;margin:2rem;color:#222}section{border-top:1px solid #aaa;padding:1rem 0}.shots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.shots.single{grid-template-columns:minmax(0,1fr);max-width:900px}img{width:100%;border:1px solid #aaa}h3{font-size:1.2rem}pre{background:#f2f2f2;padding:.75rem;white-space:pre-wrap}</style>`;
const write = (html: string) => writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Visual PR review</title>
${STYLE}
${html}`);

function main(): void {
  mkdirSync(dir, {recursive: true});
  let results: Result[];
  try {
    results = JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8"));
  } catch (err) {
    // No capture results means there are no screenshots to compare, so say that
    // instead of rendering empty before/after columns.
    write(`<h1>Visual PR review</h1><p>The capture results are unavailable, so no screenshots can be shown. See the capture job log for the original error.</p>
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
  const row = (r: Result, kinds: string[]) => `<section><h3>${escape(r.name)} — ${escape(r.detail ?? r.status)}</h3><div class="shots ${kinds.length === 1 ? "single" : ""}">${kinds.map((kind) => `<div><h4>${kind === "actual" ? "PR" : kind}</h4>${picture(r.name, kind)}</div>`).join("")}</div></section>`;
  write(`<h1>Visual PR review</h1><p>Inspect placement, clipping, readability, and missing badges. Open the PNG files for full resolution.</p>
${changed.length ? `<h2>Changed visuals</h2>${changed.map(r => row(r, ["before", "actual", "diff"])).join("")}` : ""}
${added.length ? `<h2>New visuals</h2>${added.map(r => row(r, ["actual"])).join("")}` : ""}
${!changed.length && !added.length ? "<p>No visual changes to review.</p>" : ""}`);
}

main();
