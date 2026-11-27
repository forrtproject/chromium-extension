import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {FIREFOX_MIN_VERSION, GECKO_ID, GECKO_TESTING_ID, UPDATE_URL, toFirefoxManifest} from "../../scripts/firefox-manifest";
import {firefoxUpdateManifest} from "../../scripts/firefox-update-manifest";
import {stampTestingManifest} from "../../scripts/stamp-testing-manifest";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8"));

describe("toFirefoxManifest", () => {
  const firefox = toFirefoxManifest(manifest);

  it("runs the background script as an event page", () => {
    expect(firefox.background).toEqual({scripts: [manifest.background.service_worker]});
  });

  it("declares the add-on ID, minimum version and data collection AMO requires", () => {
    const gecko = (firefox.browser_specific_settings as {gecko: Record<string, unknown>}).gecko;
    expect(gecko.id).toBe(GECKO_ID);
    expect(gecko.strict_min_version).toBe(FIREFOX_MIN_VERSION);
    expect(gecko.update_url).toBe(UPDATE_URL);
    expect((gecko.data_collection_permissions as {required: string[]}).required.length).toBeGreaterThan(0);
  });

  it("drops Chrome-only keys and keeps everything else", () => {
    const {background: _b, minimum_chrome_version: _m, ...shared} = manifest;
    const {background: _fb, browser_specific_settings: _s, ...rest} = firefox;
    expect(rest).toEqual(shared);
    expect(toFirefoxManifest(stampTestingManifest(manifest))).not.toHaveProperty("version_name");
  });

  it("gives testing builds their own ID and no stable update feed", () => {
    const gecko = (toFirefoxManifest(manifest, "testing").browser_specific_settings as {gecko: Record<string, unknown>}).gecko;
    expect(gecko.id).toBe(GECKO_TESTING_ID);
    expect(gecko).not.toHaveProperty("update_url");
  });
});

describe("firefoxUpdateManifest", () => {
  it("points the add-on at this version's signed release asset", () => {
    const [update] = firefoxUpdateManifest("1.2.3", Buffer.from("xpi"), "flora-extension-firefox.xpi").addons[GECKO_ID].updates;
    expect(update.version).toBe("1.2.3");
    expect(update.update_link).toBe("https://github.com/forrtproject/chromium-extension/releases/download/v1.2.3/flora-extension-firefox.xpi");
    expect(update.update_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
