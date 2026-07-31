import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import type { SourceRegistryApi } from "../../sources/sourceRegistry.js";

import {
  loadModule,
  loadModulesIn,
  functionNames,
  findFunction,
  requireFunction,
  membersOf,
  findMember,
  nestedMembers,
  declaresType,
  typeAliasTarget,
  stringLiteralTypesIn,
  indexSignatures,
  typeReferenceTexts,
  imports,
  importedModules,
  requireSpecifiers,
  assertions,
  calls,
  callsWithin,
  callBoundLocals,
  constructedNames,
  identifierNames,
  assignedProperties,
  compositionLayers,
  returnedCallees,
  topLevelFrozenExports,
  arrowPropertyCount,
  allMembers,
  normalize
} from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

type Commands = typeof import("../../features/command-registry/commandRegistry.js")["default"];
type CommandContext = ReturnType<Commands["createCommandRegistry"]>;
type HasIndexSignature<T> = string extends keyof T ? true : false;

const commandContextClosed: HasIndexSignature<CommandContext> extends false ? true : never = true;
const sourceApiClosed: HasIndexSignature<SourceRegistryApi> extends false ? true : never = true;

const commandRegistry = loadModule("features", "command-registry", "commandRegistry.ts");
const sourceRegistry = loadModule("sources", "sourceRegistryFactory.ts");
const descriptors = loadModule("features", "command-registry", "commandHandlerDescriptors.ts");

function declaredTypeNames(query: ModuleQuery): string[] {
  const names: string[] = [];
  for (const name of identifierNames(query)) {
    if (declaresType(query, name)) names.push(name);
  }
  return names;
}

function runtimeModules(): ModuleQuery[] {
  const collected: ModuleQuery[] = [];
  for (const root of ["app", "features", "sources", "infra", "shared", "domain", "config"]) {
    collectTsModules([root], collected);
  }
  return collected;
}

function collectTsModules(segments: readonly string[], into: ModuleQuery[]): void {
  const absolute = path.join(process.cwd(), ...segments);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "target", "test"].includes(entry.name)) continue;
      collectTsModules([...segments, entry.name], into);
      continue;
    }
    if (entry.name.endsWith(".ts")) into.push(loadModule(...segments, entry.name));
  }
}

test("CommandRegistryContext si SourceRegistryApi sunt contracte inchise, fara index signature", () => {
  assert.equal(commandContextClosed, true, "contextul registrului de comenzi expune doar cheile declarate");
  assert.equal(sourceApiClosed, true, "API-ul registrului de surse expune doar cheile declarate");
  assert.deepEqual(
    indexSignatures(commandRegistry),
    [],
    "nicio index signature in commandRegistry.ts (regresie: contextul redevine bag netipizat)"
  );
});

test("DI-ul handler-elor e verificat de TypeScript, nu simulat printr-un Proxy peste god-object", () => {
  assert.ok(
    !constructedNames(descriptors).includes("Proxy"),
    "descriptorii nu mai fabrica dependintele printr-un Proxy peste servicii"
  );
  const phantom = assertions(descriptors).filter(entry => entry.expression === "{}");
  assert.deepEqual(phantom, [], "fara cast fantoma `{} as Dependencies`: un cast dintr-un obiect gol ascunde o dependinta lipsa de TypeScript");
  const build = findMember(descriptors, "CommandHandlerDescriptor", "build");
  assert.ok(build, "descriptorul declara build");
  assert.equal(build?.params.length, 1, "build primeste exact contextul domeniului");
  assert.equal(
    build?.params[0]?.type,
    "CommandDomainDeps[D]",
    "descriptorul e generic pe domeniu, deci build cere exact dependintele domeniului lui: ingustarea nu se mai pierde la granita"
  );
  assert.equal(build?.returnType, "CommandHandler", "build intoarce un CommandHandler");
});

