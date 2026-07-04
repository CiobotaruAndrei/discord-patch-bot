import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("command cache e factory-only, iar presentation isi deriveaza target-ul installer-ului din factory runtime", () => {
  const commandCache = readSource("features/command-cache/commandCache.ts");
  const commandPresentation = readSource("features/command-presentation/commandPresentation.ts");

  assert.ok(!commandCache.includes("CommandCacheDeps & Record<string, unknown>"));
  assert.ok(!commandCache.includes("Object.assign(target"), "commandCache nu mai are installer care muta target-ul (factory-only, R5 #3)");
  assert.match(commandCache, /const commandCacheModule = \{\s*createCommandCache,\s*computeMissingChannelPerms,\s*formatMissingChannelPerms\s*\};/, "exportul e un obiect plat de factory-uri, fara callable de atasare");
  assert.match(commandCache, /export = commandCacheModule;/);

  assert.ok(!commandPresentation.includes("CommandUiDeps & Record<string, unknown>"));
  assert.match(commandPresentation, /type CommandUiRuntime = ReturnType<typeof createCommandPresentation>/);
  assert.match(commandPresentation, /type CommandUiContext = CommandUiDeps & Partial<CommandUiRuntime>/);
});

test("modulele numite de review-ul R5 #3 sunt factory-only: fara mutare pe target in notifications/index, commandCache si models", () => {
  for (const [file, factoryKey] of [
    ["features/notifications/index.ts", "createNotificationRuntime"],
    ["features/command-cache/commandCache.ts", "createCommandCache"],
    ["infra/mongo/models.ts", "buildFrom"]
  ] as const) {
    const text = readSource(file);
    assert.ok(!/Object\.assign\(target/.test(text), `${file}: fara Object.assign(target, ...) (factory-only)`);
    assert.ok(!/\(\(target[:)]/.test(text), `${file}: fara callable de atasare pe target`);
    assert.ok(text.includes(factoryKey), `${file}: expune factory-ul ${factoryKey}`);
  }
});
