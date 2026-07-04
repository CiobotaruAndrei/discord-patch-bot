type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface UserErrorFormattingDeps {
  logger: Logger;
}

export function createUserErrorFormatting({ logger }: UserErrorFormattingDeps) {
  function formatUserError(err: unknown, defaultMsg = "A aparut o eroare interna.", errorCode: string | null = null): string {
    const detail = err && typeof err === "object"
      ? ((err as { stack?: unknown; message?: unknown }).stack || (err as { message?: unknown }).message || err)
      : err;
    if (err) logger("WARN", "USER_COMMAND", `${defaultMsg}${errorCode ? ` [${errorCode}]` : ""}`, detail);
    const suffix = errorCode ? ` \`[${errorCode}]\`` : "";
    return `Eroare: ${defaultMsg}${suffix}`;
  }

  return { formatUserError };
}
