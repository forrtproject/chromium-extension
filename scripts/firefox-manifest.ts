import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GECKO_ID = "ore@forrt.org";
export const GECKO_TESTING_ID = "ore-testing@forrt.org";
export const FIREFOX_MIN_VERSION = "140.0";
export const RELEASES_URL = "https://github.com/forrtproject/chromium-extension/releases";
export const UPDATE_URL = `${RELEASES_URL}/latest/download/updates.json`;

interface ChromeManifest {
  background: { service_worker: string };
  minimum_chrome_version?: string;
  version_name?: string;
  [key: string]: unknown;
}

export function toFirefoxManifest(manifest: ChromeManifest, channel: "stable" | "testing" = "stable"): Record<string, unknown> {
  const { background, minimum_chrome_version: _min, version_name: _name, ...rest } = manifest;
  return {
    ...rest,
    background: { scripts: [background.service_worker] },
    browser_specific_settings: {
      gecko: {
        id: channel === "testing" ? GECKO_TESTING_ID : GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        ...(channel === "stable" && { update_url: UPDATE_URL }),
        data_collection_permissions: {
          required: ["websiteContent", "browsingActivity", "personallyIdentifyingInfo"],
        },
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: firefox-manifest <manifest.json> [--testing]");
  const manifest = JSON.parse(readFileSync(file, "utf-8")) as ChromeManifest;
  const channel = process.argv.includes("--testing") ? "testing" : "stable";
  writeFileSync(file, `${JSON.stringify(toFirefoxManifest(manifest, channel), null, 2)}\n`);
}
