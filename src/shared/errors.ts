// V11: strict superset of the old `err instanceof Error` form. Mongo / axios
// / discord.js sometimes throw plain objects with a .message field that don't
// pass `instanceof Error` (e.g. when the error crosses a worker boundary or
// gets serialized). The old form returned "[object Object]" for those — the
// new form extracts the message. Behavior for real Error instances and for
// strings / numbers / undefined is unchanged.
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
