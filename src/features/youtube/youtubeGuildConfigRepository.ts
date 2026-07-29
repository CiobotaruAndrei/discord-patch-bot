"use strict";

import type { MongoWriteOutcome, YouTubeChannelSubscription } from "../../types.js";
import { MAX_YOUTUBE_ROUTE_DESTINATIONS, YOUTUBE_TITLE_WORD_LIMIT } from "./youtubeDeliveryPolicy.js";
import { updatedDocument } from "../../shared/persistenceOutcome.js";

type MongoWriteResult = MongoWriteOutcome;

export interface YouTubeConfigGuildModel {
  updateOne(filter: object, update: object, options?: object): Promise<MongoWriteResult>;
  findOneAndUpdate(filter: object, update: object, options?: object): Promise<{
    youtubeChannels?: Array<{ channelId: string }>;
    youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }>;
    youtubeTitleIncludeWords?: string[];
  } | null>;
}

export const MAX_YOUTUBE_CHANNELS = 25;

export function buildYouTubeChannelUpsertPipeline(subscription: YouTubeChannelSubscription, maxChannels: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      youtubeChannels: {
        $let: {
          vars: { existing: { $ifNull: ["$youtubeChannels", []] } },
          in: {
            $cond: [
              { $or: [
                { $in: [subscription.channelId, { $map: { input: "$$existing", as: "channel", in: "$$channel.channelId" } }] },
                { $gte: [{ $size: "$$existing" }, maxChannels] }
              ] },
              "$$existing",
              { $concatArrays: ["$$existing", [subscription]] }
            ]
          }
        }
      }
    }
  }];
}

export function buildYouTubeTitleWordAddPipeline(word: string, maxWords: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      youtubeTitleIncludeWords: {
        $let: {
          vars: { existing: { $ifNull: ["$youtubeTitleIncludeWords", []] } },
          in: {
            $cond: [
              { $or: [
                { $in: [word, "$$existing"] },
                { $gte: [{ $size: "$$existing" }, maxWords] }
              ] },
              "$$existing",
              { $concatArrays: ["$$existing", [word]] }
            ]
          }
        }
      }
    }
  }];
}

export function buildYouTubeRouteAddPipeline(youtubeChannelId: string, discordChannelId: string, maxDestinations: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      youtubeChannelRoutes: {
        $let: {
          vars: { routes: { $ifNull: ["$youtubeChannelRoutes", []] } },
          in: {
            $cond: [
              { $in: [youtubeChannelId, { $map: { input: "$$routes", as: "route", in: "$$route.channelId" } }] },
              { $map: { input: "$$routes", as: "route", in: {
                $cond: [
                  { $eq: ["$$route.channelId", youtubeChannelId] },
                  { $mergeObjects: ["$$route", { discordChannelIds: {
                    $let: {
                      vars: { ids: { $ifNull: ["$$route.discordChannelIds", []] } },
                      in: {
                        $cond: [
                          { $or: [
                            { $in: [discordChannelId, "$$ids"] },
                            { $gte: [{ $size: "$$ids" }, maxDestinations] }
                          ] },
                          "$$ids",
                          { $concatArrays: ["$$ids", [discordChannelId]] }
                        ]
                      }
                    }
                  } }] },
                  "$$route"
                ]
              } } },
              { $concatArrays: ["$$routes", [{ channelId: youtubeChannelId, discordChannelIds: [discordChannelId] }]] }
            ]
          }
        }
      }
    }
  }];
}

export async function addYouTubeChannelSubscription(
  GuildModel: YouTubeConfigGuildModel,
  guildId: string,
  subscription: YouTubeChannelSubscription
): Promise<{ alreadySubscribed: boolean; limitReached: boolean }> {
  const before = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildYouTubeChannelUpsertPipeline(subscription, MAX_YOUTUBE_CHANNELS),
    { upsert: true }
  );
  const existing = before?.youtubeChannels || [];
  return {
    alreadySubscribed: existing.some(item => item.channelId === subscription.channelId),
    limitReached: existing.length >= MAX_YOUTUBE_CHANNELS
  };
}

