import test from "node:test";
import assert from "node:assert/strict";

import {
  recordChannelLockDivergence,
  listChannelLockRecoveries,
  countChannelLockRecoveries,
  type ChannelLockRecoveryRecord
} from "../../features/command-security/channelLockRecoveryRepository.js";
import {
  createChannelLockRecoveryRuntime,
  readLockedChannelPermissionState,
  type RecoveryChannel
} from "../../features/command-security/channelLockRecoveryRuntime.js";
import type { LockedChannelPermissionState } from "../../features/guild-config/guildConfigRepository.js";

function memoryRecoveryModel() {
  const rows = new Map<string, ChannelLockRecoveryRecord>();
  return {
    rows,
    model: {
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const id = String(filter._id);
        const set = (update.$set ?? {}) as Partial<ChannelLockRecoveryRecord>;
        const setOnInsert = (update.$setOnInsert ?? {}) as Partial<ChannelLockRecoveryRecord>;
        const increment = (update.$inc ?? {}) as { attempts?: number };
        const existing = rows.get(id);
        if (!existing) {
          rows.set(id, { _id: id, ...setOnInsert, ...set } as ChannelLockRecoveryRecord);
          return { upsertedCount: 1 };
        }
        Object.assign(existing, set);
        if (increment.attempts) existing.attempts = (existing.attempts ?? 0) + increment.attempts;
        return { modifiedCount: 1 };
      },
      find: () => ({
        sort: () => ({ limit: (count: number) => ({ lean: async () => [...rows.values()].slice(0, count) }) })
      }),
      deleteOne: async (filter: Record<string, unknown>) => {
        const existed = rows.delete(String(filter._id));
        return { deletedCount: existed ? 1 : 0 };
      },
      countDocuments: async (filter: Record<string, unknown>) => {
        let total = 0;
        for (const row of rows.values()) if (row.guildId === filter.guildId) total++;
        return total;
      }
    }
  };
}

function makeChannel(state: LockedChannelPermissionState, options: { editFails?: boolean; ignoreEdit?: boolean } = {}): RecoveryChannel & { state: LockedChannelPermissionState; edits: number } {
  const channel = {
    id: "chan-1",
    state,
    edits: 0,
    guild: { roles: { everyone: { id: "everyone-1" } } },
    permissionOverwrites: {
      cache: {
        get: () => ({
          allow: { has: () => channel.state === "allow" },
          deny: { has: () => channel.state === "deny" }
        })
      },
      edit: async (_target: object, permissions: { SendMessages: boolean | null }) => {
        channel.edits++;
        if (options.editFails) throw new Error("Discord 503");
        if (options.ignoreEdit) return undefined;
        channel.state = permissions.SendMessages === true ? "allow" : permissions.SendMessages === false ? "deny" : "inherit";
        return undefined;
      }
    }
  };
  return channel;
}

function runtimeFor(memory: ReturnType<typeof memoryRecoveryModel>, channel: RecoveryChannel | null, persist: (guildId: string, channelId: string, previous: LockedChannelPermissionState, locked: boolean) => Promise<unknown>) {
  return createChannelLockRecoveryRuntime({
    RecoveryModel: memory.model,
    fetchChannel: async () => channel,
    persistState: persist,
    logger: () => undefined
  });
}

test("lock esuat: divergenta inregistrata e restaurata automat de worker si inchisa doar dupa convergenta (audit 154c #3)", async () => {
  const memory = memoryRecoveryModel();
  assert.equal(
    await recordChannelLockDivergence(memory.model, {
      guildId: "guild-1",
      channelId: "chan-1",
      command: "lock-channel",
      previousState: "inherit",
      divergedState: "deny",
      desiredState: "inherit",
      desiredLocked: false
    }),
    true
  );
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 1, "divergenta e vizibila operational");

  const channel = makeChannel("deny");
  const persisted: Array<{ locked: boolean; previous: LockedChannelPermissionState }> = [];
  const runtime = runtimeFor(memory, channel, async (_g, _c, previous, locked) => { persisted.push({ locked, previous }); });

  const totals = await runtime.runRecoveryCycle();
  assert.equal(totals.converged, 1);
  assert.equal(channel.state, "inherit", "permisiunea Discord e restaurata exact la starea anterioara");
  assert.deepEqual(persisted, [{ locked: false, previous: "inherit" }], "persistenta reflecta faptul ca blocarea nu a ramas in picioare");
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 0, "inregistrarea se inchide dupa convergenta");
});

