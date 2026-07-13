import test from "node:test";
import assert from "node:assert/strict";

import { createNotificationEmbeds } from "../../features/command-presentation/notificationEmbeds.js";

class FakeEmbed {
  color: unknown;
  title: unknown;
  footer: unknown;
  url: unknown;
  description: unknown;
  image: unknown;
  thumbnail: unknown;
  timestamp: unknown;
  author: unknown;
  fields: unknown[] = [];
  setColor(value: unknown) { this.color = value; return this; }
  setTitle(value: unknown) { this.title = value; return this; }
  setFooter(value: unknown) { this.footer = value; return this; }
  setURL(value: unknown) { this.url = value; return this; }
  setDescription(value: unknown) { this.description = value; return this; }
  setImage(value: unknown) { this.image = value; return this; }
  setThumbnail(value: unknown) { this.thumbnail = value; return this; }
  setTimestamp(value: unknown) { this.timestamp = value; return this; }
  setAuthor(value: unknown) { this.author = value; return this; }
  addFields(...fields: unknown[]) { this.fields.push(...fields); return this; }
}

const embeds = createNotificationEmbeds({
  EmbedBuilder: FakeEmbed,
  COLORS: { SUCCESS: 1, ERROR: 2, FREE: 3 },
  truncate: (value, maxLen) => String(value ?? "").slice(0, maxLen),
  DEFAULT_CURRENCY: "EUR",
  formatPrice: (value, currencyCode) => `${value} ${currencyCode}`
});

test("buildUpdateEmbed compact trimite doar indicatia de titlu, detailed include excerpt, imagine si timestamp", () => {
  const latest = {
    title: "Patch 1.2",
    link: "https://example.com/patch",
    excerpt: "Note de patch",
    image: "https://img.example/full.png",
    thumbnail: "https://img.example/thumb.png",
    timestamp: "2026-07-01T10:00:00.000Z"
  };

  const compact = embeds.buildUpdateEmbed("Jocul Meu", latest, "compact") as FakeEmbed;
  assert.equal(compact.description, "Apasa pe titlu pentru a citi patch-ul.");
  assert.equal(compact.image, undefined);

  const detailed = embeds.buildUpdateEmbed("Jocul Meu", latest) as FakeEmbed;
  assert.equal(detailed.description, "Note de patch");
  assert.equal(detailed.image, "https://img.example/full.png");
  assert.equal(detailed.thumbnail, "https://img.example/thumb.png");
  assert.ok(detailed.timestamp instanceof Date);
  assert.equal(detailed.url, "https://example.com/patch");
});

test("buildDealEmbed marcheaza jocurile gratuite cu culoarea FREE si titlul Gratuit, reducerile cu ERROR", () => {
  const freeDeal = embeds.buildDealEmbed({ title: "Joc Gratis", salePrice: "0", normalPrice: "10", store: "Epic", link: "https://x" }, "compact") as FakeEmbed;
  assert.equal(freeDeal.color, 3);
  assert.ok(String(freeDeal.title).startsWith("Gratuit: "));
  assert.ok(String(freeDeal.description).includes("GRATUIT"));

  const discountDeal = embeds.buildDealEmbed({ title: "Joc Redus", salePrice: "5", normalPrice: "10", store: "Steam", link: "https://y", savings: 50 }) as FakeEmbed;
  assert.equal(discountDeal.color, 2);
  assert.ok(String(discountDeal.title).startsWith("Reducere: "));
  assert.ok(String(discountDeal.description).includes("50%"));
  assert.equal(discountDeal.fields.length, 3);
});

test("buildDealEmbed detailed plafoneaza savings la 0-100 si adauga extraDetails ca field separat", () => {
  const weird = embeds.buildDealEmbed({
    title: "Joc",
    salePrice: "5",
    normalPrice: "10",
    store: "Steam",
    link: "https://z",
    savings: 250,
    extraDetails: "  editie deluxe  "
  }) as FakeEmbed;
  assert.ok(String(weird.description).includes("100%"));
  const detailsField = weird.fields.find(field => (field as { name?: string }).name === "Detalii") as { value?: string };
  assert.equal(detailsField?.value, "editie deluxe");
});