export async function removeYouTubeChannelSubscription(
  GuildModel: YouTubeConfigGuildModel,
  guildId: string,
  channelId: string
): Promise<boolean> {
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { youtubeChannels: { channelId }, youtubeChannelRoutes: { channelId } } }
  );
  return updatedDocument(result);
}

export async function setYouTubeNotificationChannel(GuildModel: YouTubeConfigGuildModel, guildId: string, channelId: string): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $set: { youtubeNotificationChannelId: channelId } },
    { upsert: true }
  );
}

export async function setYouTubeNotificationsEnabled(GuildModel: YouTubeConfigGuildModel, guildId: string, enabled: boolean): Promise<void> {
  const update = enabled
    ? { $set: { youtubeNotificationsEnabled: true, youtubeHasActivated: true } }
    : { $set: { youtubeNotificationsEnabled: false } };
  await GuildModel.updateOne({ _id: guildId }, update, { upsert: true });
}

export async function setYouTubeFilterFlag(GuildModel: YouTubeConfigGuildModel, guildId: string, field: string, enabled: boolean): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $set: { [`youtubeFilters.${field}`]: enabled } },
    { upsert: true }
  );
}

export async function setYouTubeMinDurationSeconds(GuildModel: YouTubeConfigGuildModel, guildId: string, seconds: number): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $set: { "youtubeFilters.minDurationSeconds": seconds } },
    { upsert: true }
  );
}

export async function setYouTubeMessageTemplate(GuildModel: YouTubeConfigGuildModel, guildId: string, template: string | null): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $set: { youtubeMessageTemplate: template } },
    { upsert: true }
  );
}

export async function addYouTubeRouteDestination(
  GuildModel: YouTubeConfigGuildModel,
  guildId: string,
  youtubeChannelId: string,
  discordChannelId: string
): Promise<{ saved: boolean }> {
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildYouTubeRouteAddPipeline(youtubeChannelId, discordChannelId, MAX_YOUTUBE_ROUTE_DESTINATIONS),
    { upsert: true, returnDocument: "after" }
  );
  const savedRoute = (updated?.youtubeChannelRoutes || []).find(route => route.channelId === youtubeChannelId);
  return { saved: (savedRoute?.discordChannelIds || []).includes(discordChannelId) };
}

export async function removeYouTubeChannelRoute(GuildModel: YouTubeConfigGuildModel, guildId: string, youtubeChannelId: string): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { youtubeChannelRoutes: { channelId: youtubeChannelId } } }
  );
}

export async function removeYouTubeRouteDestination(
  GuildModel: YouTubeConfigGuildModel,
  guildId: string,
  youtubeChannelId: string,
  discordChannelId: string
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { "youtubeChannelRoutes.$[route].discordChannelIds": discordChannelId } },
    { arrayFilters: [{ "route.channelId": youtubeChannelId }] }
  );
}

export async function addYouTubeTitleWord(GuildModel: YouTubeConfigGuildModel, guildId: string, word: string): Promise<{ saved: boolean }> {
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildYouTubeTitleWordAddPipeline(word, YOUTUBE_TITLE_WORD_LIMIT),
    { upsert: true, returnDocument: "after" }
  );
  return { saved: (updated?.youtubeTitleIncludeWords || []).includes(word) };
}

export async function removeYouTubeTitleWord(GuildModel: YouTubeConfigGuildModel, guildId: string, word: string): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { youtubeTitleIncludeWords: word } }
  );
}

export async function clearYouTubeTitleWords(GuildModel: YouTubeConfigGuildModel, guildId: string): Promise<void> {
  await GuildModel.updateOne({ _id: guildId }, { $set: { youtubeTitleIncludeWords: [] } }, { upsert: true });
}
