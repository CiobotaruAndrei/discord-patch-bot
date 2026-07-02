"use strict";

import type { LoggerFunction } from "../../types";
import type { PreparedVideo } from "./youtubeDeliveryPlanner";
import { rollbackOrReport, type ReportRollbackFailure } from "../notifications/rollbackReporter";

export interface YouTubeRollbackPolicyDeps {
  rollbackVideo(guildId: string, channelId: string, videoId: string): Promise<void>;
  logger: LoggerFunction;
  reportRollbackFailure?: ReportRollbackFailure;
}

export function createYouTubeRollbackPolicy(deps: YouTubeRollbackPolicyDeps) {
  const { rollbackVideo, logger, reportRollbackFailure } = deps;

  async function rollbackClaimedVideo(guildId: string, channelId: string, videoId: string): Promise<void> {
    await rollbackOrReport(() => rollbackVideo(guildId, channelId, videoId), logger, { guildId, kind: "youtube", itemId: videoId }, reportRollbackFailure);
  }

  async function rollbackClaimedItems(guildId: string, items: PreparedVideo[]): Promise<void> {
    for (const item of items) {
      await rollbackClaimedVideo(guildId, item.channel.channelId, item.video.videoId);
    }
  }

  return { rollbackClaimedVideo, rollbackClaimedItems };
}
