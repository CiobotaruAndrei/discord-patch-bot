const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { z } = require("zod");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionsBitField } = require("discord.js");

// CONSTANTE GLOBALE
const PREFIX = "big_master!";
const MAX_DEALS = 40;
const MAX_FREE_PER_STORE = 20;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 50;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/120.0"
];

// VALIDARE CONFIG CU ZOD
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
});

const ConfigSchema = z.object({
    checkIntervalMinutes: z.number().int().positive().refine(v => [5, 10, 15, 20, 30, 60].includes(v)),
    games: z.array(GameSchema).min(1)
});

let config;
try {
    const CONFIG_PATH = path.join(__dirname, "config.json");
    config = ConfigSchema.parse(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
} catch (err) {
    console.error("Eroare validare config.json", err.issues || err.message);
    process.exit(1);
}

// I18N DICTIONAR
const i18n = {
    ro: {
        adminOnly: "⛔ Doar un admin poate folosi această comandă.",
        pong: "Pong! 🏓",
        setChannelUpdates: "⏳ Setez canalul...",
        updatesActive: "✅ Update-uri automate activate.",
        initError: "Eroare la inițializarea datelor.",
        startUpdatesSyntax: "❌ Sintaxă: {prefix}start updates, {prefix}start deals sau {prefix}start free games.",
        setChannelDeals: "⏳ Setez canalul pentru oferte plătite...",
        dealsActive: "✅ Alertele pentru reduceri activate!",
        setChannelFree: "⏳ Setez canalul pentru jocuri gratuite...",
        freeActive: "✅ Alertele pentru jocurile promoționale 100% GRATUITE activate!",
        dealsError: "Eroare internă la preluarea ofertelor.",
        stopUpdates: "🛑 Update-uri oprite.",
        stopDeals: "🛑 Reduceri oprite.",
        stopFree: "🛑 Notificările de jocuri gratuite oprite.",
        stopSyntax: "❌ Sintaxă: {prefix}stop updates/deals/free games.",
        setHelp: "⚙️ Setări: mode, mindiscount, language.",
        invalidMode: "❌ Permise: compact sau detailed.",
        modeSet: "✅ Mod setat: {value}",
        invalidDiscount: "❌ 0-100.",
        discountSet: "✅ Reducere minimă: {value}%",
        invalidLang: "❌ Limbi permise: ro sau en.",
        langSet: "✅ Limba setată: {value}",
        unknownSetting: "❌ Setare necunoscută.",
        saveError: "Eroare la salvarea preferințelor.",
        estTime: "⏳ Durată estimată: {time} secunde",
        fetchUpdatesError: "Nu am reușit să obțin update-urile.",
        noData: "❌ Nu am date disponibile.",
        dataLoaded: "✅ Date încărcate!",
        fetchDealsError: "Nu am putut interoga magazinele.",
        noDealsMatch: "❌ Nu am găsit oferte care să corespundă setărilor.",
        noFreeMatch: "❌ Nu am găsit jocuri promoționale 100% gratuite în acest moment.",
        dealsLoaded: "✅ Oferte încărcate!",
        freeLoaded: "✅ Promoții gratuite găsite!",
        separatorSteam: "🎮  ---  PROMOȚII STEAM  ---  🎮",
        separatorEpic: "🛒  ---  PROMOȚII EPIC GAMES  ---  🛒",
        latestUpdateSyntax: "❌ Ex: {prefix}latest update cs2.",
        connecting: "⏳ Mă conectez... Durată estimată: {time} sec.",
        gameNotFound: "❌ Nu am găsit jocul.",
        didYouMean: " Te refereai cumva la {name} ({key})?",
        updateSuccess: "✅ Update {name}:",
        updateError: "Nu am putut prelua acest update.",
        priceSyntax: "❌ Trebuie să specifici un joc. Ex: {prefix}latest price cyberpunk.",
        searchingDualPrice: "⏳ Caut prețul pe Steam și Epic pentru {name}...",
        steamError: "❌ Eroare la conectarea cu serverele Steam.",
        noSteamResults: "❌ Nu am găsit niciun rezultat pe Steam pentru \"{name}\".",
        noDualResults: "❌ Nu am găsit rezultate pe Steam sau Epic pentru \"{name}\".",
        invalidSteamResult: "❌ Nu am putut selecta un rezultat valid de pe Steam.",
        steamApiError: "❌ Steam API nu a putut returna detaliile.",
        steamDetailsUnavailable: "❌ Detaliile de preț nu sunt disponibile.",
        priceDualSuccess: "✅ Am obținut prețurile!",
        dualPriceTitle: "🏷️ Preț curent: {title}",
        notFoundSteam: "❌ Jocul nu are preț public pe Steam.",
        notFoundEpic: "❌ Jocul nu a fost găsit pe Epic Games.",
        priceUnexpectedError: "❌ Eroare neașteptată la căutarea prețului.",
        dlcSyntax: "❌ Trebuie să specifici un joc. Ex: {prefix}dlc cyberpunk.",
        searchingDlc: "⏳ Caut DLC-urile pentru {name}...",
        ageGate: "❌ Pagina este blocată de verificarea vârstei.",
        pageStructureError: "❌ Structura paginii nu a putut fi interpretată.",
        noDlcList: "❌ Niciun DLC listat separat pe Steam.",
        dlcSuccess: "✅ Am găsit {count} DLC-uri pentru {name}!",
        dlcUnexpectedError: "❌ Eroare la căutarea DLC-urilor.",
        helpTitle: "🤖 Meniul de Ajutor - Big Master",
        helpDetailedTitle: "📖 Detalii comandă",
        helpCmdNotFound: "❌ Nu am găsit detalii pentru comanda asta.",
        helpFooter: "💡 Tip: Folosește {prefix}help [comandă]",
        helpGeneral: "🛠️ Utility", helpNotif: "🔔 Notificări", helpPrefs: "⚙️ Setări", helpManual: "🎮 Jocuri",
        trackedGames: "🎮 Jocuri urmărite:\n",
        onlyAuthor: "Doar autorul comenzii poate naviga!",
        prev: "◀ Ant", next: "Urm ▶",
        updateTitleText: "Apasă pe titlu pentru a citi patch-ul.",
        updateDescText: "A apărut un update nou pentru {name}.",
        fallbackUpdateTitle: "Update nou",
        free: "Gratuit", discount: "Reducere", oldPrice: "Preț Vechi", newPrice: "Preț Nou", link: "Link", details: "Detalii", platformsLabel: "Platforme", quality: "Calitate", popularity: "Popularitate", expiresAt: "Expiră la", freeUntil: "Gratis până la", page: "Pagina", displayed: "Afișate", extracted: "Extrase",
        dlcMoreNote: "⚠️ Pot exista mai multe DLC-uri pe pagina oficială.",
        notifiedUpdate: "🔔 Update nou pentru {name}!",
        notifiedDeal: "🔥 Ofertă nouă detectată!",
        notifiedFree: "🎁 Un joc GRATUIT a apărut!",
        currFree: "Permanent gratuit (Free-to-Play).",
        priceUnav: "Prețul nu este disponibil în acest moment.",
        activeDisc: "Reducere de {percent}%!\n\n~~{old}~~ -> {new}",
        expAt: "\n⏳ Oferta expiră la: ",
        noDisc: "Nu este la reducere.\n\nPreț standard: {price}",
        dlcPack: "📦 DLC-uri: {title}", dlcBuyLink: "🛒 Cumpără",
        dealOffer: "🏷️ {store} oferă o reducere de {savings}%!\n\n",
        freeOffer: "🎁 {store} oferă acest titlu GRATUIT limitat!\n\n",
        statusTitle: "📊 Status complet: {name}",
        statusNoUpdate: "Nu am găsit update-uri recente în baza de date.",
        excerptFortnite: "Update oficial Fortnite.", excerptAmdDriver: "Driver disponibil.", excerptAMD: "Update AMD.com.", excerptIntel: "Update intel.com detectat.", excerptVersion: "Versiunea {v}",
        helpGeneralCmds: "{prefix}help\n{prefix}help [comandă]\n{prefix}ping",
        helpNotifCmds: "{prefix}start updates\n{prefix}stop updates\n{prefix}start deals\n{prefix}stop deals\n{prefix}start free\n{prefix}stop free",
        helpPrefsCmds: "{prefix}set mode [compact/detailed]\n{prefix}set mindiscount [0-100]\n{prefix}set language [ro/en]",
        helpManualCmds: "{prefix}games\n{prefix}latest updates\n{prefix}latest deals\n{prefix}latest free\n{prefix}latest update [nume]\n{prefix}latest price [nume]\n{prefix}dlc [nume]\n{prefix}status [nume]",
        helpCmd_status: "🔍 Status [nume joc]: Afișează un raport complet (preț, update-uri) pentru un joc."
    },
    en: {
        adminOnly: "⛔ Admin only.", pong: "Pong! 🏓", setChannelUpdates: "⏳ Setting updates channel...", updatesActive: "✅ Automatic updates enabled.", initError: "Error initializing data.", startUpdatesSyntax: "❌ Syntax: {prefix}start updates/deals/free games.", setChannelDeals: "⏳ Setting deals channel...", dealsActive: "✅ Deal alerts enabled!", setChannelFree: "⏳ Setting free games channel...", freeActive: "✅ 100% FREE games alerts enabled!", dealsError: "Internal error.", stopUpdates: "🛑 Updates stopped.", stopDeals: "🛑 Deals stopped.", stopFree: "🛑 Free games notifications stopped.", stopSyntax: "❌ Syntax: {prefix}stop updates/deals/free games.", setHelp: "⚙️ Settings: mode, mindiscount, language.", invalidMode: "❌ Allowed: compact/detailed.", modeSet: "✅ Mode set to: {value}", invalidDiscount: "❌ 0-100.", discountSet: "✅ Min discount: {value}%", invalidLang: "❌ Allowed: ro/en.", langSet: "✅ Language: {value}", unknownSetting: "❌ Unknown setting.", saveError: "Error saving.", estTime: "⏳ Est time: {time}s", fetchUpdatesError: "Failed to fetch updates.", noData: "❌ No data.", dataLoaded: "✅ Data loaded!", fetchDealsError: "Failed to fetch deals.", noDealsMatch: "❌ No deals found.", noFreeMatch: "❌ No 100% free games found.", dealsLoaded: "✅ Deals loaded!", freeLoaded: "✅ Free promotions found!", separatorSteam: "🎮  ---  STEAM  ---  🎮", separatorEpic: "🛒  ---  EPIC GAMES  ---  🛒", latestUpdateSyntax: "❌ Ex: {prefix}latest update cs2.", connecting: "⏳ Connecting... Est time: {time}s", gameNotFound: "❌ Game not found.", didYouMean: " Did you mean {name}?", updateSuccess: "✅ Update {name}:", updateError: "Could not fetch update.", priceSyntax: "❌ Specify a game.", searchingDualPrice: "⏳ Searching Steam and Epic for {name}...", steamError: "❌ Steam error.", noSteamResults: "❌ No Steam results.", noDualResults: "❌ No results.", invalidSteamResult: "❌ Invalid Steam result.", steamApiError: "❌ Steam API error.", steamDetailsUnavailable: "❌ Price details unavailable.", priceDualSuccess: "✅ Prices retrieved!", dualPriceTitle: "🏷️ Current Price: {title}", notFoundSteam: "❌ Not found on Steam.", notFoundEpic: "❌ Not found on Epic Games.", priceUnexpectedError: "❌ Unexpected error.", dlcSyntax: "❌ Specify game.", searchingDlc: "⏳ Searching DLCs...", ageGate: "❌ Age-restricted.", pageStructureError: "❌ Parse error.", noDlcList: "❌ No DLCs.", dlcSuccess: "✅ Found {count} DLCs!", dlcUnexpectedError: "❌ Error searching DLCs.", helpTitle: "🤖 Help Menu", helpDetailedTitle: "📖 Details", helpCmdNotFound: "❌ Not found.", helpFooter: "💡 Tip: {prefix}help [cmd]", helpGeneral: "🛠️ Utility", helpNotif: "🔔 Notifications", helpPrefs: "⚙️ Settings", helpManual: "🎮 Games", trackedGames: "🎮 Tracked:\n", onlyAuthor: "Only author can navigate!", prev: "◀ Prev", next: "Next ▶", updateTitleText: "Click title to read.", updateDescText: "New update for {name}.", fallbackUpdateTitle: "New Update", free: "Free", discount: "Discount", oldPrice: "Old Price", newPrice: "New Price", link: "Link", details: "Details", platformsLabel: "Platforms", quality: "Quality", popularity: "Popularity", expiresAt: "Expires at", freeUntil: "Free until", page: "Page", displayed: "Displayed", extracted: "Extracted", dlcMoreNote: "⚠️ More on store.", notifiedUpdate: "🔔 New update {name}!", notifiedDeal: "🔥 New deal!", notifiedFree: "🎁 FREE game!", currFree: "Free-to-Play.", priceUnav: "Price unavailable.", activeDisc: "{percent}% discount!\n\n~~{old}~~ -> {new}", expAt: "\n⏳ Expires at: ", noDisc: "Not on sale.\n\nStandard price: {price}", dlcPack: "📦 DLCs: {title}", dlcBuyLink: "🛒 Buy", dealOffer: "🏷️ {store} discount {savings}%!\n\n", freeOffer: "🎁 {store} FREE limit time!\n\n", statusTitle: "📊 Full Status: {name}", statusNoUpdate: "No recent updates.", excerptFortnite: "Fortnite update.", excerptAmdDriver: "Driver available.", excerptAMD: "AMD update.", excerptIntel: "Intel update.", excerptVersion: "Version {v}", helpGeneralCmds: "{prefix}help\n{prefix}ping", helpNotifCmds: "{prefix}start updates\n{prefix}stop updates\n{prefix}start deals\n{prefix}stop deals\n{prefix}start free\n{prefix}stop free", helpPrefsCmds: "{prefix}set mode [compact/detailed]\n{prefix}set mindiscount [0-100]\n{prefix}set language [ro/en]", helpManualCmds: "{prefix}games\n{prefix}latest updates\n{prefix}latest deals\n{prefix}latest free\n{prefix}latest update [name]\n{prefix}latest price [name]\n{prefix}dlc [name]\n{prefix}status [name]", helpCmd_status: "🔍 Status [game name]: Shows price and latest update for a game."
    }
};

function getText(lang, key, params = {}) {
    let text = i18n[lang]?.[key] || i18n["ro"]?.[key] || key;
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, v);
    return text;
}

