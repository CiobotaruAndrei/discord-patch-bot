import { z } from "zod";

export const GameTypeSchema = z.enum(["steam", "minecraft", "epic_games", "roblox", "listing_based", "nvidia", "amd", "intel", "rss"]);

const EmptyFallbackFields = {
  url: z.never().optional(),
  listingUrl: z.never().optional(),
  listingUrls: z.never().optional(),
  baseUrl: z.never().optional()
};

const EmptyFallbackSchema = z.object(EmptyFallbackFields).strict();
const UrlFallbackFields = { url: z.string().url() };
const ListingFallbackFields = {
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).min(1).optional(),
  baseUrl: z.string().url().optional()
};

export const GameSourceFallbackSchema = z.discriminatedUnion("type", [
  EmptyFallbackSchema.extend({ type: z.literal("steam") }),
  EmptyFallbackSchema.extend({ type: z.literal("minecraft") }),
  EmptyFallbackSchema.extend({ type: z.literal("roblox") }),
  EmptyFallbackSchema.extend({ type: z.literal("nvidia") }),
  EmptyFallbackSchema.extend({ type: z.literal("amd") }),
  EmptyFallbackSchema.extend({ type: z.literal("rss"), ...UrlFallbackFields }),
  EmptyFallbackSchema.extend({ type: z.literal("intel"), ...UrlFallbackFields }),
  EmptyFallbackSchema.extend({ type: z.literal("listing_based"), ...ListingFallbackFields }),
  EmptyFallbackSchema.extend({ type: z.literal("epic_games"), ...ListingFallbackFields })
]);

const EmptySourceFields = {
  appId: z.never().optional(),
  listingUrl: z.never().optional(),
  listingUrls: z.never().optional(),
  baseUrl: z.never().optional(),
  articleHrefRegex: z.never().optional(),
  requireKeywords: z.never().optional(),
  url: z.never().optional(),
  upCRD: z.never({ error: "upCRD este un camp legacy permis doar pentru sursele NVIDIA" }).optional()
};

const GameBaseSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  thumbnail: z.string().url().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  fallbacks: z.array(GameSourceFallbackSchema).optional(),
  ...EmptySourceFields
}).strict();

const ListingFields = {
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).min(1).optional(),
  baseUrl: z.string().url(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string().min(1)).optional()
};

const EpicFields = {
  ...ListingFields,
  baseUrl: z.string().url().optional()
};

const ListingGameSchema = GameBaseSchema.extend({ type: z.literal("listing_based"), ...ListingFields }).superRefine((game, refinement) => {
  if (!game.listingUrl && !game.listingUrls?.length) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["listingUrls"], message: "Sursele listing_based trebuie sa aiba listingUrl sau listingUrls" });
  }
  if (game.listingUrls && new Set(game.listingUrls).size !== game.listingUrls.length) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["listingUrls"], message: "listingUrls nu trebuie sa contina URL-uri duplicate" });
  }
});

const EpicGameSchema = GameBaseSchema.extend({ type: z.literal("epic_games"), ...EpicFields }).superRefine((game, refinement) => {
  if (game.key !== "fortnite" && !game.listingUrl && !game.listingUrls?.length) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["listingUrls"], message: "Sursele epic_games (non-fortnite) trebuie sa aiba listingUrl sau listingUrls" });
  }
  if (game.key !== "fortnite" && !game.baseUrl) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "Sursele epic_games (non-fortnite) trebuie sa aiba baseUrl" });
  }
  if (game.listingUrls && new Set(game.listingUrls).size !== game.listingUrls.length) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["listingUrls"], message: "listingUrls nu trebuie sa contina URL-uri duplicate" });
  }
});

const GameDiscriminatedSchema = z.discriminatedUnion("type", [
  GameBaseSchema.extend({ type: z.literal("steam"), appId: z.string().regex(/^\d+$/, "appId pentru Steam trebuie sa contina doar cifre") }),
  GameBaseSchema.extend({ type: z.literal("minecraft") }),
  EpicGameSchema,
  GameBaseSchema.extend({ type: z.literal("roblox") }),
  ListingGameSchema,
  GameBaseSchema.extend({ type: z.literal("nvidia"), upCRD: z.union([z.literal(0), z.literal(1)]).optional() }),
  GameBaseSchema.extend({ type: z.literal("amd") }),
  GameBaseSchema.extend({ type: z.literal("intel"), url: z.string().url() }),
  GameBaseSchema.extend({ type: z.literal("rss"), url: z.string().url() })
]);

export const GameSchema = z.preprocess(
  value => value && typeof value === "object" && !("type" in value) ? { ...value, type: "steam" } : value,
  GameDiscriminatedSchema
);

export type NormalizedGameConfig = z.output<typeof GameSchema>;
export type NormalizedGameSourceFallback = z.output<typeof GameSourceFallbackSchema>;
