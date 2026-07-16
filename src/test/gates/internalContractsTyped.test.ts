import test from "node:test";
import assert from "node:assert/strict";
import type { CommandRuntime, MongoContextLike, ScraperRuntime } from "../../app/appRuntimeContracts.js";
import type { SlashCommandJson } from "../../features/command-definitions/slashDefinitionTools.js";
import type { FindGameResult } from "../../features/command-presentation/gameLookupCache.js";
import type { UpdateNotificationServiceDeps } from "../../features/notifications/updateNotificationService.js";
import type { DiscountNotificationServiceDeps } from "../../features/notifications/discountNotificationService.js";

type UpdateEmbedReturn = ReturnType<UpdateNotificationServiceDeps["buildUpdateEmbed"]>;
const updateEmbedIsNotUnknown: [unknown] extends [UpdateEmbedReturn] ? never : true = true;
type DealEmbedReturn = ReturnType<DiscountNotificationServiceDeps["buildDealEmbed"]>;
const dealEmbedIsNotUnknown: [unknown] extends [DealEmbedReturn] ? never : true = true;

type RegistryApi = typeof import("../../features/command-registry/commandRegistry.js")["default"];

const registerSlashCommandsReturnsVoid: [Awaited<ReturnType<RegistryApi["registerSlashCommands"]>>] extends [void] ? true : never = true;
const runtimeRegisterSlashCommandsReturnsVoid: [Awaited<ReturnType<CommandRuntime["registerSlashCommands"]>>] extends [void] ? true : never = true;

type SlashDefinitions = ReturnType<RegistryApi["buildSlashCommandDefinitions"]>;
const slashDefinitionsAreTyped: [SlashDefinitions] extends [SlashCommandJson[]]
  ? ([unknown[]] extends [SlashDefinitions] ? never : true)
  : never = true;

type FindGameReturn = ReturnType<RegistryApi["findGameAndSuggestion"]>;
const findGameResultIsTyped: [FindGameReturn] extends [FindGameResult]
  ? ([unknown] extends [FindGameReturn] ? never : true)
  : never = true;

type HelpEmbedReturn = ReturnType<RegistryApi["buildHelpEmbed"]>;
const helpEmbedIsNotUnknown: [unknown] extends [HelpEmbedReturn] ? never : true = true;

type HandleInteractionReturn = ReturnType<CommandRuntime["handleInteraction"]>;
const handleInteractionReturnsPromise: [HandleInteractionReturn] extends [Promise<unknown>] ? true : never = true;

const cleanEnrichedCacheReturnsVoid: [ReturnType<ScraperRuntime["cleanEnrichedCache"]>] extends [void] ? true : never = true;
const cleanGuildCacheReturnsVoid: [ReturnType<MongoContextLike["cleanGuildCache"]>] extends [void] ? true : never = true;
const releaseDbLockReturnsVoid: [Awaited<ReturnType<MongoContextLike["releaseDbLock"]>>] extends [void] ? true : never = true;
const adminAlertReturnsVoid: [Awaited<ReturnType<MongoContextLike["adminAlert"]>>] extends [void] ? true : never = true;

test("contract compile-time: suprafata interna a registrului si a runtime-ului nu mai expune unknown gratuit (review nou, Mediu #19)", () => {
  assert.equal(registerSlashCommandsReturnsVoid, true, "registerSlashCommands promite void, nu Promise<unknown>");
  assert.equal(runtimeRegisterSlashCommandsReturnsVoid, true, "CommandRuntime.registerSlashCommands promite void");
  assert.equal(slashDefinitionsAreTyped, true, "buildSlashCommandDefinitions intoarce SlashCommandJson[], nu unknown[]");
  assert.equal(findGameResultIsTyped, true, "findGameAndSuggestion intoarce FindGameResult, nu unknown");
  assert.equal(helpEmbedIsNotUnknown, true, "buildHelpEmbed intoarce un embed opac (object), nu unknown");
  assert.equal(handleInteractionReturnsPromise, true, "handleInteraction e mereu un Promise (rezultatul ramane unknown - granita Discord legitima)");
  assert.equal(cleanEnrichedCacheReturnsVoid, true, "cleanEnrichedCache promite void");
  assert.equal(cleanGuildCacheReturnsVoid, true, "cleanGuildCache promite void");
  assert.equal(releaseDbLockReturnsVoid, true, "releaseDbLock promite void");
  assert.equal(adminAlertReturnsVoid, true, "adminAlert promite void");
  assert.equal(updateEmbedIsNotUnknown, true, "buildUpdateEmbed promite NotificationEmbed (obiect opac), nu unknown (review nou, Mediu #13)");
  assert.equal(dealEmbedIsNotUnknown, true, "buildDealEmbed promite NotificationEmbed (obiect opac), nu unknown (review nou, Mediu #13)");
});
