"use strict";

export type DiscordGatewayLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type DiscordGatewayMetrics = {
  requests?: () => void;
  rateLimits?: () => void;
  errors?: () => void;
};

export interface DiscordReplyTarget {
  deferReply?(payload?: unknown): Promise<unknown>;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
  editReply?(payload: unknown): Promise<unknown>;
}

export interface DiscordSendTarget {
  send(payload: unknown): Promise<unknown>;
}

export interface DiscordGateway {
  defer(target: DiscordReplyTarget, options?: { ephemeral?: boolean }): Promise<unknown>;
  reply(target: DiscordReplyTarget, payload: unknown, options?: { ephemeral?: boolean; allowedMentions?: { parse?: string[] } }): Promise<unknown>;
  followUp(target: DiscordReplyTarget, payload: unknown, options?: { ephemeral?: boolean; allowedMentions?: { parse?: string[] } }): Promise<unknown>;
  edit(target: DiscordReplyTarget, payload: unknown): Promise<unknown>;
  send(target: DiscordSendTarget, payload: unknown, options?: { allowedMentions?: { parse?: string[] } }): Promise<unknown>;
}

function createDiscordGateway(logger: DiscordGatewayLogger, metrics: DiscordGatewayMetrics = {}): DiscordGateway {
  async function call<T>(context: string, fn: () => Promise<T>): Promise<T> {
    metrics.requests?.();
    try {
      return await fn();
    } catch (error) {
      metrics.errors?.();
      logger("WARN", "DISCORD_GATEWAY", `${context} a esuat`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  const normalize = (payload: unknown, options?: { ephemeral?: boolean; allowedMentions?: { parse?: string[] } }) => {
    const base = payload && typeof payload === "object" ? payload as Record<string, unknown> : { content: payload };
    return { ...base, ...(options?.ephemeral === undefined ? {} : { ephemeral: options.ephemeral }), allowedMentions: options?.allowedMentions ?? { parse: [] } };
  };
  return {
    defer: (target, options) => call("deferReply", () => target.deferReply?.(options?.ephemeral ? { flags: 64 } : {}) ?? Promise.reject(new Error("deferReply indisponibil"))),
    reply: (target, payload, options) => call("reply", () => target.reply?.(normalize(payload, options)) ?? Promise.reject(new Error("reply indisponibil"))),
    followUp: (target, payload, options) => call("followUp", () => target.followUp?.(normalize(payload, options)) ?? Promise.reject(new Error("followUp indisponibil"))),
    edit: (target, payload) => call("editReply", () => target.editReply?.(payload) ?? Promise.reject(new Error("editReply indisponibil"))),
    send: (target, payload, options) => call("send", () => target.send(normalize(payload, options)))
  };
}

export { createDiscordGateway };
