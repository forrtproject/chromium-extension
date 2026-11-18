import type * as esbuild from "esbuild";
import { readFileSync } from "fs";

// Chrome Web Store rejects MV3 items containing remotely hosted code; jsPDF's
// "pdfobjectnewwindow" output injects a cdnjs <script>, so that branch is cut.
const REMOTE_OUTPUT_BRANCHES = /case"pdfobjectnewwindow":[\s\S]*?(?=case"dataurlnewwindow":)/;

export function removeRemoteOutputs(source: string, path: string): string {
  if (!REMOTE_OUTPUT_BRANCHES.test(source)) {
    throw new Error(`jsPDF's pdfobjectnewwindow branch not found in ${path}; update the patch`);
  }
  return source.replace(
    REMOTE_OUTPUT_BRANCHES,
    'case"pdfobjectnewwindow":case"pdfjsnewwindow":throw new Error("Unsupported output type");',
  );
}

export const jsPdfOfflineOnly: esbuild.Plugin = {
  name: "jspdf-offline-only",
  setup(build) {
    build.onLoad({ filter: /[\\/]jspdf[\\/]dist[\\/]jspdf\.es\.min\.js$/ }, (args) => ({
      contents: removeRemoteOutputs(readFileSync(args.path, "utf8"), args.path),
      loader: "js",
    }));
  },
};
