export interface SandAgentCustomization {
  readonly displayName?: string;
  readonly persona?: string;
  readonly customInstructions?: string;
}

export const SAND_AGENT_CUSTOMIZATION_LIMITS = {
  displayName: 60,
  persona: 600,
  customInstructions: 4000,
} as const;

const TEXT_FIELDS = {
  displayName: SAND_AGENT_CUSTOMIZATION_LIMITS.displayName,
  persona: SAND_AGENT_CUSTOMIZATION_LIMITS.persona,
  customInstructions: SAND_AGENT_CUSTOMIZATION_LIMITS.customInstructions,
} as const;

type TextField = keyof typeof TEXT_FIELDS;

export function sanitizeSandAgentCustomizationText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const withoutControls = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return withoutControls.length > maxLength ? withoutControls.slice(0, maxLength) : withoutControls;
}

function isEmpty(value: SandAgentCustomization): boolean {
  return (value.displayName ?? "").trim().length === 0 && (value.persona ?? "").trim().length === 0 && (value.customInstructions ?? "").trim().length === 0;
}

export function normalizeSandAgentCustomization(value: unknown): SandAgentCustomization | undefined {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const result: { displayName?: string; persona?: string; customInstructions?: string } = {};
  for (const field of Object.keys(TEXT_FIELDS) as TextField[]) {
    const text = sanitizeSandAgentCustomizationText(raw[field], TEXT_FIELDS[field]).trim();
    if (text.length > 0) result[field] = text;
  }
  return isEmpty(result) ? undefined : result;
}

export function composeSandAgentCustomizationPromptBlock(customization: SandAgentCustomization | null | undefined): string {
  if (customization == null) return "";
  const lines: string[] = [];
  const name = customization.displayName?.trim();
  if (name != null && name.length > 0) lines.push(`The user calls you "${name}". Treat that as your name and introduce yourself with it when names matter. It overrides any other product name.`);
  const persona = customization.persona?.trim();
  if (persona != null && persona.length > 0) lines.push(`Your personality and voice, which should shape every reply: ${persona}`);
  const instructions = customization.customInstructions?.trim();
  if (instructions != null && instructions.length > 0) lines.push(`Standing instructions from the user that apply to every reply:\n${instructions}`);
  return lines.length === 0 ? "" : `\n\n${lines.join("\n\n")}`;
}
