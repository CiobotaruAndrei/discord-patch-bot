import { createHash } from "node:crypto";
import type { GameConfig, GameType, NormalizedGameConfig } from "./configTypes.js";
import { GAME_CATALOG_SCHEMA_VERSION } from "./gameCatalogSchema.js";

export function normalizeGameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface CatalogGame {
  key: string;
  name: string;
  aliases?: string[];
  type?: GameType;
  appId?: string;
}

export interface GameCatalog<G extends CatalogGame = NormalizedGameConfig> {
  readonly schemaVersion: number;
  readonly contentVersion: string;
  readonly size: number;
  all(): readonly G[];
  keys(): readonly string[];
  has(key: string | null | undefined): boolean;
  byKey(key: string | null | undefined): G | null;
  byKeyOrAlias(value: string | null | undefined): G | null;
  typeOf(key: string | null | undefined): GameType | null;
  platformId(key: string | null | undefined): string | null;
  enabledSubset(enabledKeys: readonly string[] | null | undefined): readonly G[];
}

function platformIdentifier(game: CatalogGame): string | null {
  return game.type === "steam" ? game.appId ?? null : null;
}

function contentFingerprint(games: readonly CatalogGame[]): string {
  const hash = createHash("sha256");
  hash.update(String(GAME_CATALOG_SCHEMA_VERSION));
  for (const game of games) {
    hash.update(" ");
    hash.update(JSON.stringify(game));
  }
  return hash.digest("hex").slice(0, 16);
}

export function createGameCatalog<G extends CatalogGame>(games: readonly G[]): GameCatalog<G> {
  const ordered: readonly G[] = [...games];
  const byExactKey = new Map<string, G>();
  const bySearchTerm = new Map<string, G>();

  for (const game of ordered) {
    if (!byExactKey.has(game.key)) byExactKey.set(game.key, game);
    for (const term of [game.key, game.name, ...(game.aliases ?? [])]) {
      const normalized = normalizeGameKey(String(term));
      if (normalized && !bySearchTerm.has(normalized)) bySearchTerm.set(normalized, game);
    }
  }

  const keys: readonly string[] = ordered.map(game => game.key);
  const contentVersion = contentFingerprint(ordered);

  return {
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
    contentVersion,
    size: ordered.length,
    all: () => ordered,
    keys: () => keys,
    has: key => (key ? byExactKey.has(key) : false),
    byKey: key => (key ? byExactKey.get(key) ?? null : null),
    byKeyOrAlias: value => {
      const normalized = normalizeGameKey(String(value ?? ""));
      return normalized ? bySearchTerm.get(normalized) ?? null : null;
    },
    typeOf: key => (key ? byExactKey.get(key)?.type ?? null : null),
    platformId: key => {
      const game = key ? byExactKey.get(key) : undefined;
      return game ? platformIdentifier(game) : null;
    },
    enabledSubset: enabledKeys => {
      if (!Array.isArray(enabledKeys) || enabledKeys.length === 0) return ordered;
      const enabled = new Set(enabledKeys.map(normalizeGameKey));
      return ordered.filter(game => enabled.has(normalizeGameKey(game.key)));
    }
  };
}

const catalogsByGameList = new WeakMap<readonly CatalogGame[], GameCatalog<CatalogGame>>();

export function catalogFor<G extends CatalogGame>(games: readonly G[]): GameCatalog<G> {
  const cached = catalogsByGameList.get(games);
  if (cached) return cached as GameCatalog<G>;
  const catalog = createGameCatalog(games);
  catalogsByGameList.set(games, catalog);
  return catalog;
}

export function findGameByKey(games: GameConfig[], key: string | null | undefined): GameConfig | null {
  return catalogFor(games).byKey(key);
}

export function findGameByKeyOrAlias(games: GameConfig[], value: string | null | undefined): GameConfig | null {
  return catalogFor(games).byKeyOrAlias(value);
}
