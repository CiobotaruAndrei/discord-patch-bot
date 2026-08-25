"use strict";

export const MAX_VERIFIED_CHANNELS = 25;

export interface WritableChannelProbe {
  channelId: string;
  canSendMessages: boolean | null;
}

export type MuteEffect =
  | { kind: "silenced"; verified: number }
  | { kind: "still-writable"; channelIds: string[]; verified: number }
  | { kind: "unverifiable"; reason: string };

export function assessMuteEffect(probes: readonly WritableChannelProbe[]): MuteEffect {
  const readable = probes.filter(probe => probe.canSendMessages !== null);
  if (readable.length === 0) {
    return { kind: "unverifiable", reason: "permisiunile efective nu au putut fi citite in niciun canal" };
  }

  const writable = readable.filter(probe => probe.canSendMessages === true).map(probe => probe.channelId);
  return writable.length > 0
    ? { kind: "still-writable", channelIds: writable, verified: readable.length }
    : { kind: "silenced", verified: readable.length };
}

export function describeMuteEffect(effect: MuteEffect): string {
  if (effect.kind === "silenced") {
    return `rolul Muted opreste efectiv scrisul (verificat in ${effect.verified} canale)`;
  }
  if (effect.kind === "unverifiable") {
    return `rolul Muted a fost atribuit, dar efectul nu a putut fi verificat: ${effect.reason}`;
  }
  const shown = effect.channelIds.slice(0, 3).join(", ");
  const rest = effect.channelIds.length > 3 ? ` si inca ${effect.channelIds.length - 3}` : "";
  return `rolul Muted a fost atribuit, dar participantul poate scrie in continuare in ${shown}${rest}`;
}