function smoothTime(oldMs, newMs, alpha = 0.3) { return Math.round(oldMs * (1 - alpha) + newMs * alpha); }
function safeStringify(val) { try { return JSON.stringify(val); } catch { return String(val); } }

function logger(level, context, message, meta = "") {
    const ts = new Date().toISOString();
    const format = `[${ts}] [${level}] [${context}] ${message} ${meta ? safeStringify(meta) : ""}`;
    if (level === "ERROR") console.error(format);
    else if (level === "WARN") console.warn(format);
    else console.log(format);
}

function formatUserError(err, defaultMsgKey, lang = "ro") {
    const defaultMsg = getText(lang, defaultMsgKey);
    if (err) {
        logger("WARN", "USER_COMMAND", defaultMsg, err.stack || err.message);
        const specificMsg = i18n[lang]?.[err.message];
        if (specificMsg) return `❌ ${specificMsg}`;
    }
    return `❌ ${defaultMsg}`;
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
        }
    }
    return m[a.length][b.length];
}

function canSendEmbeds(channel, botId) {
    if (!channel || !channel.isTextBased()) return false;
    const perms = channel.permissionsFor(botId);
    return perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]);
}

async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
    const reqConfig = { method, url, timeout: options.timeout || 15000, headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)], ...options.headers } };
    if (options.data) reqConfig.data = options.data;
    for (let i = 0; i <= retries; i++) {
        try { return await axios(reqConfig); }
        catch (err) {
            const status = err.response?.status || "N/A";
            if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw err;
            if (i === retries) throw err;
            await new Promise(res => setTimeout(res, backoff)); backoff *= 2;
        }
    }
}

