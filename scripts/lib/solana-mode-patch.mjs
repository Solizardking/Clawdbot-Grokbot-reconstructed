import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ENTRY_ANCHOR = "async upsertSecrets(";
const INSTALL_MARKER = "__sandSolanaModeInstalled";
const REBRAND_BEFORE = "Grok Bot";
const REBRAND_AFTER = "Clawd Bot";
const HEADING_CHECK = 'title:"Meet Clawd Bot"';

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const SOLANA_MODE_RUNTIME = `
;(function(){
if (window.${INSTALL_MARKER}) return;
window.${INSTALL_MARKER} = true;
var LS_KEY = "sand-solana-mode";
var doc = document;
var root = doc.documentElement;
var PURPLE = "#9945FF";
var GREEN = "#14F195";

function el(tag, props, children) {
  var node = doc.createElement(tag);
  if (props) for (var k in props) {
    if (k === "style" && props[k] && typeof props[k] === "object") { for (var s in props[k]) node.style.setProperty(s, props[k][s]); }
    else if (k === "text") node.textContent = props[k];
    else if (k.slice(0, 2) === "on" && typeof props[k] === "function") node.addEventListener(k.slice(2), props[k]);
    else if (props[k] != null) node.setAttribute(k, props[k]);
  }
  (children || []).forEach(function (child) { if (child != null) node.appendChild(child); });
  return node;
}
function short(value) { return typeof value === "string" && value.length > 14 ? value.slice(0, 4) + "\\u2026" + value.slice(-4) : String(value == null ? "" : value); }
function sol(lamports) { return (Number(lamports || 0) / 1e9).toFixed(4) + " SOL"; }

var css = [
'html[data-solana="on"],html[data-solana="on"] .ui-1lzgia1{',
'--cursor-accent:' + PURPLE + ';',
'--cursor-green:' + GREEN + ';',
'--cursor-success:' + GREEN + ';',
'--cursor-added:' + GREEN + ';',
'--cursor-purple:' + PURPLE + ';',
'--cursor-focus:' + GREEN + ';',
'--cursor-bg-accent:' + PURPLE + ';',
'}',
'html[data-solana="on"] ::selection{background:rgba(153,69,255,.45);}',
'html[data-solana="on"] ::-webkit-scrollbar-thumb{background:linear-gradient(180deg,' + PURPLE + ',' + GREEN + ');border-radius:99px;}',
'#sand-solana-button{position:fixed;top:10px;right:12px;z-index:2147483000;width:32px;height:32px;border-radius:50%;',
'display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;user-select:none;',
'background:rgba(20,20,24,.82);border:1.5px solid rgba(255,255,255,.16);box-shadow:0 2px 10px rgba(0,0,0,.45);',
'backdrop-filter:blur(8px);transition:border-color .15s ease,transform .12s ease;padding:0;line-height:1;}',
'#sand-solana-button:hover{transform:scale(1.08);}',
'#sand-solana-button[data-active="on"]{border-color:transparent;background:linear-gradient(135deg,rgba(20,20,24,.92),rgba(20,20,24,.82)) padding-box,linear-gradient(135deg,' + PURPLE + ',' + GREEN + ') border-box;}',
'#sand-solana-panel{position:fixed;top:50px;right:12px;z-index:2147483001;width:340px;max-height:min(640px,calc(100vh - 70px));overflow:auto;',
'border-radius:14px;background:rgba(18,18,22,.96);color:#eee;border:1px solid rgba(255,255,255,.12);',
'box-shadow:0 12px 40px rgba(0,0,0,.55);backdrop-filter:blur(14px);font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;display:none;}',
'#sand-solana-panel[data-open="1"]{display:block;}',
'#sand-solana-panel h4{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9a9aa2;}',
'#sand-solana-panel .sp-sec{padding:12px 14px;border-top:1px solid rgba(255,255,255,.08);}',
'#sand-solana-panel .sp-head{display:flex;align-items:center;justify-content:space-between;border-top:none;padding-top:14px;}',
'#sand-solana-panel .sp-title{font-size:13px;font-weight:600;background:linear-gradient(90deg,' + PURPLE + ',' + GREEN + ');-webkit-background-clip:text;background-clip:text;color:transparent;}',
'#sand-solana-panel input{width:100%;box-sizing:border-box;margin:3px 0;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.14);',
'background:rgba(255,255,255,.06);color:#eee;font-size:12px;outline:none;}',
'#sand-solana-panel input:focus{border-color:' + PURPLE + ';}',
'#sand-solana-panel button.sp-btn{margin:4px 0;padding:6px 12px;border-radius:8px;border:0;cursor:pointer;color:#fff;font-size:12px;font-weight:600;',
'background:linear-gradient(90deg,' + PURPLE + ',' + GREEN + ');}',
'#sand-solana-panel button.sp-btn[disabled]{opacity:.5;cursor:default;}',
'#sand-solana-panel button.sp-mini{margin:0;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);cursor:pointer;background:transparent;color:#ddd;font-size:11px;}',
'#sand-solana-panel .sp-row{display:flex;align-items:center;gap:6px;justify-content:space-between;padding:5px 0;}',
'#sand-solana-panel .sp-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:#555;}',
'#sand-solana-panel .sp-dot[data-ok="1"]{background:' + GREEN + ';}',
'#sand-solana-panel .sp-status{min-height:15px;font-size:11px;color:#f26d7d;margin-top:4px;word-break:break-word;}',
'#sand-solana-panel .sp-status[data-ok="1"]{color:' + GREEN + ';}',
'#sand-solana-panel .sp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px;}',
'#sand-solana-panel .sp-card{border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);padding:6px;cursor:pointer;text-align:center;}',
'#sand-solana-panel .sp-card:hover{border-color:' + PURPLE + ';}',
'#sand-solana-panel .sp-card img{width:100%;height:64px;object-fit:cover;border-radius:7px;background:rgba(255,255,255,.06);}',
'#sand-solana-panel .sp-card .sp-name{margin-top:4px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#ddd;}',
'#sand-solana-panel .sp-switch{position:relative;width:34px;height:20px;border-radius:99px;border:0;cursor:pointer;background:rgba(255,255,255,.16);padding:0;transition:background .15s ease;}',
'#sand-solana-panel .sp-switch[data-on="1"]{background:linear-gradient(90deg,' + PURPLE + ',' + GREEN + ');}',
'#sand-solana-panel .sp-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s ease;}',
'#sand-solana-panel .sp-switch[data-on="1"] span{left:16px;}',
'#sand-solana-panel .sp-detail img{width:100%;max-height:170px;object-fit:contain;border-radius:9px;background:rgba(255,255,255,.05);margin-bottom:6px;}',
'#sand-solana-panel .sp-attr{display:flex;justify-content:space-between;gap:8px;padding:3px 6px;border-radius:6px;background:rgba(255,255,255,.05);margin:2px 0;font-size:11px;}',
'#sand-solana-panel .sp-addr{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#bbb;}'
].join("");

function applySkin(on) {
  if (on) root.setAttribute("data-solana", "on");
  else root.removeAttribute("data-solana");
  button.setAttribute("data-active", on ? "on" : "off");
  if (switchEl) switchEl.setAttribute("data-on", on ? "1" : "0");
  try { localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch (e) {}
}

var style = doc.createElement("style");
style.id = "sand-solana-mode";
style.textContent = css;
doc.head.appendChild(style);

var statusLine, statusOk, phantomDots, walletList, walletNameInput, createBtn,
    assetGrid, balanceRow, detailBox, ownerSelect, ownerCustom, loadBtn,
    switchEl, button, panel;

function report(message, ok) {
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.setAttribute("data-ok", ok ? "1" : "0");
}
function desktopApi() { return window.desktop && window.desktop.solana ? window.desktop.solana : null; }
function secretsApi() { return window.desktop && window.desktop.secrets ? window.desktop.secrets : null; }
function owsApi() { return window.desktop && window.desktop.ows ? window.desktop.ows : null; }

function labeled(parent, labelText, input) {
  parent.appendChild(el("div", { text: labelText, style: { "font-size": "11px", color: "#9a9aa2", "margin-top": "5px" } }));
  parent.appendChild(input);
  return input;
}

function refreshStatus() {
  var api = desktopApi();
  if (!api) return;
  api.getStatus().then(function (status) {
    if (phantomDots) phantomDots.replaceChildren(
      el("span", { text: "Phantom " + (status.phantomConfigured ? "ready" : "not configured") }),
      el("span", { text: " \\u00b7 " }),
      el("span", { text: "Helius " + (status.heliusConfigured ? "ready" : "not configured") }),
      el("span", { text: " \\u00b7 " }),
      el("span", { text: status.walletCount + " wallet" + (status.walletCount === 1 ? "" : "s") })
    );
    refreshWallets();
    refreshLocalWallets();
    refreshOws();
  }).catch(function (error) { report(String(error && error.message || error)); });
}

function refreshWallets() {
  var api = desktopApi();
  if (!api || !walletList) return;
  api.listWallets().then(function (result) {
    walletList.replaceChildren.apply(walletList, (result.wallets || []).map(function (wallet) {
      return el("div", { "class": "sp-row" }, [
        el("span", {}, [
          el("span", { text: wallet.name, style: { "font-weight": "600" } }),
          wallet.solanaAddress ? el("span", { text: "  " + short(wallet.solanaAddress), "class": "sp-addr" }) : null,
        ]),
        el("span", { style: { display: "flex", gap: "4px" } }, [
          wallet.solanaAddress ? el("button", { "class": "sp-mini", text: "Copy", title: wallet.solanaAddress, onclick: function () {
            navigator.clipboard.writeText(wallet.solanaAddress).then(function () { report("Address copied", true); }, function () {});
          } }) : null,
          el("button", { "class": "sp-mini", text: "Assets", onclick: function () {
            if (wallet.solanaAddress) { ownerCustom.value = wallet.solanaAddress; loadAssets(wallet.solanaAddress); }
          } }),
        ]),
      ]);
    }));
    if ((result.wallets || []).length === 0) walletList.appendChild(el("div", { text: "No wallets yet.", style: { color: "#77777e", padding: "4px 0" } }));
    if (ownerSelect) {
      var previous = ownerSelect.value;
      var localOptions = [].slice.call(ownerSelect.options).filter(function (option) { return option.dataset.kind === "local"; });
      ownerSelect.replaceChildren.apply(ownerSelect, [el("option", { value: "", text: "Created wallets\\u2026" })].concat((result.wallets || []).filter(function (w) { return w.solanaAddress; }).map(function (w) {
        var option = el("option", { value: w.solanaAddress, text: w.name + " (" + short(w.solanaAddress) + ")" });
        option.dataset.kind = "phantom";
        return option;
      })).concat(localOptions));
      if (previous) ownerSelect.value = previous;
    }
  }).catch(function (error) { report(String(error && error.message || error)); });
}

function assetImage(asset) {
  var content = (asset && asset.content) || {};
  var links = content.links || {};
  if (links.image) return links.image;
  var files = content.files || [];
  for (var i = 0; i < files.length; i++) {
    var file = files[i] || {};
    if (file.cdn_image) return file.cdn_image;
    if (file.cdn_uri) return file.cdn_uri;
    if (file.uri) return file.uri;
  }
  return null;
}

function assetName(asset) {
  var metadata = (asset && asset.content && asset.content.metadata) || {};
  return metadata.name || metadata.symbol || (asset && asset.id) || "Unknown";
}

function loadAssets(owner) {
  var api = desktopApi();
  if (!api || !assetGrid) return;
  if (!owner) { report("Enter or pick a Solana address first."); return; }
  report("Loading assets\\u2026");
  loadBtn.disabled = true;
  api.getWalletAssets({ ownerAddress: owner, limit: 24 }).then(function (result) {
    loadBtn.disabled = false;
    var items = (result && result.items) || [];
    var native = result && result.nativeBalance;
    if (balanceRow) balanceRow.replaceChildren(el("span", { text: native ? sol(native.lamports) + "  \\u00b7  " + items.length + " assets" : items.length + " assets" }));
    assetGrid.replaceChildren.apply(assetGrid, items.map(function (asset) {
      var image = assetImage(asset);
      var card = el("div", { "class": "sp-card" }, [
        image ? el("img", { src: image, alt: "", loading: "lazy" }) : el("div", { style: { width: "100%", height: "64px", "border-radius": "7px", background: "linear-gradient(135deg,rgba(153,69,255,.35),rgba(20,241,149,.25))" } }),
        el("div", { "class": "sp-name", text: assetName(asset) }),
      ]);
      card.addEventListener("click", function () { showDetail(asset.id); });
      return card;
    }));
    if (items.length === 0) assetGrid.appendChild(el("div", { text: "No assets found.", style: { color: "#77777e" } }));
    report("Loaded " + items.length + " assets", true);
  }).catch(function (error) {
    loadBtn.disabled = false;
    report(String(error && error.message || error));
  });
}

function showDetail(id) {
  var api = desktopApi();
  if (!api || !detailBox) return;
  report("Loading asset\\u2026");
  api.getAsset(id).then(function (asset) {
    var metadata = (asset && asset.content && asset.content.metadata) || {};
    var ownership = (asset && asset.ownership) || {};
    var royalty = (asset && asset.royalty) || {};
    var attributes = (metadata.attributes || []).slice(0, 12).map(function (attribute) {
      return el("div", { "class": "sp-attr" }, [
        el("span", { text: attribute.trait_type || "?", style: { color: "#9a9aa2" } }),
        el("span", { text: String(attribute.value == null ? "" : attribute.value) }),
      ]);
    });
    detailBox.replaceChildren.apply(detailBox, [
      assetImage(asset) ? el("img", { src: assetImage(asset), alt: "" }) : null,
      el("div", { text: assetName(asset), style: { "font-weight": "600", "font-size": "13px" } }),
      metadata.description ? el("div", { text: String(metadata.description).slice(0, 220), style: { color: "#aaa", margin: "4px 0" } }) : null,
      el("div", { "class": "sp-addr", text: id }),
      el("div", { text: "Owner " + short(ownership.owner || "?") + (royalty.basis_points ? "  \\u00b7  " + (royalty.basis_points / 100) + "% royalty" : ""), style: { margin: "4px 0" } }),
    ].concat(attributes.length ? [el("div", { style: { "margin-top": "6px" } }, attributes)] : []));
    report("Asset loaded", true);
  }).catch(function (error) { report(String(error && error.message || error)); });
}

function saveSecrets(entries, doneMessage) {
  var secrets = secretsApi();
  if (!secrets) { report("Desktop secrets bridge is unavailable."); return; }
  secrets.upsert(entries).then(function () { report(doneMessage, true); refreshStatus(); }).catch(function (error) {
    report(String(error && error.message || error));
  });
}

panel = el("div", { id: "sand-solana-panel" });

var modeSwitch = el("button", { "class": "sp-switch", "aria-label": "Toggle Solana mode", onclick: function () {
  applySkin(root.getAttribute("data-solana") !== "on");
} });
switchEl = modeSwitch;
modeSwitch.appendChild(el("span"));

panel.appendChild(el("div", { "class": "sp-sec sp-head" }, [
  el("span", { "class": "sp-title", text: "\\uD83E\\uDD80 Solana Mode" }),
  modeSwitch,
]));

var statusSec = el("div", { "class": "sp-sec" });
phantomDots = el("div", { text: "Checking configuration\\u2026", style: { color: "#9a9aa2" } });
statusSec.appendChild(phantomDots);
panel.appendChild(statusSec);

var walletSec = el("div", { "class": "sp-sec" });
walletSec.appendChild(el("h4", { text: "Wallets (Phantom Server SDK)" }));
var orgInput = el("input", { type: "password", placeholder: "PHANTOM_ORGANIZATION_ID", "aria-label": "Phantom organization id" });
var appInput = el("input", { type: "password", placeholder: "PHANTOM_APP_ID", "aria-label": "Phantom app id" });
var keyInput = el("input", { type: "password", placeholder: "PHANTOM_API_PRIVATE_KEY (base58)", "aria-label": "Phantom api private key" });
walletSec.appendChild(orgInput); walletSec.appendChild(appInput); walletSec.appendChild(keyInput);
walletSec.appendChild(el("button", { "class": "sp-btn", text: "Save Phantom credentials", onclick: function () {
  var entries = {};
  if (orgInput.value.trim()) entries.PHANTOM_ORGANIZATION_ID = orgInput.value.trim();
  if (appInput.value.trim()) entries.PHANTOM_APP_ID = appInput.value.trim();
  if (keyInput.value.trim()) entries.PHANTOM_API_PRIVATE_KEY = keyInput.value.trim();
  if (Object.keys(entries).length === 0) { report("Nothing to save."); return; }
  orgInput.value = appInput.value = keyInput.value = "";
  saveSecrets(entries, "Phantom credentials saved");
} }));
walletNameInput = el("input", { type: "text", placeholder: "New wallet name", "aria-label": "New wallet name", maxlength: "120" });
createBtn = el("button", { "class": "sp-btn", text: "Create wallet", onclick: function () {
  var api = desktopApi();
  if (!api) return;
  var name = walletNameInput.value.trim();
  if (!name) { report("Give the wallet a name first."); return; }
  createBtn.disabled = true;
  report("Creating wallet\\u2026");
  api.createWallet(name).then(function (wallet) {
    createBtn.disabled = false;
    walletNameInput.value = "";
    report("Wallet " + wallet.name + " created", true);
    refreshStatus();
  }).catch(function (error) {
    createBtn.disabled = false;
    report(String(error && error.message || error));
  });
} });
walletSec.appendChild(walletNameInput);
walletSec.appendChild(createBtn);
walletList = el("div", {});
walletSec.appendChild(walletList);
panel.appendChild(walletSec);

var localSec = el("div", { "class": "sp-sec" });
localSec.appendChild(el("h4", { text: "Local wallets (this Mac)" }));
var localNameInput = el("input", { type: "text", placeholder: "New local wallet name", "aria-label": "New local wallet name", maxlength: "120" });
var generateBtn = el("button", { "class": "sp-btn", text: "Generate wallet", onclick: function () {
  var api = desktopApi();
  if (!api) return;
  var name = localNameInput.value.trim();
  if (!name) { report("Give the wallet a name first."); return; }
  generateBtn.disabled = true;
  report("Generating keypair\\u2026");
  api.generateLocalWallet(name).then(function (wallet) {
    generateBtn.disabled = false;
    localNameInput.value = "";
    report("Wallet " + wallet.name + " generated (" + short(wallet.address) + ")", true);
    refreshLocalWallets();
  }).catch(function (error) {
    generateBtn.disabled = false;
    report(String(error && error.message || error));
  });
} });
localSec.appendChild(localNameInput);
localSec.appendChild(generateBtn);
localSec.appendChild(el("div", { text: "Keys are generated on this Mac and encrypted with the OS keychain.", style: { color: "#77777e", "font-size": "10px", margin: "4px 0" } }));
var localList = el("div", {});
localSec.appendChild(localList);
panel.appendChild(localSec);

var owsSec = el("div", { "class": "sp-sec" });
owsSec.appendChild(el("h4", { text: "OWS trading wallet" }));
owsSec.appendChild(el("div", { text: "Bots only see wallet names and public addresses. The password stays in this masked field.", style: { color: "#77777e", "font-size": "10px", margin: "0 0 6px" } }));
var owsNameInput = el("input", { type: "text", placeholder: "Wallet name", "aria-label": "OWS wallet name", maxlength: "80" });
var owsPasswordInput = el("input", { type: "password", placeholder: "Wallet password", "aria-label": "OWS wallet password", autocomplete: "new-password" });
var owsCreateBtn = el("button", { "class": "sp-btn", text: "Create OWS wallet", onclick: function () {
  var api = owsApi();
  if (!api) { report("OWS is unavailable."); return; }
  var name = owsNameInput.value.trim();
  var password = owsPasswordInput.value;
  if (!name) { report("Give the wallet a name first."); return; }
  if (!password) { report("Enter the wallet password in the masked field."); return; }
  owsCreateBtn.disabled = true;
  report("Creating OWS wallet\\u2026");
  var pending = owsPendingId;
  api.createWallet({ name: name, password: password, requestId: pending || undefined }).then(function (wallet) {
    owsCreateBtn.disabled = false;
    owsNameInput.value = "";
    owsPasswordInput.value = "";
    owsPendingId = null;
    report("OWS wallet " + (wallet && wallet.name ? wallet.name : name) + " created", true);
    refreshOws();
  }).catch(function (error) {
    owsCreateBtn.disabled = false;
    owsPasswordInput.value = "";
    report(String(error && error.message || error));
  });
} });
owsSec.appendChild(owsNameInput);
owsSec.appendChild(owsPasswordInput);
owsSec.appendChild(owsCreateBtn);
var owsList = el("div", {});
owsSec.appendChild(owsList);
panel.appendChild(owsSec);
var owsPendingId = null;

function owsAddress(wallet) {
  var accounts = (wallet && wallet.accounts) || [];
  for (var i = 0; i < accounts.length; i++) {
    if (String(accounts[i].chainId || "").toLowerCase().indexOf("solana") >= 0) return accounts[i].address;
  }
  return accounts[0] && accounts[0].address;
}

function refreshOws() {
  var api = owsApi();
  if (!api || !owsList) return;
  Promise.all([api.listWallets(), api.requests()]).then(function (rows) {
    var wallets = (rows[0] && rows[0].wallets) || [];
    var requests = (rows[1] && rows[1].requests) || [];
    var pending = requests.filter(function (row) { return row.status === "awaiting_password"; });
    if (pending.length && !owsNameInput.value) owsNameInput.value = pending[0].name;
    if (pending.length) owsPendingId = pending[0].id;
    var nodes = pending.map(function (row) {
      return el("div", { "class": "sp-row" }, [
        el("span", { text: "Pending: " + row.name, style: { color: "#14F195" } }),
      ]);
    }).concat(wallets.map(function (wallet) {
      var address = owsAddress(wallet);
      return el("div", { "class": "sp-row" }, [
        el("span", {}, [
          el("span", { text: wallet.name, style: { "font-weight": "600" } }),
          address ? el("span", { text: "  " + short(address), "class": "sp-addr" }) : null,
        ]),
        address ? el("button", { "class": "sp-mini", text: "Copy", title: address, onclick: function () {
          navigator.clipboard.writeText(address).then(function () { report("Address copied", true); }, function () {});
        } }) : null,
      ]);
    }));
    owsList.replaceChildren.apply(owsList, nodes);
    if (nodes.length === 0) owsList.appendChild(el("div", { text: "No OWS wallets yet.", style: { color: "#77777e", padding: "4px 0" } }));
  }).catch(function (error) { report(String(error && error.message || error)); });
}

function refreshLocalWallets() {
  var api = desktopApi();
  if (!api || !localList) return;
  api.listLocalWallets().then(function (result) {
    localList.replaceChildren.apply(localList, (result.wallets || []).map(function (wallet) {
      return el("div", { "class": "sp-row" }, [
        el("span", {}, [
          el("span", { text: wallet.name, style: { "font-weight": "600" } }),
          el("span", { text: "  " + short(wallet.address), "class": "sp-addr" }),
        ]),
        el("span", { style: { display: "flex", gap: "4px" } }, [
          el("button", { "class": "sp-mini", text: "Copy", title: wallet.address, onclick: function () {
            navigator.clipboard.writeText(wallet.address).then(function () { report("Address copied", true); }, function () {});
          } }),
          el("button", { "class": "sp-mini", text: "Key", title: "Copy the secret key", onclick: function () {
            api.revealLocalWalletSecret(wallet.name).then(function (secret) {
              navigator.clipboard.writeText(secret).then(function () { report("Secret key copied \\u2014 store it somewhere safe", true); }, function () {});
            }).catch(function (error) { report(String(error && error.message || error)); });
          } }),
        ]),
      ]);
    }));
    if ((result.wallets || []).length === 0) localList.appendChild(el("div", { text: "No local wallets yet.", style: { color: "#77777e", padding: "4px 0" } }));
    if (ownerSelect) {
      var previous = ownerSelect.value;
      var createdOptions = [].slice.call(ownerSelect.options).filter(function (option) { return option.dataset.kind === "phantom"; });
      ownerSelect.replaceChildren.apply(ownerSelect, [el("option", { value: "", text: "Created wallets\\u2026" })].concat((result.wallets || []).map(function (w) {
        var option = el("option", { value: w.address, text: w.name + " (" + short(w.address) + ")" });
        option.dataset.kind = "local";
        return option;
      })).concat(createdOptions));
      if (previous) ownerSelect.value = previous;
    }
  }).catch(function (error) { report(String(error && error.message || error)); });
}

var heliusSec = el("div", { "class": "sp-sec" });
heliusSec.appendChild(el("h4", { text: "Portfolio (Helius DAS)" }));
var heliusInput = el("input", { type: "password", placeholder: "HELIUS_API_KEY", "aria-label": "Helius api key" });
heliusSec.appendChild(heliusInput);
heliusSec.appendChild(el("button", { "class": "sp-btn", text: "Save Helius key", onclick: function () {
  if (!heliusInput.value.trim()) { report("Nothing to save."); return; }
  var entries = { HELIUS_API_KEY: heliusInput.value.trim() };
  heliusInput.value = "";
  saveSecrets(entries, "Helius key saved");
} }));
ownerSelect = el("select", { "aria-label": "Pick wallet", style: { width: "100%", "box-sizing": "border-box", margin: "3px 0", padding: "6px 8px", "border-radius": "8px", border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.06)", color: "#eee", "font-size": "12px" } });
ownerCustom = el("input", { type: "text", placeholder: "\\u2026or paste any Solana address", "aria-label": "Owner address" });
loadBtn = el("button", { "class": "sp-btn", text: "Load assets", onclick: function () {
  var owner = ownerCustom.value.trim() || ownerSelect.value;
  loadAssets(owner);
} });
balanceRow = el("div", { text: "", style: { color: "#9a9aa2", "margin-top": "4px" } });
assetGrid = el("div", { "class": "sp-grid" });
detailBox = el("div", { "class": "sp-detail", style: { "margin-top": "10px" } });
heliusSec.appendChild(ownerSelect);
heliusSec.appendChild(ownerCustom);
heliusSec.appendChild(loadBtn);
heliusSec.appendChild(balanceRow);
heliusSec.appendChild(assetGrid);
heliusSec.appendChild(detailBox);
panel.appendChild(heliusSec);

statusLine = el("div", { "class": "sp-status" });
panel.appendChild(el("div", { "class": "sp-sec" }, [statusLine]));

button = el("button", {
  id: "sand-solana-button",
  title: "Solana mode \\uD83E\\uDD80",
  "aria-label": "Toggle Solana panel",
  text: "\\uD83E\\uDD80",
});
button.addEventListener("click", function () {
  panel.setAttribute("data-open", panel.getAttribute("data-open") === "1" ? "0" : "1");
  if (panel.getAttribute("data-open") === "1") { refreshStatus(); report(""); }
});
doc.body.appendChild(button);
doc.body.appendChild(panel);

var enabled = false;
try { enabled = localStorage.getItem(LS_KEY) === "1"; } catch (e) {}
if (enabled) applySkin(true);

var TAGLINE_TEXT = "Clawd Bot \\u2014 powered by Grok and xAI on Solana";
var taglineCss = [
'.sand-solana-tagline{margin:14px auto 6px;text-align:center;font-size:12px;font-weight:600;letter-spacing:.04em;',
'background:linear-gradient(90deg,' + PURPLE + ',' + GREEN + ');-webkit-background-clip:text;background-clip:text;color:transparent;',
'width:fit-content;max-width:90%;}'
].join("");
var taglineStyle = doc.createElement("style");
taglineStyle.textContent = taglineCss;
doc.head.appendChild(taglineStyle);

function taglineNode() {
  var node = doc.createElement("div");
  node.className = "sand-solana-tagline";
  node.textContent = TAGLINE_TEXT;
  return node;
}
function injectTaglines() {
  var steps = doc.querySelectorAll('[class*="sand-onboarding__"]');
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (step.querySelector(".sand-solana-tagline") != null) { step.setAttribute("data-solana-tagged", "1"); continue; }
    var hasHeading = step.querySelector("h1, h2, h3, [class*=heading]");
    if (!hasHeading) continue;
    step.setAttribute("data-solana-tagged", "1");
    step.appendChild(taglineNode());
  }
}
if (typeof MutationObserver === "function") {
  new MutationObserver(function () { injectTaglines(); }).observe(doc.body, { childList: true, subtree: true });
}
injectTaglines();
})();
`;

