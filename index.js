const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const http = require("http");
const cron = require("node-cron");
const Parser = require("rss-parser");
const crypto = require("crypto");
const { z } = require("zod");
const rssParser = new Parser();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

// -------------------------------------------------------------
// SISTEM DE TRADUCERI (i18n)
// -------------------------------------------------------------
const i18n = {
  ro: {
    adminOnly: "⛔ Doar un admin poate folosi această comandă.",
    pong: "Pong! 🏓",
    setChannelUpdates: "⏳ Setez canalul...",
    updatesActive: "✅ Update-uri automate activate.",
    initError: "Eroare la inițializarea datelor.",
    startUpdatesSyntax: "❌ Sintaxă: `{prefix}start updates` sau `{prefix}start reduceri`.",
    setChannelDeals: "⏳ Setez canalul oferte...",
    dealsActive: "✅ Alertele reduceri activate!",
    dealsError: "Eroare internă la preluarea ofertelor.",
    stopUpdates: "🛑 Update-uri oprite.",
    stopDeals: "🛑 Reduceri oprite.",
    stopSyntax: "❌ Sintaxă: `{prefix}stop updates` sau `{prefix}stop reduceri`.",
    setHelp: "⚙️ Setări: mode, mindiscount, free, paid, lang.",
    invalidMode: "❌ Permise: `compact` sau `detailed`.",
    modeSet: "✅ Mod setat: **{value}**",
    invalidDiscount: "❌ 0-100.",
    discountSet: "✅ Reducere minimă: **{value}%**",
    invalidBool: "❌ `on` / `off`.",
    freeSet: "✅ Jocuri free: **{value}**",
    paidSet: "✅ Oferte plătite: **{value}**",
    invalidLang: "❌ Limbi permise: `ro` sau `en`.",
    langSet: "✅ Limba setată: **{value}**",
    unknownSetting: "❌ Setare necunoscută.",
    saveError: "Eroare la salvarea preferințelor.",
    estTime: "⏳ *Durată estimată: **{time} secunde***",
    fetchUpdatesError: "Nu am reușit să obțin update-urile.",
    noData: "❌ Nu am date disponibile.",
    dataLoaded: "✅ Date încărcate!",
    fetchDealsError: "Nu am putut interoga magazinele.",
    noDealsMatch: "❌ Nu am găsit oferte care să corespundă setărilor serverului.",
    dealsLoaded: "✅ Oferte încărcate!",
    latestUpdateSyntax: "❌ Ex: `{prefix}latest update cs2`.",
    connecting: "⏳ *Mă conectez... Durată estimată: **{time} secunde**.*",
    gameNotFound: "❌ Nu am găsit jocul.",
    didYouMean: " Te refereai cumva la **{name}** (`{key}`)?",
    updateSuccess: "✅ Update **{name}**:",
    updateError: "Nu am putut prelua acest update.",
    priceSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}latest pret cyberpunk`.",
    searchingPrice: "⏳ *Caut prețul pe Steam pentru **{name}**...*",
    steamError: "❌ Eroare la conectarea cu serverele Steam. Te rugăm să încerci mai târziu.",
    noSteamResults: "❌ Nu am găsit niciun rezultat pe Steam pentru \"**{name}**\".",
    invalidSteamResult: "❌ Nu am putut selecta un rezultat valid de pe Steam.",
    steamApiError: "❌ Steam API nu a putut returna detaliile pentru acest titlu.",
    steamDetailsUnavailable: "❌ Am găsit un rezultat, dar detaliile de preț nu sunt disponibile (posibil blocat regional sau nelistat).",
    priceSuccess: "✅ Am obținut datele de pe Steam!",
    priceUnexpectedError: "❌ A apărut o eroare neașteptată la căutarea prețului.",
    dlcSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}dlc cyberpunk`.",
    searchingDlc: "⏳ *Caut DLC-urile pentru **{name}**...*",
    ageGate: "❌ Pagina de Steam pentru **{name}** necesită verificare de vârstă, iar botul nu o poate accesa direct.",
    pageStructureError: "❌ Structura paginii pentru **{name}** nu a putut fi interpretată (posibil regiune blocată sau pachet special).",
    noDlcList: "❌ Jocul **{name}** nu are niciun DLC listat separat pe magazinul Steam.",
    dlcSuccess: "✅ Am găsit **{count}** DLC-uri pentru **{name}**!",
    dlcUnexpectedError: "❌ A apărut o eroare la căutarea DLC-urilor.",
    statusSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}status fortnite`.",
    searchingStatus: "⏳ *Verific statusul serverelor pentru **{name}**...*",
    statusSuccess: "✅ Informații preluate pentru **{name}**:",
    statusError: "❌ A apărut o eroare la preluarea statusului.",
    helpTitle: "🤖 Meniul de Ajutor - Big Master",
    helpGeneral: "🛠️ Comenzi Utilitare Generale",
    helpNotif: "🔔 Notificări Automate",
    helpPrefs: "⚙️ Preferințe Server",
    helpManual: "🔍 Comenzi Manuale",
    trackedGames: "🎮 **Jocuri urmărite:**\n",
    onlyAuthor: "Doar autorul comenzii poate naviga!",
    prev: "◀ Ant",
    next: "Urm ▶",
    updateTitleText: "Apasă pe titlu pentru a citi patch-ul.",
    updateDescText: "A apărut un nou update pentru {name}.",
    fallbackUpdateTitle: "Update nou",
    free: "Gratuit",
    discount: "Reducere",
    oldPrice: "Preț Vechi",
    newPrice: "Preț Nou",
    link: "Link",
    details: "Detalii",
    platformsLabel: "Platforme",
    quality: "Calitate",
    popularity: "Popularitate",
    expiresAt: "Expiră la",
    freeUntil: "Gratis până la",
    page: "Pagina",
    displayed: "Afișate",
    extracted: "Extrase",
    notifiedUpdate: "🔔 A apărut un update nou pentru **{name}**!",
    notifiedDeal: "🔥 Ofertă nouă detectată!",
    typeProd: "**Tip produs:**",
    typeGame: "Joc",
    typeDlc: "DLC / Extensie",
    typeMusic: "Coloană Sonoră",
    typeDemo: "Demo",
    typeApp: "Aplicație/Bundle",
    currFree: "Acest titlu este în prezent **GRATUIT** (Free to Play).",
    priceUnav: "Prețul nu este disponibil în acest moment.",
    activeDisc: "Este o reducere activă de **{percent}%**!\n\n~~${old}~~ -> **${new}**",
    expAt: "\n⏳ **Oferta expiră la:** ",
    expUnspec: "Nespecificat (posibil ofertă permanentă sau bundle).",
    noDisc: "Nu este la reducere în acest moment.\n\nPreț standard: **${price}**",
    steamPriceTitle: "🏷️ Preț curent pe Steam: {title}",
    statusApiErr: "Acest joc nu are un API de status public și oficial integrat în bot.",
    statusServ: "**Status Server:**",
    statusRoblox: "Apasă pe linkul de mai jos pentru a vedea starea oficială Roblox.",
    statusRiot: "Apasă pe linkul de mai jos pentru a vedea starea oficială Riot Games.",
    noLink: "Nu este disponibil un link oficial.",
    statusTitle: "📡 Status Servere: {name}",
    statusOff: "🔗 Pagină Oficială de Status",
    statusCheckText: "Verifică Statusul Aici",
    statusHome: "🏠 Pagină Principală / Fallback",
    statusFallbackText: "Accesează Homepage",
    statusFallbackNote: "\n*(Acesta este link-ul general al jocului/producătorului, nu o pagină automată de status)*",
    dlcPack: "📦 DLC-uri: {title}",
    dealOffer: "**{store}** oferă o reducere de **{savings}%**!\n\n",
    defaultError: "A apărut o eroare internă.",
    errCircuitBreaker: "Circuit Breaker Activ",
    errSteamPatch: "Lipsă patch notes Steam valabile.",
    errAncore: "Nu am găsit ancore valide.",
    errFortnite: "Nu am găsit postări valide.",
    errFortniteTotal: "Eșec total Fortnite.",
    errAMD: "Eșec AMD.",
    errIntel: "Eșec Intel.",
    errMinecraft: "Lipsă versiune JSON.",
    errRoblox: "Lipsă versiune API.",
    errNvidia: "Eșec Nvidia.",
    errUnknownType: "Tip necunoscut.",
    errNoValidDeals: "Fără oferte valide.",
    helpGeneralCmds: "`{prefix}ping`\n`{prefix}games` (sau `{prefix}porecle`)",
    helpNotifCmds: "`{prefix}start updates`\n`{prefix}stop updates`\n`{prefix}start reduceri`\n`{prefix}stop reduceri`",
    helpPrefsCmds: "`{prefix}set mode [compact/detailed]`\n`{prefix}set mindiscount [0-100]`\n`{prefix}set free [on/off]`\n`{prefix}set paid [on/off]`\n`{prefix}set lang [ro/en]`",
    helpManualCmds: "`{prefix}latest updates`\n`{prefix}latest reduceri`\n`{prefix}latest update [poreclă]`\n`{prefix}latest pret [nume joc]`\n`{prefix}dlc [nume joc]`\n`{prefix}status [nume joc]`",
    excerptFortnite: "Update oficial Fortnite.",
    excerptAmdDriver: "Driver disponibil.",
    excerptAMD: "Update AMD.com.",
    excerptIntel: "Update intel.com detectat.",
    excerptVersion: "Versiunea {v}"
  },
  en: {
    adminOnly: "⛔ Admin only.",
    pong: "Pong! 🏓",
    setChannelUpdates: "⏳ Setting channel...",
    updatesActive: "✅ Automatic updates enabled.",
    initError: "Error initializing data.",
    startUpdatesSyntax: "❌ Syntax: `{prefix}start updates` or `{prefix}start reduceri`.",
    setChannelDeals: "⏳ Setting deals channel...",
    dealsActive: "✅ Deal alerts enabled!",
    dealsError: "Internal error fetching deals.",
    stopUpdates: "🛑 Updates stopped.",
    stopDeals: "🛑 Deals stopped.",
    stopSyntax: "❌ Syntax: `{prefix}stop updates` or `{prefix}stop reduceri`.",
    setHelp: "⚙️ Settings: mode, mindiscount, free, paid, lang.",
    invalidMode: "❌ Allowed: `compact` or `detailed`.",
    modeSet: "✅ Mode set to: **{value}**",
    invalidDiscount: "❌ 0-100.",
    discountSet: "✅ Minimum discount: **{value}%**",
    invalidBool: "❌ `on` / `off`.",
    freeSet: "✅ Free games: **{value}**",
    paidSet: "✅ Paid offers: **{value}**",
    invalidLang: "❌ Allowed languages: `ro` or `en`.",
    langSet: "✅ Language set to: **{value}**",
    unknownSetting: "❌ Unknown setting.",
    saveError: "Error saving preferences.",
    estTime: "⏳ *Estimated time: **{time} seconds***",
    fetchUpdatesError: "Failed to fetch updates.",
    noData: "❌ No data available.",
    dataLoaded: "✅ Data loaded!",
    fetchDealsError: "Failed to query stores.",
    noDealsMatch: "❌ No deals found matching server settings.",
    dealsLoaded: "✅ Deals loaded!",
    latestUpdateSyntax: "❌ Ex: `{prefix}latest update cs2`.",
    connecting: "⏳ *Connecting... Estimated time: **{time} seconds**.*",
    gameNotFound: "❌ Game not found.",
    didYouMean: " Did you mean **{name}** (`{key}`)?",
    updateSuccess: "✅ Update **{name}**:",
    updateError: "Could not fetch this update.",
    priceSyntax: "❌ You must specify a game. Ex: `{prefix}latest pret cyberpunk`.",
    searchingPrice: "⏳ *Searching Steam price for **{name}**...*",
    steamError: "❌ Error connecting to Steam servers. Please try again later.",
    noSteamResults: "❌ No Steam results found for \"**{name}**\".",
    invalidSteamResult: "❌ Could not select a valid Steam result.",
    steamApiError: "❌ Steam API could not return details for this title.",
    steamDetailsUnavailable: "❌ Found a result, but price details are unavailable.",
    priceSuccess: "✅ Steam data retrieved!",
    priceUnexpectedError: "❌ Unexpected error while searching for price.",
    dlcSyntax: "❌ You must specify a game. Ex: `{prefix}dlc cyberpunk`.",
    searchingDlc: "⏳ *Searching DLCs for **{name}**...*",
    ageGate: "❌ Steam page for **{name}** requires an age check which the bot cannot bypass.",
    pageStructureError: "❌ Page structure for **{name}** could not be parsed.",
    noDlcList: "❌ The game **{name}** has no DLCs listed separately on Steam.",
    dlcSuccess: "✅ Found **{count}** DLCs for **{name}**!",
    dlcUnexpectedError: "❌ Error searching for DLCs.",
    statusSyntax: "❌ You must specify a game. Ex: `{prefix}status fortnite`.",
    searchingStatus: "⏳ *Checking server status for **{name}**...*",
    statusSuccess: "✅ Information retrieved for **{name}**:",
    statusError: "❌ Error retrieving status.",
    helpTitle: "🤖 Help Menu - Big Master",
    helpGeneral: "🛠️ General Utility Commands",
    helpNotif: "🔔 Automated Notifications",
    helpPrefs: "⚙️ Server Preferences",
    helpManual: "🔍 Manual Commands",
    trackedGames: "🎮 **Tracked Games:**\n",
    onlyAuthor: "Only the command author can navigate!",
    prev: "◀ Prev",
    next: "Next ▶",
    updateTitleText: "Click the title to read the patch notes.",
    updateDescText: "A new update for {name} has been released.",
    fallbackUpdateTitle: "New Update",
    free: "Free",
    discount: "Discount",
    oldPrice: "Old Price",
    newPrice: "New Price",
    link: "Link",
    details: "Details",
    platformsLabel: "Platforms",
    quality: "Quality",
    popularity: "Popularity",
    expiresAt: "Expires at",
    freeUntil: "Free until",
    page: "Page",
    displayed: "Displayed",
    extracted: "Extracted",
    notifiedUpdate: "🔔 A new update for **{name}** has been released!",
    notifiedDeal: "🔥 New deal detected!",
    typeProd: "**Product Type:**",
    typeGame: "Game",
    typeDlc: "DLC / Expansion",
    typeMusic: "Soundtrack",
    typeDemo: "Demo",
    typeApp: "Application/Bundle",
    currFree: "This title is currently **FREE** (Free to Play).",
    priceUnav: "Price is unavailable at this moment.",
    activeDisc: "There is an active discount of **{percent}%**!\n\n~~${old}~~ -> **${new}**",
    expAt: "\n⏳ **Offer expires at:** ",
    expUnspec: "Unspecified (possibly permanent offer or bundle).",
    noDisc: "Not on sale at the moment.\n\nStandard Price: **${price}**",
    steamPriceTitle: "🏷️ Current Steam Price: {title}",
    statusApiErr: "This game does not have an official public status API integrated.",
    statusServ: "**Server Status:**",
    statusRoblox: "Click the link below to see the official Roblox status.",
    statusRiot: "Click the link below to see the official Riot Games status.",
    noLink: "No official link available.",
    statusTitle: "📡 Server Status: {name}",
    statusOff: "🔗 Official Status Page",
    statusCheckText: "Check Status Here",
    statusHome: "🏠 Main Page / Fallback",
    statusFallbackText: "Access Homepage",
    statusFallbackNote: "\n*(This is the general link, not automated status)*",
    dlcPack: "📦 DLCs: {title}",
    dealOffer: "**{store}** offers a **{savings}%** discount!\n\n",
    defaultError: "An internal error occurred.",
    errCircuitBreaker: "Circuit Breaker Active",
    errSteamPatch: "Missing valid Steam patch notes.",
    errAncore: "No valid anchors found.",
    errFortnite: "No valid posts found.",
    errFortniteTotal: "Total Fortnite failure.",
    errAMD: "AMD failure.",
    errIntel: "Intel failure.",
    errMinecraft: "Missing JSON version.",
    errRoblox: "Missing API version.",
    errNvidia: "Nvidia failure.",
    errUnknownType: "Unknown type.",
    errNoValidDeals: "No valid deals found.",
    helpGeneralCmds: "`{prefix}ping`\n`{prefix}games`",
    helpNotifCmds: "`{prefix}start updates`\n`{prefix}stop updates`\n`{prefix}start reduceri`\n`{prefix}stop reduceri`",
    helpPrefsCmds: "`{prefix}set mode [compact/detailed]`\n`{prefix}set mindiscount [0-100]`\n`{prefix}set free [on/off]`\n`{prefix}set paid [on/off]`\n`{prefix}set lang [ro/en]`",
    helpManualCmds: "`{prefix}latest updates`\n`{prefix}latest reduceri`\n`{prefix}latest update [nickname]`\n`{prefix}latest pret [game name]`\n`{prefix}dlc [game name]`\n`{prefix}status [game name]`",
    excerptFortnite: "Official Fortnite update.",
    excerptAmdDriver: "Driver available.",
    excerptAMD: "AMD.com update.",
    excerptIntel: "intel.com update detected.",
    excerptVersion: "Version {v}"
  }
};

function getText(lang, key, params = {}) {
  let text = i18n[lang]?.[key] || i18n["ro"]?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}

// -------------------------------------------------------------
// 1. SETĂRI GLOBALE ȘI CONSTANTE
// -------------------------------------------------------------
const PREFIX = "big_master!";
const CACHE_TTL_MS = 180000;
const GLOBAL_CACHE_TTL_MS = 1800000;
const MAX_DEALS = 50;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 300;
const FETCH_CONCURRENCY = 10;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

// --- UTILAJE DE BAZĂ ---
function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function safeStringify(value) {
  try { return JSON.stringify(value); }
  catch (e) { return String(value); }
}

function logger(level, context, message, meta = "") {
  const timestamp = new Date().toISOString();
  const format = `[${timestamp}] [${level}] [${context}] ${message} ${meta ? safeStringify(meta) : ""}`;
  if (level === "ERROR") console.error(format);
  else if (level === "WARN") console.warn(format);
  else console.log(format);
}

function formatUserError(err, defaultMsgKey, lang = "ro") {
  const defaultMsg = getText(lang, defaultMsgKey);
  if (err) {
    const errorDetails = err.stack ? err.stack : (err.message || err);
    logger("WARN", "USER_COMMAND", defaultMsg, errorDetails);

    const specificMsg = i18n[lang]?.[err.message];
    if (specificMsg) {
      return `❌ ${specificMsg}`;
    }
  }
  return `❌ ${defaultMsg}`;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, 
        matrix[i][j - 1] + 1, 
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]);
}

// -------------------------------------------------------------
// 2. VALIDARE CONFIG CU ZOD
// -------------------------------------------------------------
const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["steam", "intel", "nvidia", "amd", "roblox", "minecraft", "epic_games", "listing_based"]),
  aliases: z.array(z.string()).optional(),
  appId: z.string().optional(),
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional()
}).superRefine((game, ctx) => {
  if (game.type === "steam" && !game.appId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Steam "${game.name}" trebuie să aibă appId.` });
  if (game.type === "intel" && !game.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Intel "${game.name}" trebuie să aibă url.` });
  if (game.type === "listing_based" || (game.type === "epic_games" && game.key !== "fortnite")) {
    const hasListing = game.listingUrl || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
    if (!hasListing) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită listingUrl/Urls.` });
    if (!game.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită baseUrl.` });
  }
});

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().int().positive().refine(
    (v) => [5, 10, 15, 20, 30, 60].includes(v),
    { message: "checkIntervalMinutes trebuie să fie 5, 10, 15, 20, 30 sau 60." }
  ),
  games: z.array(GameSchema).min(1).superRefine((games, ctx) => {
    const keys = games.map(g => g.key);
    const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
    if (duplicates.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chei duplicate: ${[...new Set(duplicates)].join(', ')}` });
  })
});

