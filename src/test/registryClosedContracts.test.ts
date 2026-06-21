import test from "node:test";
import assert from "node:assert/strict";
import type { SourceRegistryApi } from "../sources/sourceRegistry";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

type Commands = typeof import("../features/command-registry/commandRegistry");
type CommandContext = NonNullable<Parameters<Commands["createCommandRegistry"]>[0]>;
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

test("installerele nu mai sunt coercitate cu as unknown as sau as never in registre", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  const src = fs.readFileSync(sourceRegistryPath, "utf8");
  assert.ok(!cmd.includes("as unknown as"), "commandRegistry nu mai are bypass-uri as unknown as");
  assert.ok(!src.includes("as unknown as"), "sourceRegistry nu mai are bypass-uri as unknown as");
  assert.equal((cmd.match(/as never/g) || []).length, 0, "commandRegistry nu mai are granita as never");
  assert.equal((src.match(/as never/g) || []).length, 0, "sourceRegistry nu mai are granita as never");
  assert.ok(!cmd.includes("LegacyInstallerTarget"), "commandRegistry nu mai are tinta legacy bazata pe Record<string, unknown>");
  assert.match(cmd, /type CommandInstallerTarget = CommandRuntimeBootContext & CommandRegistryContext/, "commandRegistry foloseste o tinta explicita din boot context + registry context");
  assert.match(cmd, /const installContext: CommandInstallerTarget = context;/, "tinta de instalare e o atribuire tipata explicit (CommandRuntimeBootContext e assignable la contractul all-optional), nu un cast");
  assert.ok(!/context as /.test(cmd), "boundary-ul de instalare nu mai foloseste un cast (`context as T & CommandInstallerTarget`), ci o atribuire tipata");
  assert.match(cmd, /function isCommandModuleInstaller/, "commandRegistry verifica runtime ca fiecare installer e functie");
  assert.match(src, /type SourceRuntimeContext = Partial<SourceRegistryApi>/, "sourceRegistry modeleaza contextul progresiv ca Partial<SourceRegistryApi>");
  assert.match(src, /function requireSourceValue/, "sourceRegistry citeste exporturile prin garda fail-fast pe chei");
  assert.ok(!/SourceRuntimeContext = [^\n]*Record<string, unknown>/.test(src), "SourceRuntimeContext nu mai e largit cu Record<string, unknown> (R11 #5): contextul progresiv e exact Partial<SourceRegistryApi> & runtime");
  assert.ok(!cmd.includes("(...args: unknown[]) => MaybePromise<unknown>"), "commandRegistry nu mai are tipul generic RegistryFunction = (...args: unknown[]) (R11 #4): campurile contractului au semnaturi precise");
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
  assert.match(indexText, /GuildModel: \{ countDocuments\(/, "capabilitatea countDocuments e declarata explicit in NotificationsRuntimeDeps");
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
