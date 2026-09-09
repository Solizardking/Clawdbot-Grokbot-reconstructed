const WEB_PROVIDER = "grok-bot-local-web";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 GrokBotReconstructed/0.18";
const FETCH_TIMEOUT_MS = 30_000;
const SEARCH_TIMEOUT_MS = 20_000;
const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 24_000;

export interface WebFetchLike {
  (url: string, init?: { method: string; headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;
}

let testOverrides: { fetchImpl?: WebFetchLike } = {};

export function configureWebBridgeForTests(overrides: { fetchImpl?: WebFetchLike } | null): void {
  testOverrides = overrides ?? {};
}

function resolveFetch(): WebFetchLike {
  return testOverrides.fetchImpl ?? (globalThis.fetch as unknown as WebFetchLike);
}

async function httpGet(url: string, timeoutMs: number): Promise<{ status: number; contentType: string | undefined; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await resolveFetch()(url, { method: "GET", headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "accept-language": "en-US,en;q=0.9" }, signal: controller.signal });
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FETCH_BYTES) throw new Error(`Response from ${url} is too large (${buffer.byteLength} bytes).`);
    return { status: response.status, contentType: response.headers.get("content-type") ?? undefined, bytes: new Uint8Array(buffer) };
  } finally { clearTimeout(timeout); }
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷", laquo: "«", raquo: "»", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", bull: "•", dagger: "†", prime: "′", Prime: "″", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", szlig: "ß", agrave: "à", aacute: "á", acirc: "â", atilde: "ã", aring: "å", ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", oslash: "ø", ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý" };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => named[name] ?? match);
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function collapse(text: string): string {
  return text.replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToText(html: string): { title: string | undefined; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const scope = bodyMatch?.[1] ?? html;
  const text = collapse(decodeEntities(scope
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
  return { title: titleMatch == null ? undefined : collapse(decodeEntities(stripTags(titleMatch[1]!))), text };
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "::" || host === "0.0.0.0" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  return /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^fe80:/i.test(host) || /^fc00:/i.test(host) || /^fd[0-9a-f]{2}:?/i.test(host);
}

function normalizeUrl(raw: string): URL {
  let candidate = raw.trim();
  if (candidate.length === 0) throw new Error("web_fetch requires a non-empty url.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error(`web_fetch could not parse the url "${raw}".`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`web_fetch only supports http(s), not ${parsed.protocol}`);
  if (isBlockedHost(parsed.hostname)) throw new Error(`web_fetch refuses to fetch private or local host "${parsed.hostname}".`);
  return parsed;
}

type WebRoutedToolSchema = Record<string, unknown>;

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "The search query. Be specific and include keywords, version numbers, or dates when relevant." },
    max_results: { type: "integer", minimum: 1, maximum: 10, default: 5, description: "How many results to return (default 5)." },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const FETCH_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", minLength: 1, description: "The page URL to read. Use web_search first to discover URLs." },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export interface WebRoutedTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export const WEB_ROUTED_TOOLS: readonly WebRoutedTool[] = [
  {
    name: "web_search",
    toolName: "web_search",
    providerIdentifier: WEB_PROVIDER,
    description: "Search the public web for up-to-date information and get titles, URLs, and snippets. No API key needed. Use whenever the user asks about current events, recent releases, documentation, prices, weather, or anything that may postdate your training data. Follow up with web_fetch to read a promising result.",
    inputSchema: SEARCH_SCHEMA,
  },
  {
    name: "web_fetch",
    toolName: "web_fetch",
    providerIdentifier: WEB_PROVIDER,
    description: "Read a public web page by URL and get its extracted plain text (HTML stripped). No API key needed. Use after web_search, or directly when the user gives you a link.",
    inputSchema: FETCH_SCHEMA,
  },
];

export function webRoutedTools(): readonly WebRoutedTool[] {
  return WEB_ROUTED_TOOLS;
}

export function isWebRoutedTool(name: unknown): boolean {
  return typeof name === "string" && WEB_ROUTED_TOOLS.some(tool => tool.name === name);
}

interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

function decodeResultUrl(href: string): string | undefined {
  const trimmed = href.trim().replace(/^\/\//, "https://");
  try {
    const parsed = new URL(trimmed, "https://duckduckgo.com");
    const redirect = parsed.searchParams.get("uddg");
    if (redirect != null) return decodeEntities(redirect);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname !== "/l/") return undefined;
    return parsed.toString();
  } catch { return undefined; }
}

function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const titles = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g)];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < titles.length; index += 1) {
    const match = titles[index]!;
    const url = decodeResultUrl(match[1]!);
    if (url == null || seen.has(url)) continue;
    seen.add(url);
    hits.push({
      title: collapse(decodeEntities(stripTags(match[2]!))),
      url,
      snippet: collapse(decodeEntities(stripTags(snippets[index]?.[1] ?? snippets[index]?.[2] ?? ""))),
    });
  }
  return hits;
}