test("contextele de handler tipeaza logger canonic (LoggerFunction), nu loose", () => {
  for (const file of ["simpleCommandsHandler.ts", "helpInteractionHandler.ts"]) {
    const query = loadModule("features", "command-handlers", file);
    const loggers = allMembers(query).filter(member => member.name === "logger");
    assert.ok(loggers.length > 0, `${file}: contextul declara logger`);
    for (const logger of loggers) {
      assert.equal(logger.type, "LoggerFunction", `${file}: logger e tipat canonic LoggerFunction, nu (...args: unknown[]) => void`);
    }
  }
});

test("registrele compun modulele prin importuri statice, nu require-uri inline", () => {
  const commandImports = imports(commandRegistry);
  assert.ok(
    commandImports.some(entry => entry.module === "../command-cache/commandCache.js" && entry.defaultName !== null),
    "commandRegistry importa modulele static, cu binding numit"
  );
  assert.deepEqual(
    requireSpecifiers(commandRegistry).filter(specifier => specifier.startsWith(".")),
    [],
    "fara require-uri de module locale in commandRegistry"
  );
  assert.ok(
    imports(sourceRegistry).some(entry => entry.module === "../infra/http/client.js" && entry.defaultName !== null),
    "sourceRegistry importa clientul HTTP static"
  );
  assert.deepEqual(
    requireSpecifiers(sourceRegistry).filter(specifier => specifier.startsWith(".")),
    [],
    "fara require-uri de module locale in sourceRegistry"
  );
});

test("commandRegistry: zonele se compun prin spread imutabil, fara mutatie in-place a unui base partajat", () => {
  assert.ok(functionNames(commandRegistry).includes("createAppServices"), "compunerea zonelor traieste intr-un createAppServices dedicat");
  const mutations = calls(commandRegistry).filter(call => call.callee === "Object.assign" && call.args.length > 1);
  assert.deepEqual(
    mutations.map(call => call.args[0]),
    [],
    "Object.assign cu mai multe argumente muteaza primul obiect in loc; zonele se compun prin spread in obiecte noi"
  );
  const layers = compositionLayers(commandRegistry, "createAppServices");
  assert.ok(layers.length > 0, "createAppServices compune straturi prin obiecte literale");
  for (const layer of layers) {
    assert.ok(layer.spreads.length > 0, `${layer.name}: stratul se construieste prin spread, nu prin mutatie`);
  }
});

test("helper-ele partajate accepta contractul minimal de interactiune (DeferEditInteraction), nu un DiscordInteraction bogat", () => {
  const contracts = loadModule("features", "command-presentation", "presentationContracts.ts");
  const helpers = loadModule("features", "command-presentation", "interactionReplyHelpers.ts");
  assert.ok(declaresType(contracts, "DeferEditInteraction"), "presentation defineste contractul minimal DeferEditInteraction");
  const deferReply = findMember(contracts, "DeferEditInteraction", "deferReply");
  assert.ok(deferReply?.optional, "deferReply e optional, deci orice DI de handler mai sarac e assignable");
  assert.equal(deferReply?.returnType, "Promise<unknown>", "deferReply intoarce Promise<unknown>");
  for (const helper of ["safeDefer", "safeEdit", "enforceCooldown"]) {
    const signature = requireFunction(helpers, helper);
    assert.equal(
      signature.params[0]?.type,
      "DeferEditInteraction",
      `${helper} primeste DeferEditInteraction (parametru contravariant minimal), nu DiscordInteraction-ul bogat`
    );
  }
});

test("contextele handler-elor nu mai cara reziduul handleInteraction din lantul legacy de installers", () => {
  for (const query of loadModulesIn(["features", "command-handlers"], () => true)) {
    const residual: string[] = [];
    for (const typeName of declaredTypeNames(query)) {
      for (const member of membersOf(query, typeName)) {
        if (member.name === "handleInteraction" && member.optional) residual.push(`${typeName}.${member.name}`);
      }
    }
    assert.deepEqual(residual, [], `${query.relativePath}: God-object-ul nu mai e pasat implicit prin contexte`);
  }
  const fallback = loadModule("features", "command-handlers", "fallbackInteractionHandler.ts");
  const loose = allMembers(fallback).filter(member => member.name === "games" && member.type === "unknown[]");
  assert.deepEqual(loose, [], "fallback nu mai tipeaza games ca unknown[] (aliniat cu dispatcher-ul tipat)");
});


