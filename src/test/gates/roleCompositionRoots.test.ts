import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls, callsWithin, functionNames, importedModules } from "./sourceStructureQueries.js";

const appRuntime = loadModule("app", "appRuntime.ts");
const gateway = loadModule("app", "runtime", "gatewayFeatureRuntimes.ts");
const schedulerTasks = loadModule("app", "runtime", "schedulerFeatureTasks.ts");

const GATEWAY_FEATURE_FACTORIES = [
  "createSecurityRuntime",
  "createReputationEngine",
  "createPermissionDelegationRuntime",
  "createServerEventLogRuntime",
  "createNewAccountAlertDelivery",
  "reconcileStuckNewAccountSends",
  "loadYaraRuleset"
];

test("feature-urile de gateway se construiesc in modulul lor, nu in asamblarea comuna", () => {
  const built = calls(appRuntime).map(call => call.callee);
  for (const factory of GATEWAY_FEATURE_FACTORIES) {
    assert.ok(
      !built.includes(factory),
      `${factory} nu se mai apeleaza din appRuntime: ar rula pentru orice rol, inclusiv pentru unul care nu primeste intent-urile necesare`
    );
  }
  const gatewayBuilt = calls(gateway).map(call => call.callee);
  for (const factory of GATEWAY_FEATURE_FACTORIES) {
    assert.ok(gatewayBuilt.includes(factory), `${factory} traieste in radacina de compunere a gateway-ului`);
  }
});

test("radacina worker nu construieste feature-uri de gateway, iar cea web nu construieste schedulere", () => {
  const worker = callsWithin(appRuntime, "createWorkerRuntime").map(call => call.callee);
  assert.ok(worker.includes("createInactiveGatewayFeatureRuntimes"), "worker-ul declara explicit ca nu are feature-uri de gateway");
  assert.ok(!worker.includes("composeGatewayFeatures"), "worker-ul nu compune feature-uri pe care nu le poate apela");
  assert.ok(worker.includes("createSchedulers"), "worker-ul construieste subgraful de schedulere");
  assert.ok(worker.includes("composeSchedulerTasks"), "worker-ul construieste task-urile de fundal");

  const web = callsWithin(appRuntime, "createWebRuntime").map(call => call.callee);
  assert.ok(web.includes("composeGatewayFeatures"), "web-ul compune feature-urile de gateway");
  assert.ok(web.includes("createIdleSchedulerFeatureTasks"), "web-ul declara explicit ca nu are task-uri de fundal");
  assert.ok(!web.includes("createSchedulers"), "web-ul nu construieste schedulere");
  assert.ok(!web.includes("composeSchedulerTasks"), "web-ul nu construieste task-uri de fundal");
});

test("runtime-ul de moderare are un singur proprietar, deci o singura instanta per proces", () => {
  const owners = functionNames(appRuntime).filter(
    name => callsWithin(appRuntime, name).some(call => call.callee === "createModerationLifecycleRuntime")
  );
  assert.deepEqual(
    owners,
    ["composeModerationLifecycle"],
    "doua apeluri ale fabricii dau doua instante independente: sanctiunea curatata de una nu se vede in cealalta"
  );
  for (const root of ["createWebRuntime", "createWorkerRuntime", "createAppRuntime"]) {
    const built = callsWithin(appRuntime, root).filter(call => call.callee === "composeModerationLifecycle");
    assert.equal(built.length, 1, `${root} construieste runtime-ul de moderare exact o data`);
  }
  const threaded = callsWithin(appRuntime, "createWorkerRuntime").find(call => call.callee === "composeSchedulerTasks");
  assert.ok(
    threaded?.args.includes("moderationLifecycleRuntime"),
    "aceeasi instanta ajunge si la task-ul de curatare, nu una construita separat"
  );
});

test("cele doua radacini de compunere nu se amesteca", () => {
  const gatewayImports = importedModules(gateway);
  for (const forbidden of ["scheduler/", "runtimeSchedulers"]) {
    assert.ok(
      !gatewayImports.some(module => module.includes(forbidden)),
      `radacina gateway nu cunoaste schedulerele (${forbidden})`
    );
  }
  const taskImports = importedModules(schedulerTasks);
  for (const forbidden of ["securityRuntime", "reputationEngine", "yaraRuleset", "newAccountAlertDedup", "serverEventLogRuntime"]) {
    assert.ok(
      !taskImports.some(module => module.includes(forbidden)),
      `radacina de task-uri nu cunoaste feature-urile de gateway (${forbidden})`
    );
  }
});
