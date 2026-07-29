import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import { MONGO_PORT_NAMES } from "../../infra/mongo/mongoPorts.js";
import type {
  AuditStore,
  GuildConfigStore,
  NotificationStore,
  OperationStore,
  SecurityStore
} from "../../infra/mongo/mongoPorts.js";
import type { MongoContextExports } from "../../infra/mongo/mongoContext.js";

type IsStrictSubset<Port> = keyof Port extends keyof MongoContextExports
  ? keyof MongoContextExports extends keyof Port ? false : true
  : false;

const guildConfigIsSubset: IsStrictSubset<GuildConfigStore> extends true ? true : never = true;
const notificationIsSubset: IsStrictSubset<NotificationStore> extends true ? true : never = true;
const securityIsSubset: IsStrictSubset<SecurityStore> extends true ? true : never = true;
const auditIsSubset: IsStrictSubset<AuditStore> extends true ? true : never = true;
const operationIsSubset: IsStrictSubset<OperationStore> extends true ? true : never = true;

test("fiecare port e un subset strict al contextului, verificat de compilator", () => {
  for (const [nume, verificat] of [
    ["GuildConfigStore", guildConfigIsSubset],
    ["NotificationStore", notificationIsSubset],
    ["SecurityStore", securityIsSubset],
    ["AuditStore", auditIsSubset],
    ["OperationStore", operationIsSubset]
  ] as const) {
    assert.equal(verificat, true, `${nume} trebuie sa fie mai ingust decat contextul, altfel nu schimba nimic`);
  }
});

test("porturile sunt derivate din context, nu redeclarate paralel", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "infra", "mongo", "mongoPorts.ts"), "utf8");
  assert.match(
    text,
    /type Port<K extends keyof MongoContextExports> = Pick<MongoContextExports, K>;/,
    "porturile se taie din context cu `Pick`, deci o cheie redenumita in context rupe portul la compilare. " +
      "Redeclarate de mana, ar deveni o a doua sursa de adevar care poate devia tacut"
  );
  assert.ok(
    !text.includes("Model:") && !text.includes("interface "),
    "porturile nu isi descriu propriile forme; ele doar selecteaza din contract-ul existent"
  );
});

test("lista de porturi si tipurile exportate raman aliniate", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "infra", "mongo", "mongoPorts.ts"), "utf8");
  for (const nume of MONGO_PORT_NAMES) {
    assert.ok(text.includes(`export type ${nume} =`), `${nume} e listat dar nu exportat ca tip`);
  }
  const exportate = [...text.matchAll(/^export type (\w+Store) =/gm)].map(match => match[1]).sort();
  assert.deepEqual(
    exportate,
    [...MONGO_PORT_NAMES].sort(),
    "un port nou trebuie adaugat si in lista, ca gate-urile si documentatia sa il vada"
  );
});
