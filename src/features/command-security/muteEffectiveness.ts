"use strict";

export interface ChannelWriteProbe {
  channelId: string;
  isThread: boolean;
  canView: boolean | null;
  canPost: boolean | null;
}

export interface WritableChannelProbe {
  channelId: string;
  canSendMessages: boolean | null;
}

export function resolveWriteProbe(probe: ChannelWriteProbe): WritableChannelProbe {
  if (probe.canView === null || probe.canPost === null) {
    return { channelId: probe.channelId, canSendMessages: null };
  }
  return { channelId: probe.channelId, canSendMessages: probe.canView && probe.canPost };
}

export type MuteEffect =
  | { kind: "silenced"; verified: number }
  | { kind: "still-writable"; channelIds: string[]; verified: number }
  | { kind: "unverifiable"; reason: string };

export function assessMuteEffect(probes: readonly WritableChannelProbe[]): MuteEffect {
  const writable = probes.filter(probe => probe.canSendMessages === true).map(probe => probe.channelId);
  if (writable.length > 0) {
    return { kind: "still-writable", channelIds: writable, verified: probes.length };
  }

  const readable = probes.filter(probe => probe.canSendMessages !== null);
  if (readable.length === 0) {
    return { kind: "unverifiable", reason: "permisiunile efective nu au putut fi citite in niciun canal" };
  }
  if (readable.length < probes.length) {
    return {
      kind: "unverifiable",
      reason: `permisiunile nu au putut fi citite in ${probes.length - readable.length} canale, deci tacerea nu e confirmata`
    };
  }

  return { kind: "silenced", verified: readable.length };
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
