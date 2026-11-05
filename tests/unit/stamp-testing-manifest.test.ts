import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {stampTestingManifest} from "../../scripts/stamp-testing-manifest";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8"));

describe("stampTestingManifest", () => {
  const stamped = stampTestingManifest(manifest) as typeof manifest;

  it("labels every name Chrome and the Web Store show", () => {
    expect(stamped.name).toContain("Testing");
    expect(stamped.short_name).toContain("Testing");
    expect(stamped.version_name).toBe(`${manifest.version} testing`);
    expect(stamped.action.default_title).toContain("Testing");
  });

  it("stays within Chrome's name limits", () => {
    expect(stamped.name.length).toBeLessThanOrEqual(75);
    expect(stamped.short_name.length).toBeLessThanOrEqual(12);
  });

  it("changes nothing else", () => {
    expect(stamped.version).toBe(manifest.version);
    expect(stamped.content_scripts).toEqual(manifest.content_scripts);
    expect(stamped.host_permissions).toEqual(manifest.host_permissions);
    expect(stamped.action.default_popup).toBe(manifest.action.default_popup);
  });

  it("leaves the source manifest unmarked so testing can merge into main", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/testing/i);
  });
});