let config;
try {
  const CONFIG_PATH = path.join(__dirname, "config.json");
  config = ConfigSchema.parse(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
} catch (err) {
  logger("ERROR", "CONFIG", "Eroare validare config.json", err.issues || err.message);
  process.exit(1);
}

// -------------------------------------------------------------
// 3. MONGODB & DISCORD CLIENT
// -------------------------------------------------------------
const guildSchema = new mongoose.Schema({
  _id: String,
  language: { type: String, enum: ["ro", "en"], default: "ro" },
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Map, of: [String], default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] }, 
  minDiscountPercent: { type: Number, default: 70 },
  includeFreeGames: { type: Boolean, default: true },
  includePaidDiscounts: { type: Boolean, default: true },
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" }
}, { minimize: false });

const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null }
}, { minimize: false });

const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: { all: { type: Number, default: 35000 }, single: { type: Number, default: 2000 }, reduceri: { type: Number, default: 10000 } }
}, { minimize: false });

const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
  _id: String,
  lockedUntil: { type: Date, default: null, index: true },
  ownerToken: { type: String, default: null }
}, { minimize: false });

const JobLockModel = mongoose.model("JobLock", jobLockSchema);
const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const lockToken = crypto.randomUUID();

  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: expires, ownerToken: lockToken } },
      { new: true } 
    );
    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    try {
      await JobLockModel.create({
        _id: `lock_${jobName}`,
        lockedUntil: expires,
        ownerToken: lockToken
      });
      activeLocks.set(jobName, lockToken);
      return lockToken;
    } catch (createErr) {
      if (createErr.code === 11000) return null;
      throw createErr;
    }
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la obținerea lock-ului", err.message);
    return null;
  }
}

