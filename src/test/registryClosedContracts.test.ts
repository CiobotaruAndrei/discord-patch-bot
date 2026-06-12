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
