import test from "node:test";
import assert from "node:assert/strict";

import { loadModulesIn, importedModules } from "./sourceStructureQueries.js";
import { composeMongoContextBundles } from "../../infra/mongo/mongoContextBundles.js";

const LAYERS: ReadonlyArray<readonly string[]> = [
  ["app"], ["app", "health"], ["app", "runtime"], ["app", "scheduler"], ["app", "lifecycle"],
  ["features", "notifications"], ["features", "command-handlers"], ["features", "command-security"],
  ["features", "command-registry"], ["features", "guild-config"], ["features", "admin-records"],
  ["features", "moderation"], ["features", "youtube"], ["features", "player-count"],
  ["infra", "redis"], ["sources"], ["shared"]
];

const COMPOSITION_ROOT = "app/runtimeComposition.ts";

test("doar radacina de compunere atinge contextul Mongo plat", () => {
  const offenders: string[] = [];
  for (const query of LAYERS.flatMap(directory => loadModulesIn(directory, name => name.endsWith(".ts")))) {
    if (query.relativePath === COMPOSITION_ROOT) continue;
    if (importedModules(query).some(module => module.endsWith("infra/mongo/mongoContext.js"))) {
      offenders.push(query.relativePath);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "contextul plat are ~46 de exporturi: cine il importa poate lua orice, iar dependinta reala nu se vede nicaieri. " +
      `Bundle-urile din \`mongoContextBundles.ts\` sunt calea: ${offenders.join(", ")}`
  );
});

test("bundle-urile acopera tot ce lua bootstrap-ul direct din contextul plat", () => {
  const names = Object.keys(composeMongoContextBundles(stubContext()));
  for (const bundle of ["repositories", "locks", "migrations", "snapshots", "administration", "platform", "guildCache", "outboxState"]) {
    assert.ok(names.includes(bundle), `bundle-ul ${bundle} exista`);
  }
});

function stubContext(): Parameters<typeof composeMongoContextBundles>[0] {
  const proxy = new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : `stub:${String(key)}`) });
  return proxy as Parameters<typeof composeMongoContextBundles>[0];
}
