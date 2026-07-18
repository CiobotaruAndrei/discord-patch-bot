"use strict";

import crypto from "node:crypto";

export type AuditCorrelation = {
  operationId: string;
  requestId: string;
  guildId: string;
};

export function createAuditCorrelation(guildId: string, requestId: string = crypto.randomUUID()): AuditCorrelation {
  return { guildId, requestId, operationId: `${guildId}:${requestId}` };
}
