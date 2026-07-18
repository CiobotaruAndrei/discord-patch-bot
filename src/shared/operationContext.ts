"use strict";

export type OperationContext = {
  requestId: string;
  operationId: string;
  guildId?: string;
  retry: number;
};

export function createOperationContext(input: { operationId: string; requestId?: string; guildId?: string; retry?: number }): OperationContext {
  return {
    requestId: input.requestId ?? input.operationId,
    operationId: input.operationId,
    guildId: input.guildId,
    retry: Math.max(0, Math.floor(input.retry ?? 0))
  };
}

export function operationContextMeta(context: OperationContext): Record<string, string | number> {
  return {
    requestId: context.requestId,
    operationId: context.operationId,
    ...(context.guildId ? { guildId: context.guildId } : {}),
    retry: context.retry
  };
}
