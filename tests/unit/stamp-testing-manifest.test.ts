import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {stampTestingManifest} from "../../scripts/stamp-testing-manifest";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8"));

describe("stampTestingManifest", () => {
  const stamped = stampTestingManifest(manifest);

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
    expect(stamped).toEqual({
      ...manifest,
      name: `${manifest.short_name} Testing`,
      short_name: "ORE Testing",
      version_name: `${manifest.version} testing`,
      action: {...manifest.action, default_title: `${manifest.action.default_title} Testing`},
    });
  });

  it("leaves the source manifest unmarked so testing can merge into main", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/testing/i);
  });
});
