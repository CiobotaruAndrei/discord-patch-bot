import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import {
  INTERACTION_INTENTS,
  SCHEDULER_ONLY_INTENTS,
  intentNamesForRole,
  roleRunsInteractions
} from "../../shared/botRole.js";

test("worker-ul nu mai cere intents pentru interactiuni pe care nu le asculta", () => {
  const worker = intentNamesForRole("worker");
  assert.deepEqual([...worker], ["Guilds"], "worker-ul doar trimite notificari; ii trebuie doar rezolvarea de canale");

  for (const intent of ["GuildMembers", "MessageContent", "GuildMessages", "GuildModeration"] as const) {
    assert.ok(
      !worker.includes(intent),
      `${intent} deserveste listeneri pe care worker-ul nu ii inregistreaza. GuildMembers si MessageContent sunt ` +
        "in plus privilegiate: cerute de un proces care nu le foloseste, primeste date pe care nu are motiv sa le vada"
    );
  }
});

test("rolurile care raspund la interactiuni isi pastreaza intreg setul", () => {
  for (const role of ["all", "web"] as const) {
    assert.deepEqual(
      [...intentNamesForRole(role)],
      [...INTERACTION_INTENTS],
      `${role} inregistreaza listenerii de interactiuni si moderare, deci are nevoie de tot setul`
    );
  }
});

test("setul de intents urmeaza aceeasi conditie ca inregistrarea listenerilor", () => {
  for (const role of ["all", "web", "worker"] as const) {
    const asteptat = roleRunsInteractions(role) ? INTERACTION_INTENTS : SCHEDULER_ONLY_INTENTS;
    assert.deepEqual(
      [...intentNamesForRole(role)],
      [...asteptat],
      "daca cele doua s-ar despartii, un rol ar cere intents fara listeneri sau ar inregistra listeneri fara intents"
    );
  }
});

test("compozitia runtime nu mai are lista de intents scrisa de mana", () => {
  const services = fs.readFileSync(
    path.join(process.cwd(), "app", "runtime", "runtimeServices.ts"),
    "utf8"
  );
  assert.match(
    services,
    /intents: intentNamesForRole\(env\.BOT_ROLE\)\.map\(name => GatewayIntentBits\[name\]\)/,
    "setul se deriva din rol; scris de mana, ar ramane in urma cand un rol capata sau pierde listeneri"
  );
  assert.ok(
    !services.includes("GatewayIntentBits.MessageContent"),
    "nicio referinta directa la un intent privilegiat in compozitie"
  );
});
