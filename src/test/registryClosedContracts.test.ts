import test from "node:test";
import assert from "node:assert/strict";
import type { SourceRegistryApi } from "../sources/sourceRegistry";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

type Commands = typeof import("../features/command-registry/commandRegistry");
type CommandContext = ReturnType<Commands["createCommandRegistry"]>;
type HasIndexSignature<T> = string extends keyof T ? true : false;

const commandContextClosed: HasIndexSignature<CommandContext> extends false ? true : never = true;
const sourceApiClosed: HasIndexSignature<SourceRegistryApi> extends false ? true : never = true;

const srcRoot = process.cwd();
const commandRegistryPath = path.join(srcRoot, "features", "command-registry", "commandRegistry.ts");
const sourceRegistryPath = path.join(srcRoot, "sources", "sourceRegistry.ts");

test("CommandRegistryContext si SourceRegistryApi sunt contracte inchise, fara index signature", () => {
  assert.equal(commandContextClosed, true, "contextul registrului de comenzi expune doar cheile declarate");
  assert.equal(sourceApiClosed, true, "API-ul registrului de surse expune doar cheile declarate");
  const text = fs.readFileSync(commandRegistryPath, "utf8");
  assert.ok(!text.includes("[key: string]: unknown"), "fara index signature in commandRegistry.ts (regresie: contextul redevine bag netipizat)");
});

test("pregatire migrare commandRegistry: context-urile de handler tipeaza logger canonic (LoggerFunction), nu loose", () => {
  for (const file of ["simpleCommandsHandler.ts", "helpInteractionHandler.ts"]) {
    const text = fs.readFileSync(path.join(srcRoot, "features", "command-handlers", file), "utf8");
    assert.ok(!/logger\??: \(\.\.\.args: unknown\[\]\) => void/.test(text), `${file}: logger nu mai e tipat loose (...args: unknown[]) => void`);
    assert.match(text, /logger\??: LoggerFunction/, `${file}: logger e tipat canonic LoggerFunction (aliniere pentru compunerea explicita)`);
  }
});

