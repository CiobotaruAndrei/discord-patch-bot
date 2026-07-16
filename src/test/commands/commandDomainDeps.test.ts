import test from "node:test";
import assert from "node:assert/strict";
import type {
  CommandDomain,
  CommandDomainDeps,
  DomainBundlesAreServiceSlices,
  DomainBundlesAreStrictSlices,
  GameInfoCommandDeps,
  AdminCommandDeps,
  NotificationCommandDeps
} from "../../features/command-registry/commandDomainDeps.js";
import type { CommandAppServices } from "../../features/command-registry/commandRegistry.js";

const everyDomainBundleIsAServiceSlice: DomainBundlesAreServiceSlices = {
  "game-info": true, admin: true, notifications: true, configuration: true, core: true, youtube: true, routing: true
};

const everyDomainBundleIsStrictlySmaller: DomainBundlesAreStrictSlices = {
  "game-info": true, admin: true, notifications: true, configuration: true, core: true, youtube: true, routing: true
};

type DomainKeysAreClosed = [CommandDomain] extends ["game-info" | "admin" | "notifications" | "configuration" | "core" | "youtube" | "routing"]
  ? (["game-info" | "admin" | "notifications" | "configuration" | "core" | "youtube" | "routing"] extends [CommandDomain] ? true : never)
  : never;
const domainKeysAreClosed: DomainKeysAreClosed = true;

type GameInfoHasNoAdminOnlyModel = "GuildAuditLogModel" extends keyof GameInfoCommandDeps ? never : true;
const gameInfoHasNoAdminOnlyModel: GameInfoHasNoAdminOnlyModel = true;

type NamedBundlesResolveToObjects = [GameInfoCommandDeps, AdminCommandDeps, NotificationCommandDeps] extends [object, object, object] ? true : never;
const namedBundlesResolveToObjects: NamedBundlesResolveToObjects = true;

type EachDomainMapsToADepBundle = { [K in CommandDomain]: CommandDomainDeps[K] extends object ? true : never };
const eachDomainMapsToADepBundle: EachDomainMapsToADepBundle = {
  "game-info": true, admin: true, notifications: true, configuration: true, core: true, youtube: true, routing: true
};

test("contract compile-time: fiecare domeniu de comenzi are un bundle DI numit, o felie reala din god-object, strict mai mica (review nou, Mare #2)", () => {
  assert.deepEqual(Object.values(everyDomainBundleIsAServiceSlice), [true, true, true, true, true, true, true], "fiecare bundle de domeniu e satisfacut de CommandAppServices (handlerele domeniului se pot construi din god-object)");
  assert.deepEqual(Object.values(everyDomainBundleIsStrictlySmaller), [true, true, true, true, true, true, true], "fiecare bundle de domeniu e STRICT mai mic decat CommandAppServices - niciun domeniu nu are nevoie de tot god-object-ul (DI per feature, nu context plat)");
  assert.equal(domainKeysAreClosed, true, "multimea domeniilor de comenzi e inchisa (un domeniu nou fara bundle nu compileaza)");
  assert.equal(gameInfoHasNoAdminOnlyModel, true, "GameInfoCommandDeps nu include modele admin-only (ex. GuildAuditLogModel) - bariera de domeniu reala");
  assert.equal(namedBundlesResolveToObjects, true, "bundle-urile numite cerute de review (GameInfoCommandDeps/AdminCommandDeps/NotificationCommandDeps) sunt tipuri de obiect reale");
  assert.deepEqual(Object.values(eachDomainMapsToADepBundle), [true, true, true, true, true, true, true]);
});

const bundlesCoverServices: [CommandAppServices] extends [Record<string, never>] ? never : true = true;
test("CommandAppServices ramane super-tipul din care se deriva bundle-urile de domeniu", () => {
  assert.equal(bundlesCoverServices, true);
});
