import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { FIREFOX_MIN_VERSION, GECKO_ID, RELEASES_URL } from "./firefox-manifest";

export function firefoxUpdateManifest(version: string, xpi: Buffer, xpiName: string) {
  return {
    addons: {
      [GECKO_ID]: {
        updates: [{
          version,
          update_link: `${RELEASES_URL}/download/v${version}/${xpiName}`,
          update_hash: `sha256:${createHash("sha256").update(xpi).digest("hex")}`,
          applications: { gecko: { strict_min_version: FIREFOX_MIN_VERSION } },
        }],
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [xpiPath, out = "updates.json"] = process.argv.slice(2);
  if (!xpiPath) throw new Error("Usage: firefox-update-manifest <signed.xpi> [updates.json]");
  const version = JSON.parse(readFileSync("manifest.json", "utf-8")).version as string;
  const manifest = firefoxUpdateManifest(version, readFileSync(xpiPath), basename(xpiPath));
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
}
