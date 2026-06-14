class FakeTimer {
  _onTimeout: (...args: unknown[]) => void = () => undefined;
  ref(): this { return this; }
  unref(): this { return this; }
  hasRef(): boolean { return true; }
  refresh(): this { return this; }
  close(): this { return this; }
  [Symbol.toPrimitive](): number { return 0; }
  [Symbol.dispose](): void { return undefined; }
}

export function makeFakeTimer<T extends object>(extra: T, onUnref?: () => void): NodeJS.Timeout & T {
  const timer: NodeJS.Timeout & T = Object.assign(new FakeTimer(), extra);
  if (onUnref) {
    timer.unref = function unref() { onUnref(); return timer; };
  }
  return timer;
}

export function fakeTimer(): NodeJS.Timeout {
  return new FakeTimer();
}