async function renewDbLock(jobName, token, ttlMs = 120000) {
  if (!token) return false;
  const expires = new Date(Date.now() + ttlMs);
  try {
    const res = await JobLockModel.updateOne({ _id: `lock_${jobName}`, ownerToken: token }, { $set: { lockedUntil: expires } });
    return res.modifiedCount > 0;
  } catch (err) { 
    logger("WARN", "DB_LOCK", "Eroare la reînnoire lock", err.message);
    return false; 
  }
}

async function releaseDbLock(jobName, token) {
  if (!token) return;
  try {
    await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
    activeLocks.delete(jobName);
  } catch (err) { 
    logger("WARN", "DB_LOCK", "Eroare la eliberare lock", err.message);
  }
}

async function getSystemTimes() {
  let sys = await SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: { all: 35000, single: 2000, reduceri: 10000 } } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return sys.executionTimes || { all: 35000, single: 2000, reduceri: 10000 };
}

async function saveSystemTimes(times) { 
    await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// -------------------------------------------------------------
// 4. SERVER WEB PENTRU HEALTHCHECK
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/health") {
    const mongoOk = mongoose.connection.readyState === 1;
    const discordOk = typeof client.isReady === "function" && client.isReady();
    if (mongoOk && discordOk) { 
      res.writeHead(200, { "Content-Type": "application/json" }); 
      return res.end(JSON.stringify({ ok: true, mongoOk, discordOk, message: "Toate sistemele sunt online." })); 
    }
    res.writeHead(503, { "Content-Type": "application/json" }); 
    return res.end(JSON.stringify({ ok: false, mongoOk, discordOk, message: "Sisteme indisponibile." }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

// -------------------------------------------------------------
// 5. SHUTDOWN GRACEFUL
// -------------------------------------------------------------
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  try {
    for (const [jobName, token] of activeLocks.entries()) await releaseDbLock(jobName, token);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy(); process.exit(0);
  } catch (err) { 
    logger("ERROR", "SHUTDOWN", "Eroare la închidere", err.message);
    process.exit(1); 
  }
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// CACHE 
// -------------------------------------------------------------
const cache = { 
  updates: { data: null, expiresAt: 0 }, 
  deals: { data: null, expiresAt: 0 }, 
  single: new Map(),
  dlc: new Map()
};

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
  if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
  for (const [key, value] of cache.single.entries()) { if (value.expiresAt < now) cache.single.delete(key); }
  for (const [key, value] of cache.dlc.entries()) { if (value.expiresAt < now) cache.dlc.delete(key); }
  if (cache.dlc.size > 100) { const oldestKeys = [...cache.dlc.keys()].slice(0, 20); oldestKeys.forEach(k => cache.dlc.delete(k)); }
  if (cache.single.size > 100) { const oldestKeys = [...cache.single.keys()].slice(0, 20); oldestKeys.forEach(k => cache.single.delete(k)); }
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & EMBEDS
// -------------------------------------------------------------
function cleanText(text) { return String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
function truncate(str, maxLen) { const t = String(str || ""); return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t; }

function normalizeUpdate(data) {
  return { 
    id: String(data.id || ""), 
    title: data.title ? truncate(data.title, 250) : null, 
    link: String(data.link || ""), 
    excerpt: truncate(data.excerpt || "", 700), 
    excerptKey: data.excerptKey || null,
    excerptParams: data.excerptParams || null,
    fullText: truncate(data.fullText || "", 3500), 
    image: data.image || null, 
    thumbnail: data.thumbnail || null, 
    timestamp: data.timestamp || "" 
  };
}

function buildUpdateEmbed(gameName, latest, mode = "detailed", lang = "ro") {
  const isCompact = mode === "compact";
  const displayTitle = latest.title || getText(lang, "fallbackUpdateTitle");
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle(truncate(displayTitle, 256)).setFooter({ text: truncate(gameName, 2048) }); 
  if (latest.link) embed.setURL(latest.link);

  let safeExcerpt = latest.excerpt;
  if (latest.excerptKey) {
    safeExcerpt = getText(lang, latest.excerptKey, latest.excerptParams || {});
  }

  if (isCompact) {
    embed.setDescription(latest.link ? getText(lang, "updateTitleText") : getText(lang, "updateDescText", { name: gameName }));
  } else {
    embed.setDescription(truncate(safeExcerpt || getText(lang, "updateDescText", { name: gameName }), 4096));
    if (latest.image) embed.setImage(latest.image);
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) { const d = new Date(latest.timestamp); if (!Number.isNaN(d.getTime())) embed.setTimestamp(d); }
  }
  return embed;
}

function buildDealEmbed(deal, mode = "detailed", lang = "ro") {
  const isFree = parseFloat(deal.salePrice) === 0;
  const isCompact = mode === "compact";
  const freeText = getText(lang, "free");
  const discText = getText(lang, "discount");
  const embed = new EmbedBuilder().setColor(isFree ? 0xffd700 : 0xe74c3c).setTitle(truncate(`${isFree ? `${freeText}: ` : `${discText}: `}${deal.title}`, 256));

  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? freeText.toUpperCase() : "$" + deal.salePrice}**\n[${getText(lang, "link")}](${deal.link})`);
  } else {
    let statsStr = "";
    if (deal.qualityScore > 0) {
      statsStr = `⭐ **${getText(lang, "quality")}:** ${deal.qualityScore}% | 👥 **${getText(lang, "popularity")}:** ${deal.totalReviews > 0 ? deal.totalReviews : "Top Seller"}\n\n`;
    }

    let displayDate = deal.endDateStr;
    if (displayDate) {
        const d = new Date(displayDate);
        if (!isNaN(d.getTime())) {
            displayDate = d.toLocaleDateString(lang === "ro" ? "ro-RO" : "en-US");
        }
    }

    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(getText(lang, "dealOffer", { store: deal.store, savings: deal.savings }) + statsStr + (displayDate ? `⏳ **${isFree ? getText(lang, "freeUntil") : getText(lang, "expiresAt")}:** ${displayDate}\n\n` : ""), 4096))
      .addFields(
        { name: getText(lang, "oldPrice"), value: `~~$${deal.normalPrice}~~`, inline: true },
        { name: getText(lang, "newPrice"), value: isFree ? `🔥 ${freeText.toUpperCase()} 🔥` : `$${deal.salePrice}`, inline: true },
        { name: getText(lang, "link"), value: `[Link](${deal.link})`, inline: false }
      );

    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);

    let detailsVal = "";
    if (deal.platformsInfo) {
      detailsVal += `**${getText(lang, "platformsLabel")}:** ${deal.platformsInfo}\n`;
    }
    if (deal.extraDetails) {
      detailsVal += deal.extraDetails;
    }
    if (detailsVal.trim()) {
      embed.addFields({ name: getText(lang, "details"), value: truncate(detailsVal.trim(), 1024), inline: false });
    }
  }
  return embed;
}

function buildPaginationButtons(prefix, sessionId, page, totalPages, lang = "ro") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel(getText(lang, "prev")).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel(getText(lang, "next")).setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed", lang = "ro") {
  if (!items || items.length === 0) return;
  let currentPage = 0; const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = Date.now().toString();
  let collector = null;
  const updateMessage = async () => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      const components = [buildPaginationButtons(prefix, sessionId, currentPage, totalPages, lang)];
      await interactionMessage.edit({ embeds, components }).catch(() => null);
    } catch (err) { 
      if (collector) collector.stop("error"); 
    }
  };

  await updateMessage();
  collector = interactionMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: getText(lang, "onlyAuthor"), ephemeral: true }).catch(() => null);
    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;

    if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));

    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });
  collector.on("end", () => {
    if (interactionMessage.editable) interactionMessage.edit({ components: [] }).catch(() => null);
  });
}

function findGameAndSuggestion(text) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length < 2) {
    const exact = config.games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  let candidates = [];
  for (const game of config.games) {
    const key = String(game.key).toLowerCase().replace(/[-_]/g, " ");
    const name = String(game.name).toLowerCase().replace(/[-_]/g, " ");
    const aliases = Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " ")) : [];
    const allIdentifiers = [key, name, ...aliases];

    if (allIdentifiers.includes(search)) return { game, suggestion: null };

    let bestDistForGame = Infinity;
    let isStartsWith = false;
    let isIncludes = false;

    for (const val of allIdentifiers) {
        if (val.startsWith(search)) isStartsWith = true;
        if (val.includes(search)) isIncludes = true;
        const dist = levenshtein(search, val);
        if (dist < bestDistForGame) bestDistForGame = dist;
    }
    candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
  }

  candidates.sort((a, b) => {
      if (a.isStartsWith && !b.isStartsWith) return -1;
      if (!a.isStartsWith && b.isStartsWith) return 1;
      if (a.dist !== b.dist) return a.dist - b.dist;
      if (a.isIncludes && !b.isIncludes) return -1;
      if (!a.isIncludes && b.isIncludes) return 1;
      return 0;
  });
  const best = candidates[0];
  if (!best) return { game: null, suggestion: null };

  const dynamicThreshold = Math.max(1, Math.floor(search.length * 0.3));
  if (best.dist <= 1) return { game: best.game, suggestion: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) return { game: null, suggestion: best.game };
  return { game: null, suggestion: null };
}

// -------------------------------------------------------------
// HTTP & PROXY & SCRAPING
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  const reqConfig = { method, url, timeout: options.timeout || 15000, headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)], ...options.headers } };
  if (options.data) reqConfig.data = options.data;
  for (let i = 0; i <= retries; i++) {
    try { return await axios(reqConfig); } 
    catch (err) {
      const status = err.response?.status || "N/A";
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw err;
      if (i === retries) {
        logger("ERROR", "HTTP", `Eșec final request [${status}] după ${retries} încercări: ${url}`, err.message);
        throw err;
      }
      logger("WARN", "HTTP", `Eșec request [${status}] (încercarea ${i + 1}/${retries}), reîncerc în ${backoff}ms: ${url}`, err.message);
      await new Promise(res => setTimeout(res, backoff)); backoff *= 2;
    }
  }
}

async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`];
  let lastErr;
  for (const proxy of proxies) {
    try {
      const res = await httpReq('GET', proxy, options);
      return proxy.includes("allorigins") ? String(res?.data?.contents || "") : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
}

function absoluteUrl(base, maybeRelative) { try { return new URL(maybeRelative, base).href; } catch { return ""; } }
function isGoodSteamArticleUrl(url) { const v = String(url || "").trim().toLowerCase(); return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn")); }
function extractDateScore(url) { const u = url.toLowerCase(); const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/); if (m1) { const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`); if (!isNaN(d.getTime())) return d.getTime(); } return 0; }
function scoreCandidate(candidate, keywords) { const haystack = `${candidate.href} ${candidate.text}`.toLowerCase(); let score = 0; for (const k of keywords) if (haystack.includes(String(k).toLowerCase())) score += 1; return score; }
function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;
  const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
  if (badWordsInTitle.some((word) => title.includes(word))) return false;
  if (tags.includes("patchnotes") || tags.includes("update")) return true;
  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];
  return goodWords.some((word) => text.includes(word));
}

async function fetchSteamUpdate(game) {
  const response = await httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements") && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  if (!patchNotes.length) throw new Error("errSteamPatch");
  const latest = patchNotes[0];
  const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");
  return normalizeUpdate({ id: String(latest.gid), title: cleanText(latest.title), link: String(latest.url), excerpt: rawContents, fullText: rawContents, timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : "" });
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
  let collected = [];
  for (const url of listingUrls) {
    try {
      const listRes = await httpReq('GET', url);
      const $ = cheerio.load(String(listRes.data));
      let position = 0;
      $('a').each((i, el) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr('href'));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(el).text()), position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) { logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, err.message); }
  }

  const seen = new Set();
  const unique = collected.filter(item => { if (!item.href || seen.has(item.href)) return false; seen.add(item.href); return true; });
  unique.sort((a, b) => { 
    if (keywords.length) { const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords); if(s!==0) return s; }
    const d = extractDateScore(b.href) - extractDateScore(a.href); if(d!==0) return d;
    return a.position - b.position; 
  });
  if (!unique.length) throw new Error("errAncore");
  const articleUrl = unique[0].href;
  const articleRes = await httpReq('GET', articleUrl);
  const $art = cheerio.load(String(articleRes.data || ""));
  const ogTitle = $art('meta[property="og:title"]').attr('content') || $art('title').text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr('content') || "";
  $art('script, style, nav, footer, header').remove();
  const rawContent = $art('article').text() || $art('main').text() || $art('body').text();
  return normalizeUpdate({ id: String(articleUrl), title: cleanText(ogTitle) || `${game.name} Update`, link: articleUrl, excerpt: cleanText(ogDesc), fullText: cleanText(rawContent), thumbnail: game.thumbnail });
}

async function fetchFortniteUpdate() {
  try {
    const posts = JSON.parse(await fetchWithProxy("https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US", { timeout: 15000 }) || "{}")?.blogList;
    const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("errFortnite");
    const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({ id: String(latest.slug), title: cleanText(latest.title), link: `https://www.fortnite.com/news/${latest.slug}`, excerpt: cleanText(latest.shareDescription), excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: latest.date });
  } catch (err) {
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq('GET', backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("errFortniteTotal");
    return normalizeUpdate({ id: feed.items[0].link, title: cleanText(feed.items[0].title), link: feed.items[0].link, excerpt: "Update oficial Fortnite.", excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: feed.items[0].pubDate });
  }
}

async function fetchAmdUpdate(game) {
  try {
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (match) return normalizeUpdate({ id: match[1], title: `AMD Radeon Adrenalin v${match[1]}`, link: "https://www.amd.com", excerpt: "Driver disponibil.", excerptKey: "excerptAmdDriver", thumbnail: game.thumbnail });
  } catch (err) {}
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("errAMD");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update AMD.com.", excerptKey: "excerptAMD", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchIntelUpdate(game) {
  try {
    const rawContent = await fetchWithProxy(game.url);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) return normalizeUpdate({ id: match[1], title: `${game.name} v${match[1]}`, link: game.url, excerpt: `Versiune găsită: ${match[1]}`, excerptKey: "excerptVersion", excerptParams: { v: match[1] }, thumbnail: game.thumbnail });
  } catch (err) {}
  const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("errIntel");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update intel.com detectat.", excerptKey: "excerptIntel", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchMinecraftUpdate() { 
  const r = await httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"); 
  const v = r?.data?.latest?.release;
  if(!v) throw new Error("errMinecraft"); 
  return normalizeUpdate({ id: v, title: `Minecraft ${v}`, link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`, excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: v }, thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg" });
}

async function fetchRobloxUpdate() { 
  const r = await httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer"); 
  const v = r?.data?.clientVersionUpload;
  if(!v) throw new Error("errRoblox"); 
  return normalizeUpdate({ id: String(v), title: "Roblox Update", link: "https://en.help.roblox.com/hc/en-us", excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: String(v) }, thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg" });
}

async function fetchNvidiaUpdate(g) { 
  const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const r = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`); 
  const f = await rssParser.parseString(r.data);
  if (!f.items || f.items.length === 0) throw new Error("errNvidia");
  return normalizeUpdate({ id: f.items[0].link, title: cleanText(f.items[0].title).split(" - ")[0], link: f.items[0].link, thumbnail: g.thumbnail });
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL ȘI REDUCERI 
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  const t = game.type;
  if (!t || t === "steam") return await fetchSteamUpdate(game);
  if (t === "minecraft") return await fetchMinecraftUpdate();
  if (t === "epic_games" && game.key === "fortnite") return await fetchFortniteUpdate(); 
  if (t === "roblox") return await fetchRobloxUpdate();
  if (t === "nvidia") return await fetchNvidiaUpdate(game);
  if (t === "intel") return await fetchIntelUpdate(game);
  if (t === "amd") return await fetchAmdUpdate(game);
  if (t === "listing_based" || t === "epic_games") return await fetchListingBasedUpdate(game);
  throw new Error("errUnknownType");
}

async function executeFetchWithCircuitBreaker(game) {
  let cb = await CircuitBreakerModel.findById(game.key);
  if (!cb) cb = new CircuitBreakerModel({ _id: game.key });

  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "errCircuitBreaker" };
  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0 || cb.cooldownUntil) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); }
    return { game, latest, error: null };
  } catch (error) {
    cb.fails += 1;
    if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000); 
    await cb.save();
    return { game, latest: null, error: error.message };
  }
}

