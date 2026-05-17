"use strict";

module.exports = (ctx) => {
function dealPassesFilters(deal, guild) {
  const minDisc = guild?.minDiscountPercent ?? 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;
  const maxPrice = Number(guild?.maxAbsolutePrice) || 0;
  const enabledStores = Array.isArray(guild?.enabledStores) ? guild.enabledStores : [];

  const salePriceNum = parseFloat(deal.salePrice);
  const isFree = salePriceNum === 0;

  if (isFree && !incFree) return false;
  if (!isFree && !incPaid) return false;
  if (!isFree && deal.savings < minDisc) return false;
  if (!isFree && maxPrice > 0 && Number.isFinite(salePriceNum) && salePriceNum > maxPrice) return false;
  if (enabledStores.length > 0 && !enabledStores.includes(deal.store)) return false;
  return true;
}

function normalizePendingUpdateArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (!item || typeof item !== "object" || !item.id) return null;
    return {
      id: String(item.id),
      title: item.title || "",
      link: item.link || "",
      excerpt: item.excerpt || "",
      thumbnail: item.thumbnail || null,
      image: item.image || null,
      timestamp: item.timestamp || "",
      createdAt: item.createdAt || new Date(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0
    };
  }).filter(Boolean);
}

function normalizePendingDiscountArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (!item || typeof item !== "object" || !item.hash) return null;
    return {
      hash: String(item.hash),
      snapshot: item.snapshot || null,
      lastSeenAt: item.lastSeenAt || new Date(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0
    };
  }).filter(Boolean);
}

function toEntries(value) {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof value.toObject === "function") return Object.entries(value.toObject());
  return Object.entries(value);
}

function mapToObject(map) {
  return Object.fromEntries(Array.from(map.entries()));
}

function getSeenSet(guild, gameKey) {
  const seenEntries = toEntries(guild.seen);
  const found = seenEntries.find(([key]) => key === gameKey);
  return new Set(Array.isArray(found?.[1]) ? found[1].map(String) : []);
}

function rotateAfter(keys, lastKey) {
  if (!lastKey || !keys.includes(lastKey)) return keys;
  const index = keys.indexOf(lastKey);
  return keys.slice(index + 1).concat(keys.slice(0, index + 1));
}

  Object.assign(ctx, {
    dealPassesFilters,
    normalizePendingUpdateArray,
    normalizePendingDiscountArray,
    toEntries,
    mapToObject,
    getSeenSet,
    rotateAfter
  });
};
