import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } from "discord.js";

interface NamedCommand { name?: string }
interface CommandsEval { ok: boolean; count: number; missing: string[] }
interface PermsEval { ok: boolean; missing: string[] }

const REQUIRED_COMMANDS = ["ping", "help"];
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
    console.log("[discord-smoke] Credentiale de staging incomplete - sar proba live Discord (exit 0).");
    console.log("[discord-smoke] Seteaza STAGING_DISCORD_TOKEN, STAGING_DISCORD_CLIENT_ID, STAGING_TEST_GUILD_ID,");
    console.log("[discord-smoke] STAGING_TEST_CHANNEL_ID (+ optional STAGING_DISCORD_SEND_TEST=true) ca sa rulezi proba live.");
    return 0;
  }

  let failures = 0;
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      client.once("ready", () => resolve());
      client.once("error", reject);
      client.login(token).catch(reject);
    }), READY_TIMEOUT_MS, "login + ready");
    console.log(`[discord-smoke] Gateway READY ca ${client.user?.tag || "?"} (token + gateway OK).`);

    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const guildCmds = await rest.get(Routes.applicationGuildCommands(clientId, guildId)) as NamedCommand[];
      const globalCmds = await rest.get(Routes.applicationCommands(clientId)) as NamedCommand[];
      const all = [...(Array.isArray(guildCmds) ? guildCmds : []), ...(Array.isArray(globalCmds) ? globalCmds : [])];
      const evalC = evaluateCommands(all);
      if (!evalC.ok) {
        failures++;
        console.error(`[discord-smoke] Slash commands FAIL: inregistrate=${evalC.count}, lipsa=${evalC.missing.join(", ") || "(niciuna)"}`);
      } else {
        console.log(`[discord-smoke] Slash commands OK (${evalC.count} inregistrate, inclusiv ${REQUIRED_COMMANDS.join("/")}).`);
      }
    } catch (err) {
      failures++;
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
      if (!evalP.ok) {
        failures++;
        console.error(`[discord-smoke] Permisiuni canal FAIL: lipsesc ${evalP.missing.join(", ")}`);
      } else {
        console.log("[discord-smoke] Permisiuni canal OK (ViewChannel/SendMessages/EmbedLinks/ReadMessageHistory).");

        if (sendTest && channel && typeof (channel as { isTextBased?: () => boolean }).isTextBased === "function"
            && (channel as { isTextBased: () => boolean }).isTextBased()) {
          const sendable = channel as unknown as { send: (payload: unknown) => Promise<{ delete: () => Promise<unknown> }> };
          const embed = new EmbedBuilder()
            .setTitle("Staging smoke")
            .setDescription(`Mesaj de test trimis de runner-ul de staging la ${new Date().toISOString()}. Se sterge automat.`);
          const message = await sendable.send({ embeds: [embed] });
          await message.delete();
          console.log("[discord-smoke] Trimitere notificare reala OK (embed trimis si sters).");
        }
      }
    } catch (err) {
      failures++;
      console.error(`[discord-smoke] Eroare la verificarea canalului/permisiunilor: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    failures++;
    console.error(`[discord-smoke] Login/gateway esuat: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.destroy().catch(() => undefined);
  }

  if (failures === 0) {
    console.log("[discord-smoke] Proba live Discord a trecut.");
    return 0;
  }
  console.error(`[discord-smoke] ${failures} verificare(i) esuate.`);
  return 1;
}

export { evaluateCommands, evaluatePermissions, REQUIRED_COMMANDS, REQUIRED_PERMISSIONS };

if (require.main === module) {
  runDiscordSmoke()
    .then(code => process.exit(code))
    .catch(err => {
      console.error("[discord-smoke] eroare neasteptata:", err);
      process.exit(1);
    });
}