async function getLatestForAllGames() {
  const results = [];
  for (let i = 0; i < config.games.length; i += FETCH_CONCURRENCY) {
    const chunk = config.games.slice(i, i + FETCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (game) => await executeFetchWithCircuitBreaker(game)));
    results.push(...chunkResults);
  }
  return results;
}

async function fetchSteamReviewData(appId) {
  try {
    const res = await httpReq('GET', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent };
    }
  } catch (err) {}
  return { totalReviews: 0, qualityPercent: 0 };
}

const activeEnrichments = new Map();
async function enrichDealData(deal) {
  if (deal.enriched) return deal; 
  if (activeEnrichments.has(deal.id)) return activeEnrichments.get(deal.id);

  const enrichTask = (async () => {
    if (deal.store === "Steam" && deal.steamAppID) {
      try {
        const res = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}&cc=US&l=english`, { timeout: 5000 });
        const data = res.data[deal.steamAppID]?.data;
        if (data && data.platforms) {
          deal.platformsInfo = [
            data.platforms.windows ? "Win" : "", 
            data.platforms.mac ? "Mac" : "", 
            data.platforms.linux ? "Lin" : ""
          ].filter(Boolean).join(", ");
        }
        const htmlRes = await httpReq('GET', deal.link, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
        const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
        if (match && match[1]) deal.endDateStr = match[1].trim();
      } catch (e) {}
    }
    deal.enriched = true;
    return deal;
  })();
  activeEnrichments.set(deal.id, enrichTask);
  try { await enrichTask; } finally { activeEnrichments.delete(deal.id); }
  return deal;
}

async function fetchDeals() {
  const deals = [];
  try {
    const steamRes = await httpReq('GET', 'https://store.steampowered.com/api/featuredcategories/?cc=US&l=english');
    const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, 30);
    const reviewsData = [];
    for (let i = 0; i < steamSpecials.length; i += 5) {
      const chunk = steamSpecials.slice(i, i + 5);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      await new Promise(res => setTimeout(res, 500));
    }
    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const normalPrice = (item.original_price / 100).toFixed(2);
      const salePrice = (item.final_price / 100).toFixed(2);
      const savings = item.discount_percent || 0;
      const hybridScore = (savings * 0.8) + (revData.qualityPercent * 1.0) + Math.min(25, Math.floor(revData.totalReviews / 1000));
      deals.push({
        id: `steam_${item.id}`, steamAppID: item.id, title: item.name, salePrice: salePrice, normalPrice: normalPrice, savings: savings, store: "Steam", link: `https://store.steampowered.com/app/${item.id}`, popularityScore: hybridScore, totalReviews: revData.totalReviews, qualityScore: revData.qualityPercent, endDateStr: null, extraDetails: "", platformsInfo: null, enriched: false, thumbnail: item.header_image || null
      });
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message); }

  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    const epicVars = { category: "games/edition/base|bundles/games", count: 20, country: "US", locale: "en-US", onSale: true, withPrice: true };
    const epicRes = await httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
    const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];

    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;
      const normalPrice = (priceInfo.originalPrice / 100).toFixed(2);
      const salePrice = (priceInfo.discountPrice / 100).toFixed(2);
      let savings = 0;
      if (priceInfo.originalPrice > 0) savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);
      const hybridScore = (savings * 0.8) + 80.0 + 15.0;
      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img) thumb = img.url;
      }
      let endDate = null;
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = promos.endDate;

      const urlSlug = item.urlSlug || item.id;
      deals.push({ id: `epic_${item.id}`, steamAppID: null, title: item.title, salePrice: salePrice, normalPrice: normalPrice, savings: savings, store: "Epic Games", link: `https://store.epicgames.com/en-US/p/${urlSlug}`, popularityScore: hybridScore, totalReviews: 0, qualityScore: 80, endDateStr: endDate, extraDetails: "", platformsInfo: null, enriched: true, thumbnail: thumb });
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", err.message); }

  const finalTop = deals.sort((a, b) => b.popularityScore - a.popularityScore).slice(0, MAX_DEALS);
  if (!finalTop.length) throw new Error("errNoValidDeals");
  return finalTop;
}

