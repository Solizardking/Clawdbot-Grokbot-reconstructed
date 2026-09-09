// Split engines into Cloud (first-party catalog + Custom) and Local
// (no catalog — inject a model). A missing `access` is Cloud so older
// payloads stay in the top group. VibeCoder would join Local later.
import type { InstanceInfo } from "@/state/store";

export function isCustomOnly(instance: { access?: InstanceInfo["access"]; driverKind?: string } | undefined): boolean {
  // Compatible HTTP engines publish their own catalog, including hosted models.
  return instance?.access === "custom" && instance.driverKind !== "openai-compat";
}

export function splitEngineRail<T>(instances: readonly T[]): {
  subscription: T[];
  custom: T[];
} {
  const subscription: T[] = [];
  const custom: T[] = [];
  for (const instance of instances) {
    if (isCustomOnly(instance as { access?: InstanceInfo["access"] })) custom.push(instance);
    else subscription.push(instance);
  }
  return { subscription, custom };
}