export async function applyOriginalRendererSolanaModePatch({ stageRoot }) {
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
    throw new Error(`The Solana mode runtime is already installed in ${entryName}.`);
  }
  const rebrand = [];
  for (const name of names) {
    const source = sources.get(name);
    const count = source.split(REBRAND_BEFORE).length - 1;
    if (count === 0) continue;
    const patched = source.replaceAll(REBRAND_BEFORE, REBRAND_AFTER);
    await writeFile(path.join(assetsRoot, name), patched);
    rebrand.push({ path: `dist/renderer/assets/${name}`, replacements: count, patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) } });
  }
  const indexPath = path.join(stageRoot, "dist", "renderer", "index.html");
  const indexSource = await readFile(indexPath, "utf8");
  const indexCount = indexSource.split(REBRAND_BEFORE).length - 1;
  if (indexCount > 0) {
    const patchedIndex = indexSource.replaceAll(REBRAND_BEFORE, REBRAND_AFTER);
    await writeFile(indexPath, patchedIndex);
    rebrand.push({ path: "dist/renderer/index.html", replacements: indexCount, patched: { bytes: Buffer.byteLength(patchedIndex), sha256: sha256(patchedIndex) } });
  }
  const patchedEntry = sources.get(entryName).replaceAll(REBRAND_BEFORE, REBRAND_AFTER) + `\n${SOLANA_MODE_RUNTIME}`;
  if (!patchedEntry.includes(HEADING_CHECK)) {
    throw new Error(`The onboarding heading anchor is missing from ${entryName}; the Clawd rebrand could not be verified.`);
  }
  await writeFile(path.join(assetsRoot, entryName), patchedEntry);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-solana-mode",
    chunks: [{
      role: "entry-runtime",
      path: `dist/renderer/assets/${entryName}`,
      original: { bytes: Buffer.byteLength(entrySource), sha256: sha256(entrySource) },
      patched: { bytes: Buffer.byteLength(patchedEntry), sha256: sha256(patchedEntry) },
    }],
    rebrand,
    indexHtmlReplacements: indexCount,
    features: ["solana-skin", "solana-lobster-button", "phantom-wallets", "helius-portfolio", "local-wallet-generator", "ows-masked-password", "clawd-global-rebrand", "onboarding-tagline"],
    transformations: ["entry-chunk-runtime-append", "clawd-global-rebrand"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-solana-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