// -------------------------------------------------------------
// HELPERE PENTRU CĂUTAREA PREȚURILOR ȘI DLC-urilor PE STEAM
// -------------------------------------------------------------
async function searchSteamGameByName(query) {
  const searchRes = await httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`);
  return searchRes.data?.items || [];
}

function chooseBestSteamMatch(items, query) {
  const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
  const extraTypes = new Set(["dlc", "demo", "music"]);

  let bestMatch = items[0];
  let bestScore = Infinity;

  for (const item of items) {
    const itemName = String(item.name || "").toLowerCase();
    const normItemName = normalize(itemName);
    let score = levenshtein(normTarget, normItemName);

    if (normItemName === normTarget) score -= 100;
    else if (normItemName.startsWith(normTarget)) score -= 20;
    else if (normItemName.includes(normTarget)) score -= 10;

    if (!wantsDLC) {
      const isExtraByName = dlcKeywords.some(kw => itemName.includes(kw));
      const isExtraByType = typeof item.type === "string" && extraTypes.has(item.type.toLowerCase());
      if (isExtraByName || isExtraByType) score += 50;
    }
    if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch; 
}

async function fetchSteamPriceDetails(appId) {
  const detailsRes = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`);
  return detailsRes.data[appId]?.data || null;
}

async function extractSteamOfferEndDate(appId) {
  try {
    const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${appId}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
    const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
    return match && match[1] ? match[1].trim() : null;
  } catch (err) { return null; }
}

