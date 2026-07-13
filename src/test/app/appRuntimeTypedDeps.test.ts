import test from "node:test";
import assert from "node:assert/strict";
import type { AppRuntimeDeps } from "../../app/appRuntime.js";
import type { CreateCronControllerDeps } from "../../app/scheduler/cron.js";
import type { CreateHousekeepingDeps, HousekeepingController } from "../../app/scheduler/housekeeping.js";
import type { CreateOutboxWorkerDeps, OutboxWorker } from "../../app/scheduler/outboxWorker.js";
import type { CreateHttpServerDeps } from "../../app/health/httpServer.js";
import type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps } from "../../app/lifecycle/events.js";
import type { CreateShutdownControllerDeps, ShutdownController } from "../../app/lifecycle/shutdown.js";
import type { BotMetrics, ConfigLoadResult, CronController, RateLimiter, RuntimeEnv } from "../../types.js";

type Expect<T extends true> = T;
type NotLooseRecord<T> = Record<string, unknown> extends T ? false : true;

type _CronOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["createCronController"]>[0]>>;
type _HousekeepingOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["createHousekeeping"]>[0]>>;
type _OutboxOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["createOutboxWorker"]>[0]>>;
type _HttpOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["createHttpServer"]>[0]>>;
type _DiscordEventsOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["registerDiscordEvents"]>[0]>>;
type _MongoEventsOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["registerMongoEvents"]>[0]>>;
type _ShutdownOptsNotLoose = Expect<NotLooseRecord<Parameters<AppRuntimeDeps["createShutdownController"]>[0]>>;

type _CronOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["createCronController"]>[0] extends CreateCronControllerDeps ? true : false>;
type _HousekeepingOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["createHousekeeping"]>[0] extends CreateHousekeepingDeps ? true : false>;
type _OutboxOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["createOutboxWorker"]>[0] extends CreateOutboxWorkerDeps ? true : false>;
type _HttpOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["createHttpServer"]>[0] extends CreateHttpServerDeps ? true : false>;
type _DiscordEventsOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["registerDiscordEvents"]>[0] extends RegisterDiscordEventsDeps ? true : false>;
type _MongoEventsOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["registerMongoEvents"]>[0] extends RegisterMongoEventsDeps ? true : false>;
type _ShutdownOptsAreRealDeps = Expect<Parameters<AppRuntimeDeps["createShutdownController"]>[0] extends CreateShutdownControllerDeps ? true : false>;

type _CronReturnsController = Expect<ReturnType<AppRuntimeDeps["createCronController"]> extends CronController ? true : false>;
type _HousekeepingReturnsController = Expect<ReturnType<AppRuntimeDeps["createHousekeeping"]> extends HousekeepingController ? true : false>;
type _OutboxReturnsWorker = Expect<ReturnType<AppRuntimeDeps["createOutboxWorker"]> extends OutboxWorker ? true : false>;
type _ShutdownReturnsController = Expect<ReturnType<AppRuntimeDeps["createShutdownController"]> extends ShutdownController ? true : false>;
type _MetricsReturnIsBotMetrics = Expect<ReturnType<AppRuntimeDeps["createMetrics"]> extends BotMetrics ? true : false>;
type _RateLimiterReturnIsTyped = Expect<ReturnType<AppRuntimeDeps["createRateLimiter"]> extends RateLimiter ? true : false>;
type _LoadConfigReturnIsTyped = Expect<ReturnType<AppRuntimeDeps["loadConfig"]> extends ConfigLoadResult ? true : false>;
type _MongoEnvIsRuntimeEnv = Expect<AppRuntimeDeps["mongo"]["env"] extends RuntimeEnv ? true : false>;

test("AppRuntimeDeps: factory-urile centrale au contracte din tipurile reale, nu Record<string, unknown>", () => {
  assert.ok(true,
    "aserțiunile sunt compile-time: tsc pica daca vreun factory din boot wiring regreseaza la Record<string, unknown> sau isi pierde tipul de retur");
});
