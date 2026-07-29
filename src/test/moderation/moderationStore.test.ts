import test from "node:test";
import assert from "node:assert/strict";

import { createModerationStore, MODERATION_FIELDS } from "../../features/moderation/moderationStore.js";
import { getModerationState, saveTimeout } from "../../features/moderation/moderationRepository.js";

type Doc = Record<string, unknown>;

function spion(seed: Record<string, Doc> = {}) {
  const store: Record<string, Doc> = { ...seed };
  const scrieri: Array<{ filter: Doc; update: unknown; options?: Doc }> = [];
  return {
    store,
    scrieri,
    model: {
      async findOne(filter: Doc): Promise<Doc | null> {
        const doc = store[String(filter._id)];
        return doc ? { ...doc } : null;
      },
      async findOneAndUpdate(filter: Doc, update: Doc, options?: Doc): Promise<Doc | null> {
        scrieri.push({ filter, update, options });
        return store[String(filter._id)] ?? null;
      },
      async updateOne(filter: Doc, update: Doc, options?: Doc) {
        scrieri.push({ filter, update, options });
        const id = String(filter._id);
        const doc = store[id] ?? (options?.upsert === true ? (store[id] = { _id: id }) : null);
        if (doc && update.$set) Object.assign(doc, update.$set);
        return {};
      },
      async updateMany(filter: Doc, update: Doc) {
        scrieri.push({ filter, update });
        return {};
      }
    }
  };
}

test("o scriere de moderare e trimisa catre ambele colectii cat timp migrarea e in curs", async () => {
  const guild = spion({ g1: { _id: "g1" } });
  const dedicat = spion();
  const store = createModerationStore(guild.model, dedicat.model);

  await saveTimeout(store, "g1", {
    userId: "u1",
    username: "U1",
    moderatorId: "m1",
    appliedAt: new Date("2030-01-01")
  });

  assert.equal(guild.scrieri.length, 1, "documentul vechi ramane scris, ca o revenire la versiunea anterioara sa nu piarda date");
  assert.equal(dedicat.scrieri.length, 1, "colectia noua primeste aceeasi scriere; altfel citirile de dupa migrare ar gasi gol");
  assert.deepEqual(
    dedicat.scrieri[0].update,
    guild.scrieri[0].update,
    "se trimite exact acelasi update, inclusiv pipeline-ul de agregare; o rescriere a lui ar putea devia semantica"
  );
  assert.equal(dedicat.scrieri[0].options?.upsert, true, "colectia noua nu are inca documentul, deci scrierea trebuie sa il creeze");
});

test("o scriere care nu atinge moderarea nu ajunge in colectia noua", async () => {
  const guild = spion({ g2: { _id: "g2" } });
  const dedicat = spion();
  const store = createModerationStore(guild.model, dedicat.model);

  await store.updateOne({ _id: "g2" }, { $set: { notificationChannelId: "c1" } });

  assert.equal(dedicat.scrieri.length, 0, "colectia de moderare primeste doar campurile domeniului ei");
  assert.equal(guild.scrieri.length, 1);
});

test("citirea cade pe documentul vechi si il copiaza o singura data", async () => {
  const guild = spion({
    g3: {
      _id: "g3",
      moderationWarnings: [{ userId: "u9", username: "U9", moderatorId: "m0", warnedAt: new Date() }],
      moderationWarnBanLimit: 3
    }
  });
  const dedicat = spion();
  const copiate: string[] = [];
  const store = createModerationStore(guild.model, dedicat.model, guildId => copiate.push(guildId));

  const prima = await getModerationState(store, "g3");
  assert.equal(prima.moderationWarnings?.length, 1, "datele dinainte de migrare raman vizibile");
  assert.deepEqual(copiate, ["g3"], "prima citire copiaza feliile de moderare in colectia noua");
  assert.equal(dedicat.store.g3.moderationWarnBanLimit, 3, "se copiaza toate campurile domeniului, nu doar vectorii");

  await getModerationState(store, "g3");
  assert.deepEqual(copiate, ["g3"], "a doua citire vine din colectia noua, fara sa recopieze");
});

test("copierea nu porneste pentru un guild fara date de moderare", async () => {
  const guild = spion({ g5: { _id: "g5", notificationChannelId: "c9" } });
  const dedicat = spion();
  const copiate: string[] = [];
  const store = createModerationStore(guild.model, dedicat.model, guildId => copiate.push(guildId));

  await getModerationState(store, "g5");
  assert.deepEqual(copiate, [], "un document fara campuri de moderare nu are ce copia, deci nu se scrie degeaba");
});

test("lista de campuri mutate e explicita, ca sa nu ramana vreunul in urma", () => {
  assert.deepEqual(
    [...MODERATION_FIELDS],
    ["moderationTimeouts", "moderationMutes", "moderationWarnings", "moderationWarnBanLimit"],
    "un camp de moderare adaugat pe documentul Guild trebuie trecut si aici, altfel scapa din migrare"
  );
});

test("un document gol creat de o curatare nu blocheaza copierea datelor vechi", async () => {
  const guild = spion({
    g6: { _id: "g6", moderationWarnBanLimit: 5 }
  });
  const dedicat = spion({ g6: { _id: "g6" } });
  const copiate: string[] = [];
  const store = createModerationStore(guild.model, dedicat.model, guildId => copiate.push(guildId));

  const stare = await getModerationState(store, "g6");

  assert.equal(
    stare.moderationWarnBanLimit,
    5,
    "curatarea scrie cu upsert si poate crea un document gol in colectia noua inainte de prima citire; " +
      "daca ala ar fi luat drept migrat, setarile vechi ar disparea tacut"
  );
  assert.deepEqual(copiate, ["g6"], "documentul gol trebuie completat, nu ocolit");
});
