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

test("registrele compun modulele prin importuri statice, nu require-uri inline in array", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  assert.match(cmd, /import attachCommandCache = require\("\.\.\/command-cache\/commandCache"\)/, "module importate static in commandRegistry");
  assert.ok(!/^\s+require\("\.\.\/command/m.test(cmd), "fara require-uri anonime inline in lista de installers");
  const src = fs.readFileSync(sourceRegistryPath, "utf8");
  assert.match(src, /import attachHttpClient = require\("\.\.\/infra\/http\/client"\)/, "module importate static in sourceRegistry");
  assert.ok(!/^\s+require\("\.\.?\//m.test(src), "fara require-uri anonime inline in lista de installers");
});

test("installerele nu mai sunt coercitate cu as unknown as; granita e un singur as never per registru (review #9.3 + #9.6)", () => {
  const cmd = fs.readFileSync(commandRegistryPath, "utf8");
  const src = fs.readFileSync(sourceRegistryPath, "utf8");
  assert.ok(!cmd.includes("as unknown as"), "commandRegistry nu mai are bypass-uri as unknown as");
  assert.ok(!src.includes("as unknown as"), "sourceRegistry nu mai are bypass-uri as unknown as");
  assert.equal((cmd.match(/as never/g) || []).length, 1, "exact o granita as never in commandRegistry (bucla de instalare)");
  assert.equal((src.match(/as never/g) || []).length, 1, "exact o granita as never in sourceRegistry (bucla de instalare)");
  assert.match(cmd, /\(context: never\) => void/, "tipul installer-ului nu pretinde un context pe care nu-l poate proba static");
  assert.match(src, /\(target: never\) => void/, "tipul installer-ului nu pretinde un context pe care nu-l poate proba static");
});

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

test("as never ramane izolat in cele doua registre; nu se raspandeste in restul codului (review #10.5)", () => {
  const allowed = new Set([commandRegistryPath, sourceRegistryPath]);
  const offenders: string[] = [];
  for (const root of ["app", "features", "sources", "infra", "shared", "domain", "config"]) {
    const dir = path.join(srcRoot, root);
    if (!fs.existsSync(dir)) continue;
    for (const file of walkTsFiles(dir)) {
      if (allowed.has(file)) continue;
      if (fs.readFileSync(file, "utf8").includes("as never")) offenders.push(path.relative(srcRoot, file));
    }
  }
  assert.deepEqual(offenders, [], "granita as never exista DOAR in registre, pinuita la cate o aparitie");
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
