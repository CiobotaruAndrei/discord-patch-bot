"use strict";

export interface NewAccountAlertDeliveryModelLike {
  findOneAndUpdate(
    filter: Record<string, object | string | object[]>,
    update: Record<string, object>,
    options: Record<string, boolean>
  ): Promise<{ claimToken?: string | null } | null>;
  updateOne(filter: Record<string, unknown>, update: Record<string, object>): Promise<{ modifiedCount?: number }>;
  updateMany?(filter: Record<string, unknown>, update: Record<string, object>): Promise<{ modifiedCount?: number }>;
  countDocuments?(filter: Record<string, unknown>): Promise<number>;
}

export interface NewAccountAlertClaim {
  token: string;
  beginSend(): Promise<boolean>;
  markDelivered(): Promise<boolean>;
  markSentUnconfirmed(): Promise<boolean>;
  release(): Promise<boolean>;
}

export type NewAccountAlertOutcome = "delivered" | "sent-unconfirmed" | "undetermined" | "not-claimed";

const CLAIM_LEASE_MS = 5 * 60_000;
const SENDING_LEASE_MS = 100 * 365 * 86_400_000;
const RETENTION_MS = 90 * 86_400_000;
const RELEASED_RETENTION_MS = 86_400_000;

export const NEW_ACCOUNT_SEND_RECONCILE_AFTER_MS = 15 * 60_000;

export function createNewAccountAlertDelivery(
  model: NewAccountAlertDeliveryModelLike,
  createToken: () => string,
  now: () => number = () => Date.now()
): { claim(guildId: string, userId: string): Promise<NewAccountAlertClaim | null> } {
  async function claim(guildId: string, userId: string): Promise<NewAccountAlertClaim | null> {
    if (!guildId || !userId) return null;
    const token = createToken();
    const current = now();
    const leaseUntil = new Date(current + CLAIM_LEASE_MS);
    const expiresAt = new Date(current + RETENTION_MS);
    let document: { claimToken?: string | null } | null;
    try {
      document = await model.findOneAndUpdate(
        {
          _id: `${guildId}:${userId}`,
          $or: [
            { status: { $nin: ["delivered", "sent-unconfirmed", "sending"] }, leaseUntil: { $lte: new Date(current) } },
            { status: { $exists: false } }
          ]
        },
        {
          $set: { guildId, userId, status: "claimed", claimToken: token, leaseUntil, expiresAt },
          $setOnInsert: { deliveredAt: null }
        },
        { upsert: true, new: true }
      );
    } catch {
      return null;
    }
    if (document?.claimToken !== token) return null;
    const id = `${guildId}:${userId}`;
    return {
      token,
      async beginSend(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: id, claimToken: token, status: "claimed" },
          {
            $set: {
              status: "sending",
              sendingAt: new Date(now()),
              leaseUntil: new Date(now() + SENDING_LEASE_MS),
              expiresAt: new Date(now() + RETENTION_MS)
            }
          }
        );
        return result.modifiedCount === 1;
      },
      async markDelivered(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: id, claimToken: token, status: "sending" },
          {
            $set: { status: "delivered", deliveredAt: new Date(now()), expiresAt: new Date(now() + RETENTION_MS) },
            $unset: { claimToken: "", leaseUntil: "", sendingAt: "" }
          }
        );
        return result.modifiedCount === 1;
      },
      async markSentUnconfirmed(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: id, claimToken: token, status: "sending" },
          {
            $set: { status: "sent-unconfirmed", deliveredAt: new Date(now()), expiresAt: new Date(now() + RETENTION_MS) },
            $unset: { leaseUntil: "", sendingAt: "" }
          }
        );
        return result.modifiedCount === 1;
      },
      async release(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: id, claimToken: token, status: { $in: ["claimed", "sending"] } },
          {
            $set: { status: "released", leaseUntil: new Date(0), expiresAt: new Date(now() + RELEASED_RETENTION_MS) },
            $unset: { claimToken: "", sendingAt: "" }
          }
        );
        return result.modifiedCount === 1;
      }
    };
  }
  return { claim };
}

export async function deliverNewAccountAlert(
  claim: NewAccountAlertClaim | null,
  send: () => Promise<void>
): Promise<NewAccountAlertOutcome> {
  if (!claim) {
    await send();
    return "delivered";
  }
  const started = await claim.beginSend().catch(() => false);
  if (!started) return "not-claimed";
  try {
    await send();
  } catch (error) {
    await claim.release().catch(() => false);
    throw error;
  }
  if (await claim.markDelivered().catch(() => false)) return "delivered";
  if (await claim.markSentUnconfirmed().catch(() => false)) return "sent-unconfirmed";
  return "undetermined";
}

export async function countUnresolvedNewAccountSends(
  model: Pick<NewAccountAlertDeliveryModelLike, "countDocuments">,
  guildId: string
): Promise<number> {
  if (!model.countDocuments) return 0;
  try {
    return await model.countDocuments({ guildId, status: "sending" });
  } catch {
    return -1;
  }
}

export async function reconcileStuckNewAccountSends(
  model: Pick<NewAccountAlertDeliveryModelLike, "updateMany">,
  olderThanMs: number = NEW_ACCOUNT_SEND_RECONCILE_AFTER_MS,
  now: () => number = () => Date.now()
): Promise<number> {
  if (!model.updateMany) return 0;
  const cutoff = new Date(now() - olderThanMs);
  try {
    const result = await model.updateMany(
      { status: "sending", sendingAt: { $lte: cutoff } },
      {
        $set: { status: "sent-unconfirmed", reconciledAt: new Date(now()), expiresAt: new Date(now() + RETENTION_MS) },
        $unset: { leaseUntil: "", sendingAt: "" }
      }
    );
    return result.modifiedCount ?? 0;
  } catch {
    return 0;
  }
}

export default {
  createNewAccountAlertDelivery,
  deliverNewAccountAlert,
  reconcileStuckNewAccountSends,
  countUnresolvedNewAccountSends
};
