// @ts-check
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dealHash } = require("../sources");

function steamDeal() {
  return {
    id: "steam_730",
    steamAppID: 730,
    title: "Counter-Strike 2",
    salePrice: "9.99",
    normalPrice: "19.99",
    savings: 50,
    store: "Steam",
    link: "https://store.steampowered.com/app/730",
    popularityScore: 90,
    totalReviews: 1000,
    qualityScore: 95,
    endDateStr: "Nespecificat",
    extraDetails: "",
    enriched: false,
    thumbnail: null,
    currency: "USD"
  };
}

function epicDeal() {
  return {
    id: "epic_abc-123",
    steamAppID: null,
    title: "Fortnite Pack",
    salePrice: "5.00",
    normalPrice: "10.00",
    savings: 50,
    store: "Epic Games",
    link: "https://store.epicgames.com/en-US/p/fortnite-pack",
    popularityScore: 80,
    totalReviews: 0,
    qualityScore: 80,
    endDateStr: "01/01/2026",
    extraDetails: "",
    enriched: true,
    thumbnail: null,
    currency: "USD"
  };
}

function listingDeal() {
  return {
    id: "ls_abc",
    steamAppID: null,
    title: "Some Listing Game",
    salePrice: "7.50",
    normalPrice: "15.00",
    savings: 50,
    store: "Itch.io",
    link: "https://example.com/game",
    popularityScore: 60,
    totalReviews: 0,
    qualityScore: 70,
    endDateStr: "TBD",
    extraDetails: "",
    enriched: true,
    thumbnail: null,
    currency: "USD"
  };
}

test("dealHash este stabil pentru acelasi deal Steam", () => {
  assert.equal(dealHash(steamDeal()), dealHash(steamDeal()));
});

test("dealHash este stabil pentru acelasi deal Epic", () => {
  assert.equal(dealHash(epicDeal()), dealHash(epicDeal()));
});

test("dealHash nu se schimba cand doar endDateStr difera pentru Steam", () => {
  const a = steamDeal();
  const b = steamDeal();
  b.endDateStr = "31/12/2026";
  assert.equal(dealHash(a), dealHash(b));
});

test("dealHash nu se schimba cand doar endDateStr difera pentru Epic", () => {
  const a = epicDeal();
  const b = epicDeal();
  b.endDateStr = "31/12/2026";
  assert.equal(dealHash(a), dealHash(b));
});

test("dealHash nu se schimba cand doar endDateStr difera pentru listing", () => {
  const a = listingDeal();
  const b = listingDeal();
  b.endDateStr = "31/12/2026";
  assert.equal(dealHash(a), dealHash(b));
});

test("dealHash se schimba cand savings difera", () => {
  const a = steamDeal();
  const b = steamDeal();
  b.savings = 70;
  assert.notEqual(dealHash(a), dealHash(b));
});

test("dealHash se schimba cand salePrice difera", () => {
  const a = steamDeal();
  const b = steamDeal();
  b.salePrice = "4.99";
  assert.notEqual(dealHash(a), dealHash(b));
});

test("dealHash se schimba cand normalPrice difera", () => {
  const a = steamDeal();
  const b = steamDeal();
  b.normalPrice = "29.99";
  assert.notEqual(dealHash(a), dealHash(b));
});
