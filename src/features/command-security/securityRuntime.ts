"use strict";

import { createBotAddSecurityRuntime } from "./botAddSecurityRuntime.js";
import { createMessageThreatRuntime } from "./messageThreatRuntime.js";
import { createChannelLockCleanupRuntime } from "./channelLockCleanupRuntime.js";

import type { SecurityRuntimeDeps } from "./securityEventContext.js";

export type { SecurityRuntimeDeps } from "./securityEventContext.js";

export function createSecurityRuntime(deps: SecurityRuntimeDeps) {
  const botAdd = createBotAddSecurityRuntime(deps);
  const messages = createMessageThreatRuntime({ ...deps, observeBotMessage: botAdd.observeBotMessage });
  const channels = createChannelLockCleanupRuntime(deps);

  return Object.freeze({
    handleGuildMemberAdd: botAdd.handleGuildMemberAdd,
    handleMessageCreate: messages.handleMessageCreate,
    handleChannelDelete: channels.handleChannelDelete
  });
}

export default { createSecurityRuntime };
