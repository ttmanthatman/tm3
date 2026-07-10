export function envFlagEnabled(value: string | undefined, defaultValue = true) {
  if (value === undefined || value.trim() === "") return defaultValue;
  return !new Set(["0", "false", "off", "no", "disabled"]).has(value.trim().toLowerCase());
}
