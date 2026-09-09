/** Read old exports without emitting their branding in new Clawd packages. */
export function normalizeLegacyFormat(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const formats: Record<string, string> = {
    'openmaus.package': 'clawd.package',
    'openmaus.team': 'clawd.team',
    'openmaus.catalog': 'clawd.catalog',
  };
  if(typeof record.format !== 'string' || !Object.hasOwn(formats,record.format)) return value;
  return {...record,format:formats[record.format]};
}
