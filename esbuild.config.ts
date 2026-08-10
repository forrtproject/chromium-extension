import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
  target: "chrome116",
  logLevel: "info",
  loader: { ".css": "text" },
};

const configs: esbuild.BuildOptions[] = [
  {
    ...sharedOptions,
    entryPoints: ["src/content-general/index.ts"],
    outfile: "dist/content-general.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/content-scholar/index.ts"],
    outfile: "dist/content-scholar.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/content-pubpeer/index.ts"],
    outfile: "dist/content-pubpeer.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/content-forrt/index.ts"],
    outfile: "dist/content-forrt.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/content-github/index.ts"],
    outfile: "dist/content-github.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/background.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/options/options.ts"],
    outfile: "dist/options.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/popup/popup.ts"],
    outfile: "dist/popup.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/walkthrough/walkthrough.ts"],
    outfile: "dist/walkthrough.js",
  },
  // Ships with the docs site, not the extension: it renders a shared Meta
  // Report from the link's fragment for readers who don't have ORE installed.
  {
    ...sharedOptions,
    entryPoints: ["src/report-page/index.ts"],
    outfile: "docs/report.js",
  },
];

function copyStaticAssets() {
  mkdirSync("dist", { recursive: true });
  copyFileSync("src/options/index.html", "dist/options.html");
  copyFileSync("src/options/styles.css", "dist/styles.css");
  copyFileSync("src/popup/popup.html", "dist/popup.html");
  copyFileSync("src/popup/popup.css", "dist/popup.css");
  copyFileSync("src/walkthrough/index.html", "dist/walkthrough.html");
  copyFileSync("src/walkthrough/walkthrough.css", "dist/walkthrough.css");
  copyFileSync("assets/forrt-logo.svg", "dist/forrt-logo.svg");
  copyFileSync("assets/fonts/fonts.css", "dist/fonts.css");
  mkdirSync("dist/fonts", { recursive: true });
  for (const font of readdirSync("assets/fonts").filter((f) => f.endsWith(".woff2"))) {
    copyFileSync(`assets/fonts/${font}`, `dist/fonts/${font}`);
  }
  // The service worker fetches this at runtime as the retraction fallback, so
  // it ships as a static asset instead of being bundled into any script.
  copyFileSync("src/retractions.json", "dist/retractions.json");
}

async function build() {
  copyStaticAssets();
  if (isWatch) {
    const contexts = await Promise.all(
      configs.map((config) => esbuild.context(config))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(configs.map((config) => esbuild.build(config)));
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
