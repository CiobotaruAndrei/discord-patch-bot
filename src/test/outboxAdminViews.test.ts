import test from "node:test";
import assert from "node:assert/strict";

import { createOutboxAdminViews, formatDeadLetterEntry, type OutboxAdminViewsDeps } from "../features/command-handlers/outboxAdminViews";

const emptyDeadLetterModel: OutboxAdminViewsDeps["GuildDeadLetterModel"] = {
  countDocuments: async () => 0,
  find: () => {
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
    return chain;
  }
};

function makeDeadLetterModel(entries: Array<{ kind: "update" | "discount" | "youtube"; title?: string; reason?: string; attempts?: number; failedAt?: Date }>): OutboxAdminViewsDeps["GuildDeadLetterModel"] {
  const docs = entries.map((entry, index) => ({ guildId: "guild-1", failedAt: new Date(Date.UTC(2026, 0, 1, 0, index)), ...entry }));
  return {
    countDocuments: async () => docs.length,
    find: () => {
      let sorted = [...docs];
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: () => {
          sorted = [...sorted].sort((a, b) => new Date(b.failedAt ?? 0).getTime() - new Date(a.failedAt ?? 0).getTime());
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    }
  };
}

function makeDeps(overrides: Partial<OutboxAdminViewsDeps> = {}): OutboxAdminViewsDeps {
  return {
    NotificationOutboxModel: { countDocuments: async () => 0 },
    GuildDeadLetterModel: emptyDeadLetterModel,
    getGuildSettings: async () => null,
    getOutboxPaused: async () => false,
    checkChannelPermissions: async () => null,
    outboxEnabled: true,
    recoveryVerifyGlobal: false,
    recoveryStrict: false,
    ...overrides
  };
}

test("renderStatus arata starea drenarii: activa, pe pauza sau necunoscuta cand citirea starii arunca", async () => {
  const active = createOutboxAdminViews(makeDeps());
  assert.ok((await active.renderStatus("guild-1")).includes("Drenare: **ACTIVA**"));

  const paused = createOutboxAdminViews(makeDeps({ getOutboxPaused: async () => true }));
  assert.ok((await paused.renderStatus("guild-1")).includes("Drenare: **PE PAUZA**"));

  const broken = createOutboxAdminViews(makeDeps({
    getOutboxPaused: async () => {
      throw new Error("mongo indisponibil");
    }
  }));
  assert.ok((await broken.renderStatus("guild-1")).includes("NECUNOSCUTA"));
});

test("renderDeadLetters afiseaza ultimele intrari in ordine inversa, respectand limita de preview", async () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({
    kind: "update" as const,
    title: `Intrare ${index + 1}`,
    reason: "max-attempts",
    attempts: index + 1
  }));
  const views = createOutboxAdminViews(makeDeps({
    GuildDeadLetterModel: makeDeadLetterModel(entries),
    deadLetterPreviewLimit: 3
  }));

  const rendered = await views.renderDeadLetters("guild-1");
  assert.ok(rendered.includes("ultimele 3 din 5"));
  assert.ok(rendered.indexOf("Intrare 5") < rendered.indexOf("Intrare 4"));
  assert.ok(!rendered.includes("Intrare 1"));

  const empty = createOutboxAdminViews(makeDeps());
  assert.equal(await empty.renderDeadLetters("guild-1"), "Nicio livrare in dead-letter pentru acest server.");
});

test("formatDeadLetterEntry mapeaza kind-ul la eticheta romaneasca si include canal + dedupe scurtat", () => {
  const line = formatDeadLetterEntry({
    kind: "discount",
    title: "Oferta X",
    channelId: "123",
    dedupeKey: "abcdef0123456789deadbeef",
    reason: "invalid-payload",
    attempts: 2,
    failedAt: "2026-07-01T10:00:00.000Z"
  });
  assert.ok(line.startsWith("- [reducere] Oferta X"));
  assert.ok(line.includes("<#123>"));
  assert.ok(line.includes("dedupe: abcdef012345"));
  assert.ok(line.includes("invalid-payload"));
});

test("renderRecoveryVerifyStatus combina starea per server cu cea globala", async () => {
  const views = createOutboxAdminViews(makeDeps({
    getGuildSettings: async () => ({ outboxRecoveryVerify: true }),
    recoveryVerifyGlobal: true,
    recoveryStrict: false
  }));
  const rendered = await views.renderRecoveryVerifyStatus("guild-1");
  assert.ok(rendered.includes("Acest server: **ON**"));
  assert.ok(rendered.includes("Global: **ON** | strict: **OFF**"));
});
