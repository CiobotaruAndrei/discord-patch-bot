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
  price_overview: z.object({ initial: z.number(), final: z.number(), discount_percent: z.number() }).nullable().optional()
}).passthrough();
const SteamDetailsResponseSchema = z.record(z.string(), z.object({ data: SteamDetailsSummarySchema.optional() }).optional());

export function decodeSteamSearchResponse(value: unknown): { items?: SteamSearchItem[] } {
  const parsed = SteamSearchResponseSchema.parse(value);
  return { ...parsed, items: parsed.items?.map(item => ({ ...item })) };
}

export function decodeSteamDetailsResponse(value: unknown): Record<string, { data?: SteamAppDetailsSummary } | undefined> {
  const parsed = SteamDetailsResponseSchema.parse(value);
  const result: Record<string, { data?: SteamAppDetailsSummary } | undefined> = {};
  Object.entries(parsed).forEach(([key, entry]) => { result[key] = entry; });
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

export function decodeEpicGraphqlResponse(value: unknown): EpicGraphqlResponse {
  const parsed = z.object({ data: z.object({ Catalog: z.object({ searchStore: z.object({ elements: z.array(EpicElementSchema).optional() }).optional() }).optional() }).optional() }).passthrough().parse(value);
  return parsed;
}

export function decodeFortniteBlogResponse(value: unknown): FortniteBlogResponse {
  return z.object({ blogList: z.array(z.object({ slug: z.string().optional(), title: z.string().optional(), shareDescription: z.string().optional(), date: z.string().optional() }).passthrough()).optional() }).passthrough().parse(value);
}

export interface SteamNewsItem {
  gid?: string | number;
  title?: string;
  url?: string;
  contents?: string;
  tags?: unknown;
  feed_type?: number;
  feedname?: string;
  date?: string | number;
}

const SteamNewsItemSchema = z.object({
  gid: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(), url: z.string().optional(), contents: z.string().optional(),
  tags: z.unknown().optional(), feed_type: z.number().optional(), feedname: z.string().optional(),
  date: z.union([z.string(), z.number()]).optional()
}).passthrough();

export function decodeSteamNewsResponse(value: unknown): { appnews?: { newsitems?: SteamNewsItem[] } } {
  return z.object({ appnews: z.object({ newsitems: z.array(SteamNewsItemSchema).optional() }).optional() }).passthrough().parse(value);
}

export interface SteamReviewResponse {
  query_summary?: { total_reviews?: number; total_positive?: number };
}

export function decodeSteamReviewResponse(value: unknown): SteamReviewResponse {
  return z.object({ query_summary: z.object({ total_reviews: z.number().optional(), total_positive: z.number().optional() }).optional() }).passthrough().parse(value);
}

export interface SteamFeaturedCategoryItem {
  id: string | number;
  name?: string;
  original_price?: number;
  final_price?: number;
  discount_percent?: number;
  header_image?: string | null;
}

export function decodeSteamFeaturedCategoriesResponse(value: unknown): { specials?: { items?: SteamFeaturedCategoryItem[] } } {
  return z.object({
    specials: z.object({
      items: z.array(z.object({
        id: z.union([z.string(), z.number()]), name: z.string().optional(),
        original_price: z.number().optional(), final_price: z.number().optional(),
        discount_percent: z.number().optional(), header_image: z.string().nullable().optional()
      }).passthrough()).optional()
    }).optional()
  }).passthrough().parse(value);
}
