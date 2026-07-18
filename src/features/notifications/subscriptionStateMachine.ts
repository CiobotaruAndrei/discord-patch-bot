"use strict";

export type SubscriptionState = "inactive" | "initializing" | "active";
export type SubscriptionTransition =
  | { type: "begin"; activationId: string }
  | { type: "finalize"; activationId: string }
  | { type: "supersede"; activationId: string }
  | { type: "fail"; activationId: string }
  | { type: "stop" };

export type SubscriptionStateSnapshot = {
  state: SubscriptionState;
  activationId?: string;
};

export type SubscriptionTransitionResult = {
  accepted: boolean;
  next: SubscriptionStateSnapshot;
};

/** Pure lifecycle reducer used by the persistence adapter and deterministic tests. */
export function transitionSubscription(
  current: SubscriptionStateSnapshot,
  transition: SubscriptionTransition
): SubscriptionTransitionResult {
  switch (transition.type) {
    case "begin":
      return { accepted: true, next: { state: "initializing", activationId: transition.activationId } };
    case "finalize":
      return current.state === "initializing" && current.activationId === transition.activationId
        ? { accepted: true, next: { state: "active" } }
        : { accepted: false, next: current };
    case "supersede":
      return current.activationId === transition.activationId
        ? { accepted: true, next: { state: "inactive" } }
        : { accepted: false, next: current };
    case "fail":
      return current.activationId === transition.activationId
        ? { accepted: true, next: { state: "inactive" } }
        : { accepted: false, next: current };
    case "stop":
      return { accepted: true, next: { state: "inactive" } };
  }
}