test("safeDefer e tipat canonic (interaction, ephemeral?) => Promise<void> peste handlere si in helper-ul comun", () => {
  const helpers = loadModule("features", "command-presentation", "interactionReplyHelpers.ts");
  const real = requireFunction(helpers, "safeDefer");
  assert.equal(real.params.length, 2, "implementarea reala primeste (interaction, ephemeral)");
  assert.ok(real.params[1]?.hasDefault, "al doilea parametru are valoare implicita, deci apelul cu un argument ramane valid");
  assert.equal(real.returnType, "Promise<void>", "implementarea reala pastreaza Promise<void>");
  const declarations: Array<{ file: string; interactionType: string }> = [
    { file: "gameFilterHandlers.ts", interactionType: "DiscordInteraction" },
    { file: "rolePingHandlers.ts", interactionType: "DiscordInteraction" },
    { file: "setInteractionHandler.ts", interactionType: "DiscordInteraction" },
    { file: "subscriptionCommandContracts.ts", interactionType: "SubscriptionInteraction" }
  ];
  for (const { file, interactionType } of declarations) {
    const query = loadModule("features", "command-handlers", file);
    const found = allMembers(query).filter(member => member.name === "safeDefer");
    assert.ok(found.length > 0, `${file}: contextul declara safeDefer`);
    for (const member of found) {
      assert.equal(member.params.length, 2, `${file}: safeDefer declara si parametrul ephemeral, ca implementarea reala`);
      assert.equal(member.params[0]?.type, interactionType, `${file}: primul parametru e ${interactionType}`);
      assert.equal(member.params[1]?.type, "boolean", `${file}: ephemeral e boolean`);
      assert.ok(member.params[1]?.optional, `${file}: ephemeral e optional`);
      assert.equal(member.returnType, "Promise<void>", `${file}: safeDefer nu mai e declarat loose cu Promise<unknown>`);
    }
  }
});

test("GuildModel din notifications foloseste contract segregat, nu Pick<Model> sau cast as QueryFilter", () => {
  const seen = loadModule("features", "notifications", "seenRepository.ts");
  assert.ok(
    !typeReferenceTexts(seen).some(text => text.startsWith("Pick<Model<GuildSettings>")),
    "seenRepository nu mai deriva GuildModelLike din Pick<Model<GuildSettings>>: invarianta filtrului mongoose blocheaza compunerea explicita"
  );
  const updateOne = findMember(seen, "GuildModelLike", "updateOne");
  assert.equal(
    updateOne?.params[0]?.type,
    "Record<string, unknown>",
    "filtrul GuildModel e Record<string, unknown>, aliniat cu sibling-urile din fisier"
  );
  for (const file of ["updateNotificationService.ts", "discountNotificationService.ts"]) {
    const query = loadModule("features", "notifications", file);
    const casts = assertions(query).filter(entry => entry.type.startsWith("QueryFilter<"));
    assert.deepEqual(casts, [], `${file}: fara cast as QueryFilter<GuildSettings> (filtrul e Record<string, unknown>)`);
  }
});

test("listele Generated*Deps omit cheile generate intern de seenRepository", () => {
  const contracts = loadModule("features", "notifications", "notificationRuntimeContracts.ts");
  const update = stringLiteralTypesIn(contracts, "GeneratedUpdateDeps");
  for (const key of ["seedSeenUpdates", "setSeenHashVersion"]) {
    assert.ok(update.includes(key), `GeneratedUpdateDeps omite ${key} din input-ul extern (e generat intern de createSeenRepository)`);
  }
  const discount = stringLiteralTypesIn(contracts, "GeneratedDiscountDeps");
  for (const key of ["loadSeenDiscountHashes", "seedSeenDiscounts", "setSeenHashVersion"]) {
    assert.ok(discount.includes(key), `GeneratedDiscountDeps omite ${key} din input-ul extern`);
  }
});

