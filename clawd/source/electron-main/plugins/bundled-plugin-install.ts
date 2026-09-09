import { copyBundledPlugins, listBundledPluginSkills, type BundledSkill } from "../../shared/bundled-trading-skills.js";
import { getPluginSkillsDir, getPluginsRootDir, writePluginSkillsCache } from "../../host/extensions/mcp/plugin-skills-cache.js";

export function installBundledPluginSkills(sandRoot: string, pluginsRoot?: string): { readonly installed: number; readonly skills: readonly BundledSkill[] } {
  const copied = copyBundledPlugins(getPluginsRootDir(sandRoot), pluginsRoot);
  const skills = copied.skills.length > 0 ? copied.skills : listBundledPluginSkills(pluginsRoot);
  writePluginSkillsCache(getPluginSkillsDir(sandRoot), {
    skills: skills.map(skill => ({
      id: skill.id,
      pluginId: skill.pluginId,
      pluginName: skill.pluginName,
      name: skill.name,
      description: skill.description,
      filePath: skill.skillFile,
      pluginVersion: "1",
      installPath: skill.directory.replace(/[/\\]skills[/\\][^/\\]+$/, ""),
      skillRelativePath: `skills/${skill.id}/SKILL.md`,
      publisherUserId: null,
      marketplaceTeamId: null,
    })),
  });
  return { installed: skills.length, skills };
}
