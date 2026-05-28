"use strict";

const { errorMessage } = require("../../../shared/errors");

type GameConfig = { key: string; name: string } & Record<string, unknown>;
type NotificationMode = "compact" | "detailed";

interface DiscordInteraction {
  guild?: { id: string } | null;
  user?: { id: string };
  options: { getSubcommand(): string };
}

interface UpdateRecord {
  game: GameConfig;
  latest: ({ id: string } & Record<string, unknown>) | null;
}

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface GuildSettingsLite {
  enabledGames?: string[];
  notificationMode?: NotificationMode;
}

export interface LatestUpdatesHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown | null>;
  getUpdatesCacheData: () => UpdateRecord[] | null;
  setUpdatesCache: (data: UpdateRecord[]) => void;
  getLatestForAllGames: (games: GameConfig[]) => Promise<UpdateRecord[]>;
  getSystemTimes: () => Promise<{ all?: number }>;
  saveSystemTime: (key: string, value: number) => Promise<unknown>;
  smoothTime: (estimate: number, actual: number) => number;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  buildUpdateEmbed: (gameName: string, latest: unknown, mode: NotificationMode) => { setFooter: (opts: { text: string }) => unknown };
  handlePagination: (
    msg: unknown,
    authorId: string,
    prefix: string,
    items: unknown[],
    itemsPerPage: number,
    generateEmbedsFn: (page: number, totalP: number, mode: NotificationMode) => Promise<unknown[]> | unknown[],
    defaultMode?: NotificationMode
  ) => Promise<void>;
  ITEMS_PER_PAGE: number;
}

export function createLatestUpdatesHandler(deps: LatestUpdatesHandlerDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit,
    getUpdatesCacheData, setUpdatesCache, getLatestForAllGames,
    getSystemTimes, saveSystemTime, smoothTime,
    getGuildSettings, formatUserError, buildUpdateEmbed, handlePagination,
    ITEMS_PER_PAGE
  } = deps;

  async function handleLatestUpdates(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!(await enforceCooldown(interaction, "latest updates"))) return;
    const endLog = startCommandLog(interaction, "latest updates");
    await safeDefer(interaction);

    let data = getUpdatesCacheData();
    if (!data) {
      const estMs = (await getSystemTimes()).all || 35000;
      await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
      const startTime = Date.now();
      try {
        data = await getLatestForAllGames(games);
        setUpdatesCache(data);
        await saveSystemTime("all", smoothTime(estMs, Date.now() - startTime));
      } catch (err: unknown) {
        endLog("error", { errorMsg: errorMessage(err) });
        return safeEdit(interaction, formatUserError(err, "Nu am reusit sa obtin update-urile.", "ERR_LATEST_UPDATES"));
      }
    }
    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    const enabledGames = Array.isArray(guild?.enabledGames) ? guild!.enabledGames! : [];
    const enabledSet = enabledGames.length > 0 ? new Set(enabledGames) : null;
    const valid = data.filter(r => r.latest !== null && (!enabledSet || enabledSet.has(r.game.key)));
    if (!valid.length) {
      endLog("no_data");
      return safeEdit(
        interaction,
        enabledSet
          ? "Eroare: Nu am date disponibile pentru jocurile active ale acestui server."
          : "Eroare: Nu am date disponibile."
      );
    }
    const mode: NotificationMode = guild?.notificationMode || "detailed";
    const msg = await safeEdit(interaction, "OK: Date incarcate!");
    const generateEmbeds = async (page: number, totalP: number, currentMode: NotificationMode) =>
      valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map((r) =>
        buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} - Pagina ${page + 1}/${totalP}` })
      );
    endLog("ok", { resultCount: valid.length });
    if (msg && interaction.user) {
      await handlePagination(msg, interaction.user.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode);
    }
  }

  return { handleLatestUpdates };
}
