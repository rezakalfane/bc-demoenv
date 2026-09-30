// Generates the desktop app icon (electron/icon.png + electron/icon.icns):
// stacked catalog layers on a dark macOS squircle. Rendered by Electron itself
// (offscreen window → capturePage), sized with sips, packaged with iconutil.
//   npx electron scripts/generate-icon.mjs      (npm run icon)
import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SIZE = 1024;
// Apple's grid: an 824px rounded square centred on the 1024 canvas.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0b1120"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="#334155" stroke-width="3"/>
  <g stroke-linejoin="round" stroke-linecap="round" stroke-width="30" fill="none">
    <path d="M292 530 L512 640 L732 530" stroke="#475569"/>
    <path d="M292 602 L512 712 L732 602" stroke="#334155"/>
    <path d="M512 568 L292 458 L512 348 L732 458 Z" fill="url(#top)" stroke="#93c5fd"/>
  </g>
</svg>`;

// No top-level await: an ESM main delays "ready" until the module settles.
app.dock?.hide();
void app.whenReady().then(render);

async function render() {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
  });
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
    )}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.capturePage();
  mkdirSync("electron", { recursive: true });
  writeFileSync("electron/icon.png", image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log("wrote electron/icon.png");

  const iconset = "electron/icon.iconset";
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  for (const px of [16, 32, 128, 256, 512]) {
    for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
      execFileSync("sips", ["-z", String(px * scale), String(px * scale), "electron/icon.png", "--out", `${iconset}/icon_${px}x${px}${suffix}.png`], { stdio: "ignore" });
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", "electron/icon.icns"]);
  rmSync(iconset, { recursive: true, force: true });
  console.log("wrote electron/icon.icns");
  app.quit();
}
