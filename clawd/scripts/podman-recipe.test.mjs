import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipe = path.join(root, "deploy", "podman");

function readRecipe(name) {
  return fs.readFileSync(path.join(recipe, name), "utf8");
}

describe("rootless Podman recipe", () => {
  it("ships clawd.ps1 as the Windows entry point and not maus.ps1", () => {
    expect(fs.existsSync(path.join(recipe, "clawd.ps1"))).toBe(true);
    expect(fs.existsSync(path.join(recipe, "maus.ps1"))).toBe(false);
  });

  it("names clawd.ps1 and a Clawd default machine in wrapper usage", () => {
    const wrapper = readRecipe("clawd.ps1");
    expect(wrapper).toMatch(/Usage:.*clawd\.ps1/);
    expect(wrapper).toMatch(/Example:.*clawd\.ps1/);
    expect(wrapper).not.toMatch(/maus\.ps1/);
    const defaultMachine = wrapper.match(/OMB_PODMAN_MACHINE \(default ([^)]+)\)/)?.[1];
    expect(defaultMachine).toBeTruthy();
    expect(defaultMachine).not.toBe("openmausbot");
    expect(wrapper).toContain(`else { '${defaultMachine}' }`);
    expect(wrapper).not.toMatch(/default openmausbot/);
    expect(wrapper).not.toMatch(/else \{ 'openmausbot' \}/);
  });

  it("documents clawd.ps1 in README Windows and exec samples", () => {
    const readme = readRecipe("README.md");
    expect(readme).toMatch(/\.\\deploy\\podman\\clawd\.ps1 setup/);
    expect(readme).toMatch(/\.\\deploy\\podman\\clawd\.ps1 up -d --build/);
    expect(readme).toMatch(/clawd\.ps1 exec omb /);
    expect(readme).not.toMatch(/maus\.ps1/);
    expect(readme).toMatch(/`omb` service/);
    expect(readme).toMatch(/OMB_/);
  });

  it("does not create a maus image user; keep-id uid 1001 stays", () => {
    const containerfile = readRecipe("Containerfile");
    expect(containerfile).not.toMatch(/useradd[^\n]*\bmaus\b/);
    expect(containerfile).not.toMatch(/^USER maus$/m);
    expect(containerfile).not.toMatch(/chown=maus:/);
    expect(containerfile).toMatch(/useradd --uid 1001 /);
    expect(containerfile).toMatch(/USER clawd/);
    expect(containerfile).toMatch(/OMB_DATA_DIR=\/data\/\.clawdbot/);
  });

  it("keeps host-network keep-id topology with a Clawd data dir", () => {
    const compose = readRecipe("compose.yaml");
    expect(compose).toMatch(/^\s+OMB_DATA_DIR: \$\{OMB_DATA_ROOT\}\/\.clawdbot$/m);
    expect(compose).not.toMatch(/\.openmausbot/);
    expect(compose.match(/network_mode:\s*host/g)?.length).toBeGreaterThanOrEqual(2);
    expect(compose).toMatch(/userns_mode:\s*keep-id:uid=1001,gid=1001/);
    expect(compose).toMatch(/app!=='clawdbot'/);
    const dataVolume = compose.match(/- \$\{OMB_DATA_ROOT:[^}]+\}:\$\{OMB_DATA_ROOT\}(?::\S+)?/);
    expect(dataVolume?.[0]).toBeTruthy();
    expect(dataVolume[0]).not.toMatch(/:U\b/);
    expect(compose).toMatch(/^\s+omb:/m);
  });

  it("generates a Linux Clawd data root and socket, and skips an existing .env", () => {
    const setup = readRecipe("setup.sh");
    expect(setup).toMatch(/if \[ ! -f \.env \]; then/);
    expect(setup).toMatch(/data_root="\$HOME\/clawd-bot\/data"/);
    expect(setup).toMatch(/PODMAN_SOCKET=\/run\/user\/\$\(id -u\)\/podman\/podman\.sock/);
    expect(setup).not.toMatch(/openmausbot\/data/);
    expect(setup).not.toMatch(/[A-Za-z]:\\/);
    const envWrite = setup.slice(setup.indexOf("if [ ! -f .env ]; then"));
    expect(envWrite).toContain("cat > .env <<EOF");
    expect(envWrite.indexOf("cat > .env <<EOF")).toBeLessThan(envWrite.indexOf("\nfi"));

    const example = readRecipe(".env.example");
    expect(example).toMatch(/^OMB_DATA_ROOT=\/home\/[^/\s]+\/clawd-bot\/data$/m);
    expect(example).not.toMatch(/openmausbot/);
    expect(example).not.toMatch(/^[A-Za-z]:\\/m);
    expect(example).toMatch(/^PODMAN_SOCKET=\/run\/user\/\d+\/podman\/podman\.sock$/m);
    expect(example).not.toMatch(/COMPOSIO_API_KEY=ak_/);
  });
});
