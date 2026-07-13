import test from "node:test";
import assert from "node:assert/strict";
import { makeInteraction, requireGuildAdmin } from "../adminGuardTestKit.js";

test("admin guard accepts guild administrators without replying", async () => {
  const { interaction, replies } = makeInteraction(true);

  assert.equal(requireGuildAdmin.isGuildAdmin(interaction), true);
  assert.equal(await requireGuildAdmin(interaction), true);
  assert.deepEqual(replies, []);
});

test("admin guard nu mai accepta BOT_ADMIN_ROLE_IDS ca regula implicita", async () => {
  const previous = process.env.BOT_ADMIN_ROLE_IDS;
  process.env.BOT_ADMIN_ROLE_IDS = "role-allowed";
  try {
    const { interaction, replies } = makeInteraction(false);
    interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };

    assert.equal(requireGuildAdmin.hasAllowedAdminRole(interaction), false);
    assert.equal(await requireGuildAdmin(interaction), false);
    assert.deepEqual(replies, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
  } finally {
    if (previous === undefined) delete process.env.BOT_ADMIN_ROLE_IDS;
    else process.env.BOT_ADMIN_ROLE_IDS = previous;
  }
});

test("admin guard accepts configured exact admin role without Discord Administrator", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), true);
});

test("admin guard accepts configured role IDs cand member.roles e un array brut de ID-uri (interactiune necache-uita) (R[Medium] #2)", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: ["role-other", "role-allowed"] };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), true);
});

test("admin guard respinge cand member.roles e array fara rolul configurat (nu accepta orbeste orice array) (R[Medium] #2)", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: ["role-x", "role-y"] };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), false);
});

test("admin guard accepts configured role-or-higher by Discord role position", () => {
  const { interaction } = makeInteraction(false);
  interaction.guild = {
    id: "guild-1",
    roles: { cache: { has: () => false, get: (roleId: string) => roleId === "role-required" ? { position: 5 } : undefined } }
  };
  interaction.member = { roles: { has: () => false, highest: { position: 7 } } };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role-or-higher", roleId: "role-required" }), true);
});

test("admin guard rejects non-admins with an ephemeral reply", async () => {
  const { interaction, replies } = makeInteraction(false);

  assert.equal(await requireGuildAdmin(interaction), false);
  assert.deepEqual(replies, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
});

test("admin guard uses followUp after an interaction was deferred", async () => {
  const { interaction, replies, followUps } = makeInteraction(false, true);

  assert.equal(await requireGuildAdmin(interaction), false);
  assert.deepEqual(replies, []);
  assert.deepEqual(followUps, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
});

