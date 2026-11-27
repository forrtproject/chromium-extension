import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toFirefoxManifest } from "./firefox-manifest";

const outDir = process.argv[2] ?? "build/firefox";
rmSync(outDir, { recursive: true, force: true });
cpSync("dist", join(outDir, "dist"), { recursive: true });
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(toFirefoxManifest(manifest), null, 2)}\n`);
console.log(`Firefox build in ${outDir}: load ${join(outDir, "manifest.json")} from about:debugging`);
