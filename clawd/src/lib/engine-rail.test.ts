import { describe, expect, it } from "vitest";

import { splitEngineRail } from "./engine-rail";

describe("splitEngineRail", () => {
  it("shows compatible HTTP model catalogs in the cloud group", () => {
    const engine = { access: "custom", driverKind: "openai-compat", instanceId: "novita" };
    expect(splitEngineRail([engine])).toEqual({ subscription: [engine], custom: [] });
  });
  it("keeps Cloud engines above Local engines", () => {
    const { subscription, custom } = splitEngineRail([
      { access: "subscription", instanceId: "claude" },
      { access: "custom", instanceId: "hermes" },
      { instanceId: "grok" },
      { access: "custom", instanceId: "qwen" },
    ]);
    expect(subscription.map((row) => row.instanceId)).toEqual(["claude", "grok"]);
    expect(custom.map((row) => row.instanceId)).toEqual(["hermes", "qwen"]);
  });

  it("hides the second group when nothing is custom-only", () => {
    const rows = [{ instanceId: "claude" }];
    expect(splitEngineRail(rows).custom).toEqual([]);
  });
});
