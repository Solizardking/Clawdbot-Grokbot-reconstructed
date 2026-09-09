import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "source/node-agent-coordinator/web-tools.ts");

async function loadWebTools() {
  const outfile = path.join(repoRoot, ".cache", `web-tools-test-${Date.now()}.mjs`);
  await build({
    entryPoints: [sourcePath],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${outfile}?${Math.random()}`);
  return module;
}

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  impl.calls = calls;
  return impl;
}

function htmlResponse(body, status = 200, contentType = "text/html; charset=utf-8") {
  const bytes = Uint8Array.from(Buffer.from(body, "utf8"));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const BING_RSS_FIXTURE = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Bing</title>
<item><title>Grok <b>news</b> &amp; updates</title><link>https://example.com/grok</link><description>Latest Grok release notes &#39;round the web &quot;here&quot;</description></item>
<item><title><![CDATA[Second result]]></title><link>https://direct-example.org/page</link><description><![CDATA[Snippet two]]></description></item>
<item><title>Duplicate dropped</title><link>https://example.com/grok</link><description>x</description></item>
</channel></rss>`;

const MOJEEK_FIXTURE = `<html><body>
<h2><a class="title" title="https://mojeek-result.test/" href="https://mojeek-result.test/">Mojeek hit</a></h2>
<p class="s">Mojeek snippet text &amp; more</p>
</body></html>`;

const SEARCH_FIXTURE = `
<html><body>
<div class="result results_links">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fgrok&amp;rut=abc">Grok <b>news</b> &amp; updates</a></h2>
  <a class="result__snippet" href="#">Latest <b>Grok</b> release notes &#x27;round the web &quot;here&quot;</a>
</div>
</body></html>`;

test("web_search prefers Bing RSS and decodes titles, URLs, and snippets", async () => {
  const web = await loadWebTools();
  try {
    const fetchImpl = fakeFetch((url) => {
      assert.ok(url.startsWith("https://www.bing.com/search?q="));
      assert.ok(url.includes(encodeURIComponent("grok 4.6 news")));
      assert.ok(url.includes("format=rss"));
      return htmlResponse(BING_RSS_FIXTURE, 200, "application/rss+xml");
    });
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_search", { query: "grok 4.6 news" });
    assert.equal(result.ok, true);
    assert.equal(result.engine, "bing");
    assert.equal(result.count, 2);
    assert.equal(result.results[0].url, "https://example.com/grok");
    assert.equal(result.results[0].title, "Grok news & updates");
    assert.match(result.results[0].snippet, /release notes 'round the web "here"/);
    assert.equal(result.results[1].url, "https://direct-example.org/page");
    assert.equal(result.results[1].title, "Second result");
  } finally { web.configureWebBridgeForTests(null); }
});

test("web_search falls back to Mojeek when Bing fails, then errors after all engines fail", async () => {
  const web = await loadWebTools();
  try {
    const fetchImpl = fakeFetch((url) => String(url).includes("mojeek.com") ? htmlResponse(MOJEEK_FIXTURE) : htmlResponse("<error/>", 202));
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_search", { query: "fallback" });
    assert.equal(result.engine, "mojeek");
    assert.equal(result.results[0].url, "https://mojeek-result.test/");
    assert.equal(result.results[0].title, "Mojeek hit");
    assert.equal(result.results[0].snippet, "Mojeek snippet text & more");

    const failing = fakeFetch(() => htmlResponse("<error/>", 202));
    web.configureWebBridgeForTests({ fetchImpl: failing });
    await assert.rejects(
      web.executeWebRoutedTool("web_search", { query: "offline" }),
      (error) => {
        assert.match(error.message, /every engine/);
        assert.match(error.message, /HTTP 202/);
        return true;
      },
    );
  } finally { web.configureWebBridgeForTests(null); }
});

test("the DuckDuckGo parser still works as the last-resort engine", async () => {
  const web = await loadWebTools();
  try {
    const fetchImpl = fakeFetch((url) => String(url).includes("duckduckgo.com") ? htmlResponse(SEARCH_FIXTURE) : htmlResponse("<error/>", 500));
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_search", { query: "legacy" });
    assert.equal(result.engine, "duckduckgo");
    assert.equal(result.results[0].url, "https://example.com/grok");
  } finally { web.configureWebBridgeForTests(null); }
});

test("max_results clamps the number of returned hits", async () => {
  const web = await loadWebTools();
  try {
    const items = Array.from({ length: 9 }, (_, i) => `<item><title>S${i}</title><link>https://site${i}.test/</link><description>d${i}</description></item>`).join("");
    const fetchImpl = fakeFetch(() => htmlResponse(`<rss><channel>${items}</channel></rss>`));
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_search", { query: "x", max_results: 3 });
    assert.equal(result.count, 3);
  } finally { web.configureWebBridgeForTests(null); }
});

test("web_fetch strips HTML down to readable text and captures the title", async () => {
  const web = await loadWebTools();
  try {
    const page = `<html><head><title>Example Page &amp; more</title><style>.x{}</style></head>
      <body><script>alert(1)</script><nav>Menu junk</nav>
      <h1>Welcome</h1><p>First   paragraph with an entity: caf&eacute; &#9731;</p>
      <p>Second paragraph</p></body></html>`;
    const fetchImpl = fakeFetch((url) => {
      assert.equal(url, "https://example.com/post/hello-world");
      return htmlResponse(page);
    });
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_fetch", { url: "https://example.com/post/hello-world" });
    assert.equal(result.ok, true);
    assert.equal(result.title, "Example Page & more");
    assert.match(result.text, /Welcome/);
    assert.match(result.text, /First paragraph with an entity: café ☃/);
    assert.doesNotMatch(result.text, /alert\(1\)/);
    assert.doesNotMatch(result.text, /\.x\{\}/);
  } finally { web.configureWebBridgeForTests(null); }
});

test("web_fetch accepts scheme-less urls, rejects private hosts, and reports http errors", async () => {
  const web = await loadWebTools();
  try {
    const fetchImpl = fakeFetch((url) => {
      assert.equal(url, url);
      return String(url).includes("missing.test") ? htmlResponse("<html><body>nope</body></html>", 404) : htmlResponse("<html><body>hi</body></html>");
    });
    web.configureWebBridgeForTests({ fetchImpl });
    await assert.rejects(web.executeWebRoutedTool("web_fetch", { url: "http://127.0.0.1/x" }), /private or local/);
    await assert.rejects(web.executeWebRoutedTool("web_fetch", { url: "http://192.168.1.10/admin" }), /private or local/);
    await assert.rejects(web.executeWebRoutedTool("web_fetch", { url: "ftp://example.com/f" }), /only supports http/);
    await assert.rejects(web.executeWebRoutedTool("web_fetch", { url: "" }), /non-empty url/);
    await assert.rejects(web.executeWebRoutedTool("web_fetch", { url: "https://missing.test/" }), /HTTP 404/);
    const plain = await web.executeWebRoutedTool("web_fetch", { url: "example.com/plain.txt" });
    assert.equal(plain.url, "https://example.com/plain.txt");
  } finally { web.configureWebBridgeForTests(null); }
});

test("long pages are truncated to a model-friendly size", async () => {
  const web = await loadWebTools();
  try {
    const filler = "lorem ipsum dolor sit amet ".repeat(3000);
    const fetchImpl = fakeFetch(() => htmlResponse(`<html><body>${filler}</body></html>`));
    web.configureWebBridgeForTests({ fetchImpl });
    const result = await web.executeWebRoutedTool("web_fetch", { url: "https://big.example/" });
    assert.equal(result.truncated, true);
    assert.match(result.text, /\[Truncated/);
  } finally { web.configureWebBridgeForTests(null); }
});

test("unknown tools are rejected and the catalog exposes both tools without any key", async () => {
  const web = await loadWebTools();
  try {
    assert.deepEqual(web.webRoutedTools().map(tool => tool.name), ["web_search", "web_fetch"]);
    for (const tool of web.webRoutedTools()) assert.equal(tool.providerIdentifier, "grok-bot-local-web");
    assert.equal(web.isWebRoutedTool("web_search"), true);
    assert.equal(web.isWebRoutedTool("grok_imagine"), false);
    await assert.rejects(web.executeWebRoutedTool("web_nope", {}), /Unknown web tool/);
    await assert.rejects(web.executeWebRoutedTool("web_search", {}), /non-empty query/);
  } finally { web.configureWebBridgeForTests(null); }
});

test("router and telegram bridge route web_ tools through the local gate", async () => {
  const routerSource = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(routerSource, /from "\.\/web-tools\.js"/);
  assert.match(routerSource, /isWebRoutedTool\(name\)\) return executeWebRoutedTool/);
  const servicesSource = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  assert.match(servicesSource, /\.\.\.webRoutedTools\(\)/);
});
