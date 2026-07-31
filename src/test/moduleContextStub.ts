export function moduleContext<T>(stub: Record<string, unknown>): Record<string, unknown> & T {
  return stub as Record<string, unknown> & T;
}
