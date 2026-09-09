import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkflowFile } from "./workflow-model.js";

export const BUNDLED_TRADING_PLUGIN_ID = "clawd-trading";
export const BUNDLED_SKILL_TOOL_PROVIDER = "grok-bot-bundled-skills";

export interface BundledSkill {
  readonly id: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly name: string;
  readonly description: string;
  readonly directory: string;
  readonly skillFile: string;
  readonly supportFiles: readonly string[];
}

const SKILL_FILE = "SKILL.md";

function defaultPluginsRoot(): string {
  const override = process.env.SAND_BUNDLED_PLUGINS_DIR?.trim();
  if (override) return override;
  return join(process.cwd(), "plugins");
}

function modulePluginsRoot(): string {
  try {
    return join(fileURLToPath(new URL("../..", import.meta.url)), "plugins");
  } catch {
    return defaultPluginsRoot();
  }
}

export function bundledPluginsRoot(): string {
  const cwdRoot = defaultPluginsRoot();
  if (existsSync(join(cwdRoot, "paybox")) || existsSync(join(cwdRoot, "trading"))) return cwdRoot;
  const moduleRoot = modulePluginsRoot();
  if (existsSync(join(moduleRoot, "paybox")) || existsSync(join(moduleRoot, "trading"))) return moduleRoot;
  return cwdRoot;
}

function supportFiles(skillDir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === "node_modules" || entry.name === ".git") continue;
      const target = join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name !== SKILL_FILE) files.push(relative(skillDir, target).split(sep).join("/"));
    }
  };
  walk(skillDir);
  return files.sort();
}

function pluginDisplayName(pluginDir: string, fallback: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf8")) as { displayName?: unknown; name?: unknown };
    if (typeof manifest.displayName === "string" && manifest.displayName.trim()) return manifest.displayName.trim();
    if (typeof manifest.name === "string" && manifest.name.trim()) return manifest.name.trim();
  } catch {}
  return fallback;
}

function skillFromDirectory(pluginId: string, pluginName: string, skillDir: string): BundledSkill | null {
  const skillFile = join(skillDir, SKILL_FILE);
  if (!existsSync(skillFile)) return null;
  const id = skillDir.split(/[/\\]/).filter(Boolean).at(-1);
  if (id == null || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
  let raw: string;
  try { raw = readFileSync(skillFile, "utf8"); } catch { return null; }
  const parsed = parseWorkflowFile(raw);
  return {
    id,
    pluginId,
    pluginName,
    name: parsed?.name || id,
    description: parsed?.description || "",
    directory: skillDir,
    skillFile,
    supportFiles: supportFiles(skillDir),
  };
}

export function listBundledPluginSkills(pluginsRoot: string = bundledPluginsRoot()): BundledSkill[] {
  const skills: BundledSkill[] = [];
  const seen = new Set<string>();
  let plugins;
  try { plugins = readdirSync(pluginsRoot, { withFileTypes: true }); } catch { return []; }
  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;
    const pluginDir = join(pluginsRoot, plugin.name);
    const pluginName = pluginDisplayName(pluginDir, plugin.name);
    const pluginId = plugin.name === "trading" ? BUNDLED_TRADING_PLUGIN_ID : plugin.name;
    const skillsRoot = join(pluginDir, "skills");
    let skillEntries;
    try { skillEntries = readdirSync(skillsRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of skillEntries) {
      if (!entry.isDirectory()) continue;
      const skill = skillFromDirectory(pluginId, pluginName, join(skillsRoot, entry.name));
      if (skill == null || seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push(skill);
    }
  }
  return skills.sort((left, right) => left.id.localeCompare(right.id));
}

export function renderBundledSkillsCatalog(skills: readonly BundledSkill[] = listBundledPluginSkills()): string {
  if (skills.length === 0) return "";
  const rows = skills.map(skill => `- ${skill.name}: ${skill.description || "Bundled skill."} Support files: ${skill.supportFiles.length}. Read with bundled_skill_read { name: "${skill.id}" }.`);
  return [
    "Bundled trading, Solana, Cheshire, Pump.fun, Helius, DFlow, Imperial, and PayBox skills are installed with this app.",
    "Use bundled_skill_list to see them and bundled_skill_read to load SKILL.md plus a support file. Never ask the user to paste private keys or wallet passwords.",
    ...rows,
  ].join("\n");
}

function resolveSkillFile(skill: BundledSkill, relativePath?: string): string {
  if (relativePath == null || relativePath.trim().length === 0) return skill.skillFile;
  const cleaned = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.length === 0 || cleaned.includes("\0")) throw new Error("Invalid skill file path.");
  const resolved = resolve(skill.directory, cleaned);
  const root = resolve(skill.directory);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Skill file path must stay inside the skill folder.");
  if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`No support file named ${cleaned} in ${skill.id}.`);
  return resolved;
}

