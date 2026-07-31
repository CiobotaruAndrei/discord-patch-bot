import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, exportedTypeNames, reExports, membersOf } from "./sourceStructureQueries.js";

const PRIMITIVE_PERMISE = new Set([
  "CurrencyCode",
  "BotRole",
  "DiscordReplyPayload",
  "AbortPredicate",
  "MaybePromise",
  "PriceValue",
  "CurrencyPlacement",
  "LogLevel",
  "LoggerFunction",
  "ParseEnvNumber",
  "ParseEnvNumberLimits",
  "LockToken",
  "ActiveLocks",
  "MongoWriteOutcome",
  "CurrencyConfig",
  "CurrencyRegistry",
  "LifecycleState",
  "ConcurrentRunResult",
  "SystemTimes"
]);

const barrel = loadModule("types.ts");

test("barrel-ul de tipuri nu creste cu contracte de domeniu noi", () => {
  const straine = exportedTypeNames(barrel).filter(nume => !PRIMITIVE_PERMISE.has(nume));
  assert.deepEqual(
    straine,
    [],
    "`types.ts` e importat din tot repo-ul, deci un contract definit aici leaga toate straturile de el. " +
      `Tipurile astea apartin domeniului lor si trebuie definite acolo, cu re-export daca e nevoie: ${straine.join(", ")}`
  );
});

test("contractele de paginare traiesc in domeniul lor, nu in barrel", () => {
  const domeniu = loadModule("features", "command-presentation", "paginationTypes.ts");
  const declarate = exportedTypeNames(domeniu);
  for (const nume of ["PaginationButtonInteraction", "ComponentCollector", "InteractionMessage"]) {
    assert.ok(declarate.includes(nume), `${nume} se defineste in domeniu`);
    assert.ok(membersOf(domeniu, nume).length > 0, `${nume} chiar are o forma, nu doar un nume`);
  }
  assert.ok(
    reExports(barrel).some(entry => entry.module.endsWith("command-presentation/paginationTypes.js")),
    "barrel-ul doar re-exporta, ca importurile existente sa continue sa functioneze"
  );
});

test("lista de primitive permise nu contine forme cu comportament", () => {
  for (const nume of PRIMITIVE_PERMISE) {
    assert.ok(
      !/Interaction$|Handler$|Service$|Repository$|Store$/.test(nume),
      `${nume} arata a contract de domeniu, nu a primitiva comuna; nu are ce cauta in lista permisa`
    );
  }
});
