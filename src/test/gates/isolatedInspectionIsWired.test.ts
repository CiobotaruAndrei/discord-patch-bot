import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, importedModules } from "./sourceStructureQueries.js";

const MODULE = "isolatedInspection.js";

test("inspectia trece prin decizia de izolare, nu direct pe addon-ul in-proces", () => {
  const entry = loadModule("features", "command-security", "passiveArchiveInspection.ts");
  assert.ok(
    importedModules(entry).some(module => module.endsWith(MODULE)),
    "fara importul asta, procesul cu filtru de syscall redevine cod mort: exista, dar nu il apeleaza nimeni"
  );
});

test("procesele izolate primesc metrici si sunt oprite la shutdown", () => {
  const services = loadModule("app", "runtime", "runtimeServices.ts");
  const runtime = loadModule("app", "appRuntime.ts");
  assert.ok(
    importedModules(services).some(module => module.endsWith(MODULE)),
    "fara atasarea recorderului, kill-urile si timeout-urile procesului nu ajung niciodata la /metrics"
  );
  assert.ok(
    importedModules(runtime).some(module => module.endsWith(MODULE)),
    "fara oprire la shutdown, procesele copil raman in viata si tin nodul deschis dupa semnal"
  );
});

test("decizia de rutare sta intr-un modul fara efecte, separat de pool", () => {
  const routing = loadModule("features", "command-security", "nativeInspectorRouting.ts");
  const forbidden = importedModules(routing).filter(module => module.endsWith("nativeInspectorProcess.js") || module.endsWith(MODULE));
  assert.deepEqual(
    forbidden,
    [],
    "regula de rutare trebuie sa ramana testabila fara sa porneasca procese: " + forbidden.join(", ")
  );
});
