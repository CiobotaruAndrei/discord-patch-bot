"use strict";

import type { ProtectedResourceSnapshot } from "./protectedResourceTypes.js";

export const CATEGORY_CHANNEL_TYPE = 4;

export function overwritePayload(snapshot: ProtectedResourceSnapshot): Array<Record<string, unknown>> {
  return snapshot.overwrites.map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: BigInt(overwrite.allow),
    deny: BigInt(overwrite.deny)
  }));
}

export function channelEditPayload(snapshot: ProtectedResourceSnapshot): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: snapshot.name,
    permissionOverwrites: overwritePayload(snapshot)
  };
  if (snapshot.parentId !== null) payload.parent = snapshot.parentId;
  if (snapshot.position !== null) payload.position = snapshot.position;
  if (snapshot.topic !== null) payload.topic = snapshot.topic;
  if (snapshot.nsfw !== null) payload.nsfw = snapshot.nsfw;
  if (snapshot.rateLimitPerUser !== null) payload.rateLimitPerUser = snapshot.rateLimitPerUser;
  if (snapshot.bitrate !== null) payload.bitrate = snapshot.bitrate;
  if (snapshot.userLimit !== null) payload.userLimit = snapshot.userLimit;
  return payload;
}

export function roleEditPayload(snapshot: ProtectedResourceSnapshot): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: snapshot.name };
  if (snapshot.permissions !== null) payload.permissions = BigInt(snapshot.permissions);
  if (snapshot.position !== null) payload.position = snapshot.position;
  if (snapshot.color !== null) payload.color = snapshot.color;
  if (snapshot.hoist !== null) payload.hoist = snapshot.hoist;
  if (snapshot.mentionable !== null) payload.mentionable = snapshot.mentionable;
  return payload;
}

export function channelCreatePayload(snapshot: ProtectedResourceSnapshot): Record<string, unknown> {
  const payload = channelEditPayload(snapshot);
  payload.type = snapshot.channelType ?? 0;
  if (snapshot.channelType === CATEGORY_CHANNEL_TYPE) delete payload.parent;
  return payload;
}