function buildSteamPriceEmbed(gameData, appId, offerEndDate, lang = "ro") {
  const typeStr = gameData.type === 'game' ? getText(lang, "typeGame") :
                  gameData.type === 'dlc' ? getText(lang, "typeDlc") :
                  gameData.type === 'music' ? getText(lang, "typeMusic") :
                  gameData.type === 'demo' ? getText(lang, "typeDemo") : getText(lang, "typeApp");

  const title = gameData.name;
  const isFree = gameData.is_free;
  const priceOverview = gameData.price_overview;

  let embedDesc = `${getText(lang, "typeProd")} ${typeStr}\n\n`;
  let color = 0x2b2d31;

  if (isFree) {
    embedDesc += getText(lang, "currFree");
    color = 0xffd700;
  } else if (!priceOverview) {
    embedDesc += getText(lang, "priceUnav");
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    const discountPercent = priceOverview.discount_percent;

    if (discountPercent > 0) {
      embedDesc += getText(lang, "activeDisc", { percent: discountPercent, old: normalPrice, new: currentPrice });
      color = 0xe74c3c;
      if (offerEndDate) {
        embedDesc += `${getText(lang, "expAt")} ${offerEndDate}`;
      } else {
        embedDesc += `${getText(lang, "expAt")} ${getText(lang, "expUnspec")}`;
      }
    } else {
      embedDesc += getText(lang, "noDisc", { price: normalPrice });
      color = 0x57f287;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(getText(lang, "steamPriceTitle", { title: title }))
    .setURL(`https://store.steampowered.com/app/${appId}`)
    .setDescription(embedDesc);

  if (gameData.header_image) embed.setImage(gameData.header_image);
  return embed;
}

// -------------------------------------------------------------
// STATUS SERVERE
// -------------------------------------------------------------
async function fetchGameStatus(game, lang = "ro") {
  let statusText = getText(lang, "statusApiErr");
  let statusLink = "";
  let homepageLink = "";
  let color = 0x3498db;

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      statusText = `${getText(lang, "statusServ")} ${res.data.status.description}`;
      statusLink = "https://status.epicgames.com/";
      color = res.data.status.indicator === "none" ? 0x2ecc71 : 0xe74c3c;
    } catch (e) {
      statusText = getText(lang, "statusError");
      statusLink = "https://status.epicgames.com/";
    }
  } else if (game.key === "roblox") {
    statusLink = "https://status.roblox.com/";
    statusText = getText(lang, "statusRoblox");
  } else if (game.key === "valorant" || game.key === "lol") {
    statusLink = "https://status.riotgames.com/";
    statusText = getText(lang, "statusRiot");
  } else if (game.key === "minecraft") {
    statusLink = "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-Status";
  } else {
    homepageLink = game.url || game.baseUrl || getText(lang, "noLink");
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(getText(lang, "statusTitle", { name: game.name }))
    .setDescription(statusText);

  if (statusLink && statusLink.startsWith("http")) {
    embed.addFields({ name: getText(lang, "statusOff"), value: `[${getText(lang, "statusCheckText")}](${statusLink})` });
  } else if (homepageLink && homepageLink.startsWith("http")) {
    embed.addFields({ name: getText(lang, "statusHome"), value: `[${getText(lang, "statusFallbackText")}](${homepageLink})${getText(lang, "statusFallbackNote")}` });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

// -------------------------------------------------------------
// FUNCȚII CRON JOB
// -------------------------------------------------------------
async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  const results = await getLatestForAllGames();
  const validResults = results.filter(r => r.latest !== null);
  if (!validResults.length) return;

  for (const guild of guilds) {
    let channel;
    const lang = guild.language || "ro";
    try { channel = await client.channels.fetch(guild.notificationChannelId); } catch (err) { continue; } 
    if (!canSendEmbeds(channel, client.user.id)) continue;

    let updatePayload = {};
    if (!guild.seen) guild.seen = {};
    let sentUpdatesCount = 0; 

    for (const { game, latest } of validResults) {
      const seenIds = Array.isArray(guild.seen[game.key]) ? [...guild.seen[game.key]] : [];
      if (!seenIds.includes(latest.id)) {
        if (sentUpdatesCount < 5) { 
          const embed = buildUpdateEmbed(game.name, latest, guild.notificationMode || "detailed", lang);
          try {
            await channel.send({ content: getText(lang, "notifiedUpdate", { name: game.name }), embeds: [embed] });
            await new Promise(r => setTimeout(r, 800)); 
            sentUpdatesCount++;
            seenIds.push(latest.id);
            if (seenIds.length > 20) seenIds.shift();
            guild.seen[game.key] = seenIds;
            updatePayload[`seen.${game.key}`] = seenIds;
            await GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });
          } catch (err) {}
        } else {
           seenIds.push(latest.id);
           if (seenIds.length > 20) seenIds.shift();
           guild.seen[game.key] = seenIds;
           updatePayload[`seen.${game.key}`] = seenIds;
           await GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });
        }
      }
    }
  }
}

