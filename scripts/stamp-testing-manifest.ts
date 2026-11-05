import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

interface StampableManifest {
  name: string;
  short_name: string;
  version: string;
  action: { default_title: string };
}

export function stampTestingManifest<T extends StampableManifest>(manifest: T): T {
  return {
    ...manifest,
    name: `${manifest.short_name} Testing`,
    short_name: "ORE Testing",
    version_name: `${manifest.version} testing`,
    action: { ...manifest.action, default_title: `${manifest.action.default_title} Testing` },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: stamp-testing-manifest <manifest.json>");
  const manifest = JSON.parse(readFileSync(file, "utf-8")) as StampableManifest;
  writeFileSync(file, `${JSON.stringify(stampTestingManifest(manifest), null, 2)}\n`);
}
