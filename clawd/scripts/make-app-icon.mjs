// Rebuild platform icons from the user-supplied brand master (macOS).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const master = join(root, "public/brand/clawd-icon.png");
const out = join(root, "build");
const resize = (size, dest) => { mkdirSync(dirname(dest), { recursive: true }); execFileSync("sips", ["-z", String(size), String(size), master, "--out", dest], { stdio: "ignore" }); };
resize(1024, join(out, "icon-1024.png"));
for (const dest of ["public/app-icon.png", "electron/resources/app-icon.png", "ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"]) copyFileSync(join(out, "icon-1024.png"), join(root, dest));
// iconutil accepts only standard macOS sizes; clear stale generated entries.
rmSync(join(out, "icon.iconset"), { recursive: true, force: true });
for (const size of [16,32,128,256,512]) {
  resize(size, join(out, "icon.iconset", `icon_${size}x${size}.png`));
  resize(size*2, join(out, "icon.iconset", `icon_${size}x${size}@2x.png`));
}
execFileSync("iconutil", ["-c", "icns", join(out, "icon.iconset"), "-o", join(out, "icon.icns")]);
const png = readFileSync(join(out, "icon.iconset/icon_256x256.png"));
const header = Buffer.alloc(22);
header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
writeFileSync(join(out, "icon.ico"), Buffer.concat([header,png]));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${readFileSync(join(out,"icon-1024.png")).toString("base64")}"/></svg>\n`;
writeFileSync(join(out,"icon.svg"),svg);
writeFileSync(join(root,"public/app-icon.svg"),svg);
console.log("Updated web, Electron, macOS, Windows, Linux and iOS icons.");
