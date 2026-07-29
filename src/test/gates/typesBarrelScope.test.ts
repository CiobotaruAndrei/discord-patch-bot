import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const sursa = fs.readFileSync(path.join(process.cwd(), "types.ts"), "utf8");

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

function definitiiLocale(): string[] {
  return [...sursa.matchAll(/^export (?:type|interface) (\w+)[ <=]/gm)].map(match => match[1]);
}

test("barrel-ul de tipuri nu creste cu contracte de domeniu noi", () => {
  const straine = definitiiLocale().filter(nume => !PRIMITIVE_PERMISE.has(nume));
  assert.deepEqual(
    straine,
    [],
    "`types.ts` e importat din tot repo-ul, deci un contract definit aici leaga toate straturile de el. " +
      `Tipurile astea apartin domeniului lor si trebuie definite acolo, cu re-export daca e nevoie: ${straine.join(", ")}`
  );
});

test("contractele de paginare traiesc in domeniul lor, nu in barrel", () => {
  const domeniu = path.join(process.cwd(), "features", "command-presentation", "paginationTypes.ts");
  assert.ok(fs.existsSync(domeniu), "formele de interactiune cu butoane apartin prezentarii de comenzi");

  const text = fs.readFileSync(domeniu, "utf8");
  for (const nume of ["PaginationButtonInteraction", "ComponentCollector", "InteractionMessage"]) {
    assert.match(text, new RegExp(`export interface ${nume}`), `${nume} se defineste in domeniu`);
  }
  assert.match(
    sursa,
    /from "\.\/features\/command-presentation\/paginationTypes\.js"/,
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
