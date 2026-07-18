import test from "node:test";
import assert from "node:assert/strict";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import { createSecurityRuntime } from "../../features/command-security/securityRuntime.js";

test("atasamentele criptate sau nesuportate devin suspicious fara stergere", async () => {
  const alerts: unknown[] = [];
  let deleted = 0;
  const alertChannel = {
    id: "alerts",
    send(payload: unknown) {
      alerts.push(payload);
      return Promise.resolve(payload);
    }
  };
  const settings: GuildSettings = { _id: "guild", threatProtectionEnabled: true, threatAlertChannelId: "alerts" };
  const runtime = createSecurityRuntime({
    getGuildSettings: async () => settings,
    client: { channels: { fetch: async () => alertChannel } },
    fetchThreatResource: async () => new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
  });
  await runtime.handleMessageCreate({
    guild: { id: "guild" },
    author: { id: "user", bot: false },
    channel: { id: "source" },
    content: "",
    attachments: [{ url: "https://example.test/file.rar", name: "file.rar" }],
    delete: async () => { deleted++; }
  });
  assert.equal(deleted, 0);
  assert.equal(alerts.length, 1);
  const alert = alerts[0];
  assert.ok(alert && typeof alert === "object" && "content" in alert);
  assert.match(String(alert.content), /suspicious/);
});
