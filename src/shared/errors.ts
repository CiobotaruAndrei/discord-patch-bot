function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return String(err);
}

function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  if (err && typeof err === "object") {
    const candidate = err as { stack?: unknown; message?: unknown };
    if (typeof candidate.stack === "string") return candidate.stack;
    if ("message" in candidate) return String(candidate.message);
  }
  return String(err);
}

export { errorMessage, errorDetail };