function parseBingRss(xml: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<item>\s*<title>([\s\S]*?)<\/title>\s*<link>([\s\S]*?)<\/link>\s*<description>([\s\S]*?)<\/description>/g)) {
    const unwrap = (value: string): string => {
      const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(value)?.[1];
      return collapse(decodeEntities(stripTags((cdata ?? value).trim())));
    };
    const url = decodeEntities(match[2]!.trim());
    if (url.length === 0 || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title: unwrap(match[1]!), url, snippet: unwrap(match[3]!) });
  }
  return hits;
}

function parseMojeekHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const titles = [...html.matchAll(/<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<p[^>]*class="s"[^>]*>([\s\S]*?)<\/p>/g)];
  for (let index = 0; index < titles.length; index += 1) {
    const match = titles[index]!;
    let url = decodeEntities(match[1]!.trim());
    try { url = new URL(url).toString(); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    hits.push({ title: collapse(decodeEntities(stripTags(match[2]!))), url, snippet: collapse(decodeEntities(stripTags(snippets[index]?.[1] ?? ""))) });
  }
  return hits;
}

async function executeSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (query.length === 0) throw new Error("web_search requires a non-empty query.");
  const maxResults = typeof args.max_results === "number" && Number.isInteger(args.max_results) && args.max_results >= 1 ? Math.min(args.max_results, 10) : 5;
  const encoded = encodeURIComponent(query);
  const engines: readonly { readonly name: string; readonly url: string; readonly kind: "bing-rss" | "mojeek" | "ddg-html" }[] = [
    { name: "bing", url: `https://www.bing.com/search?q=${encoded}&format=rss&count=${Math.min(maxResults + 2, 15)}`, kind: "bing-rss" },
    { name: "mojeek", url: `https://www.mojeek.com/search?q=${encoded}`, kind: "mojeek" },
    { name: "duckduckgo", url: `https://html.duckduckgo.com/html/?q=${encoded}&kl=wt-wt`, kind: "ddg-html" },
  ];
  let lastError: Error | null = null;
  for (const engine of engines) {
    try {
      const response = await httpGet(engine.url, SEARCH_TIMEOUT_MS);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const body = new TextDecoder("utf-8", { fatal: false }).decode(response.bytes);
      const hits = (engine.kind === "bing-rss" ? parseBingRss(body) : engine.kind === "mojeek" ? parseMojeekHtml(body) : parseDuckDuckGoHtml(body)).slice(0, maxResults);
      if (hits.length === 0) throw new Error("no results parsed");
      return { ok: true, query, count: hits.length, engine: engine.name, note: "Use web_fetch on any result URL to read the full page.", results: hits };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`web_search failed on every engine (bing, mojeek, duckduckgo); last error: ${lastError?.message ?? "unknown"}`);
}

async function executeFetchPage(args: Record<string, unknown>): Promise<unknown> {
  const raw = typeof args.url === "string" ? args.url : "";
  const parsed = normalizeUrl(raw);
  const response = await httpGet(parsed.toString(), FETCH_TIMEOUT_MS);
  if (response.status < 200 || response.status >= 300) throw new Error(`Fetching ${parsed} returned HTTP ${response.status}.`);
  const contentType = response.contentType ?? "";
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(response.bytes);
  if (/^(image|audio|video)\//i.test(contentType)) {
    throw new Error(`${parsed} is binary media (${contentType}); web_fetch only returns text pages.`);
  }
  const isHtml = /html/i.test(contentType) || /^\s*</.test(decoded);
  const content = isHtml
    ? (() => { const { title, text } = htmlToText(decoded); return { title, text }; })()
    : { title: undefined, text: collapse(decoded) };
  if (content.text.length === 0) throw new Error(`${parsed} returned no readable text.`);
  const truncated = content.text.length > MAX_TEXT_CHARS;
  return {
    ok: true,
    url: parsed.toString(),
    status: response.status,
    ...(contentType == null ? {} : { contentType }),
    ...(content.title == null || content.title.length === 0 ? {} : { title: content.title }),
    truncated,
    chars: Math.min(content.text.length, MAX_TEXT_CHARS),
    text: truncated ? `${content.text.slice(0, MAX_TEXT_CHARS)}\n\n[Truncated. Fetch specific sections or search for more detail.]` : content.text,
  };
}

export async function executeWebRoutedTool(name: string, args: unknown): Promise<unknown> {
  const row = typeof args === "object" && args != null && !Array.isArray(args) ? args as Record<string, unknown> : {};
  switch (name) {
    case "web_search": return await executeSearch(row);
    case "web_fetch": return await executeFetchPage(row);
    default: throw new Error(`Unknown web tool: ${name}`);
  }
}
