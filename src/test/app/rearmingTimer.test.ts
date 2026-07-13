import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRearmingTimer } from "../../app/scheduler/rearmingTimer.js";

test("schedule armeaza un tick unic dupa delayMs si il ruleaza", () => {
  const clock = mockTimers();
  try {
    let ticks = 0;
    const timer = createRearmingTimer({ isShuttingDown: () => false, delayMs: () => 1000, onTick: () => { ticks++; } });
    timer.schedule();
    assert.equal(timer.isActive(), true);
    clock.tick(999);
    assert.equal(ticks, 0);
    clock.tick(1);
    assert.equal(ticks, 1);
  } finally {
    clock.reset();
  }
});

test("schedule in timpul shutdown nu armeaza nimic", () => {
  const clock = mockTimers();
  try {
    let ticks = 0;
    const timer = createRearmingTimer({ isShuttingDown: () => true, delayMs: () => 1000, onTick: () => { ticks++; } });
    timer.schedule();
    assert.equal(timer.isActive(), false);
    clock.tick(5000);
    assert.equal(ticks, 0);
  } finally {
    clock.reset();
  }
});

test("schedule repetat curata timerul anterior (un singur tick ramane armat)", () => {
  const clock = mockTimers();
  try {
    let ticks = 0;
    const timer = createRearmingTimer({ isShuttingDown: () => false, delayMs: () => 1000, onTick: () => { ticks++; } });
    timer.schedule();
    timer.schedule();
    timer.schedule();
    clock.tick(1000);
    assert.equal(ticks, 1);
  } finally {
    clock.reset();
  }
});

test("stop anuleaza un tick pending si marcheaza inactiv", () => {
  const clock = mockTimers();
  try {
    let ticks = 0;
    const timer = createRearmingTimer({ isShuttingDown: () => false, delayMs: () => 1000, onTick: () => { ticks++; } });
    timer.schedule();
    timer.stop();
    assert.equal(timer.isActive(), false);
    clock.tick(5000);
    assert.equal(ticks, 0);
  } finally {
    clock.reset();
  }
});

test("delayMs e recalculat la fiecare schedule (jitter cron)", () => {
  const clock = mockTimers();
  try {
    const delays = [500, 1500];
    let idx = 0;
    let ticks = 0;
    const timer = createRearmingTimer({ isShuttingDown: () => false, delayMs: () => delays[idx++], onTick: () => { ticks++; } });
    timer.schedule();
    clock.tick(500);
    assert.equal(ticks, 1);
    timer.schedule();
    clock.tick(1499);
    assert.equal(ticks, 1);
    clock.tick(1);
    assert.equal(ticks, 2);
  } finally {
    clock.reset();
  }
});

function mockTimers(): { tick(ms: number): void; reset(): void } {
  mock.timers.enable({ apis: ["setTimeout"] });
  return {
    tick: (ms: number) => mock.timers.tick(ms),
    reset: () => mock.timers.reset()
  };
}
