// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { jsPdfOfflineOnly, removeRemoteOutputs } from "../../scripts/jspdf-offline-only";

const REMOTE_CODE = /cdnjs\.cloudflare\.com|createElement\("script"\)|\.integrity\s*=/;

async function bundle(plugins: esbuild.Plugin[]): Promise<string> {
  const result = await esbuild.build({
    entryPoints: ["src/shared/report-pdf.ts"],
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    external: ["html2canvas", "canvg", "dompurify", "core-js", "core-js/*"],
    alias: { "@shared": "./src/shared" },
    logLevel: "silent",
    plugins,
  });
  return result.outputFiles[0].text;
}

describe("jsPdfOfflineOnly", () => {
  it("bundles jsPDF without the remotely hosted PDFObject loader", async () => {
    const output = await bundle([jsPdfOfflineOnly]);
    expect(output).not.toMatch(REMOTE_CODE);
    expect(output).toContain('case"pdfobjectnewwindow":case"pdfjsnewwindow":throw new Error("Unsupported output type")');
  }, 30_000);

  it("guards something real: without the plugin the loader is in the bundle", async () => {
    expect(await bundle([])).toMatch(REMOTE_CODE);
  }, 30_000);

  it("keeps the output types the report uses", () => {
    const path = createRequire(import.meta.url).resolve("jspdf/dist/jspdf.es.min.js");
    const patched = removeRemoteOutputs(readFileSync(path, "utf8"), path);
    for (const kept of ['case"arraybuffer"', 'case"dataurlnewwindow"', 'case"bloburl"']) {
      expect(patched).toContain(kept);
    }
  });

  it("fails the build when a jsPDF upgrade moves the code it patches", () => {
    expect(() => removeRemoteOutputs('switch(t){case"arraybuffer":return 1}', "jspdf.es.min.js"))
      .toThrow(/update the patch/);
  });
});