async function fetchWithProxy(targetUrl, options = {}) {
    const proxies = [`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`];
    for (const proxy of proxies) {
        try {
            const res = await httpReq('GET', proxy, options);
            return proxy.includes("allorigins") ? String(res?.data?.contents || "") : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
        } catch (err) {}
    }
    throw new Error("Proxy epuizat");
}

function cleanText(text) { return String(text || "").replace(/<[^>]+>/g, " ").replace(/&/gi, "&").replace(/\s+/g, " ").trim(); }
function truncate(str, max) { const t = String(str || ""); return t.length > max ? t.substring(0, max - 3) + "..." : t; }
function normalizeUpdate(data) { return { id: String(data.id || ""), title: data.title ? truncate(data.title, 250) : null, link: String(data.link || ""), excerpt: truncate(data.excerpt || "", 700), excerptKey: data.excerptKey || null, excerptParams: data.excerptParams || null, fullText: truncate(data.fullText || "", 3500), image: data.image || null, thumbnail: data.thumbnail || null, timestamp: data.timestamp || "" }; }

function buildUpdateEmbed(gameName, latest, mode = "detailed", lang = "ro") {
    const embed = new EmbedBuilder().setColor(0x57f287).setTitle(truncate(latest.title || getText(lang, "fallbackUpdateTitle"), 256)).setFooter({ text: truncate(gameName, 2048) });
    if (latest.link) embed.setURL(latest.link);
    let excerpt = latest.excerptKey ? getText(lang, latest.excerptKey, latest.excerptParams || {}) : latest.excerpt;
    if (mode === "compact") { embed.setDescription(latest.link ? getText(lang, "updateTitleText") : getText(lang, "updateDescText", { name: gameName })); }
    else {
        embed.setDescription(truncate(excerpt || getText(lang, "updateDescText", { name: gameName }), 4096));
        if (latest.image) embed.setImage(latest.image); if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
        if (latest.timestamp) { const d = new Date(latest.timestamp); if (!Number.isNaN(d.getTime())) embed.setTimestamp(d); }
    }
    return embed;
}

