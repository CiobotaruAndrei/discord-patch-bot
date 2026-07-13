import { pathToFileURL as __pathToFileURL } from "node:url";
import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, SlashCommandBuilder, PermissionsBitField } from "discord.js";
import { buildSmokeResult, writeSmokeResult } from "./smokeResult.js";
import type { SmokeCheck } from "./smokeResult.js";
import type { CurrencyRegistry } from "../types.js";
import attachSlashCommands from "../features/command-definitions/slashCommandDefinitions.js";

interface NamedCommand { name?: string }
interface CommandsEval { ok: boolean; count: number; missing: string[] }
interface PermsEval { ok: boolean; missing: string[] }

const SMOKE_CURRENCIES: CurrencyRegistry = {
  USD: { cc: "US", symbol: "$", placement: "prefix" },
  EUR: { cc: "DE", symbol: "EUR", placement: "prefix" },
  GBP: { cc: "GB", symbol: "GBP", placement: "prefix" },
  RON: { cc: "RO", symbol: " lei", placement: "suffix" }
};

interface SendableSmokeChannel {
  isTextBased(): boolean;
  send(payload: unknown): Promise<{ delete(): Promise<unknown> }>;
}

function isSendableSmokeChannel(channel: unknown): channel is SendableSmokeChannel {
  return !!channel
    && typeof (channel as { isTextBased?: unknown }).isTextBased === "function"
    && (channel as { isTextBased: () => boolean }).isTextBased()
    && typeof (channel as { send?: unknown }).send === "function";
}

function sendabilityFailureDetail(channel: unknown): string {
  if (!channel || typeof (channel as { isTextBased?: unknown }).isTextBased !== "function" || !(channel as { isTextBased: () => boolean }).isTextBased()) {
    return "canalul nu e text-based";
  }
  return "canalul nu are functia send";
}

function expectedCommandNames(): string[] {
  const { buildSlashCommandDefinitions } = attachSlashCommands.createSlashCommandDefinitions({
    SlashCommandBuilder,
    PermissionsBitField,
    Routes,
    REST,
    SUPPORTED_CURRENCIES: SMOKE_CURRENCIES,
    logger: () => undefined
  });
  return (buildSlashCommandDefinitions() as NamedCommand[]).map(definition => String(definition?.name || "")).filter(Boolean);
}

const REQUIRED_COMMANDS = expectedCommandNames();
const REQUIRED_PERMISSIONS = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"];
const READY_TIMEOUT_MS = 30000;

function evaluateCommands(registered: NamedCommand[], requiredAny: string[] = REQUIRED_COMMANDS): CommandsEval {
  const names = new Set(registered.map(command => String(command?.name || "")).filter(Boolean));
  const missing = requiredAny.filter(name => !names.has(name));
  return { ok: registered.length > 0 && missing.length === 0, count: registered.length, missing };
}

