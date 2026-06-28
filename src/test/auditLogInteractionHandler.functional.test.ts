import test from "node:test";
import assert from "node:assert/strict";

const installAuditLog = require("../features/command-handlers/auditLogInteractionHandler") as typeof import("../features/command-handlers/auditLogInteractionHandler");

test("/bot-log render include rezultatul Access granted si nu creeaza mentiuni invalide pentru user lipsa", () => {
  const text = installAuditLog.renderBotLog([
    {
      userId: "user-1",
      command: "/backup add",
      result: "Access granted.",
      serverId: "guild-1",
      at: "2025-01-01T00:00:00.000Z"
    },
    {
      userId: "",
      command: "/backup load",
      result: "Access denied.",
      serverId: "guild-1",
      at: "2025-01-02T00:00:00.000Z"
    }
  ]);

  assert.match(text, /Access granted\./);
  assert.match(text, /Access denied\./);
  assert.match(text, /<@user-1>/);
  assert.match(text, /user necunoscut/);
  assert.doesNotMatch(text, /<@necunoscut>/);
});

test("/server-log render afiseaza actiunea si detaliile auditului server", () => {
  const text = installAuditLog.renderServerLog([
    {
      userId: "user-1",
      action: "backup_load",
      details: "Loaded backup prod",
      serverId: "guild-1",
      at: "2025-01-01T00:00:00.000Z"
    }
  ]);

  assert.match(text, /backup_load/);
  assert.match(text, /Loaded backup prod/);
  assert.match(text, /<@user-1>/);
});