function buildDealEmbed(deal, mode = "detailed", lang = "ro") {
    const isFree = parseFloat(deal.salePrice) === 0 && deal.savings === 100;
    const embed = new EmbedBuilder().setColor(isFree ? 0x2ecc71 : 0xe74c3c).setTitle(truncate(`${isFree ? "🎁 [" + deal.store.toUpperCase() + "]" : "🏷️ " + getText(lang, "discount") + ": "}${deal.title}`, 256));
    if (mode === "compact") { embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? getText(lang, "free").toUpperCase() : "$" + deal.salePrice}**\n[${getText(lang, "link")}](${deal.link})`); }
    else {
        let statsStr = (deal.qualityScore > 0 || deal.totalReviews > 0) ? `⭐ **${getText(lang, "quality")}:** ${deal.qualityScore}% | 👥 **${getText(lang, "popularity")}:** ${deal.totalReviews > 0 ? deal.totalReviews : "N/A"}\n\n` : "";
        let dispDate = deal.endDateStr;
        if (dispDate && dispDate.includes("T")) { const d = new Date(dispDate); if (!isNaN(d.getTime())) dispDate = d.toLocaleDateString(lang === "ro" ? "ro-RO" : "en-US"); } else if (dispDate) dispDate = dispDate.replace(/Offer ends\s+/i, '').trim();
        const oText = isFree ? getText(lang, "freeOffer", { store: deal.store }) : getText(lang, "dealOffer", { store: deal.store, savings: deal.savings });
        embed.setAuthor({ name: truncate(deal.store, 256) }).setDescription(truncate(oText + statsStr + (dispDate ? `⏳ **${isFree ? getText(lang, "freeUntil") : getText(lang, "expiresAt")}:** ${dispDate}\n\n` : ""), 4096)).addFields({ name: getText(lang, "oldPrice"), value: `~~$${deal.normalPrice}~~`, inline: true }, { name: getText(lang, "newPrice"), value: isFree ? `🔥 ${getText(lang, "free").toUpperCase()} 🔥` : `$${deal.salePrice}`, inline: true }, { name: getText(lang, "link"), value: `[Link](${deal.link})`, inline: false });
        if (deal.thumbnail) embed.setThumbnail(deal.thumbnail);
        let dets = "";
        if (deal.platformsInfo) dets += `**${getText(lang, "platformsLabel")}:** ${deal.platformsInfo}\n`;
        if (deal.extraDetails) dets += deal.extraDetails;
        if (dets.trim()) embed.addFields({ name: getText(lang, "details"), value: truncate(dets.trim(), 1024), inline: false });
    }
    return embed;
}

function buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, query, lang) {
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle(getText(lang, "dualPriceTitle", { title: query }));
    let sVal = !steamData ? getText(lang, "notFoundSteam") : `**${steamData.name}**\n${steamData.is_free ? getText(lang, "currFree") : (!steamData.price_overview ? getText(lang, "priceUnav") : (steamData.price_overview.discount_percent > 0 ? getText(lang, "activeDisc", { percent: steamData.price_overview.discount_percent, old: `$${(steamData.price_overview.initial / 100).toFixed(2)}`, new: steamData.price_overview.final === 0 ? getText(lang, "free").toUpperCase() : `$${(steamData.price_overview.final / 100).toFixed(2)}` }) + (steamEndDate ? `\n${getText(lang, "expAt")} ${steamEndDate}` : "") : getText(lang, "noDisc", { price: `$${(steamData.price_overview.initial / 100).toFixed(2)}` })))}\n[${getText(lang, "link")}](https://store.steampowered.com/app/${steamAppId})`;
    if (steamData?.header_image) embed.setThumbnail(steamData.header_image); embed.addFields({ name: "🎮 Steam", value: sVal, inline: false });
    let eVal = !epicData ? getText(lang, "notFoundEpic") : `**${epicData.title}**\n${(!epicData.price?.totalPrice ? getText(lang, "priceUnav") : ((epicData.price.totalPrice.originalPrice > epicData.price.totalPrice.discountPrice) ? getText(lang, "activeDisc", { percent: Math.round(((epicData.price.totalPrice.originalPrice - epicData.price.totalPrice.discountPrice) / epicData.price.totalPrice.originalPrice) * 100), old: `$${(epicData.price.totalPrice.originalPrice / 100).toFixed(2)}`, new: epicData.price.totalPrice.discountPrice === 0 ? getText(lang, "free").toUpperCase() : `$${(epicData.price.totalPrice.discountPrice / 100).toFixed(2)}` }) : getText(lang, "noDisc", { price: `$${(epicData.price.totalPrice.originalPrice / 100).toFixed(2)}` })))}\n[${getText(lang, "link")}](https://store.epicgames.com/en-US/p/${epicData.urlSlug || epicData.id})`;
    if (!embed.data.thumbnail && epicData?.keyImages) { const img = epicData.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail"); if (img) embed.setThumbnail(img.url); }
    embed.addFields({ name: "🛒 Epic Games", value: eVal, inline: false });
    return embed;
}

function buildPaginationButtons(prefix, sessionId, page, totalPages, lang = "ro") {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel(getText(lang, "prev")).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel(getText(lang, "next")).setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
    );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed", lang = "ro") {
    if (!items || !items.length) return;
    let currentPage = 0; const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(7);
    let collector = null;
    const updateMessage = async () => { try { const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode); const components = [buildPaginationButtons(prefix, sessionId, currentPage, totalPages, lang)]; await interactionMessage.edit({ embeds, components }).catch(() => null); } catch (err) { if (collector) collector.stop("error"); } };
    await updateMessage();
    collector = interactionMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
    collector.on("collect", async (btn) => {
        if (btn.user.id !== authorId) return btn.reply({ content: getText(lang, "onlyAuthor"), ephemeral: true }).catch(() => null);
        if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--; if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;
        currentPage = Math.max(0, Math.min(totalPages - 1, currentPage)); await btn.deferUpdate().catch(() => null); await updateMessage();
    });
    collector.on("end", () => { if (interactionMessage.editable) interactionMessage.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`d_1`).setLabel(getText(lang, "prev")).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId(`d_2`).setLabel(getText(lang, "next")).setStyle(ButtonStyle.Primary).setDisabled(true))] }).catch(() => null); });
}

module.exports = {
    config, PREFIX, MAX_DEALS, MAX_FREE_PER_STORE, ITEMS_PER_PAGE, DEALS_HISTORY_LIMIT,
    getText, logger, smoothTime, safeStringify, formatUserError, levenshtein, canSendEmbeds,
    httpReq, fetchWithProxy, cleanText, truncate, normalizeUpdate,
    buildUpdateEmbed, buildDealEmbed, buildDualPriceEmbed, handlePagination
};