async function checkForDiscounts() {
  const guilds = await GuildModel.find({ discountsSubscribed: true, discountChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  let deals;
  try { deals = await fetchDeals(); } catch (err) { return; }

  for (const guild of guilds) {
    let channel;
    const lang = guild.language || "ro";
    try { channel = await client.channels.fetch(guild.discountChannelId); } catch (err) { continue; }
    if (!canSendEmbeds(channel, client.user.id)) continue;

    const minDisc = guild.minDiscountPercent || 0;
    const incFree = guild.includeFreeGames !== false;
    const incPaid = guild.includePaidDiscounts !== false;

    const filteredDeals = deals.filter(deal => {
      const isFree = parseFloat(deal.salePrice) === 0;
      if (isFree && !incFree) return false;
      if (!isFree && !incPaid) return false;
      if (!isFree && deal.savings < minDisc) return false;
      return true;
    });

    let sentCount = 0;
    if (!guild.seenDiscounts) guild.seenDiscounts = [];

    for (const deal of filteredDeals) {
      const hash = crypto.createHash('sha1').update(`${deal.title}_${deal.store}_${deal.salePrice}_${deal.normalPrice}`).digest('hex');
      if (!guild.seenDiscounts.includes(hash)) {
        if (sentCount < 8) { 
          try { await enrichDealData(deal); } catch (e) { } 
          const embed = buildDealEmbed(deal, guild.notificationMode || "detailed", lang);
          try {
            await channel.send({ content: getText(lang, "notifiedDeal"), embeds: [embed] });
            await new Promise(r => setTimeout(r, 800)); 
            sentCount++;
            guild.seenDiscounts.push(hash); 
            if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();
            await GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
          } catch (err) {}
        } else {
           guild.seenDiscounts.push(hash);
           if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();
           await GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
        }
      }
    }
  }
}

// -------------------------------------------------------------
// COMMAND HANDLERS 
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));
  if (subCommand === "updates") {
    const msg = await message.reply(getText(lang, "setChannelUpdates"));
    try {
      const results = await getLatestForAllGames();
      const setPayload = { subscribed: true, notificationChannelId: message.channel.id };
      for (const r of results) if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
      return msg.edit(getText(lang, "updatesActive"));
    } catch (err) { return msg.edit(formatUserError(err, "initError", lang)); }
  } 
  if (subCommand === "reduceri") {
    const msg = await message.reply(getText(lang, "setChannelDeals"));
    try {
      const deals = await fetchDeals(); 
      const initHashes = deals.map(d => crypto.createHash('sha1').update(`${d.title}_${d.store}_${d.salePrice}_${d.normalPrice}`).digest('hex')).slice(-DEALS_HISTORY_LIMIT);
      await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: initHashes } }, { upsert: true });
      return msg.edit(getText(lang, "dealsActive"));
    } catch (err) { return msg.edit(formatUserError(err, "dealsError", lang)); }
  }
  return message.reply(getText(lang, "startUpdatesSyntax", { prefix: PREFIX }));
}

async function handleStop(message, subCommand, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));
  try {
    if (subCommand === "updates") { await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null } }); return message.reply(getText(lang, "stopUpdates")); }
    if (subCommand === "reduceri") { await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null } }); return message.reply(getText(lang, "stopDeals")); }
  } catch (err) {}
  return message.reply(getText(lang, "stopSyntax", { prefix: PREFIX }));
}

async function handleSetCommand(message, args, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));
  const setting = (args[0] || "").toLowerCase();
  const value = (args[1] || "").toLowerCase();

  if (!setting || !value) return message.reply(getText(lang, "setHelp"));
  const updateDoc = {};
  let confirmMsg = "";

  switch (setting) {
    case "mode":
      if (!["compact", "detailed"].includes(value)) return message.reply(getText(lang, "invalidMode"));
      updateDoc.notificationMode = value; confirmMsg = getText(lang, "modeSet", { value }); break;
    case "mindiscount":
      const min = parseInt(value);
      if (isNaN(min) || min < 0 || min > 100) return message.reply(getText(lang, "invalidDiscount"));
      updateDoc.minDiscountPercent = min; confirmMsg = getText(lang, "discountSet", { value: min }); break;
    case "free":
      if (!["on", "off"].includes(value)) return message.reply(getText(lang, "invalidBool"));
      updateDoc.includeFreeGames = value === "on"; confirmMsg = getText(lang, "freeSet", { value: value.toUpperCase() }); break;
    case "paid":
      if (!["on", "off"].includes(value)) return message.reply(getText(lang, "invalidBool"));
      updateDoc.includePaidDiscounts = value === "on"; confirmMsg = getText(lang, "paidSet", { value: value.toUpperCase() }); break;
    case "lang":
      if (!["ro", "en"].includes(value)) return message.reply(getText(lang, "invalidLang"));
      updateDoc.language = value; confirmMsg = getText(value, "langSet", { value: value.toUpperCase() }); break;
    default: return message.reply(getText(lang, "unknownSetting"));
  }
  try { await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true }); return message.reply(confirmMsg); } 
  catch (err) { return message.reply(formatUserError(err, "saveError", lang)); }
}

async function handleLatestUpdates(message, guildDoc, lang) {
  let msg = null;
  if (!cache.updates.data) {
    const estMs = (await getSystemTimes()).all || 35000;
    msg = await message.reply(getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();
    try {
        const results = await getLatestForAllGames();
        cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes();
        sys.all = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "fetchUpdatesError", lang)); }
  }
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) return msg ? msg.edit(getText(lang, "noData")) : message.reply(getText(lang, "noData"));

  const mode = guildDoc?.notificationMode || "detailed";
  if (msg) await msg.edit(getText(lang, "dataLoaded"));
  else msg = await message.reply(getText(lang, "dataLoaded"));
  const generateEmbeds = async (page, totalP, currentMode) => valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r => buildUpdateEmbed(r.game.name, r.latest, currentMode, lang).setFooter({ text: `${r.game.name} • ${getText(lang, "page")} ${page + 1}/${totalP}` }));
  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestDeals(message, guildDoc, lang) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    msg = await message.reply(getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();
    try {
        const rawDeals = await fetchDeals();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes();
        sys.reduceri = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "fetchDealsError", lang)); }
  }

  const mode = guildDoc?.notificationMode || "detailed";
  const minDisc = guildDoc?.minDiscountPercent || 0;
  const incFree = guildDoc?.includeFreeGames !== false;
  const incPaid = guildDoc?.includePaidDiscounts !== false;

  const top = cache.deals.data.filter(deal => {
    const isFree = parseFloat(deal.salePrice) === 0;
    if (isFree && !incFree) return false;
    if (!isFree && !incPaid) return false;
    if (!isFree && deal.savings < minDisc) return false;
    return true;
  }).slice(0, MAX_DEALS);

  if (!top.length) return msg ? msg.edit(getText(lang, "noDealsMatch")) : message.reply(getText(lang, "noDealsMatch"));
  if (msg) await msg.edit(getText(lang, "dealsLoaded"));
  else msg = await message.reply(getText(lang, "dealsLoaded"));

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    if (currentMode !== "compact") { 
      for (const d of chunk) { try { await enrichDealData(d); } catch(e) {} }
    }
    return chunk.map(d => buildDealEmbed(d, currentMode, lang).setFooter({ text: `${getText(lang, "page")} ${page + 1}/${totalP}` }));
  };
  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestSingle(message, gameText, guildDoc, lang) {
  if (!gameText) return message.reply(getText(lang, "latestUpdateSyntax", { prefix: PREFIX }));
  const estMs = (await getSystemTimes()).single || 2000;
  const loadingMsg = await message.reply(getText(lang, "connecting", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
  const startTime = Date.now();

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = getText(lang, "gameNotFound");
    if (suggestion) errText += getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key });
    return loadingMsg.edit(errText).catch(() => null);
  }
  try {
    let latest;
    if (cache.single.has(game.key) && Date.now() < cache.single.get(game.key).expiresAt) {
        const cachedVal = cache.single.get(game.key);
        cache.single.delete(game.key);
        cache.single.set(game.key, cachedVal);
        latest = cachedVal.data;
    } else {
      const res = await executeFetchWithCircuitBreaker(game);
      if (res.error) throw new Error(res.error);
      latest = res.latest;
      cache.single.set(game.key, { data: latest, expiresAt: Date.now() + CACHE_TTL_MS });
      const executionTimes = await getSystemTimes(); executionTimes.single = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(executionTimes);
    }
    await loadingMsg.edit({ content: getText(lang, "updateSuccess", { name: game.name }), embeds: [buildUpdateEmbed(game.name, latest, guildDoc?.notificationMode || "detailed", lang)] }).catch(() => null);
  } catch (error) { 
    await loadingMsg.edit(formatUserError(error, "updateError", lang)).catch(() => null);
  }
}

async function handlePriceSearch(message, gameName, lang) {
  if (!gameName) return message.reply(getText(lang, "priceSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingPrice", { name: gameName }));

  try {
    let items;
    try { items = await searchSteamGameByName(gameName); } catch (e) { return loadingMsg.edit(getText(lang, "steamError")).catch(() => null); }
    if (!items || items.length === 0) return loadingMsg.edit(getText(lang, "noSteamResults", { name: gameName })).catch(() => null);

    const bestMatch = chooseBestSteamMatch(items, gameName);
    if (!bestMatch || !bestMatch.id) return loadingMsg.edit(getText(lang, "invalidSteamResult")).catch(() => null);

    const bestMatchId = bestMatch.id;
    let gameData;
    try { gameData = await fetchSteamPriceDetails(bestMatchId); } catch (e) { return loadingMsg.edit(getText(lang, "steamApiError")).catch(() => null); }
    if (!gameData) return loadingMsg.edit(getText(lang, "steamDetailsUnavailable")).catch(() => null);

    let offerEndDate = null;
    if (gameData.price_overview && gameData.price_overview.discount_percent > 0) offerEndDate = await extractSteamOfferEndDate(bestMatchId);

    const embed = buildSteamPriceEmbed(gameData, bestMatchId, offerEndDate, lang);
    await loadingMsg.edit({ content: getText(lang, "priceSuccess"), embeds: [embed] }).catch(() => null);
  } catch (err) {
    await loadingMsg.edit(getText(lang, "priceUnexpectedError")).catch(() => null);
  }
}

