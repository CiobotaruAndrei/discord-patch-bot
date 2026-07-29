import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const HANDLERS = path.join(srcRoot, "features", "command-handlers");
const PORTS = "discordInteractionPorts.ts";

const PORT_NAMES: readonly string[] = [
  "BaseChatInputInteraction",
  "ChatInputInteraction",
  "AlwaysReplies",
  "AlwaysFollowsUp",
  "InteractionGuildRef",
  "PartialInteractionGuildRef",
  "StringOption",
  "SubcommandOption",
  "AutocompleteResponder"
];

function interactionDeclaration(source: string): string | null {
  const lines = source.split("\n");
  const start = lines.findIndex(line => /^(?:export )?(?:type|interface) (?:Discord|Subscription)?Interaction\b/.test(line));
  if (start === -1) return null;
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && lines[index].trim() === "") break;
    block.push(lines[index]);
  }
  return block.join("\n");
}

function handlerFiles(): string[] {
  const found: string[] = [];
  const stack = [HANDLERS];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".ts") && entry.name !== PORTS) found.push(full);
    }
  }
  return found;
}

test("niciun handler nu isi mai scrie de mana forma interactiunii Discord", () => {
  const offenders: string[] = [];
  for (const file of handlerFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const declaration = interactionDeclaration(source);
    if (!declaration) continue;
    if (PORT_NAMES.some(name => declaration.includes(name))) continue;
    offenders.push(`${path.relative(srcRoot, file)}: forma scrisa inline`);
  }
  assert.deepEqual(
    offenders,
    [],
    "forma unei interactiuni se compune din porturile din discordInteractionPorts.ts (ChatInputInteraction / " +
      "BaseChatInputInteraction + citirile de optiuni), nu se rescrie in fiecare handler: " +
      offenders.join(" | ")
  );
});

test("handlerele care primesc o interactiune importa porturile, nu forme locale", () => {
  const users = handlerFiles().filter(file => fs.readFileSync(file, "utf8").includes("discordInteractionPorts.js"));
  assert.ok(
    users.length >= 30,
    `doar ${users.length} handlere folosesc porturile comune; daca scade, formele locale s-au intors`
  );
});

test("niciun port de interactiune nu accepta payload necunoscut la reply sau followUp", () => {
  const offenders: string[] = [];
  for (const file of [...handlerFiles(), path.join(HANDLERS, PORTS)]) {
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!/\b(reply|followUp)\??[(:]/.test(line)) continue;
      if (!/payload\??:\s*unknown\b/.test(line)) continue;
      offenders.push(`${path.relative(srcRoot, file)}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "payload-ul unui raspuns are un tip (DiscordReplyPayload sau tipul local de payload); `unknown` inseamna ca " +
      `orice valoare trece pana la Discord: ${offenders.join(" | ")}`
  );
});

test("porturile descriu capabilitati numite, nu un obiect mare cu tot", () => {
  const ports = fs.readFileSync(path.join(HANDLERS, PORTS), "utf8");
  for (const name of [
    "BaseChatInputInteraction",
    "ChatInputInteraction",
    "AlwaysReplies",
    "SubcommandOption",
    "SubcommandGroupOption",
    "StringOption",
    "IntegerOption",
    "NumberOption",
    "BooleanOption",
    "RoleOption",
    "UserOption",
    "ChannelOption",
    "FocusedOptionReader",
    "AutocompleteResponder"
  ]) {
    assert.match(ports, new RegExp(`^export (?:interface|type) ${name}\\b`, "m"), `portul ${name} exista`);
  }
  assert.ok(!/\bany\b/.test(ports), "porturile nu slabesc tiparea");
});