export function readBundledSkill(name: unknown, relativePath?: unknown, pluginsRoot: string = bundledPluginsRoot()): {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly supportFiles: readonly string[];
  readonly content: string;
} {
  if (typeof name !== "string" || name.trim().length === 0) throw new Error("bundled_skill_read requires a skill name.");
  const id = name.trim();
  const skill = listBundledPluginSkills(pluginsRoot).find(row => row.id === id || row.name === id);
  if (skill == null) throw new Error(`Unknown bundled skill: ${id}`);
  const filePath = resolveSkillFile(skill, typeof relativePath === "string" ? relativePath : undefined);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: relative(skill.directory, filePath).split(sep).join("/") || SKILL_FILE,
    supportFiles: skill.supportFiles,
    content: readFileSync(filePath, "utf8"),
  };
}

export function copyBundledPlugins(destinationRoot: string, pluginsRoot: string = bundledPluginsRoot()): { readonly installed: number; readonly pluginsRoot: string; readonly skills: readonly BundledSkill[] } {
  mkdirSync(destinationRoot, { recursive: true });
  if (existsSync(pluginsRoot)) {
    cpSync(pluginsRoot, destinationRoot, { recursive: true, dereference: true, force: true });
  }
  const skills = listBundledPluginSkills(destinationRoot);
  return { installed: skills.length, pluginsRoot: destinationRoot, skills };
}

const LIST_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
const READ_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Bundled skill folder name, e.g. pumpfun or cheshire-api." },
    path: { type: "string", description: "Optional support file relative to the skill folder, e.g. references/endpoints.md." },
  },
  required: ["name"],
  additionalProperties: false,
} as const;

export const BUNDLED_SKILL_ROUTED_TOOLS = [
  {
    name: "bundled_skill_list",
    toolName: "bundled_skill_list",
    providerIdentifier: BUNDLED_SKILL_TOOL_PROVIDER,
    description: "List bundled Cheshire, Pump.fun, Helius, DFlow, Imperial, Clawd trading, and PayBox skills shipped with this app, including support-file counts. Read-only.",
    inputSchema: LIST_SCHEMA,
  },
  {
    name: "bundled_skill_read",
    toolName: "bundled_skill_read",
    providerIdentifier: BUNDLED_SKILL_TOOL_PROVIDER,
    description: "Read a bundled trading skill's SKILL.md or a support file from that skill folder. Use after bundled_skill_list. Read-only.",
    inputSchema: READ_SCHEMA,
  },
] as const;

export function isBundledSkillTool(name: unknown): name is string {
  return typeof name === "string" && BUNDLED_SKILL_ROUTED_TOOLS.some(tool => tool.name === name);
}

export function executeBundledSkillTool(name: string, args: unknown, pluginsRoot: string = bundledPluginsRoot()): unknown {
  const record = typeof args === "object" && args != null && !Array.isArray(args) ? args as Record<string, unknown> : {};
  if (name === "bundled_skill_list") {
    const skills = listBundledPluginSkills(pluginsRoot);
    return {
      ok: true,
      count: skills.length,
      skills: skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        plugin: skill.pluginName,
        supportFiles: skill.supportFiles,
      })),
    };
  }
  if (name === "bundled_skill_read") {
    return { ok: true, ...readBundledSkill(record.name, record.path, pluginsRoot) };
  }
  throw new Error(`Unknown bundled skill tool: ${name}`);
}
