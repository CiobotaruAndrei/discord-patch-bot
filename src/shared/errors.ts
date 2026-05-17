function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? (err.stack || err.message) : String(err);
}

export { errorMessage, errorDetail };
