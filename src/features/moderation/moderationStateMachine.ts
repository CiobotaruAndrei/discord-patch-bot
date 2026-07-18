"use strict";

import type { ModerationRecord, WarningRecord } from "./moderationRepository.js";

export type ModerationAggregate = {
  moderationTimeouts: ModerationRecord[];
  moderationMutes: ModerationRecord[];
  moderationWarnings: WarningRecord[];
};

export type ModerationTransition =
  | { type: "timeout" | "mute"; record: ModerationRecord }
  | { type: "remove-timeout" | "remove-mute"; userId: string }
  | { type: "warn"; record: WarningRecord }
  | { type: "remove-warn"; userId: string };

export function transitionModeration(current: ModerationAggregate, transition: ModerationTransition): ModerationAggregate {
  if (transition.type === "timeout") return {
    ...current,
    moderationTimeouts: [...current.moderationTimeouts.filter(item => item.userId !== transition.record.userId), transition.record],
    moderationMutes: current.moderationMutes.filter(item => item.userId !== transition.record.userId)
  };
  if (transition.type === "mute") return {
    ...current,
    moderationMutes: [...current.moderationMutes.filter(item => item.userId !== transition.record.userId), transition.record],
    moderationTimeouts: current.moderationTimeouts.filter(item => item.userId !== transition.record.userId)
  };
  if (transition.type === "remove-timeout") return { ...current, moderationTimeouts: current.moderationTimeouts.filter(item => item.userId !== transition.userId) };
  if (transition.type === "remove-mute") return { ...current, moderationMutes: current.moderationMutes.filter(item => item.userId !== transition.userId) };
  if (transition.type === "warn") return { ...current, moderationWarnings: [...current.moderationWarnings, transition.record] };
  const userId = "userId" in transition ? transition.userId : "";
  return { ...current, moderationWarnings: current.moderationWarnings.filter((_, index, rows) => index !== rows.map(item => item.userId).lastIndexOf(userId)) };
}
