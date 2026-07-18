"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory.js";
import type { SeenServices } from "./seenRuntimeFactory.js";
import { createReportRollbackFailure } from "./notificationRuntimeContracts.js";

import { isPermanentDiscordError, transientErrorMessage } from "./outboundChannel.js";
import { createDlcNotificationService } from "./dlcNotificationService.js";
import { fetchGameDlcs } from "../command-handlers/dlcSourceService.js";

const MAX_DLCS_PER_CYCLE = 10;
const DLC_FETCH_CONCURRENCY = 3;

export function createDlcNotificationRuntime(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver,
  seenRepository: SeenServices
) {
  const {
    GuildModel, logger, runConcurrent, DEFAULT_CURRENCY, sleepIfPositive,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY, httpReq, safeCheerioLoad
  } = deps;
  const { claimSeenDlc, rollbackSeenDlc, seedSeenDlcs, disableDlcForChannelError } = seenRepository;
  const reportRollbackFailure = createReportRollbackFailure(deps);

  const dlcService = createDlcNotificationService({
    GuildModel,
    logger,
    runConcurrent,
    resolveOutboundChannel,
    claimSeenDlc,
    rollbackSeenDlc,
    seedSeenDlcs,
    disableDlcForChannelError,
    reportRollbackFailure,
    isPermanentDiscordError,
    transientErrorMessage,
    fetchGameDlcs,
    dlcSource: { httpReq, safeCheerioLoad, logger },
    sleepIfPositive,
    DEFAULT_CURRENCY,
    MAX_DLCS_PER_CYCLE,
    DLC_FETCH_CONCURRENCY,
    DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY
  });

  return { dlcService };
}

export type DlcNotificationRuntime = ReturnType<typeof createDlcNotificationRuntime>;
