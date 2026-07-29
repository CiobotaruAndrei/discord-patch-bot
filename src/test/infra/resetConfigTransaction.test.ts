import test from "node:test";
import assert from "node:assert/strict";

import { resetGuildConfigurationWithAudit } from "../../features/guild-config/guildConfigRepository.js";
import { createDeferredTransactionRunner } from "../../infra/mongo/transactionRunner.js";
import type { TransactionRunner, TransactionSession } from "../../shared/transactionPort.js";

interface Recorded {
  op: string;
  session: unknown;
}

function models(calls: Recorded[]) {
  return {
    GuildModel: {
      updateOne: async (_filter: Record<string, unknown>, _update: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ op: "guild.updateOne", session: options?.session });
        return {};
      }
    },
    GuildAuditLogModel: {
      create: async (_doc: unknown, options?: Record<string, unknown>) => {
        calls.push({ op: "audit.create", session: options?.session });
        return {};
      }
    },
    GuildYoutubeErrorModel: {
      deleteMany: async (_filter: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ op: "youtube.deleteMany", session: options?.session });
        return {};
      }
    },
    GuildDeadLetterModel: {
      deleteMany: async (_filter: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ op: "deadletter.deleteMany", session: options?.session });
        return {};
      }
    }
  };
}

const audit = { userId: "u1", action: "reset_config", details: "test" };

test("fara runner injectat, resetarea ramane secventiala si nu cere sesiune", async () => {
  const calls: Recorded[] = [];
  const m = models(calls);
  await resetGuildConfigurationWithAudit(m.GuildModel, m.GuildAuditLogModel, m.GuildYoutubeErrorModel, m.GuildDeadLetterModel, "g1", "EUR", audit, "op-1");
  assert.deepEqual(calls.map(entry => entry.op), ["guild.updateOne", "audit.create", "youtube.deleteMany", "deadletter.deleteMany"]);
  assert.ok(calls.every(entry => entry.session === undefined));
});

test("cu runner tranzactional, toate cele patru scrieri primesc aceeasi sesiune", async () => {
  const calls: Recorded[] = [];
  const m = models(calls);
  const session: TransactionSession = { endSession: () => undefined };
  const labels: string[] = [];
  const runner: TransactionRunner = {
    support: () => "replica-set",
    atomic: async (label, work) => {
      labels.push(label);
      return work(session);
    }
  };

  await resetGuildConfigurationWithAudit(m.GuildModel, m.GuildAuditLogModel, m.GuildYoutubeErrorModel, m.GuildDeadLetterModel, "g1", "EUR", audit, "op-2", runner);

  assert.deepEqual(labels, ["reset-config"]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(entry => entry.session === session), "o scriere lasata in afara sesiunii ar supravietui unui rollback");
});

test("daca tranzactia arunca, esecul urca la apelant si nu se inghite", async () => {
  const m = models([]);
  const runner: TransactionRunner = {
    support: () => "replica-set",
    atomic: async () => { throw new Error("tx a esuat"); }
  };
  await assert.rejects(
    () => resetGuildConfigurationWithAudit(m.GuildModel, m.GuildAuditLogModel, m.GuildYoutubeErrorModel, m.GuildDeadLetterModel, "g1", "EUR", audit, "op-3", runner),
    /tx a esuat/
  );
});

test("runner-ul amanat detecteaza suportul o singura data, la prima folosire", async () => {
  let helloCalls = 0;
  const mongoose = {
    connection: {
      db: {
        admin: () => ({
          command: async () => {
            helloCalls += 1;
            return {};
          }
        })
      }
    }
  };
  const logs: string[] = [];
  const runner = createDeferredTransactionRunner(mongoose, (_level, _ctx, message) => { logs.push(message); });

  assert.equal(runner.support(), "unknown", "inainte de conectare nu pretinde ca stie");
  assert.equal(await runner.atomic("a", async session => (session === null ? "fara-sesiune" : "cu-sesiune")), "fara-sesiune");
  assert.equal(runner.support(), "standalone");
  await runner.atomic("b", async () => undefined);
  assert.equal(helloCalls, 1, "detectia nu se repeta la fiecare operatie");
  assert.equal(logs.filter(message => message.includes("Suport tranzactii")).length, 1);
});
