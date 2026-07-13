import test from "node:test";
import assert from "node:assert/strict";
import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

import type { SlashCommandJsonSource, SlashDefinitionTools } from "../features/command-definitions/slashDefinitionTools";
import { buildAdminCommandDefinitions } from "../features/command-definitions/adminCommandDefinitions";
import { buildCoreCommandDefinitions } from "../features/command-definitions/coreCommandDefinitions";
import { buildDealsCommandDefinitions } from "../features/command-definitions/dealsCommandDefinitions";
import { buildGameInfoCommandDefinitions } from "../features/command-definitions/gameInfoCommandDefinitions";
import { buildNotificationCommandDefinitions } from "../features/command-definitions/notificationCommandDefinitions";
import { buildOutboxCommandDefinitions } from "../features/command-definitions/outboxCommandDefinitions";
import { buildYouTubeCommandDefinitions } from "../features/command-definitions/youtubeCommandDefinitions";
import attachSlashCommands from "../features/command-definitions/slashCommandDefinitions";

const tools: SlashDefinitionTools = {
  SlashCommandBuilder,
  PermissionsBitField,
  CURRENCY_CHOICES: ["USD", "EUR", "GBP", "RON"].map(currency => ({ name: currency, value: currency }))
};

const domainBuilders: Record<string, (input: SlashDefinitionTools) => SlashCommandJsonSource[]> = {
  core: buildCoreCommandDefinitions,
  admin: buildAdminCommandDefinitions,
  notifications: buildNotificationCommandDefinitions,
  deals: buildDealsCommandDefinitions,
  "game-info": buildGameInfoCommandDefinitions,
  youtube: buildYouTubeCommandDefinitions,
  outbox: buildOutboxCommandDefinitions
};

function composedDefinitions() {
  const definitions = attachSlashCommands.createSlashCommandDefinitions({
    SlashCommandBuilder,
    PermissionsBitField,
    Routes: {
      applicationCommands: (clientId: string) => `/applications/${clientId}/commands`,
      applicationGuildCommands: (clientId: string, guildId: string) => `/applications/${clientId}/guilds/${guildId}/commands`
    },
    REST: class {
      setToken() {
        return { put: async () => undefined };
      }
    },
    SUPPORTED_CURRENCIES: {
      USD: { cc: "us", symbol: "$", placement: "prefix" },
      EUR: { cc: "eu", symbol: "€", placement: "suffix" },
      GBP: { cc: "uk", symbol: "£", placement: "prefix" },
      RON: { cc: "ro", symbol: "lei", placement: "suffix" }
    },
    logger: () => {}
  });
  return definitions.buildSlashCommandDefinitions();
}

test("fiecare modul de domeniu contribuie cu cel putin o comanda si numele nu se suprapun intre domenii", () => {
  const seen = new Map<string, string>();
  for (const [domain, build] of Object.entries(domainBuilders)) {
    const names = build(tools).map(command => command.toJSON().name);
    assert.ok(names.length > 0, `domeniul ${domain} nu contribuie cu nicio comanda`);
    for (const name of names) {
      const owner = seen.get(name);
      assert.equal(owner, undefined, `comanda ${name} apare si in ${owner}, si in ${domain}`);
      seen.set(name, domain);
    }
  }
});

test("compozitia din slashCommandDefinitions este exact reuniunea modulelor de domeniu", () => {
  const composed = composedDefinitions().map(definition => definition.name).sort();
  const union = Object.values(domainBuilders)
    .flatMap(build => build(tools).map(command => command.toJSON().name))
    .sort();
  assert.deepEqual(composed, union);
});

test("comenzile administrative din module pastreaza dm_permission false dupa compunere", () => {
  const adminPermissions = PermissionsBitField.Flags.Administrator.toString();
  const composed = composedDefinitions();
  const adminDefinitions = composed.filter(definition => definition.default_member_permissions === adminPermissions);
  assert.ok(adminDefinitions.length > 0);
  for (const definition of adminDefinitions) {
    assert.equal(definition.dm_permission, false, `comanda ${definition.name} ar trebui sa aiba dm_permission false`);
  }
});
