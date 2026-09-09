import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, isAbsolute, dirname, basename, join } from "node:path";
import { expect, test } from "vitest";
import { DATA_DIR } from "../config.ts";

test("server and companion tests are confined to a temporary directory", () => {
  const root = realpathSync(tmpdir());
  for (const directory of [DATA_DIR, process.env.OMB_COMPANION_DIR!]) {
    expect(directory).toBeTruthy();
    const canonical = join(realpathSync(dirname(directory)), basename(directory));
    const path = relative(root, canonical);
    expect(isAbsolute(path)).toBe(false);
    expect(path.startsWith("..")).toBe(false);
    expect(path).toMatch(/^omb-test-home-/);
  }
});
