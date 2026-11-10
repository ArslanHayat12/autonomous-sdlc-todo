/** Shared helpers for nested JSON config files at repo root. */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Shallow-merge nested groups into one flat map (child keys win over parent). */
export function flattenNestedGroups(
  parsed: Record<string, unknown>,
  groupKeys: string[],
  skipTopLevel = new Set(['meta', '$schema', 'version', 'description']),
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(parsed)) {
    if (skipTopLevel.has(key)) continue;
    if (groupKeys.includes(key) && isPlainObject(val)) {
      Object.assign(flat, val);
    } else if (!groupKeys.includes(key)) {
      flat[key] = val;
    }
  }

  return { ...flat, ...pickLegacyTopLevel(parsed, groupKeys, skipTopLevel) };
}

function pickLegacyTopLevel(
  parsed: Record<string, unknown>,
  groupKeys: string[],
  skipTopLevel: Set<string>,
): Record<string, unknown> {
  const legacy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (skipTopLevel.has(key) || groupKeys.includes(key)) continue;
    legacy[key] = val;
  }
  return legacy;
}
