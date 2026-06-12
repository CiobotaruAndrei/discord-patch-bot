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
