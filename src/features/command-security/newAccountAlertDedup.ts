"use strict";

export interface NewAccountAlertDeliveryModelLike {
  findOneAndUpdate(
    filter: Record<string, object | string | object[]>,
    update: Record<string, object>,
    options: Record<string, boolean>
  ): Promise<{ claimToken?: string | null } | null>;
  updateOne(filter: Record<string, string>, update: Record<string, object>): Promise<{ modifiedCount?: number }>;
}

export interface NewAccountAlertClaim {
  token: string;
  markDelivered(): Promise<boolean>;
  markSentUnconfirmed(): Promise<boolean>;
  release(): Promise<void>;
}

export function createNewAccountAlertDelivery(
  model: NewAccountAlertDeliveryModelLike,
  createToken: () => string,
  now: () => number = () => Date.now()
): { claim(guildId: string, userId: string): Promise<NewAccountAlertClaim | null> } {
  async function claim(guildId: string, userId: string): Promise<NewAccountAlertClaim | null> {
    if (!guildId || !userId) return null;
    const token = createToken();
    const current = now();
    const leaseUntil = new Date(current + 5 * 60_000);
    const expiresAt = new Date(current + 90 * 86_400_000);
    let document: { claimToken?: string | null } | null;
    try {
      document = await model.findOneAndUpdate(
        {
          _id: `${guildId}:${userId}`,
          $or: [
            { status: { $nin: ["delivered", "sent-unconfirmed"] }, leaseUntil: { $lte: new Date(current) } },
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
    return {
      token,
      async markDelivered(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: `${guildId}:${userId}`, claimToken: token, status: "claimed" },
          { $set: { status: "delivered", deliveredAt: new Date(now()), expiresAt: new Date(now() + 90 * 86_400_000) }, $unset: { claimToken: "", leaseUntil: "" } }
        );
        return result.modifiedCount === 1;
      },
      async markSentUnconfirmed(): Promise<boolean> {
        const result = await model.updateOne(
          { _id: `${guildId}:${userId}`, claimToken: token, status: "claimed" },
          { $set: { status: "sent-unconfirmed", deliveredAt: new Date(now()), expiresAt: new Date(now() + 90 * 86_400_000) }, $unset: { leaseUntil: "" } }
        );
        return result.modifiedCount === 1;
      },
      async release(): Promise<void> {
        await model.updateOne(
          { _id: `${guildId}:${userId}`, claimToken: token, status: "claimed" },
          { $set: { leaseUntil: new Date(0), expiresAt: new Date(now() + 86_400_000) }, $unset: { claimToken: "" } }
        );
      }
    };
  }
  return { claim };
}

export default { createNewAccountAlertDelivery };