function evaluatePermissions(grantedNames: string[], requiredNames: string[] = REQUIRED_PERMISSIONS): PermsEval {
  const granted = new Set(grantedNames);
  const missing = requiredNames.filter(name => !granted.has(name));
  return { ok: missing.length === 0, missing };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout (${label}) dupa ${ms}ms`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, err => { clearTimeout(timer); reject(err); });
  });
}

async function runDiscordSmoke(): Promise<number> {
  const token = (process.env.STAGING_DISCORD_TOKEN || "").trim();
  const clientId = (process.env.STAGING_DISCORD_CLIENT_ID || "").trim();
  const guildId = (process.env.STAGING_TEST_GUILD_ID || "").trim();
  const channelId = (process.env.STAGING_TEST_CHANNEL_ID || "").trim();
  const sendTest = (process.env.STAGING_DISCORD_SEND_TEST || "").trim().toLowerCase() === "true";

  if (!token || !clientId || !guildId || !channelId) {
    const allowSkip = (process.env.ALLOW_STAGING_SMOKE_SKIP || "").trim().toLowerCase() === "true";
    console.log("[discord-smoke] Credentiale de staging incomplete - proba live Discord nu poate rula.");
    console.log("[discord-smoke] Seteaza STAGING_DISCORD_TOKEN, STAGING_DISCORD_CLIENT_ID, STAGING_TEST_GUILD_ID,");
    console.log("[discord-smoke] STAGING_TEST_CHANNEL_ID (+ optional STAGING_DISCORD_SEND_TEST=true) ca sa rulezi proba live.");
    writeSmokeResult("STAGING_DISCORD_SMOKE_RESULT_FILE", buildSmokeResult("discord", true, []));
    if (!allowSkip) {
      console.error("::error::[discord-smoke] Credentiale de staging incomplete si ALLOW_STAGING_SMOKE_SKIP != true -> esec (nu raporta verde fara proba live). Seteaza secretele de staging sau ALLOW_STAGING_SMOKE_SKIP=true ca sa sari intentionat.");
      return 1;
    }
    console.log("[discord-smoke] ALLOW_STAGING_SMOKE_SKIP=true -> sar proba live Discord (exit 0).");
    return 0;
  }

  const checks: SmokeCheck[] = [];
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      client.once("ready", () => resolve());
      client.once("error", reject);
      client.login(token).catch(reject);
    }), READY_TIMEOUT_MS, "login + ready");
    checks.push({ name: "login", ok: true, detail: `READY ca ${client.user?.tag || "?"}` });
    console.log(`[discord-smoke] Gateway READY ca ${client.user?.tag || "?"} (token + gateway OK).`);

    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const guildCmds = await rest.get(Routes.applicationGuildCommands(clientId, guildId)) as NamedCommand[];
      const globalCmds = await rest.get(Routes.applicationCommands(clientId)) as NamedCommand[];
      const all = [...(Array.isArray(guildCmds) ? guildCmds : []), ...(Array.isArray(globalCmds) ? globalCmds : [])];
      const evalC = evaluateCommands(all);
      checks.push({ name: "commands", ok: evalC.ok, detail: evalC.ok ? `${evalC.count} inregistrate` : `inregistrate=${evalC.count}, lipsa=${evalC.missing.join(", ") || "(niciuna)"}` });
      if (!evalC.ok) {
        console.error(`[discord-smoke] Slash commands FAIL: inregistrate=${evalC.count}, lipsa=${evalC.missing.join(", ") || "(niciuna)"}`);
      } else {
        console.log(`[discord-smoke] Slash commands OK (${evalC.count} inregistrate; toate cele ${REQUIRED_COMMANDS.length} comenzi din buildSlashCommandDefinitions prezente).`);
      }
    } catch (err) {
      checks.push({ name: "commands", ok: false, detail: `eroare la citire: ${err instanceof Error ? err.message : String(err)}` });
      console.error(`[discord-smoke] Eroare la citirea slash commands: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      const me = await guild.members.fetchMe();
      const perms = channel && typeof (channel as { permissionsFor?: unknown }).permissionsFor === "function"
        ? (channel as { permissionsFor: (m: unknown) => { toArray(): string[] } | null }).permissionsFor(me)
        : null;
      const grantedNames = perms ? perms.toArray() : [];
      const evalP = evaluatePermissions(grantedNames);
      checks.push({ name: "permissions", ok: evalP.ok, detail: evalP.ok ? "toate prezente" : `lipsesc ${evalP.missing.join(", ")}` });
      if (!evalP.ok) {
        console.error(`[discord-smoke] Permisiuni canal FAIL: lipsesc ${evalP.missing.join(", ")}`);
      } else {
        console.log("[discord-smoke] Permisiuni canal OK (ViewChannel/SendMessages/EmbedLinks/ReadMessageHistory).");

        if (sendTest) {
          if (isSendableSmokeChannel(channel)) {
            try {
              const embed = new EmbedBuilder()
                .setTitle("Staging smoke")
                .setDescription(`Mesaj de test trimis de runner-ul de staging la ${new Date().toISOString()}. Se sterge automat.`);
              const message = await channel.send({ embeds: [embed] });
              await message.delete();
              checks.push({ name: "send", ok: true, detail: "embed trimis si sters" });
              console.log("[discord-smoke] Trimitere notificare reala OK (embed trimis si sters).");
            } catch (err) {
              checks.push({ name: "send", ok: false, detail: `trimiterea/stergerea reala a esuat: ${err instanceof Error ? err.message : String(err)}` });
              console.error(`[discord-smoke] Trimitere notificare reala FAIL: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            const detail = sendabilityFailureDetail(channel);
            checks.push({ name: "send", ok: false, detail: `test de trimitere cerut, dar ${detail}` });
            console.error(`[discord-smoke] Trimitere notificare reala FAIL: ${detail}.`);
          }
        }
      }
    } catch (err) {
      checks.push({ name: "permissions", ok: false, detail: `eroare canal/permisiuni: ${err instanceof Error ? err.message : String(err)}` });
      console.error(`[discord-smoke] Eroare la verificarea canalului/permisiunilor: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    checks.push({ name: "login", ok: false, detail: `login/gateway esuat: ${err instanceof Error ? err.message : String(err)}` });
    console.error(`[discord-smoke] Login/gateway esuat: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.destroy().catch(() => undefined);
  }

  const result = buildSmokeResult("discord", false, checks);
  writeSmokeResult("STAGING_DISCORD_SMOKE_RESULT_FILE", result);
  if (result.ok) {
    console.log("[discord-smoke] Proba live Discord a trecut.");
    return 0;
  }
  console.error(`[discord-smoke] ${checks.filter(c => !c.ok).length} verificare(i) esuate.`);
  return 1;
}

export { evaluateCommands, evaluatePermissions, isSendableSmokeChannel, sendabilityFailureDetail, expectedCommandNames, REQUIRED_COMMANDS, REQUIRED_PERMISSIONS };

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  runDiscordSmoke()
    .then(code => process.exit(code))
    .catch(err => {
      console.error("[discord-smoke] eroare neasteptata:", err);
      process.exit(1);
    });
}