test("unlock esuat: recovery-ul readuce canalul la deny si pastreaza canalul marcat blocat", async () => {
  const memory = memoryRecoveryModel();
  await recordChannelLockDivergence(memory.model, {
    guildId: "guild-1",
    channelId: "chan-1",
    command: "unlock-channel",
    previousState: "inherit",
    divergedState: "inherit",
    desiredState: "deny",
    desiredLocked: true
  });
  const channel = makeChannel("inherit");
  const persisted: Array<{ locked: boolean }> = [];
  const runtime = runtimeFor(memory, channel, async (_g, _c, _previous, locked) => { persisted.push({ locked }); });

  const totals = await runtime.runRecoveryCycle();
  assert.equal(totals.converged, 1);
  assert.equal(channel.state, "deny");
  assert.deepEqual(persisted, [{ locked: true }]);
});

test("o schimbare legitima facuta intre timp NU este suprascrisa: recovery-ul inchide inregistrarea ca depasita", async () => {
  const memory = memoryRecoveryModel();
  await recordChannelLockDivergence(memory.model, {
    guildId: "guild-1",
    channelId: "chan-1",
    command: "lock-channel",
    previousState: "inherit",
    divergedState: "deny",
    desiredState: "inherit",
    desiredLocked: false
  });
  const channel = makeChannel("allow");
  let persistCalls = 0;
  const runtime = runtimeFor(memory, channel, async () => { persistCalls++; });

  const totals = await runtime.runRecoveryCycle();
  assert.equal(totals.superseded, 1);
  assert.equal(channel.edits, 0, "nu se scrie nimic peste schimbarea legitima");
  assert.equal(persistCalls, 0);
  assert.equal(channel.state, "allow");
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 0);
});

test("un esec Discord la restaurare pastreaza inregistrarea si o reincearca la ciclul urmator (idempotent)", async () => {
  const memory = memoryRecoveryModel();
  await recordChannelLockDivergence(memory.model, {
    guildId: "guild-1",
    channelId: "chan-1",
    command: "lock-channel",
    previousState: "inherit",
    divergedState: "deny",
    desiredState: "inherit",
    desiredLocked: false
  });

  const failing = makeChannel("deny", { editFails: true });
  const firstTotals = await runtimeFor(memory, failing, async () => undefined).runRecoveryCycle();
  assert.equal(firstTotals["discord-failed"], 1);
  const [pending] = await listChannelLockRecoveries(memory.model);
  assert.equal(pending?.attempts, 1, "incercarea esuata e contorizata");
  assert.match(String(pending?.lastError), /Discord 503/);

  const recovered = makeChannel("deny");
  const secondTotals = await runtimeFor(memory, recovered, async () => undefined).runRecoveryCycle();
  assert.equal(secondTotals.converged, 1, "dupa revenirea Discord acelasi record converge");
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 0);
});

test("un esec Mongo la persistare nu inchide inregistrarea, chiar daca Discord a fost deja restaurat", async () => {
  const memory = memoryRecoveryModel();
  await recordChannelLockDivergence(memory.model, {
    guildId: "guild-1",
    channelId: "chan-1",
    command: "lock-channel",
    previousState: "inherit",
    divergedState: "deny",
    desiredState: "inherit",
    desiredLocked: false
  });
  const channel = makeChannel("deny");
  const totals = await runtimeFor(memory, channel, async () => { throw new Error("mongo down"); }).runRecoveryCycle();
  assert.equal(totals["persist-failed"], 1);
  assert.equal(channel.state, "inherit", "Discord e deja restaurat");
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 1, "inregistrarea ramane pana cand si persistenta reuseste");

  const converged = await runtimeFor(memory, channel, async () => undefined).runRecoveryCycle();
  assert.equal(converged.converged, 1, "la ciclul urmator, cu Discord deja in starea dorita, doar persistenta se finalizeaza");
  assert.equal(channel.edits, 1, "restaurarea Discord nu se repeta inutil (idempotenta)");
});

test("canalul indisponibil (restart, canal sters temporar) lasa inregistrarea pentru mai tarziu", async () => {
  const memory = memoryRecoveryModel();
  await recordChannelLockDivergence(memory.model, {
    guildId: "guild-1",
    channelId: "chan-1",
    command: "lock-channel",
    previousState: "inherit",
    divergedState: "deny",
    desiredState: "inherit",
    desiredLocked: false
  });
  const totals = await runtimeFor(memory, null, async () => undefined).runRecoveryCycle();
  assert.equal(totals.unavailable, 1);
  assert.equal(await countChannelLockRecoveries(memory.model, "guild-1"), 1);
});

test("readLockedChannelPermissionState citeste exact allow/deny/inherit din overwrite", () => {
  assert.equal(readLockedChannelPermissionState(makeChannel("allow"), "everyone-1"), "allow");
  assert.equal(readLockedChannelPermissionState(makeChannel("deny"), "everyone-1"), "deny");
  assert.equal(readLockedChannelPermissionState(makeChannel("inherit"), "everyone-1"), "inherit");
  assert.equal(readLockedChannelPermissionState({}, "everyone-1"), "inherit");
});
