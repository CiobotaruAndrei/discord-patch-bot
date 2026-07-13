import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

const commandRegistry = (await import("../features/command-registry/commandRegistry.js")).default;

type CanHandle = (interaction: unknown) => boolean;

interface SlashJsonOption { type: number; name: string; options?: SlashJsonOption[] }
interface SlashJsonCommand { name: string; options?: SlashJsonOption[] }

function slashCommandProbePaths(defs: SlashJsonCommand[]): Array<{ label: string; commandName: string; group: string | null; sub: string }> {
  const paths: Array<{ label: string; commandName: string; group: string | null; sub: string }> = [];
  for (const command of defs) {
    const options = command.options || [];
    const nested = options.some(option => option.type === 1 || option.type === 2);
    if (!nested) {
      paths.push({ label: `/${command.name}`, commandName: command.name, group: null, sub: "" });
      continue;
    }
    for (const option of options) {
      if (option.type === 1) {
        paths.push({ label: `/${command.name} ${option.name}`, commandName: command.name, group: null, sub: option.name });
      }
      if (option.type === 2) {
        for (const subcommand of option.options || []) {
          if (subcommand.type === 1) {
            paths.push({ label: `/${command.name} ${option.name} ${subcommand.name}`, commandName: command.name, group: option.name, sub: subcommand.name });
          }
        }
      }
    }
  }
  return paths;
}

function makeProbe(commandName: string, group: string | null, sub: string): Record<string, unknown> {
  return {
    commandName,
    guild: { id: "guild-cov" },
    user: { id: "user-cov" },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    options: {
      getSubcommand: (_required?: boolean) => sub,
      getSubcommandGroup: (_required?: boolean) => group,
      getFocused: () => null,
      getString: () => null,
      getInteger: () => null,
      getBoolean: () => null,
      getNumber: () => null,
      getChannel: () => null,
      getRole: () => null
    },
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

test("fiecare comanda slash e revendicata de un handler dedicat, nu de fallback (guard de acoperire, review r2 item 12)", () => {
  const ctx = commandRegistry.createAppServices({ getGuildSettings: async () => null });
  const { commandHandlers } = commandRegistry.buildCommandHandlerList(ctx);
  assert.ok(commandHandlers.length > 10, "lista de handler-e a fost construita");

  const fallback = commandHandlers[commandHandlers.length - 1];
  const fallbackClaims = (fallback.canHandle as CanHandle)(makeProbe("comanda-inexistenta", null, ""));
  assert.equal(fallbackClaims, true, "ultimul handler e catch-all-ul (fallback), altfel dispatch-ul poate pierde interactiuni");

  const dedicated = commandHandlers.slice(0, -1);
  const defs = ctx.buildSlashCommandDefinitions() as SlashJsonCommand[];
  const paths = slashCommandProbePaths(defs);
  assert.ok(paths.length > 40, "caile de comenzi au fost extrase din slash definitions");

  for (const path of paths) {
    const probe = makeProbe(path.commandName, path.group, path.sub);
    const claimed = dedicated.some(handler => (handler.canHandle as CanHandle)(probe));
    assert.equal(claimed, true, `${path.label} nu e revendicata de niciun handler dedicat — ar cadea pe fallback (comanda inregistrata la Discord fara implementare rutata)`);
  }
});
