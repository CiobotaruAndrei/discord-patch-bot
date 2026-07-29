"use strict";

import { z } from "zod";
import type { SteamSearchItem } from "./sourceTypes.js";
import type { SteamAppDetailsSummary } from "./sourceApis.js";

const SteamSearchItemSchema = z.object({ name: z.string().optional(), type: z.string().optional() }).passthrough();
const SteamSearchResponseSchema = z.object({ items: z.array(SteamSearchItemSchema).optional() }).passthrough();
const SteamDetailsSummarySchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  header_image: z.string().optional(),
  is_free: z.boolean().optional(),
  platforms: z.object({ windows: z.boolean().optional(), mac: z.boolean().optional(), linux: z.boolean().optional() }).optional(),
  categories: z.array(z.object({ id: z.number().optional(), description: z.string().optional() })).optional(),
  genres: z.array(z.object({ id: z.string().optional(), description: z.string().optional() })).optional(),
  pc_requirements: z.union([z.string(), z.array(z.string()), z.object({ minimum: z.string().optional(), recommended: z.string().optional() }), z.null()]).optional(),
  price_overview: z.object({ initial: z.number(), final: z.number(), discount_percent: z.number(), final_formatted: z.string().optional() }).nullable().optional(),
  release_date: z.object({ coming_soon: z.boolean().optional(), date: z.string().optional() }).optional()
}).passthrough();
const SteamDetailsResponseSchema = z.record(z.string(), z.object({ data: SteamDetailsSummarySchema.optional() }).optional());

export function decodeSteamSearchResponse(value: unknown): { items?: SteamSearchItem[] } {
  const parsed = SteamSearchResponseSchema.safeParse(value);
  if (!parsed.success) return {};
  return { ...parsed.data, items: parsed.data.items?.map(item => ({ ...item })) };
}

export function decodeSteamDetailsResponse(value: unknown): Record<string, { data?: SteamAppDetailsSummary } | undefined> {
  const parsed = SteamDetailsResponseSchema.safeParse(value);
  if (!parsed.success) return {};
  const result: Record<string, { data?: SteamAppDetailsSummary } | undefined> = {};
  Object.entries(parsed.data).forEach(([key, entry]) => { result[key] = entry; });
  return result;
}

export interface EpicStoreElement {
  id?: string; title?: string; urlSlug?: string;
  keyImages?: Array<{ type?: string; url?: string }>;
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number } };
  promotions?: { promotionalOffers?: Array<{ promotionalOffers?: Array<{ endDate?: string }> }> };
}

export interface EpicGraphqlResponse {
  data?: { Catalog?: { searchStore?: { elements?: EpicStoreElement[] } } };
}

export interface FortnitePost { slug?: string; title?: string; shareDescription?: string; date?: string; }
export interface FortniteBlogResponse { blogList?: FortnitePost[]; }

const EpicElementSchema = z.object({
  id: z.string().optional(), title: z.string().optional(), urlSlug: z.string().optional(),
  keyImages: z.array(z.object({ type: z.string().optional(), url: z.string().optional() })).optional(),
  price: z.object({ totalPrice: z.object({ discountPrice: z.number().optional(), originalPrice: z.number().optional() }).optional() }).optional(),
  promotions: z.object({ promotionalOffers: z.array(z.object({ promotionalOffers: z.array(z.object({ endDate: z.string().optional() })).optional() })).optional() }).optional()
}).passthrough();

const EpicGraphqlResponseSchema = z.object({ data: z.object({ Catalog: z.object({ searchStore: z.object({ elements: z.array(EpicElementSchema).optional() }).optional() }).optional() }).optional() }).passthrough();

export function decodeEpicGraphqlResponse(value: unknown): EpicGraphqlResponse {
  const parsed = EpicGraphqlResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const FortniteBlogResponseSchema = z.object({ blogList: z.array(z.object({ slug: z.string().optional(), title: z.string().optional(), shareDescription: z.string().optional(), date: z.string().optional() }).passthrough()).optional() }).passthrough();

export function decodeFortniteBlogResponse(value: unknown): FortniteBlogResponse {
  const parsed = FortniteBlogResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const SteamReviewSchema = z.object({
  query_summary: z.object({
    total_reviews: z.number().optional(),
    total_positive: z.number().optional()
  }).optional()
}).passthrough();

const SteamSpecialItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  original_price: z.number().optional(),
  final_price: z.number().optional(),
  discount_percent: z.number().optional(),
  header_image: z.string().nullable().optional()
}).passthrough();

const SteamFeaturedCategoriesSchema = z.object({
  specials: z.object({ items: z.array(SteamSpecialItemSchema).optional() }).optional()
}).passthrough();

const MinecraftManifestSchema = z.object({
  latest: z.object({ release: z.string().optional() }).optional()
}).passthrough();

const RobloxVersionSchema = z.object({ clientVersionUpload: z.string().optional() }).passthrough();

const SteamNewsItemSchema = z.object({
  gid: z.unknown().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  contents: z.string().optional(),
  tags: z.unknown().optional(),
  feed_type: z.number().optional(),
  feedname: z.string().optional(),
  date: z.unknown().optional()
}).passthrough();

const SteamNewsSchema = z.object({
  appnews: z.object({ newsitems: z.array(SteamNewsItemSchema).optional() }).optional()
}).passthrough();

export function decodeSteamReviewResponse(value: unknown): z.infer<typeof SteamReviewSchema> {
  const parsed = SteamReviewSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function decodeSteamFeaturedCategories(value: unknown): z.infer<typeof SteamFeaturedCategoriesSchema> {
  const parsed = SteamFeaturedCategoriesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function decodeMinecraftManifest(value: unknown): z.infer<typeof MinecraftManifestSchema> {
  const parsed = MinecraftManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function decodeRobloxVersion(value: unknown): z.infer<typeof RobloxVersionSchema> {
  const parsed = RobloxVersionSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function decodeSteamNewsResponse(value: unknown): z.infer<typeof SteamNewsSchema> {
  const parsed = SteamNewsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const StatusPageSchema = z.object({
  status: z.object({ description: z.string().optional(), indicator: z.string().optional() }).optional()
}).passthrough();

export function decodeStatusPageResponse(value: unknown): z.infer<typeof StatusPageSchema> {
  const parsed = StatusPageSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