test("registrele compun modulele prin importuri statice, nu require-uri inline in array", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  assert.match(cmd, /import attachCommandCache = require\("\.\.\/command-cache\/commandCache"\)/, "module importate static in commandRegistry");
  assert.ok(!/^\s+require\("\.\.\/command/m.test(cmd), "fara require-uri anonime inline in lista de installers");
  const src = fs.readFileSync(sourceRegistryPath, "utf8");
  assert.match(src, /import attachHttpClient = require\("\.\.\/infra\/http\/client"\)/, "module importate static in sourceRegistry");
  assert.ok(!/^\s+require\("\.\.?\//m.test(src), "fara require-uri anonime inline in lista de installers");
});

test("commandRegistry: zonele se compun in createAppServices prin spread imutabil, fara mutatie in-place a unui base partajat (R14 #4)", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  assert.match(cmd, /function createAppServices/, "compunerea zonelor traieste intr-un createAppServices dedicat");
  assert.ok(!/Object\.assign\(\s*base\b/.test(cmd), "zonele nu se mai compun prin Object.assign(base, ...) pe un singur obiect mutat in loc");
  assert.ok(!/const withCache = Object\.assign/.test(cmd), "lantul withCache/withFilters/withPresentation prin Object.assign a fost inlocuit cu spread-uri in obiecte noi");
});

test("pregatire migrare commandRegistry: helper-ele partajate safeDefer/safeEdit/enforceCooldown accepta un contract minimal de interactiune (DeferEditInteraction), nu un DiscordInteraction bogat", () => {
  const text = [
    fs.readFileSync(path.join(srcRoot, "features", "command-presentation", "presentationContracts.ts"), "utf8"),
    fs.readFileSync(path.join(srcRoot, "features", "command-presentation", "interactionReplyHelpers.ts"), "utf8")
  ].join("\n");
  assert.match(text, /interface DeferEditInteraction/, "presentation defineste contractul minimal DeferEditInteraction pentru helper-ele expuse handler-elor");
  assert.match(text, /deferReply\?\(payload\?: unknown\): Promise<unknown>/, "DeferEditInteraction declara deferReply optional (orice DI de handler mai sarac e assignable)");
  for (const helper of ["safeDefer", "safeEdit", "enforceCooldown"]) {
    assert.match(text, new RegExp(`function ${helper}\\(interaction: DeferEditInteraction`), `${helper} primeste DeferEditInteraction (param contravariant minimal), nu DiscordInteraction-ul bogat`);
  }
});

test("pregatire migrare commandRegistry: handle-ul fallback tipeaza games ca GameConfig[], nu unknown[]", () => {
  const text = fs.readFileSync(path.join(srcRoot, "features", "command-handlers", "fallbackInteractionHandler.ts"), "utf8");
  assert.ok(!/games: unknown\[\]/.test(text), "fallback nu mai tipeaza games ca unknown[] (aliniat cu lantul handleInteraction)");
  assert.match(text, /handleInteraction\?: \(interaction: DiscordInteraction, games: GameConfig\[\]\) => Promise<unknown>/, "fallback tipeaza handleInteraction din chain cu games: GameConfig[]");
});

test("pregatire migrare commandRegistry: safeDefer e tipat canonic (interaction, ephemeral?) => Promise<void> peste handlere si accepta contractul minimal in helper-ul comun", () => {
  const realImpl = fs.readFileSync(path.join(srcRoot, "features", "command-presentation", "interactionReplyHelpers.ts"), "utf8");
  assert.match(realImpl, /async function safeDefer\(interaction: DeferEditInteraction, ephemeral = false\): Promise<void>/, "implementarea reala safeDefer accepta contractul minimal si pastreaza (interaction, ephemeral) => Promise<void>");
  const canonicalSafeDeferFiles: Array<{ file: string; interactionType: string }> = [
    { file: "gameFilterHandlers.ts", interactionType: "DiscordInteraction" },
    { file: "outboxAdminHandler.ts", interactionType: "DiscordInteraction" },
    { file: "rolePingHandlers.ts", interactionType: "DiscordInteraction" },
    { file: "setInteractionHandler.ts", interactionType: "DiscordInteraction" },
    { file: "subscriptionCommandContracts.ts", interactionType: "SubscriptionInteraction" }
  ];
  for (const { file, interactionType } of canonicalSafeDeferFiles) {
    const text = fs.readFileSync(path.join(srcRoot, "features", "command-handlers", file), "utf8");
    assert.ok(!new RegExp(`safeDefer: \\(interaction: ${interactionType}\\) => Promise<unknown>`).test(text), `${file}: safeDefer nu mai e declarat loose (interaction) => Promise<unknown>`);
    assert.match(text, new RegExp(`safeDefer: \\(interaction: ${interactionType}, ephemeral\\?: boolean\\) => Promise<void>`), `${file}: safeDefer e tipat canonic, ca implementarea reala`);
  }
});

test("pregatire migrare commandRegistry: GuildModel din notifications foloseste contract segregat (filtru Record<string,unknown>), nu Pick<Model> sau cast as QueryFilter", () => {
  const seen = fs.readFileSync(path.join(srcRoot, "features", "notifications", "seenRepository.ts"), "utf8");
  assert.ok(!/Pick<Model<GuildSettings>/.test(seen), "seenRepository nu mai deriva GuildModelLike din Pick<Model<GuildSettings>> (invarianta filtrului mongoose blocheaza compunerea explicita)");
  assert.match(seen, /updateOne\(filter: Record<string, unknown>/, "seenRepository tipeaza filtrul GuildModel ca Record<string, unknown>, aliniat cu sibling-urile din fisier");
  for (const file of ["updateNotificationService.ts", "discountNotificationService.ts"]) {
    const text = fs.readFileSync(path.join(srcRoot, "features", "notifications", file), "utf8");
    assert.ok(!/as QueryFilter<GuildSettings>/.test(text), `${file}: fara cast as QueryFilter<GuildSettings> (filtrul e Record<string, unknown>, deci cast-ul dispare — bonus regula #2)`);
  }
});

test("pregatire migrare commandRegistry: listele Generated*Deps omit cheile generate intern de seenRepository (nu se scurg ca input extern)", () => {
  const contracts = fs.readFileSync(path.join(srcRoot, "features", "notifications", "notificationRuntimeContracts.ts"), "utf8");
  const updateBlock = contracts.slice(contracts.indexOf("type GeneratedUpdateDeps"), contracts.indexOf("type GeneratedDiscountDeps"));
  for (const key of ["seedSeenUpdates", "setSeenHashVersion"]) {
    assert.ok(updateBlock.includes(`"${key}"`), `GeneratedUpdateDeps omite ${key} (generat intern de createSeenRepository)`);
  }
  const discountBlock = contracts.slice(contracts.indexOf("type GeneratedDiscountDeps"), contracts.indexOf("type NotificationsRuntimeDeps"));
  for (const key of ["loadSeenDiscountHashes", "seedSeenDiscounts", "setSeenHashVersion"]) {
    assert.ok(discountBlock.includes(`"${key}"`), `GeneratedDiscountDeps omite ${key} (generat intern de createSeenRepository)`);
  }
});

test("notifications: wiring-ul central traieste in module-factory pe domenii, iar index.ts doar le compune", () => {
  const index = fs.readFileSync(path.join(srcRoot, "features", "notifications", "index.ts"), "utf8");
  const outboxFactory = fs.readFileSync(path.join(srcRoot, "features", "notifications", "outboxRuntimeFactory.ts"), "utf8");
  const seenFactory = fs.readFileSync(path.join(srcRoot, "features", "notifications", "seenRuntimeFactory.ts"), "utf8");
  assert.ok(outboxFactory.includes("function createOutboxServices("), "outboxRuntimeFactory detine createOutboxServices");
  assert.ok(seenFactory.includes("function createSeenServices("), "seenRuntimeFactory detine createSeenServices");
  for (const [file, builder] of [
    ["updateNotificationRuntime.ts", "function createUpdateNotificationRuntime("],
    ["discountNotificationRuntime.ts", "function createDiscountNotificationRuntime("],
    ["youtubeNotificationRuntime.ts", "function createYouTubeNotificationRuntime("]
  ] as const) {
    const text = fs.readFileSync(path.join(srcRoot, "features", "notifications", file), "utf8");
    assert.ok(text.includes(builder), `${file} detine ${builder.replace("function ", "").replace("(", "")}`);
  }
  assert.ok(index.includes("function createNotificationDispatchServices("), "index.ts pastreaza compozitorul de dispatch");
  const dispatchStart = index.indexOf("function createNotificationDispatchServices(");
  const dispatchBody = index.slice(dispatchStart, index.indexOf("\n}", dispatchStart));
  assert.match(dispatchBody, /createUpdateNotificationRuntime\(deps, resolveOutboundChannel, seenRepository\)/, "dispatch-ul compune runtime-ul de update din modulul lui");
  assert.match(dispatchBody, /createDiscountNotificationRuntime\(deps, resolveOutboundChannel, seenRepository\)/, "dispatch-ul compune runtime-ul de discount (+ price alerts) din modulul lui");
  assert.match(dispatchBody, /createYouTubeNotificationRuntime\(deps, resolveOutboundChannel\)/, "dispatch-ul compune runtime-ul YouTube din modulul lui");
  const runtimeStart = index.indexOf("function createNotificationRuntime(");
  const runtimeBody = index.slice(runtimeStart, index.indexOf("\n}", runtimeStart));
  assert.match(runtimeBody, /createOutboxServices\(deps\)/, "createNotificationRuntime deleaga la createOutboxServices");
  assert.match(runtimeBody, /createSeenServices\(deps\)/, "createNotificationRuntime deleaga la createSeenServices");
  assert.match(runtimeBody, /createNotificationDispatchServices\(deps, resolveOutboundChannel, seenRepository\)/, "createNotificationRuntime deleaga la createNotificationDispatchServices (dispatch consuma resolveOutboundChannel + seenRepository)");
  assert.ok(!/createOutboxRuntime\(/.test(runtimeBody), "createNotificationRuntime nu mai construieste direct sub-serviciile (outbox e in createOutboxServices), ci doar compune");
  assert.ok(!/createUpdateNotificationService\(|createDiscountNotificationService\(|createYouTubeNotificationService\(/.test(index), "index.ts nu mai construieste direct serviciile de domeniu — doar compune module-factory");
});

test("pregatire migrare commandRegistry: tipurile de update fetch (notifications + latest) sunt aliniate la FetchResult, nu vederi loose ({id}&Record)", () => {
  const queue = fs.readFileSync(path.join(srcRoot, "features", "notifications", "pendingUpdatesQueue.ts"), "utf8");
  assert.match(queue, /export type UpdateFetchResult = FetchResult/, "UpdateFetchResult e alias FetchResult (latest: NormalizedUpdate real, nu {id}&Record)");
  const latest = fs.readFileSync(path.join(srcRoot, "features", "command-handlers", "latest", "latestUpdatesHandler.ts"), "utf8");
  assert.match(latest, /type UpdateRecord = FetchResult/, "UpdateRecord e alias FetchResult");
  assert.ok(!/latest: \(\{ id: string \} & Record<string, unknown>\) \| null/.test(queue + latest), "fara latest loose ({id}&Record)|null in tipurile de update fetch (datoria raw-vs-normalized rezolvata pe calea update)");
});

test("notifications: serviciile nu mai au intersectia redundanta GuildSettings & Record<string, unknown> (GuildSettings poarta deja index-sig), nici caste as { seenHashVersion } evitabile", () => {
  const types = fs.readFileSync(path.join(srcRoot, "types.ts"), "utf8");
  assert.match(types, /interface GuildSettings\b[\s\S]*?\[key: string\]: unknown/, "GuildSettings poarta deja index-sig, deci & Record<string, unknown> e redundant");
  for (const file of ["updateNotificationService.ts", "discountNotificationService.ts"]) {
    const text = fs.readFileSync(path.join(srcRoot, "features", "notifications", file), "utf8");
    assert.ok(!/GuildSettings & Record<string, unknown>/.test(text), `${file}: fara intersectia redundanta GuildSettings & Record<string, unknown>`);
    assert.ok(!/as \{ seenHashVersion(Updates|Discounts)\?: unknown \}/.test(text), `${file}: fara cast redundant as { seenHashVersion... } (index-sig da deja unknown la acces direct)`);
  }
});

test("installerele nu mai sunt coercitate cu as unknown as sau as never in registre", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  const src = fs.readFileSync(sourceRegistryPath, "utf8");
  assert.ok(!cmd.includes("as unknown as"), "commandRegistry nu mai are bypass-uri as unknown as");
  assert.ok(!src.includes("as unknown as"), "sourceRegistry nu mai are bypass-uri as unknown as");
  assert.equal((cmd.match(/as never/g) || []).length, 0, "commandRegistry nu mai are granita as never");
  assert.equal((src.match(/as never/g) || []).length, 0, "sourceRegistry nu mai are granita as never");
  assert.ok(!cmd.includes("LegacyInstallerTarget"), "commandRegistry nu mai are tinta legacy bazata pe Record<string, unknown>");
  assert.match(cmd, /function createCommandRegistry\(\s*overrides: Partial<[^)]+> = \{\}\s*\): RequiredCommandRegistry/, "commandRegistry compune explicit, cu tip de retur inchis RequiredCommandRegistry; singurul parametru e un override TIPAT Partial<context> pentru injectare in teste (nu un boundary de installers dinamici)");
  assert.ok(!/installers/.test(cmd), "commandRegistry nu mai are mecanismul de installers dinamici: compunere prin factory-uri reale + Object.assign + lista tipata CommandHandler[]");
  assert.ok(!cmd.includes("CommandInstallerTarget"), "commandRegistry nu mai are CommandInstallerTarget (boundary-ul dinamic installers: unknown[] a fost eliminat)");
  assert.ok(!cmd.includes("isCommandModuleInstaller"), "commandRegistry nu mai are garda runtime isCommandModuleInstaller (compunerea e statica, verificata de tsc)");
  assert.ok(!/context as /.test(cmd), "boundary-ul de compunere nu foloseste cast-uri (`context as T`), ci factory-uri tipate si Object.assign");
  assert.match(cmd, /function requireInstalled/, "commandRegistry verifica fail-fast ca functiile adaugate de handlere (handleInteraction/buildHelpEmbed) exista dupa compunere");
  assert.match(cmd, /const commandHandlers: CommandHandler\[\]/, "routing-ul e o lista tipata CommandHandler[] (din attach*.buildCommandHandler(ctx)), nu un lant de installX care impacheteaza handleInteraction");
  assert.match(cmd, /async function dispatchCommand/, "commandRegistry ruteaza prin dispatchCommand (loop canHandle/handle, fallback ultimul), nu prin lant ordonat-sensibil de installX");
  assert.match(cmd, /attachAdminCommandRouterGuard\(ctx\)/, "pre-check-ul admin (requireGuildAdmin) ramane singurul wrapper peste dispatchCommand");
  assert.ok((cmd.match(/\.buildCommandHandler\(ctx\)/g) || []).length >= 15, "fiecare handler de comanda contribuie la lista tipata prin buildCommandHandler(ctx) (>= 15 ocurente)");
  assert.match(src, /type SourceRuntimeContext = Partial<SourceRegistryApi>/, "sourceRegistry modeleaza contextul progresiv ca Partial<SourceRegistryApi>");
  assert.match(src, /function requireSourceValue/, "sourceRegistry citeste exporturile prin garda fail-fast pe chei");
  assert.ok(!/SourceRuntimeContext = [^\n]*Record<string, unknown>/.test(src), "SourceRuntimeContext nu mai e largit cu Record<string, unknown> (R11 #5): contextul progresiv e exact Partial<SourceRegistryApi> & runtime");
  assert.match(src, /function createSourceRegistry\(\): SourceRegistryApi/, "sourceRegistry compune explicit, cu tip de retur inchis SourceRegistryApi (nu mai accepta installers ca parametru)");
  assert.ok(!src.includes("SourceInstaller"), "sourceRegistry nu mai are tipul SourceInstaller (boundary-ul dinamic installers a fost eliminat)");
  assert.ok(!src.includes("defaultInstallers"), "sourceRegistry nu mai are lista dinamica defaultInstallers; compune prin valori returnate de factory-uri (build*From) ordonate (http -> steam -> updates -> deals)");
  assert.match(src, /attachHttpClient\.buildFrom\(base\)[\s\S]*attachSteam\.buildFrom\(withHttp\)[\s\S]*attachUpdates\.buildFrom\(withSteam\)[\s\S]*attachDeals\.buildFrom\(withUpdates\)/, "sourceRegistry compune prin valorile returnate de build*From, ordonate http->steam->updates->deals, prin spread in obiecte noi (la fel ca commandRegistry)");
  assert.ok(!/Object\.assign\(\s*context\b/.test(src), "sourceRegistry nu mai muteaza in-place un context partajat (fara Object.assign(context, ...)): compunere imutabila prin spread (R18 #4)");
  assert.match(src, /return Object\.freeze\(assertNoUndefinedExports/, "registrul de surse returnat e inghetat (Object.freeze), ca registrul public sa nu poata fi mutat dupa compunere");
  assert.ok(!cmd.includes("(...args: unknown[]) => MaybePromise<unknown>"), "commandRegistry nu mai are tipul generic RegistryFunction = (...args: unknown[]) (R11 #4): campurile contractului au semnaturi precise");
});

test("mongoContext compune prin factory-return (build*From) imutabil, ca sourceRegistry: fara installer dinamic, fara mutatie pe context, export inghetat", () => {
  const mongo = fs.readFileSync(path.join(srcRoot, "infra", "mongo", "mongoContext.ts"), "utf8");
  assert.ok(!/defaultInstallers/.test(mongo), "mongoContext nu mai are lista dinamica defaultInstallers");
  assert.ok(!/for \(const install of/.test(mongo), "mongoContext nu mai are bucla dinamica peste installers");
  assert.ok(!/installers: MongoInstaller\[\]/.test(mongo), "createMongoContext nu mai primeste un array de installers ca parametru");
  assert.match(mongo, /const base: MongoRuntimeContext = \{ \.\.\.baseContext \}/, "porneste de la o copie proaspata, nu muteaza singletonul runtime");
  assert.match(mongo, /\{ \.\.\.base, \.\.\.attachLogging\.buildFrom\(base\) \}/, "compune prin valorile returnate de build*From (factory-return), nu prin mutatie attachX(context)");
  assert.match(mongo, /attachModels\.buildFrom\(withUtilities\)[\s\S]*attachFetchSnapshots\.buildFrom\(withAdminAlerts\)/, "spread imutabil ordonat in obiecte noi (fiecare strat citeste doar campurile straturilor anterioare)");
  assert.ok(!/attachLogging\(context\)/.test(mongo), "nu mai exista apeluri de mutatie attachX(context) in compunere");
  assert.match(mongo, /Object\.freeze\(\{ \.\.\.createMongoContext\(\), createMongoContext \}\)/, "exportul mongoContext e inghetat (Object.freeze)");
});

const tsApi = require("typescript") as typeof import("typescript");

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test" || entry.name === "target") continue;
      walkTsFiles(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function countTypeAssertions(filePath: string): { asNever: number; doubleUnknown: number } {
  const source = tsApi.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), tsApi.ScriptTarget.Latest, true);
  const counts = { asNever: 0, doubleUnknown: 0 };
  const visit = (node: import("typescript").Node): void => {
    if (tsApi.isAsExpression(node)) {
      if (node.type.kind === tsApi.SyntaxKind.NeverKeyword) counts.asNever++;
      if (tsApi.isAsExpression(node.expression) && node.expression.type.kind === tsApi.SyntaxKind.UnknownKeyword) counts.doubleUnknown++;
    }
    tsApi.forEachChild(node, visit);
  };
  visit(source);
  return counts;
}

test("as never nu mai exista in codul runtime, verificat pe AST, nu pe text", () => {
  const offenders: string[] = [];
  for (const root of ["app", "features", "sources", "infra", "shared", "domain", "config"]) {
    const dir = path.join(srcRoot, root);
    if (!fs.existsSync(dir)) continue;
    for (const file of walkTsFiles(dir)) {
      const { asNever } = countTypeAssertions(file);
      if (asNever !== 0) offenders.push(`${path.relative(srcRoot, file)}: ${asNever}`);
    }
  }
  assert.deepEqual(offenders, [], "zero as never in runtime, numarat pe nodurile AST");
});

test("fisierele cu contracte inchise nu au double assertions as unknown as, verificat pe AST (review #11.4)", () => {
  const guardedFiles = [
    commandRegistryPath,
    sourceRegistryPath,
    path.join(srcRoot, "app", "main.ts"),
    path.join(srcRoot, "features", "command-runtime", "commandRuntimeContext.ts"),
    path.join(srcRoot, "features", "notifications", "index.ts"),
    path.join(srcRoot, "features", "notifications", "outboundChannel.ts"),
    path.join(srcRoot, "features", "notifications", "outboxDelivery.ts"),
    path.join(srcRoot, "features", "notifications", "updateNotificationService.ts"),
    path.join(srcRoot, "features", "notifications", "discountNotificationService.ts")
  ];
  const offenders: string[] = [];
  for (const file of guardedFiles) {
    const { doubleUnknown } = countTypeAssertions(file);
    if (doubleUnknown > 0) offenders.push(`${path.relative(srcRoot, file)}: ${doubleUnknown}`);
  }
  assert.deepEqual(offenders, [], "zero X as unknown as Y in fisierele cu contracte inchise");
});

test("notifications nu mai are cast pe modelul Mongo, iar clientul Discord e interfata minima, nu unknown (review #10.3 + #10.4)", () => {
  const notificationsIndexPath = path.join(srcRoot, "features", "notifications", "index.ts");
  const outboundChannelPath = path.join(srcRoot, "features", "notifications", "outboundChannel.ts");
  const updateServicePath = path.join(srcRoot, "features", "notifications", "updateNotificationService.ts");
  const discountServicePath = path.join(srcRoot, "features", "notifications", "discountNotificationService.ts");
  const indexText = fs.readFileSync(notificationsIndexPath, "utf8");
  assert.ok(!indexText.includes("as unknown as"), "notifications/index.ts fara cast-uri as unknown as (countDocuments e in contractul deps)");
  const contractsText = fs.readFileSync(path.join(srcRoot, "features", "notifications", "notificationRuntimeContracts.ts"), "utf8");
  assert.match(contractsText, /GuildModel: \{ countDocuments\(/, "capabilitatea countDocuments e declarata explicit in NotificationsRuntimeDeps");
  const outbound = fs.readFileSync(outboundChannelPath, "utf8");
  assert.match(outbound, /export interface NotificationDiscordClient/, "interfata minima de client Discord exista si e exportata");
  assert.match(outbound, /client: NotificationDiscordClient/, "resolver-ul cere interfata minima, nu unknown");
  assert.ok(!/client: unknown/.test(outbound), "fara client: unknown in outboundChannel");
  for (const servicePath of [updateServicePath, discountServicePath]) {
    const text = fs.readFileSync(servicePath, "utf8");
    assert.match(text, /client: NotificationDiscordClient/, `${path.basename(servicePath)} foloseste interfata minima de client`);
    assert.ok(!/client: unknown/.test(text), `${path.basename(servicePath)} fara client: unknown`);
  }
});

type RuntimeContextModule = typeof import("../features/command-runtime/commandRuntimeContext");
type RuntimeContextShape = ReturnType<RuntimeContextModule["createCommandRuntimeContext"]>;
const runtimeContextClosed: HasIndexSignature<RuntimeContextShape> extends false ? true : never = true;
const runtimeContextTyped: RuntimeContextShape extends Record<string, unknown>
  ? (Record<string, unknown> extends RuntimeContextShape ? never : true)
  : true = true;

test("createCommandRuntimeContext intoarce un contract inchis, nu Record<string, unknown> (review #9.2 + #9.6)", () => {
  assert.equal(runtimeContextClosed, true, "contextul runtime nu are index signature");
  assert.equal(runtimeContextTyped, true, "tipul de retur e concret, nu bag generic Record<string, unknown>");
  const runtimePath = path.join(srcRoot, "features", "command-runtime", "commandRuntimeContext.ts");
  const text = fs.readFileSync(runtimePath, "utf8");
  assert.ok(!/createCommandRuntimeContext\(\): Record<string, unknown>/.test(text), "return type explicit, nu Record<string, unknown>");
  assert.match(text, /createCommandRuntimeContext\(\): CommandRuntimeContext/, "return type numit si inchis");
});

test("boot-ul din main.ts foloseste require-uri tipate, ca satisfies AppRuntimeDeps sa nu fie pacalit de any (review #9.1 + #9.6)", () => {
  const mainPath = path.join(srcRoot, "app", "main.ts");
  const text = fs.readFileSync(mainPath, "utf8");
  assert.match(text, /require\("\.\.\/infra\/mongo\/mongoContext"\) as typeof import\("\.\.\/infra\/mongo\/mongoContext"\)/, "mongoContext tipat");
  assert.match(text, /require\("\.\.\/features\/command-registry\/commandRegistry"\) as typeof import\("\.\.\/features\/command-registry\/commandRegistry"\)/, "commandRegistry tipat");
  assert.match(text, /require\("\.\.\/sources\/sourceRegistry"\) as SourceRegistryApi/, "sourceRegistry tipat cu API-ul value-tipat");
  assert.match(text, /satisfies AppRuntimeDeps/, "wiring-ul de boot ramane verificat cu satisfies");
  const untypedRequires = (text.match(/= require\("\.[^"]+"\);\r?\n/g) || []).filter(line => !line.includes("as typeof import") && !line.includes("as SourceRegistryApi"));
  assert.deepEqual(untypedRequires, [], "niciun require de modul local netipat in boot");
});

test("contractul CommandHandler e generic cu type predicate (canHandle ingusteaza interaction, handle primeste tipul validat)", () => {
  const handlerPath = path.join(srcRoot, "features", "command-registry", "commandHandler.ts");
  const text = fs.readFileSync(handlerPath, "utf8");
  assert.match(text, /interface CommandHandler<I = unknown>/, "CommandHandler e generic peste tipul de interactiune validat I");
  assert.match(text, /canHandle\(interaction: unknown\): interaction is I/, "canHandle e un type guard (interaction is I), nu doar boolean");
  assert.match(text, /handle\(interaction: I, games: CommandGame\[\]\)/, "handle primeste interactiunea deja ingustata la I (fara cast intern) si games tipat onest CommandGame, nu Array<{ key }>");
  assert.match(text, /type CommandGame = Pick<GameConfig, "key" \| "name" \| "appId" \| "aliases">/, "contractul games deriva campurile necesare din GameConfig, inclusiv identitatea folosita de alertele de pret");
});
