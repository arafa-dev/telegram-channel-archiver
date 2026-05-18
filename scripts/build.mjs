import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(rootDir, "dist");
const watch = process.argv.includes("--watch");

const entryPoints = {
  "bridge/bridge": join(rootDir, "src/bridge/bridge.ts"),
  "content/content": join(rootDir, "src/content/content.ts"),
  "background/service-worker": join(rootDir, "src/background/service-worker.ts"),
  "offscreen/offscreen": join(rootDir, "src/offscreen/offscreen.ts"),
  "popup/popup": join(rootDir, "src/popup/popup.ts")
};

const copyTargets = [
  ["public/manifest.json", "manifest.json"],
  ["public/icons", "icons"],
  ["src/offscreen/offscreen.html", "offscreen/offscreen.html"],
  ["src/popup/popup.html", "popup/popup.html"],
  ["src/popup/popup.css", "popup/popup.css"],
  ["src/content/ui/panel.css", "content/ui/panel.css"]
];

async function copyStaticAssets() {
  await mkdir(distDir, { recursive: true });

  await Promise.all(
    copyTargets.map(async ([from, to]) => {
      await cp(join(rootDir, from), join(distDir, to), { recursive: true });
    })
  );
}

const buildOptions = {
  entryPoints,
  outdir: distDir,
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  sourcemap: "inline",
  logLevel: "info"
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  await copyStaticAssets();
  console.log("Watching extension sources...");
} else {
  await rm(distDir, { recursive: true, force: true });
  await esbuild.build(buildOptions);
  await copyStaticAssets();
}