test("notifications: wiring-ul central traieste in module-factory pe domenii, iar index.ts doar le compune", () => {
  const index = loadModule("features", "notifications", "index.ts");
  const owners: Array<[string, string]> = [
    ["outboxRuntimeFactory.ts", "createOutboxServices"],
    ["seenRuntimeFactory.ts", "createSeenServices"],
    ["updateNotificationRuntime.ts", "createUpdateNotificationRuntime"],
    ["discountNotificationRuntime.ts", "createDiscountNotificationRuntime"],
    ["youtubeNotificationRuntime.ts", "createYouTubeNotificationRuntime"]
  ];
  for (const [file, builder] of owners) {
    const query = loadModule("features", "notifications", file);
    assert.ok(functionNames(query).includes(builder), `${file} detine ${builder}`);
  }
  assert.ok(functionNames(index).includes("createNotificationDispatchServices"), "index.ts pastreaza compozitorul de dispatch");
  const dispatchCallees = callsWithin(index, "createNotificationDispatchServices").map(call => call.callee);
  for (const builder of ["createUpdateNotificationRuntime", "createDiscountNotificationRuntime", "createYouTubeNotificationRuntime"]) {
    assert.ok(dispatchCallees.includes(builder), `dispatch-ul compune runtime-ul prin ${builder}, din modulul lui`);
  }
  const runtimeCallees = callsWithin(index, "createNotificationRuntime").map(call => call.callee);
  for (const builder of ["createOutboxServices", "createSeenServices", "createNotificationDispatchServices"]) {
    assert.ok(runtimeCallees.includes(builder), `createNotificationRuntime deleaga la ${builder}`);
  }
  for (const direct of ["createOutboxRuntime", "createUpdateNotificationService", "createDiscountNotificationService", "createYouTubeNotificationService"]) {
    assert.ok(
      !runtimeCallees.includes(direct),
      `createNotificationRuntime nu mai construieste direct ${direct}: doar compune module-factory`
    );
  }
});

test("tipurile de update fetch (notifications + latest) sunt aliniate la FetchResult, nu vederi loose", () => {
  const queue = loadModule("features", "notifications", "pendingUpdatesQueue.ts");
  assert.equal(typeAliasTarget(queue, "UpdateFetchResult"), "FetchResult", "UpdateFetchResult e alias FetchResult, nu {id}&Record");
  const latest = loadModule("features", "command-handlers", "latest", "latestUpdatesHandler.ts");
  assert.equal(typeAliasTarget(latest, "UpdateRecord"), "FetchResult", "UpdateRecord e alias FetchResult");
  for (const query of [queue, latest]) {
    const loose = allMembers(query).filter(member => member.name === "latest" && member.type.includes("Record<string, unknown>"));
    assert.deepEqual(loose, [], `${query.relativePath}: fara latest loose ({id}&Record)|null pe calea update`);
  }
});

test("notifications: serviciile folosesc GuildSettings tipat fara intersectii sau index signature", () => {
  const barrel = loadModule("types.ts");
  const guildSettings = membersOf(barrel, "GuildSettings");
  if (guildSettings.length > 0) {
    assert.deepEqual(indexSignatures(barrel), [], "GuildSettings ramane contract inchis, fara index signature in barrel");
  }
  for (const file of ["updateNotificationService.ts", "discountNotificationService.ts"]) {
    const query = loadModule("features", "notifications", file);
    assert.ok(
      !typeReferenceTexts(query).some(text => normalize(text) === "GuildSettings & Record<string, unknown>"),
      `${file}: fara intersectia redundanta GuildSettings & Record<string, unknown>`
    );
    const redundant = assertions(query).filter(entry => /^\{ seenHashVersion(Updates|Discounts)\?: unknown \}$/.test(entry.type));
    assert.deepEqual(redundant, [], `${file}: fara cast redundant as { seenHashVersion... }`);
  }
});

test("installerele nu mai sunt coercitate cu as unknown as sau as never in registre", () => {
  for (const query of [commandRegistry, sourceRegistry]) {
    const weakened = assertions(query).filter(entry => entry.toNever || entry.throughUnknown);
    assert.deepEqual(weakened, [], `${query.relativePath}: fara granita as never / as unknown as`);
  }
});