async function handleDlcSearch(message, gameName, lang) {
  if (!gameName) return message.reply(getText(lang, "dlcSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingDlc", { name: gameName }));

  try {
    let items;
    try { items = await searchSteamGameByName(gameName); } catch (e) { return loadingMsg.edit(getText(lang, "steamError")).catch(() => null); }
    if (!items || items.length === 0) return loadingMsg.edit(getText(lang, "noSteamResults", { name: gameName })).catch(() => null);

    let bestMatch = chooseBestSteamMatch(items, gameName);
    if (!bestMatch || !bestMatch.id) return loadingMsg.edit(getText(lang, "invalidSteamResult")).catch(() => null);

    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
      if (baseGame) bestMatch = baseGame;
    }

    const cacheKey = bestMatch.id;
    let dlcData;
    if (cache.dlc.has(cacheKey) && Date.now() < cache.dlc.get(cacheKey).expiresAt) {
      const cachedVal = cache.dlc.get(cacheKey); cache.dlc.delete(cacheKey); cache.dlc.set(cacheKey, cachedVal); dlcData = cachedVal.data;
    } else {
      const title = bestMatch.name;
      let gameDetails;
      try { gameDetails = await fetchSteamPriceDetails(cacheKey); } catch (e) {}
      const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;
      const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${cacheKey}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" }, timeout: 15000 });
      const $ = cheerio.load(htmlRes.data);

      if ($('#agegate_box').length > 0 || $('.agegate_text_container').length > 0 || htmlRes.request?.path?.includes('agecheck')) {
        return loadingMsg.edit(getText(lang, "ageGate", { name: title })).catch(() => null);
      }

      const dlcList = [];
      const seenDlcIds = new Set();
      $('.game_area_dlc_row').each((i, el) => {
        const dlcName = $(el).find('.game_area_dlc_name').text().trim();
        let dlcPrice = $(el).find('.game_area_dlc_price').text().trim();
        const dlcAppId = $(el).attr('data-ds-appid') || dlcName;
        dlcPrice = dlcPrice.replace(/\s+/g, ' ');
        if (!dlcPrice || dlcPrice === "") dlcPrice = getText(lang, "priceUnav");

        if (dlcName && !seenDlcIds.has(dlcAppId)) { seenDlcIds.add(dlcAppId); dlcList.push({ name: dlcName, price: dlcPrice }); }
      });
      if (dlcList.length === 0) {
        if ($('.game_area_purchase_game').length === 0) return loadingMsg.edit(getText(lang, "pageStructureError", { name: title })).catch(() => null);
        return loadingMsg.edit(getText(lang, "noDlcList", { name: title })).catch(() => null);
      }

      const totalExtracted = dlcList.length;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, thumbUrl, totalExtracted };
      cache.dlc.set(cacheKey, { data: dlcData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } = dlcData;
    await loadingMsg.edit(getText(lang, "dlcSuccess", { count: totalExtracted, name: title })).catch(() => null);

    const itemsPerPage = 10;
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcList.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
      const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(getText(lang, "dlcPack", { title: title })).setURL(`https://store.steampowered.com/app/${finalAppId}`).setThumbnail(finalThumbUrl);
      let desc = "";
      chunk.forEach((dlc, index) => { const globalIndex = page * itemsPerPage + index + 1; desc += `**${globalIndex}. ${truncate(dlc.name, 100)}**\n💵 ${dlc.price}\n\n`; });
      embed.setDescription(desc);
      embed.setFooter({ text: `${getText(lang, "page")} ${page + 1}/${totalP} • ${getText(lang, "displayed")}: ${dlcList.length} / ${getText(lang, "extracted")}: ${totalExtracted}` });
      return [embed];
    };
    await handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcList, itemsPerPage, generateEmbeds, "detailed", lang);

  } catch (err) { await loadingMsg.edit(getText(lang, "dlcUnexpectedError")).catch(() => null); }
}

async function handleStatus(message, gameText, lang) {
  if (!gameText) return message.reply(getText(lang, "statusSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingStatus", { name: gameText }));

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = getText(lang, "gameNotFound");
    if (suggestion) errText += getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key });
    return loadingMsg.edit(errText).catch(() => null);
  }

  try {
    const embed = await fetchGameStatus(game, lang);
    await loadingMsg.edit({ content: getText(lang, "statusSuccess", { name: game.name }), embeds: [embed] }).catch(() => null);
  } catch (err) { await loadingMsg.edit(getText(lang, "statusError")).catch(() => null); }
}

// -------------------------------------------------------------
// INIT 
// -------------------------------------------------------------
let isRunningCron = false;
client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);
  const runChecks = async () => {
    if (isRunningCron) return logger("WARN", "CRON", "Jobul anterior încă rulează pe această instanță, sar peste ciclul actual.");
    isRunningCron = true;
    cleanCache();
    const lockToken = await acquireDbLock("main_cron_job", 120000);
    if (!lockToken) { isRunningCron = false; return; }

    const hb = setInterval(() => renewDbLock("main_cron_job", lockToken, 120000).catch(()=>{}), 60000);
    try { await checkForUpdates(); await checkForDiscounts(); } 
    catch (err) { logger("ERROR", "CRON", "Eroare loop principal", err.message); } 
    finally { clearInterval(hb); await releaseDbLock("main_cron_job", lockToken); isRunningCron = false; }
  };
  runChecks();
  const min = Number(config.checkIntervalMinutes || 30);
  cron.schedule(min === 60 ? '0 * * * *' : `*/${min} * * * *`, runChecks);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const guildDoc = await GuildModel.findById(message.guild.id).lean();
  const lang = guildDoc?.language || "ro";

  const rawContent = message.content.slice(PREFIX.length).trim();
  const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ''));
  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();

  if (command === "ping") return message.reply(getText(lang, "pong"));
  if (command === "games" || command === "porecle") {
    const lines = config.games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });
    let currentMsg = getText(lang, "trackedGames");
    for (const line of lines) {
        if (currentMsg.length + line.length > 1900) {
            if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
            currentMsg = "";
        }
        currentMsg += line + "\n";
    }
    if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
    return;
  }
  if (command === "start") return handleStart(message, subCommand, message.guild.id, lang);
  if (command === "stop") return handleStop(message, subCommand, message.guild.id, lang);
  if (command === "set") return handleSetCommand(message, rawArgs, message.guild.id, lang);

  if (command === "latest") {
    if (subCommand === "updates") return handleLatestUpdates(message, guildDoc, lang);
    if (subCommand === "reduceri") return handleLatestDeals(message, guildDoc, lang);
    if (subCommand === "pret") return handlePriceSearch(message, rawArgs.slice(1).join(" "), lang);
    if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "), guildDoc, lang);
  }

  if (command === "dlc") return handleDlcSearch(message, rawArgs.join(" "), lang);
  if (command === "status") return handleStatus(message, rawArgs.join(" "), lang);

  if (command === "help") {
    const helpEmbed = new EmbedBuilder().setColor(0x2b2d31).setTitle(getText(lang, "helpTitle"))
      .addFields(
        { name: getText(lang, "helpGeneral"), value: getText(lang, "helpGeneralCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpNotif"), value: getText(lang, "helpNotifCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpPrefs"), value: getText(lang, "helpPrefsCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpManual"), value: getText(lang, "helpManualCmds", { prefix: PREFIX }) }
      );
    return message.reply({ embeds: [helpEmbed] });
  }
});

async function bootstrap() {
  if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) {
    logger("ERROR", "BOOTSTRAP", "Lipsesc variabilele de mediu MONGO_URI sau DISCORD_TOKEN");
    return process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) { process.exit(1); }
}

bootstrap();
