import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("command cache si presentation isi deriveaza target-ul installer-ului din factory runtime", () => {
  const commandCache = readSource("features/command-cache/commandCache.ts");
  const commandPresentation = readSource("features/command-presentation/commandPresentation.ts");

  assert.ok(!commandCache.includes("CommandCacheDeps & Record<string, unknown>"));
  assert.match(commandCache, /type CommandCacheRuntime = ReturnType<typeof createCommandCache>/);
  assert.match(commandCache, /type CommandCacheContext = CommandCacheDeps & Partial<CommandCacheRuntime>/);

  assert.ok(!commandPresentation.includes("CommandUiDeps & Record<string, unknown>"));
  assert.match(commandPresentation, /type CommandUiRuntime = ReturnType<typeof createCommandPresentation>/);
  assert.match(commandPresentation, /type CommandUiContext = CommandUiDeps & Partial<CommandUiRuntime>/);
});