test("commandRegistry compune explicit din input injectat, cu tip de retur inchis, fara mecanism de installers", () => {
  const create = requireFunction(commandRegistry, "createCommandRegistry");
  assert.equal(create.params[0]?.type, "CommandRuntimeInput", "primul parametru e input-ul INJECTAT din bootstrap");
  assert.ok(create.params[1]?.type.startsWith("Partial<"), "al doilea parametru e un override TIPAT pentru teste");
  assert.ok(create.params[1]?.hasDefault, "override-ul are valoare implicita, deci productia il omite");
  assert.equal(create.returnType, "RequiredCommandRegistry", "tipul de retur e inchis");
  const identifiers = identifierNames(commandRegistry);
  for (const banned of [
    "LegacyInstallerTarget",
    "CommandInstallerTarget",
    "isCommandModuleInstaller",
    "requireInstalled",
    "HandlerMutableContext"
  ]) {
    assert.ok(!identifiers.has(banned), `commandRegistry nu mai are ${banned}: compunerea e statica, verificata de tsc`);
  }
  assert.ok(
    !importedModules(commandRegistry).some(module => module.includes("runtimeComposition")),
    "commandRegistry nu mai importa instante din composition root (app): sunt injectate prin input"
  );
  assert.deepEqual(
    assignedProperties(commandRegistry).filter(target => /^ctx\.(handleInteraction|buildHelpEmbed)$/.test(target)),
    [],
    "commandRegistry nu mai muteaza contextul dupa compunere"
  );
  const contextCasts = assertions(commandRegistry).filter(entry => entry.expression === "context" || entry.expression === "interaction");
  assert.deepEqual(
    contextCasts,
    [],
    "marginea e tipata (RoutedDiscordInteraction / factory-uri tipate), nu obtinuta prin cast pe context sau interaction"
  );
});

test("commandRegistry ruteaza prin descriptori si guard-uri construite ca factory, in ordine explicita", () => {
  const registryCalls = calls(commandRegistry);
  const callees = registryCalls.map(call => call.callee);
  assert.ok(callees.includes("createCommandHandlerDescriptors"), "routing-ul e construit din registrul declarativ de descriptori");
  const dispatch = findFunction(commandRegistry, "dispatchCommand");
  assert.ok(dispatch?.async, "commandRegistry ruteaza prin dispatchCommand asincron (loop canHandle/handle), nu prin lant de installX");
  assert.equal(
    dispatch?.params[0]?.type,
    "RoutedDiscordInteraction",
    "dispatcher-ul primeste contractul ingust de margine, nu unknown"
  );
  for (const factory of ["createCommandSnoozeGuard", "createAdminCommandGuard"]) {
    assert.ok(
      callees.some(callee => callee.endsWith(`.${factory}`) || callee === factory),
      `${factory} e construit ca factory in registry`
    );
  }
  for (const attach of ["attachAdminCommandRouterGuard", "attachCommandSnoozeGuard"]) {
    assert.ok(
      !callees.includes(attach),
      `guard-urile nu se mai instaleaza prin mutarea contextului (fara ${attach}(ctx))`
    );
  }
  const snooze = registryCalls.find(call => call.callee.endsWith(".handleSnoozedCommand"));
  assert.deepEqual(snooze?.args, ["interaction", "games", "dispatchCommand"], "pipeline explicit: snooze guard -> dispatchCommand");
  const admin = registryCalls.find(call => call.callee.endsWith(".handleAdminProtectedCommand"));
  assert.deepEqual(
    admin?.args,
    ["interaction", "games", "dispatchWithSnoozeGuard"],
    "pipeline explicit: admin guard (exterior) -> snooze -> dispatcher, aceeasi ordine"
  );
  assert.ok(
    returnedCallees(commandRegistry, "createCommandRegistry").includes("Object.freeze"),
    "registrul intoarce un obiect inghetat cu functiile locale, fara scriere inapoi in context"
  );
});

