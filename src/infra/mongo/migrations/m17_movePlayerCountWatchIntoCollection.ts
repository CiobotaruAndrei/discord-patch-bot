import type { Migration } from "./migrationTypes.js";

interface WatchEntry {
  gameKey?: unknown;
  appId?: unknown;
  playerCount?: unknown;
  fetchedAt?: unknown;
  lastNotifiedAt?: unknown;
  lastDirection?: unknown;
}

function validDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function validCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

const m17_movePlayerCountWatchIntoCollection: Migration = {
  id: 17,
  name: "move-player-count-watch-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const watch = db.collection("guildPlayerCountWatch");

    const cursor = guilds.find({ "playerCountWatchState.0": { $exists: true } }, { projection: { playerCountWatchState: 1 } });
    for await (const guild of cursor) {
      const entries = Array.isArray(guild.playerCountWatchState) ? guild.playerCountWatchState : [];
      for (const raw of entries as WatchEntry[]) {
        const gameKey = typeof raw.gameKey === "string" ? raw.gameKey : null;
        const playerCount = validCount(raw.playerCount);
        const fetchedAt = validDate(raw.fetchedAt);
        if (!gameKey || playerCount === null || !fetchedAt) continue;
        await watch.updateOne(
          { guildId: guild._id, gameKey },
          {
            $setOnInsert: {
              guildId: guild._id,
              gameKey,
              appId: typeof raw.appId === "string" ? raw.appId : "",
              playerCount,
              fetchedAt,
              lastNotifiedAt: validDate(raw.lastNotifiedAt),
              lastDirection: raw.lastDirection === "up" || raw.lastDirection === "down" ? raw.lastDirection : null
            }
          },
          { upsert: true }
        );
      }
    }

    await guilds.updateMany({ playerCountWatchState: { $exists: true } }, { $unset: { playerCountWatchState: "" } });
  }
};

export { m17_movePlayerCountWatchIntoCollection };
