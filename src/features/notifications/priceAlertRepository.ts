import type { GameConfig, PriceAlertRule } from "../../types.js";

export interface PriceAlertGuildModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ priceAlerts?: PriceAlertRule[] } | null>;
}

export const MAX_PRICE_ALERTS_PER_GUILD = 25;
export const PRICE_ALERT_MIN_THRESHOLD = 0.01;
export const PRICE_ALERT_MAX_THRESHOLD = 10000;

export function isValidPriceAlertThreshold(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= PRICE_ALERT_MIN_THRESHOLD
    && value <= PRICE_ALERT_MAX_THRESHOLD;
}

export function buildPriceAlertRule(game: GameConfig, threshold: number, currency: string): PriceAlertRule {
  return {
    gameKey: game.key,
    gameName: game.name,
    appId: typeof game.appId === "string" ? game.appId : "",
    aliases: Array.isArray(game.aliases) ? game.aliases.map(String) : [],
    threshold,
    currency,
    triggeredAt: null,
    lastObservedPrice: null,
    lastObservedAt: null
  };
}

export function buildPriceAlertUpsertPipeline(rule: PriceAlertRule, maxAlerts: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      priceAlerts: {
        $let: {
          vars: {
            kept: {
              $filter: {
                input: { $ifNull: ["$priceAlerts", []] },
                as: "alert",
                cond: {
                  $not: {
                    $and: [
                      { $eq: ["$$alert.gameKey", rule.gameKey] },
                      { $eq: ["$$alert.currency", rule.currency] }
                    ]
                  }
                }
              }
            }
          },
          in: {
            $cond: [
              { $lt: [{ $size: "$$kept" }, maxAlerts] },
              { $concatArrays: ["$$kept", [rule]] },
              "$$kept"
            ]
          }
        }
      }
    }
  }];
}

export async function upsertPriceAlert(
  GuildModel: PriceAlertGuildModelLike,
  guildId: string,
  rule: PriceAlertRule,
  maxAlerts = MAX_PRICE_ALERTS_PER_GUILD
): Promise<{ saved: boolean }> {
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildPriceAlertUpsertPipeline(rule, maxAlerts),
    { upsert: true, returnDocument: "after" }
  );
  const saved = (Array.isArray(updated?.priceAlerts) ? updated.priceAlerts : [])
    .some(alert => alert.gameKey === rule.gameKey && alert.currency === rule.currency);
  return { saved };
}

export async function removePriceAlertsForGame(
  GuildModel: PriceAlertGuildModelLike,
  guildId: string,
  gameKey: string
): Promise<number> {
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { priceAlerts: { gameKey } } }
  );
  return result.modifiedCount ?? 0;
}
