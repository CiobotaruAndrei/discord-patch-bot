"use strict";

import type { FetchResult, EmbeddableUpdate, InteractionMessage } from "../../../types.js";

import { errorMessage } from "../../../shared/errors.js";

const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type GameConfig = { key: string; name: string } & Record<string, unknown>;
type NotificationMode = "compact" | "detailed";

interface DiscordInteraction {
  guild?: { id: string } | null;
  user?: { id: string };
  options: { getSubcommand(): string };
}

type UpdateRecord = FetchResult;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
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
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<InteractionMessage | null>;
  getUpdatesCacheData: () => UpdateRecord[] | null;
  setUpdatesCache: (data: UpdateRecord[]) => void;
  getLatestForAllGames: (games: GameConfig[]) => Promise<UpdateRecord[]>;
  loadFetchSnapshot?: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  validateUpdateFetchSnapshot: (item: unknown) => boolean;
  getSystemTimes: () => Promise<{ all?: number }>;
  saveSystemTime: (key: string, value: number) => Promise<unknown>;
  smoothTime: (estimate: number, actual: number) => number;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  buildUpdateEmbed: (gameName: string, latest: EmbeddableUpdate, mode: NotificationMode) => { setFooter: (opts: { text: string }) => unknown };
  handlePagination: <TItem, TEmbed>(
    msg: InteractionMessage,
    authorId: string,
    prefix: string,
    items: TItem[],
    itemsPerPage: number,
    generateEmbedsFn: (page: number, totalP: number, mode: NotificationMode) => Promise<TEmbed[]> | TEmbed[],
    defaultMode?: NotificationMode
  ) => Promise<void>;
  ITEMS_PER_PAGE: number;
}

export function createLatestUpdatesHandler(deps: LatestUpdatesHandlerDeps) {
  const {
    logger,
    enforceCooldown, startCommandLog, safeDefer, safeEdit,
    getUpdatesCacheData, setUpdatesCache, getLatestForAllGames,
    loadFetchSnapshot, validateUpdateFetchSnapshot,
    getSystemTimes, saveSystemTime, smoothTime,
    getGuildSettings, formatUserError, buildUpdateEmbed, handlePagination,
    ITEMS_PER_PAGE
  } = deps;

  async function handleLatestUpdates(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!(await enforceCooldown(interaction, "latest updates"))) return;
    const endLog = startCommandLog(interaction, "latest updates");
    await safeDefer(interaction);

    const tryLoadUpdatesSnapshot = async (): Promise<{ data: UpdateRecord[]; ageMin: number } | null> => {
      const snapshot = loadFetchSnapshot ? await loadFetchSnapshot("updates").catch(() => null) : null;
      const ageMs = snapshot ? Date.now() - new Date(snapshot.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
      const isValidUpdate = (item: unknown): item is UpdateRecord => validateUpdateFetchSnapshot(item);
      const valid = snapshot && Array.isArray(snapshot.payload) && ageMs <= SNAPSHOT_FALLBACK_MAX_AGE_MS
        ? snapshot.payload.filter(isValidUpdate)
        : [];
      if (!valid.length) return null;
      return { data: valid, ageMin: Math.max(1, Math.round(ageMs / 60000)) };
    };

    let data = getUpdatesCacheData();
    let snapshotAgeMin: number | null = null;
    if (!data) {
      const estMs = (await getSystemTimes()).all || 35000;
      await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
      const startTime = Date.now();
      try {
        data = await getLatestForAllGames(games);
        const hasAnyData = data.some(record => record.latest !== null);
        if (hasAnyData) {
          setUpdatesCache(data);
          await saveSystemTime("all", smoothTime(estMs, Date.now() - startTime));
        }
      } catch (err: unknown) {
        const fromSnapshot = await tryLoadUpdatesSnapshot();
        if (!fromSnapshot) {
          endLog("error", { errorMsg: errorMessage(err) });
          return safeEdit(interaction, formatUserError(err, "Nu am reusit sa obtin update-urile.", "ERR_LATEST_UPDATES"));
        }
        logger("WARN", "LATEST_UPDATES", "Fetch live esuat, folosesc snapshot-ul persistat pentru update-uri", errorMessage(err));
        snapshotAgeMin = fromSnapshot.ageMin;
        data = fromSnapshot.data;
      }
    }
    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    const enabledGames = Array.isArray(guild?.enabledGames) ? guild!.enabledGames! : [];
    const enabledSet = enabledGames.length > 0 ? new Set(enabledGames) : null;
    const valid = data.filter((r): r is FetchResult & { latest: NonNullable<FetchResult["latest"]> } => r.latest !== null && (!enabledSet || enabledSet.has(r.game.key)));
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
    const msg = await safeEdit(interaction, snapshotAgeMin === null
      ? "OK: Date incarcate!"
      : `OK: Update-uri incarcate din ultimul snapshot salvat (fetch-ul live a esuat) - vechime ~${snapshotAgeMin} min.`);
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