test("descriptorii sunt declarati prin factory-uri tipate, in modulele lor de domeniu", () => {
  assert.ok(declaresType(descriptors, "CommandHandlerDescriptor"), "descriptorii au contract explicit");
  const declared = loadModulesIn(["features", "command-registry", "descriptors"], name => name.endsWith("Descriptors.ts"))
    .reduce((total, query) => total + arrowPropertyCount(query, "build"), 0);
  assert.ok(
    declared >= 15,
    "handler-ele sunt declarate prin factory-uri tipate in modulele din descriptors/, nu in fisierul central " +
      `(gasite ${declared})`
  );
});

test("sourceRegistry compune explicit prin fabrici, fara context progresiv partial si fara garzi runtime", () => {
  const create = requireFunction(sourceRegistry, "createSourceRegistry");
  assert.equal(create.params[0]?.type, "SourceRuntimeDeps", "compune din dependente injectate");
  assert.equal(create.returnType, "SourceRegistryApi", "tip de retur inchis");
  assert.ok(
    !typeReferenceTexts(sourceRegistry).some(text => text.startsWith("Partial<SourceRegistryApi")),
    "arhitectura Partial<SourceRegistryApi> a fost eliminata: compunerea e verificata integral de tsc"
  );
  const identifiers = identifierNames(sourceRegistry);
  for (const banned of ["requireSourceValue", "SourceInstaller", "defaultInstallers", "assertNoUndefinedExports"]) {
    assert.ok(!identifiers.has(banned), `sourceRegistry nu mai are ${banned}: tip de retur inchis + literal explicit = verificare la compilare`);
  }
  const locals = callBoundLocals(sourceRegistry, "createSourceRegistry");
  const families = locals.filter(local => ["http", "steam", "updates", "deals"].includes(local.name));
  assert.deepEqual(
    families.map(local => local.name),
    ["http", "steam", "updates", "deals"],
    "familiile se construiesc in ordinea de dependenta http -> steam -> updates -> deals"
  );
  assert.deepEqual(
    families.map(local => local.callee),
    ["attachHttpClient.buildFrom", "attachSteam.createSteamSource", "attachUpdates.createUpdates", "attachDeals.createDeals"],
    "fiecare familie e construita EXPLICIT prin fabrica ei, fara context progresiv"
  );
  const mutations = calls(sourceRegistry).filter(call => call.callee === "Object.assign" && call.args.length > 1);
  assert.deepEqual(mutations, [], "sourceRegistry nu mai muteaza in-place un context partajat: compunere imutabila prin spread");
  assert.ok(
    returnedCallees(sourceRegistry, "createSourceRegistry").includes("Object.freeze"),
    "registrul de surse returnat e inghetat; completitudinea campurilor e dovedita de tsc pe literalul de retur"
  );
});

test("mongoContext compune prin factory-return imutabil: fiecare strat citeste doar straturile anterioare", () => {
  const mongo = loadModule("infra", "mongo", "mongoContext.ts");
  const identifiers = identifierNames(mongo);
  assert.ok(!identifiers.has("defaultInstallers"), "mongoContext nu mai are lista dinamica defaultInstallers");
  const create = requireFunction(mongo, "createMongoContext");
  assert.deepEqual(create.params, [], "createMongoContext nu mai primeste un array de installers ca parametru");
  const layers = compositionLayers(mongo, "createMongoContext");
  assert.ok(layers.length >= 10, `compunerea are straturi explicite (gasite ${layers.length})`);
  assert.equal(layers[0]?.name, "base", "porneste de la o copie proaspata a modulului de runtime");
  assert.deepEqual(layers[0]?.spreads, ["runtimeContextModule"], "base e o copie, nu singletonul mutat");
  const seen = new Set<string>(["base"]);
  let previous = "base";
  for (const layer of layers.slice(1)) {
    const builders = layer.spreads.filter(spread => spread.includes(".buildFrom("));
    assert.equal(builders.length, 1, `${layer.name}: exact un buildFrom pe strat (compunere prin factory-return)`);
    assert.ok(
      layer.spreads.includes(previous),
      `${layer.name}: extinde strict stratul anterior (${previous}), fara sa sara peste el`
    );
    const argument = normalize(builders[0].slice(builders[0].indexOf("(") + 1, builders[0].lastIndexOf(")")));
    assert.ok(
      argument === "{}" || seen.has(argument),
      `${layer.name}: buildFrom primeste un strat deja construit (${argument}), nu unul viitor`
    );
    seen.add(layer.name);
    previous = layer.name;
  }
  const mutations = calls(mongo).filter(call => call.callee.startsWith("attach") && call.args.includes("context"));
  assert.deepEqual(mutations, [], "nu mai exista apeluri de mutatie attachX(context) in compunere");
  assert.ok(topLevelFrozenExports(mongo).includes("mongoContext"), "exportul mongoContext e inghetat (Object.freeze)");
});

