import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ENTRY_ANCHOR = "async upsertSecrets(";
const INSTALL_MARKER = "__sandReadAloudInstalled";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Injected into the original shipped renderer entry chunk. Adds a "Read
// aloud" toggle to every agent message hover toolbar; speech is synthesized
// in the main process via desktop.speech.synthesize (free OpenRouter TTS,
// deepgram/flux-tts:free by default) and played back as a data-URL.
const READ_ALOUD_RUNTIME = `
;(function(){
if (window.${INSTALL_MARKER}) return;
window.${INSTALL_MARKER} = true;
var doc = document;
var audio = null;
var currentKey = null;
var busyKey = null;
var buttons = new Map();

function bridge() {
  return window.desktop && window.desktop.speech && typeof window.desktop.speech.synthesize === "function" ? window.desktop.speech : null;
}
function syncButtons() {
  buttons.forEach(function (state, node) {
    if (!node.isConnected) { buttons.delete(node); return; }
    var active = currentKey === state.key;
    var loading = busyKey === state.key;
    var glyph = loading ? "\\u23F3" : active ? "\\u23F9" : "\\uD83D\\uDD0A";
    var label = loading ? "Loading voice" : active ? "Stop reading" : "Read aloud";
    var title = loading ? "Synthesizing voice\\u2026" : active ? "Stop reading" : "Read aloud with free OpenRouter voice";
    if (node.textContent !== glyph) node.textContent = glyph;
    if (node.getAttribute("aria-label") !== label) node.setAttribute("aria-label", label);
    if (node.getAttribute("title") !== title) node.setAttribute("title", title);
  });
}
function stop() {
  if (audio != null) { try { audio.pause(); } catch (e) {} audio = null; }
  currentKey = null;
  syncButtons();
}
function toggle(key, text) {
  if (currentKey === key) { stop(); return; }
  stop();
  var speech = bridge();
  if (speech == null) { console.warn("[read-aloud] desktop.speech bridge unavailable"); return; }
  busyKey = key; syncButtons();
  speech.synthesize({ text: text }).then(function (result) {
    busyKey = null;
    if (currentKey != null && currentKey !== key) return;
    var element = new Audio("data:audio/" + (result && result.format || "mp3") + ";base64," + result.audioBase64);
    audio = element; currentKey = key;
    element.addEventListener("ended", stop);
    element.addEventListener("error", stop);
    var played = element.play();
    if (played && typeof played.catch === "function") played.catch(function () { stop(); });
    syncButtons();
  }).catch(function (error) {
    busyKey = null;
    console.warn("[read-aloud] speech failed:", error && error.message || error);
    syncButtons();
  });
}
function messageText(bubble) {
  var clone = bubble.cloneNode(true);
  var strips = clone.querySelectorAll(".sand-message-hover-actions, .sand-message-typing, .sand-message-attachments, script, style");
  for (var i = 0; i < strips.length; i++) strips[i].remove();
  var text = (clone.innerText || clone.textContent || "").replace(/[\\t ]+/g, " ").replace(/\\s*\\n\\s*/g, " ").trim();
  return text.length > 4096 ? text.slice(0, 4093) + "\\u2026" : text;
}
function insertButton(state, toolbar) {
  var more = toolbar.querySelector('button[aria-haspopup="menu"]');
  if (more != null && more.parentNode === toolbar) toolbar.insertBefore(state.node, more);
  else toolbar.appendChild(state.node);
}
function enhance(toolbar) {
  var tracked = buttons.get(toolbar);
  if (tracked != null) {
    if (!tracked.node.isConnected) insertButton(tracked, toolbar);
    return;
  }
  var bubble = toolbar.closest(".sand-message");
  if (bubble == null || bubble.getAttribute("data-role") !== "assistant") return;
  var text = messageText(bubble);
  if (text.length === 0) return;
  var row = bubble.closest("[data-entry-id]");
  var key = (row && row.getAttribute("data-entry-id")) || String(buttons.size) + "-" + text.slice(0, 40);
  var node = doc.createElement("button");
  node.type = "button";
  node.className = "sand-message-hover-actions__button sand-read-aloud-button";
  node.addEventListener("click", function (event) {
    event.stopPropagation();
    toggle(key, text);
  });
  var state = { key: key, node: node };
  insertButton(state, toolbar);
  buttons.set(toolbar, state);
  syncButtons();
}
function scan() {
  var toolbars = doc.querySelectorAll(".sand-message-hover-actions");
  for (var i = 0; i < toolbars.length; i++) enhance(toolbars[i]);
  syncButtons();
}
var scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(function () { scanScheduled = false; scan(); }, 150);
}
if (typeof MutationObserver === "function") {
  new MutationObserver(function () { scheduleScan(); }).observe(doc.body, { childList: true, subtree: true });
}
scan();
})();
`;

export async function applyOriginalRendererReadAloudPatch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const names = (await readdir(assetsRoot)).filter(name => name.endsWith(".js"));
  const sources = new Map();
  for (const name of names) sources.set(name, await readFile(path.join(assetsRoot, name), "utf8"));
  const entryCandidates = [...sources.entries()].filter(([, source]) => source.split(ENTRY_ANCHOR).length - 1 === 1);
  const entryMulti = [...sources.entries()].filter(([, source]) => source.split(ENTRY_ANCHOR).length - 1 > 1);
  if (entryCandidates.length !== 1 || entryMulti.length > 0) {
    throw new Error(`Expected exactly one renderer entry chunk carrying the RPC client anchor, found ${entryCandidates.length}.`);
  }
  const [entryName, entrySource] = entryCandidates[0];
  if (entrySource.includes(INSTALL_MARKER)) {
    throw new Error(`The read-aloud runtime is already installed in ${entryName}.`);
  }
  const patchedEntry = `${entrySource}\n${READ_ALOUD_RUNTIME}`;
  await writeFile(path.join(assetsRoot, entryName), patchedEntry);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-read-aloud",
    chunks: [{
      role: "entry-runtime",
      path: `dist/renderer/assets/${entryName}`,
      original: { bytes: Buffer.byteLength(entrySource), sha256: sha256(entrySource) },
      patched: { bytes: Buffer.byteLength(patchedEntry), sha256: sha256(patchedEntry) },
    }],
    rebrand: [],
    indexHtmlReplacements: 0,
    features: ["read-aloud-toolbar", "free-openrouter-tts-playback"],
    transformations: ["entry-chunk-runtime-append"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-read-aloud-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
