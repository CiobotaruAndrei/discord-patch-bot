import type { SourceFetchOutcome } from "./sourceTypes";

const RATE_LIMIT_PATTERN = /\b429\b|rate.?limit|too many requests/i;
const PERMANENT_PATTERN = /tip necunoscut/i;

export function classifySourceError(message: string): Exclude<SourceFetchOutcome, "ok" | "schema-drift"> {
  if (RATE_LIMIT_PATTERN.test(message)) return "rate-limited";
  if (PERMANENT_PATTERN.test(message)) return "permanent-error";
  return "transient-error";
}