test("as never nu mai exista in codul runtime, verificat pe AST", () => {
  const offenders: string[] = [];
  for (const query of runtimeModules()) {
    const count = assertions(query).filter(entry => entry.toNever).length;
    if (count !== 0) offenders.push(`${query.relativePath}: ${count}`);
  }
  assert.deepEqual(offenders, [], "zero as never in runtime, numarat pe nodurile AST");
});

test("fisierele cu contracte inchise nu au double assertions as unknown as, verificat pe AST", () => {
  const guarded = [
    ["features", "command-registry", "commandRegistry.ts"],
    ["sources", "sourceRegistryFactory.ts"],
    ["app", "main.ts"],
    ["app", "bootstrap.ts"],
    ["features", "command-runtime", "commandRuntimeContext.ts"],
    ["features", "command-runtime", "commandRuntimeDependencies.ts"],
    ["features", "notifications", "index.ts"],
    ["features", "notifications", "outboundChannel.ts"],
    ["features", "notifications", "outboxDelivery.ts"],
    ["features", "notifications", "updateNotificationService.ts"],
    ["features", "notifications", "discountNotificationService.ts"]
  ];
  const offenders: string[] = [];
  for (const segments of guarded) {
    const query = loadModule(...segments);
    const count = assertions(query).filter(entry => entry.throughUnknown).length;
    if (count > 0) offenders.push(`${query.relativePath}: ${count}`);
  }
  assert.deepEqual(offenders, [], "zero X as unknown as Y in fisierele cu contracte inchise");
});

test("notifications nu mai are cast pe modelul Mongo, iar clientul Discord e interfata minima, nu unknown", () => {
  const index = loadModule("features", "notifications", "index.ts");
  assert.deepEqual(
    assertions(index).filter(entry => entry.throughUnknown),
    [],
    "notifications/index.ts fara cast-uri as unknown as (countDocuments e in contractul deps)"
  );
  const contracts = loadModule("features", "notifications", "notificationRuntimeContracts.ts");
  const guildModel = nestedMembers(contracts, "NotificationsRuntimeDeps", "GuildModel");
  assert.ok(
    guildModel.some(member => member.name === "countDocuments"),
    "capabilitatea countDocuments e declarata explicit in NotificationsRuntimeDeps"
  );
  const outbound = loadModule("features", "notifications", "outboundChannel.ts");
  assert.ok(declaresType(outbound, "NotificationDiscordClient"), "interfata minima de client Discord exista");
  for (const query of [
    outbound,
    loadModule("features", "notifications", "updateNotificationService.ts"),
    loadModule("features", "notifications", "discountNotificationService.ts")
  ]) {
    const clients = allMembers(query).filter(member => member.name === "client");
    assert.ok(clients.length > 0, `${query.relativePath}: contractul declara client`);
    for (const client of clients) {
      assert.equal(
        client.type,
        "NotificationDiscordClient",
        `${query.relativePath}: clientul e interfata minima, nu unknown`
      );
    }
  }
});

