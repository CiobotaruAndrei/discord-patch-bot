import { z } from "zod";
import { GameSchema } from "./gameConfigSchemas.js";

type IssuePath = Array<string | number>;

type SeenSearchTerm = {
  label: string;
  path: IssuePath;
  ownerIndex: number;
};

export const GAME_CATALOG_SCHEMA_VERSION = 1;

export const GameCatalogSchema = z.array(GameSchema).min(1).superRefine((games, refinement) => {
  const seenKeys = new Set<string>();
  const seenSearchTerms = new Map<string, SeenSearchTerm>();

  function addSearchTerm(term: string, path: IssuePath, label: string, ownerIndex: number): void {
    const normalized = term.toLowerCase().trim();
    if (!normalized) return;
    const existing = seenSearchTerms.get(normalized);
    if (existing && existing.ownerIndex !== ownerIndex) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path, message: `${label} duplicat cu ${existing.label}: ${term}` });
      return;
    }
    if (!existing) seenSearchTerms.set(normalized, { label, path, ownerIndex });
  }

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const path: IssuePath = [i];
    if (seenKeys.has(game.key)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "key"], message: `Cheie duplicata in config: ${game.key}` });
    }
    seenKeys.add(game.key);
    addSearchTerm(game.key, [...path, "key"], `cheia jocului ${game.name}`, i);
    addSearchTerm(game.name, [...path, "name"], `numele jocului ${game.key}`, i);

    const localAliases = new Set<string>();
    for (let aliasIndex = 0; aliasIndex < (game.aliases?.length ?? 0); aliasIndex++) {
      const alias = game.aliases?.[aliasIndex] ?? "";
      const normalizedAlias = alias.toLowerCase().trim();
      if (localAliases.has(normalizedAlias)) {
        refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "aliases", aliasIndex], message: `Alias duplicat pentru ${game.key}: ${alias}` });
      }
      localAliases.add(normalizedAlias);
      addSearchTerm(alias, [...path, "aliases", aliasIndex], `aliasul jocului ${game.key}`, i);
    }

    if (game.articleHrefRegex) {
      try {
        new RegExp(game.articleHrefRegex);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "articleHrefRegex"], message: `Regex invalid: ${message}` });
      }
    }
  }
});
