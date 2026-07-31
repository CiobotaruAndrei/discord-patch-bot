import test from "node:test";
import assert from "node:assert/strict";

import { createPlayerCountWatchRepository } from "../../features/player-count/playerCountWatchRepository.js";
import type { PlayerCountWatchRecord } from "../../features/player-count/playerCountWatchRepository.js";

interface Written {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options?: Record<string, unknown>;
}

function collection(records: PlayerCountWatchRecord[], writes: Written[] = []) {
  return {
    find(filter: Record<string, unknown>) {
      const ids = (filter.guildId as { $in?: string[] } | undefined)?.$in ?? [];
      return {
        lean: async () => records.filter(record => ids.includes(record.guildId) && record.gameKey === filter.gameKey)
      };
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) {
      writes.push({ filter, update, options });
      const existing = records.find(record => record.guildId === filter.guildId && record.gameKey === filter.gameKey);
      if (update.$setOnInsert) {
        if (existing) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
        records.push(update.$setOnInsert as PlayerCountWatchRecord);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      const stale = !existing
        || existing.playerCount !== filter.playerCount
        || existing.fetchedAt.getTime() !== (filter.fetchedAt as Date).getTime();
      if (stale) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

const AT = new Date("2026-07-31T10:00:00.000Z");

test("prima observatie creeaza documentul de urmarire, a doua nu il rescrie", async () => {
  const records: PlayerCountWatchRecord[] = [];
  const repository = createPlayerCountWatchRepository(collection(records));

  const first = await repository.startWatching({ guildId: "g1", gameKey: "cs2", appId: "10", playerCount: 1000, fetchedAt: AT });
  const second = await repository.startWatching({ guildId: "g1", gameKey: "cs2", appId: "10", playerCount: 5000, fetchedAt: AT });

  assert.equal(first, true, "prima scriere chiar creeaza baseline-ul");
  assert.equal(second, false, "a doua nu mai creeaza nimic: indexul unic (guildId, gameKey) tine locul garzii $ne de dinainte");
  assert.equal(records.length, 1);
  assert.equal(records[0].playerCount, 1000, "baseline-ul ramane cel dintai, nu e suprascris de a doua incercare");
});

test("revendicarea unei tranzitii reuseste o singura data pentru aceeasi valoare anterioara", async () => {
  const records: PlayerCountWatchRecord[] = [{ guildId: "g1", gameKey: "cs2", appId: "10", playerCount: 1000, fetchedAt: AT }];
  const repository = createPlayerCountWatchRepository(collection(records));
  const later = new Date(AT.getTime() + 60_000);

  const first = await repository.claimObservation("g1", "cs2", { playerCount: 1000, fetchedAt: AT }, {
    playerCount: 1500, fetchedAt: later, appId: "10", notifiedDirection: "up"
  });
  const second = await repository.claimObservation("g1", "cs2", { playerCount: 1000, fetchedAt: AT }, {
    playerCount: 1500, fetchedAt: later, appId: "10", notifiedDirection: "up"
  });

  assert.equal(first, true);
  assert.equal(second, false, "a doua instanta vede deja valoarea noua, deci nu mai poate revendica aceeasi tranzitie");
  assert.equal(records[0].playerCount, 1500);
  assert.equal(records[0].lastDirection, "up");
});

test("o observatie fara notificare nu atinge cooldown-ul", async () => {
  const records: PlayerCountWatchRecord[] = [{
    guildId: "g1", gameKey: "cs2", appId: "10", playerCount: 1000, fetchedAt: AT, lastNotifiedAt: AT, lastDirection: "up"
  }];
  const writes: Written[] = [];
  const repository = createPlayerCountWatchRepository(collection(records, writes));

  await repository.claimObservation("g1", "cs2", { playerCount: 1000, fetchedAt: AT }, {
    playerCount: 1010, fetchedAt: new Date(AT.getTime() + 60_000), appId: "10", notifiedDirection: null
  });

  const set = writes[0].update.$set as Record<string, unknown>;
  assert.equal("lastNotifiedAt" in set, false, "fara alerta, momentul ultimei notificari ramane neatins");
  assert.equal(records[0].lastNotifiedAt?.getTime(), AT.getTime());
});

test("citirea aduce doar guild-urile cerute, pentru jocul cerut", async () => {
  const records: PlayerCountWatchRecord[] = [
    { guildId: "g1", gameKey: "cs2", appId: "10", playerCount: 1, fetchedAt: AT },
    { guildId: "g2", gameKey: "cs2", appId: "10", playerCount: 2, fetchedAt: AT },
    { guildId: "g1", gameKey: "dota", appId: "20", playerCount: 3, fetchedAt: AT }
  ];
  const repository = createPlayerCountWatchRepository(collection(records));

  const found = await repository.listForGuilds(["g1"], "cs2");

  assert.deepEqual([...found.keys()], ["g1"]);
  assert.equal(found.get("g1")?.playerCount, 1);
});
