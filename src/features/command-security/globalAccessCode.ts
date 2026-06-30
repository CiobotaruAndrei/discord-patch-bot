import crypto = require("crypto");

type AccessCodeEnv = {
  BOT_GLOBAL_ACCESS_CODE_HASH?: string;
  BOT_GLOBAL_ACCESS_CODE?: string;
};

type AccessCodeVerification = "valid" | "invalid" | "not-configured";

function normalizeHash(value: string | undefined): string {
  const raw = String(value || "").trim();
  return raw.startsWith("sha256:") ? raw.slice("sha256:".length).trim() : raw;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "change_me" || normalized === "replace_me";
}

function verifyGlobalAccessCode(candidate: string, env: AccessCodeEnv = process.env): AccessCodeVerification {
  const code = candidate.trim();
  if (!code) return "invalid";
  const configuredHash = normalizeHash(env.BOT_GLOBAL_ACCESS_CODE_HASH);
  if (configuredHash && !isPlaceholder(configuredHash)) {
    return timingSafeEqualText(sha256Hex(code), configuredHash) ? "valid" : "invalid";
  }
  const configuredPlain = String(env.BOT_GLOBAL_ACCESS_CODE || "").trim();
  if (configuredPlain && !isPlaceholder(configuredPlain)) {
    return timingSafeEqualText(code, configuredPlain) ? "valid" : "invalid";
  }
  return "not-configured";
}

export = {
  verifyGlobalAccessCode,
  sha256Hex
};