type RuntimeContextModule = typeof import("../../features/command-runtime/commandRuntimeContext.js")["default"];
type RuntimeContextShape = ReturnType<RuntimeContextModule["createCommandRuntimeContext"]>;
const runtimeContextClosed: HasIndexSignature<RuntimeContextShape> extends false ? true : never = true;
const runtimeContextTyped: RuntimeContextShape extends Record<string, unknown>
  ? (Record<string, unknown> extends RuntimeContextShape ? never : true)
  : true = true;

test("createCommandRuntimeContext intoarce un contract inchis, nu Record<string, unknown>", () => {
  assert.equal(runtimeContextClosed, true, "contextul runtime nu are index signature");
  assert.equal(runtimeContextTyped, true, "tipul de retur e concret, nu bag generic Record<string, unknown>");
  const query = loadModule("features", "command-runtime", "commandRuntimeContext.ts");
  const create = requireFunction(query, "createCommandRuntimeContext");
  assert.equal(create.params[0]?.type, "CommandRuntimeInput", "primeste input-ul injectat");
  assert.equal(create.returnType, "CommandRuntimeDependencies", "intoarce contractul grupat, numit si inchis");
});

test("boot-ul (app/bootstrap.ts) importa static si tipat, ca satisfies AppRuntimeDeps sa nu fie pacalit", () => {
  const bootstrap = loadModule("app", "bootstrap.ts");
  const bootImports = imports(bootstrap);
  assert.ok(
    bootImports.some(entry => entry.module === "./runtimeComposition.js"),
    "boot-ul isi ia bundle-urile din radacina de compunere, nu contextul Mongo plat: contextul are ~46 de exporturi, " +
      "iar `satisfies AppRuntimeDeps` nu poate spune nimic despre ce ia cineva ad-hoc din el"
  );
  assert.ok(
    bootImports.some(entry => entry.module === "../features/command-registry/commandRegistry.js" && entry.defaultName !== null),
    "fabricile de registru importate static; instanta e construita in bootstrap cu input injectat"
  );
  const fromComposition = bootImports
    .filter(entry => entry.module === "./runtimeComposition.js")
    .flatMap(entry => entry.named);
  assert.ok(fromComposition.length > 0, "instantele vin din composition root");
  for (const binding of ["sourceRegistry", "commandRuntimeInput", "mongoContextBundles"]) {
    assert.ok(fromComposition.includes(binding), `bootstrap injecteaza ${binding} din composition root`);
  }
  assert.deepEqual(
    requireSpecifiers(bootstrap).filter(specifier => specifier.startsWith(".")),
    [],
    "niciun require de modul local in boot"
  );
  const built = calls(bootstrap).find(call => call.callee.endsWith("createCommandRegistry"));
  assert.deepEqual(
    built?.args,
    ["commandRuntimeInput"],
    "registrul de comenzi e construit in bootstrap cu input-ul injectat, nu eager la import in features"
  );
  const main = loadModule("app", "main.ts");
  const delegation = imports(main).find(entry => entry.module === "./bootstrap.js");
  assert.ok(delegation?.named.includes("startFromEnv"), "main.ts e un entry subtire care deleaga catre bootstrap-ul tipat");
});

test("contractul CommandHandler e generic cu type predicate: canHandle ingusteaza, handle primeste tipul validat", () => {
  const query = loadModule("features", "command-registry", "commandHandler.ts");
  const canHandle = findMember(query, "CommandHandler", "canHandle");
  assert.equal(canHandle?.params[0]?.type, "unknown", "canHandle primeste unknown la intrare");
  assert.equal(canHandle?.returnType, "interaction is I", "canHandle e un type guard, nu doar boolean");
  const handle = findMember(query, "CommandHandler", "handle");
  assert.equal(handle?.params[0]?.type, "I", "handle primeste interactiunea deja ingustata la I, fara cast intern");
  assert.equal(handle?.params[1]?.type, "CommandGame[]", "games e tipat onest CommandGame, nu Array<{ key }>");
  assert.equal(
    typeAliasTarget(query, "CommandGame"),
    'Pick<GameConfig, "key" | "name" | "appId" | "aliases">',
    "contractul games deriva campurile necesare din GameConfig, inclusiv identitatea folosita de alertele de pret"
  );
});
