export const BOOLEAN_ENV_PATTERN = /^(true|false|1|0)$/i;

export function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}
