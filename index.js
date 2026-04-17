const http = require("http");
const cron = require("node-cron");
const mongoose = require("mongoose");
const crypto = require("crypto");
const cheerio = require("cheerio");
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");

const db = require("./database");
const utils = require("./utils");
const api = require("./api");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// -------------------------------------------------------------
// SERVER WEB PENTRU HEALTHCHECK & SHUTDOWN GRACEFUL
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
}).listen(PORT, "0.0.0.0", () => utils.logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    utils.logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
    try {
        for (const [jobName, token] of db.activeLocks.entries()) await db.releaseDbLock(jobName, token);
        if (mongoose.connection.readyState === 1) await mongoose.connection.close();
        client.destroy(); process.exit(0);
    } catch (err) { process.exit(1); }
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// FUNCȚII CRON JOB & PROCESSORS
// -------------------------------------------------------------
async function checkForUpdates() {
    const guilds = await db.GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
    if (!guilds.length) return;

    const results = await api.getLatestForAllGames();
    const validResults = results.filter(r => r.latest !== null);
    if (!validResults.length) return;

    for (const guild of guilds) {
        let channel;
        const lang = guild.language || "ro";
        try { channel = await client.channels.fetch(guild.notificationChannelId); } catch (err) { continue; }
        if (!utils.canSendEmbeds(channel, client.user.id)) continue;

        let updatePayload = {};  
        if (!guild.seen) guild.seen = {};
        let sentUpdatesCount = 0;  

        for (const { game, latest } of validResults) {  
            const seenIds = Array.isArray(guild.seen[game.key]) ? [...guild.seen[game.key]] : [];  
            if (!seenIds.includes(latest.id)) {  
                if (sentUpdatesCount < 5) {   
                    const embed = utils.buildUpdateEmbed(game.name, latest, guild.notificationMode || "detailed", lang);
                    try {  
                        await channel.send({ content: utils.getText(lang, "notifiedUpdate", { name: game.name }), embeds: [embed] });
                        await new Promise(r => setTimeout(r, 800));   
                        sentUpdatesCount++;  
                        seenIds.push(latest.id);  
                        if (seenIds.length > 20) seenIds.shift();  
                        guild.seen[game.key] = seenIds;  
                        updatePayload[`seen.${game.key}`] = seenIds;
                        await db.GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });  
                    } catch (err) {  
                        utils.logger("WARN", "CRON_UPDATE", "Failed to send embed", err.message);
                    }  
                } else {  
                    break;
                }  
            }  
        }
    }
}

async function checkForDiscounts(targetType = 'all', forceGuildId = null) {
    const conditions = [];
    if (forceGuildId) {
        conditions.push({ _id: forceGuildId });
    } else {
        if (targetType === 'all' || targetType === 'deals') {
            conditions.push({ discountsSubscribed: true, discountChannelId: { $ne: null } });
        }
        if (targetType === 'all' || targetType === 'free') {
            conditions.push({ freeSubscribed: true, freeChannelId: { $ne: null } });
        }
    }

    if (conditions.length === 0) return;

    const guilds = await db.GuildModel.find({ $or: conditions }).lean();
    if (!guilds.length) return;

    let allDeals;
    if (api.cache.deals.data && api.cache.deals.expiresAt > Date.now()) {
        allDeals = api.cache.deals.data;
    } else {
        try {
            allDeals = await api.fetchDeals();
            api.cache.deals = { data: allDeals, expiresAt: Date.now() + utils.GLOBAL_CACHE_TTL_MS };
        } catch (err) { return; }
    }

    const paidDeals = (targetType === 'all' || targetType === 'deals')
    ? allDeals.filter(d => parseFloat(d.salePrice) > 0).sort((a, b) => b.popularityScore - a.popularityScore)
    : [];
    const freeDeals = (targetType === 'all' || targetType === 'free')
    ? allDeals.filter(d => parseFloat(d.salePrice) === 0 && d.savings === 100).sort((a, b) => b.popularityScore - a.popularityScore)
    : [];

    for (const guild of guilds) {
        const lang = guild.language || "ro";
        
        if (guild.discountsSubscribed && guild.discountChannelId && (targetType === 'all' || targetType === 'deals')) {  
            let channel;
            try { channel = await client.channels.fetch(guild.discountChannelId); } catch (err) {}  

            if (channel && utils.canSendEmbeds(channel, client.user.id)) {  
                const minDisc = guild.minDiscountPercent || 0;  
                const validPaidDeals = paidDeals.filter(deal => deal.savings >= minDisc);  

                let sentCountPaid = 0;  
                if (!guild.seenDiscounts) guild.seenDiscounts = [];
                for (const deal of validPaidDeals) {  
                    const hash = crypto.createHash('sha1').update(`${deal.title}_${deal.store}_${deal.salePrice}_${deal.normalPrice}`).digest('hex');
                    if (!guild.seenDiscounts.includes(hash)) {  
                        if (sentCountPaid < 8) {   
                            try { await api.enrichDealData(deal); } catch (e) { }   
                            const embed = utils.buildDealEmbed(deal, guild.notificationMode || "detailed", lang);
                            try {  
                                await channel.send({ content: utils.getText(lang, "notifiedDeal"), embeds: [embed] });
                                await new Promise(r => setTimeout(r, 800));   
                                sentCountPaid++;  
                                guild.seenDiscounts.push(hash);   
                                if (guild.seenDiscounts.length > utils.DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();
                                await db.GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
                            } catch (err) { utils.logger("WARN", "CRON_DEAL", "Failed to send embed", err.message); }  
                        } else {  
                            break;
                        }  
                    }  
                }  
            }  
        }  

        if (guild.freeSubscribed && guild.freeChannelId && (targetType === 'all' || targetType === 'free')) {  
            let channelFree;
            try { channelFree = await client.channels.fetch(guild.freeChannelId); } catch (err) {}  

            if (channelFree && utils.canSendEmbeds(channelFree, client.user.id)) {  
                let sentCountFree = 0;
                if (!guild.seenFree) guild.seenFree = [];  

                for (const deal of freeDeals) {  
                    const hash = crypto.createHash('sha1').update(`FREE_${deal.title}_${deal.store}`).digest('hex');
                    if (!guild.seenFree.includes(hash)) {  
                        if (sentCountFree < 8) {  
                            try { await api.enrichDealData(deal); } catch (e) { }   
                            const embed = utils.buildDealEmbed(deal, guild.notificationMode || "detailed", lang);
                            try {  
                                await channelFree.send({ content: utils.getText(lang, "notifiedFree"), embeds: [embed] });
                                await new Promise(r => setTimeout(r, 800));  
                                sentCountFree++;  
                                guild.seenFree.push(hash);  
                                if (guild.seenFree.length > utils.DEALS_HISTORY_LIMIT) guild.seenFree.shift();
                                await db.GuildModel.updateOne({ _id: guild._id }, { $set: { seenFree: guild.seenFree } });
                            } catch (err) { utils.logger("WARN", "CRON_FREE", "Failed to send embed", err.message); }  
                        } else {  
                            break;
                        }  
                    }  
                }  
            }  
        }
    }
}

async function runDiscountsSafe(targetType = 'all', guildId = null) {
    const lockName = guildId ? `manual_trigger_${guildId}_${targetType}` : "global_discounts_lock";
    const lockToken = await db.acquireDbLock(lockName, 60000);
    if (!lockToken) return;   

    const hb = setInterval(() => db.renewDbLock(lockName, lockToken, 60000).catch(()=>{}), 30000);
    try {   
        await checkForDiscounts(targetType, guildId);
    } catch (e) {   
        utils.logger("ERROR", "SAFE_DISCOUNTS", "Eroare la procesare instanțiată", e.message);
    } finally {   
        clearInterval(hb);   
        await db.releaseDbLock(lockName, lockToken);
    }
}

// -------------------------------------------------------------
// COMMAND HANDLERS
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId, lang) {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(utils.getText(lang, "adminOnly"));
    if (subCommand === "updates") {
        const msg = await message.reply(utils.getText(lang, "setChannelUpdates"));
        try {
            const results = await api.getLatestForAllGames();
            const setPayload = { subscribed: true, notificationChannelId: message.channel.id };
            for (const r of results) if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
            await db.GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
            return msg.edit(utils.getText(lang, "updatesActive")).catch(() => null);
        } catch (err) { return msg.edit(utils.formatUserError(err, "initError", lang)).catch(() => null); }
    }

    if (subCommand === "deals" || subCommand === "reduceri") {
        const msg = await message.reply(utils.getText(lang, "setChannelDeals"));
        try {
            await db.GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: [] } }, { upsert: true });
            await msg.edit(utils.getText(lang, "dealsActive")).catch(() => null);
            setTimeout(() => runDiscountsSafe('deals', guildId), 1000);
            return;  
        } catch (err) { return msg.edit(utils.formatUserError(err, "dealsError", lang)).catch(() => null); }
    }

    if (subCommand === "free") {
        const msg = await message.reply(utils.getText(lang, "setChannelFree"));
        try {
            await db.GuildModel.updateOne({ _id: guildId }, { $set: { freeSubscribed: true, freeChannelId: message.channel.id, seenFree: [] } }, { upsert: true });
            await msg.edit(utils.getText(lang, "freeActive")).catch(() => null);
            setTimeout(() => runDiscountsSafe('free', guildId), 1000);
            return;  
        } catch (err) { return msg.edit(utils.formatUserError(err, "dealsError", lang)).catch(() => null); }
    }

    return message.reply(utils.getText(lang, "startUpdatesSyntax", { prefix: utils.PREFIX }));
}

async function handleStop(message, subCommand, guildId, lang) {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(utils.getText(lang, "adminOnly"));
    try {
        if (subCommand === "updates") { await db.GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null } }); return message.reply(utils.getText(lang, "stopUpdates")); }
        if (subCommand === "deals" || subCommand === "reduceri") { await db.GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null } }); return message.reply(utils.getText(lang, "stopDeals")); }
        if (subCommand === "free") { await db.GuildModel.updateOne({ _id: guildId }, { $set: { freeSubscribed: false, freeChannelId: null } }); return message.reply(utils.getText(lang, "stopFree")); }
    } catch (err) {}
    return message.reply(utils.getText(lang, "stopSyntax", { prefix: utils.PREFIX }));
}

async function handleSetCommand(message, args, guildId, lang) {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(utils.getText(lang, "adminOnly"));
    const setting = (args[0] || "").toLowerCase();
    const value = (args[1] || "").toLowerCase();

    if (!setting || !value) return message.reply(utils.getText(lang, "setHelp"));
    const updateDoc = {};
    let confirmMsg = "";

    switch (setting) {
        case "mode":
            if (!["compact", "detailed"].includes(value)) return message.reply(utils.getText(lang, "invalidMode"));
            updateDoc.notificationMode = value;
            confirmMsg = utils.getText(lang, "modeSet", { value }); break;
        case "mindiscount":
            const min = parseInt(value);
            if (isNaN(min) || min < 0 || min > 100) return message.reply(utils.getText(lang, "invalidDiscount"));
            updateDoc.minDiscountPercent = min;
            confirmMsg = utils.getText(lang, "discountSet", { value: min }); break;
        case "language":
            if (!["ro", "en"].includes(value)) return message.reply(utils.getText(lang, "invalidLang"));
            updateDoc.language = value;
            confirmMsg = utils.getText(value, "langSet", { value: value.toUpperCase() }); break;
        default: return message.reply(utils.getText(lang, "unknownSetting"));
    }
    try { await db.GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true }); return message.reply(confirmMsg); }
    catch (err) { return message.reply(utils.formatUserError(err, "saveError", lang)); }
}

async function handleLatestUpdates(message, guildDoc, lang) {
    let msg = null;
    if (!api.cache.updates.data) {
        const estMs = (await db.getSystemTimes()).all || 35000;
        msg = await message.reply(utils.getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
        const startTime = Date.now();
        try {
            const results = await api.getLatestForAllGames();
            api.cache.updates = { data: results, expiresAt: Date.now() + utils.GLOBAL_CACHE_TTL_MS };
            const sys = await db.getSystemTimes();
            sys.all = utils.smoothTime(estMs, Date.now() - startTime); await db.saveSystemTimes(sys);
        } catch (err) { return msg.edit(utils.formatUserError(err, "fetchUpdatesError", lang)).catch(() => null); }
    }
    const valid = api.cache.updates.data.filter(r => r.latest !== null);
    if (!valid.length) return msg ? msg.edit(utils.getText(lang, "noData")).catch(() => null) : message.reply(utils.getText(lang, "noData"));

    const mode = guildDoc?.notificationMode || "detailed";
    if (msg) await msg.edit(utils.getText(lang, "dataLoaded")).catch(() => null);
    else msg = await message.reply(utils.getText(lang, "dataLoaded"));
    const generateEmbeds = async (page, totalP, currentMode) => valid.slice(page * utils.ITEMS_PER_PAGE, (page + 1) * utils.ITEMS_PER_PAGE).map(r => utils.buildUpdateEmbed(r.game.name, r.latest, currentMode, lang).setFooter({ text: `${r.game.name} • ${utils.getText(lang, "page")} ${page + 1}/${totalP}` }));
    await utils.handlePagination(msg, message.author.id, "upd", valid, utils.ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestDeals(message, guildDoc, lang) {
    let msg = null;
    if (!api.cache.deals.data || api.cache.deals.expiresAt < Date.now()) {
        const estMs = (await db.getSystemTimes()).deals || 10000;
        msg = await message.reply(utils.getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
        const startTime = Date.now();
        try {
            const rawDeals = await api.fetchDeals();
            api.cache.deals = { data: rawDeals, expiresAt: Date.now() + utils.GLOBAL_CACHE_TTL_MS };
            const sys = await db.getSystemTimes();
            sys.deals = utils.smoothTime(estMs, Date.now() - startTime); await db.saveSystemTimes(sys);
        } catch (err) { return msg.edit(utils.formatUserError(err, "fetchDealsError", lang)).catch(() => null); }
    }

    const mode = guildDoc?.notificationMode || "detailed";
    const minDisc = guildDoc?.minDiscountPercent || 0;

    // Filtrare echitabilă: Maxim 20 de la Steam și Maxim 20 de la Epic Games
    const paidSteam = api.cache.deals.data
        .filter(deal => parseFloat(deal.salePrice) > 0 && deal.savings >= minDisc && deal.store === "Steam")
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, 20);

    const paidEpic = api.cache.deals.data
        .filter(deal => parseFloat(deal.salePrice) > 0 && deal.savings >= minDisc && deal.store === "Epic Games")
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, 20);

    // Combinăm listele și le sortăm global pentru a fi afișate de la cea mai bună la cea mai slabă ofertă
    const top = [...paidSteam, ...paidEpic].sort((a, b) => b.popularityScore - a.popularityScore);

    if (!top.length) return msg ? msg.edit(utils.getText(lang, "noDealsMatch")).catch(() => null) : message.reply(utils.getText(lang, "noDealsMatch"));
    if (msg) await msg.edit(utils.getText(lang, "dealsLoaded")).catch(() => null);
    else msg = await message.reply(utils.getText(lang, "dealsLoaded"));

    const generateEmbeds = async (page, totalP, currentMode) => {
        const chunk = top.slice(page * utils.ITEMS_PER_PAGE, (page + 1) * utils.ITEMS_PER_PAGE);
        if (currentMode !== "compact") {
            for (const d of chunk) { try { await api.enrichDealData(d); } catch(e) {} }
        }
        return chunk.map(d => utils.buildDealEmbed(d, currentMode, lang).setFooter({ text: `${utils.getText(lang, "page")} ${page + 1}/${totalP}` }));
    };
    await utils.handlePagination(msg, message.author.id, "deals", top, utils.ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestFreeGames(message, guildDoc, lang) {
    let msg = null;
    if (!api.cache.deals.data || api.cache.deals.expiresAt < Date.now()) {
        const estMs = (await db.getSystemTimes()).free || 10000;
        msg = await message.reply(utils.getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
        const startTime = Date.now();
        try {
            const rawDeals = await api.fetchDeals();
            api.cache.deals = { data: rawDeals, expiresAt: Date.now() + utils.GLOBAL_CACHE_TTL_MS };
            const sys = await db.getSystemTimes();
            sys.free = utils.smoothTime(estMs, Date.now() - startTime); await db.saveSystemTimes(sys);
        } catch (err) { return msg.edit(utils.formatUserError(err, "fetchDealsError", lang)).catch(() => null); }
    }

    const mode = guildDoc?.notificationMode || "detailed";
    
    // Extrage max 20 Steam și max 20 Epic
    const freeSteam = api.cache.deals.data
        .filter(deal => parseFloat(deal.salePrice) === 0 && deal.savings === 100 && deal.store === "Steam")
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, utils.MAX_FREE_PER_STORE);
        
    const freeEpic = api.cache.deals.data
        .filter(deal => parseFloat(deal.salePrice) === 0 && deal.savings === 100 && deal.store === "Epic Games")
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, utils.MAX_FREE_PER_STORE);
        
    const freeGames = [...freeSteam, ...freeEpic];

    freeGames.sort((a, b) => {
        if (a.store === "Steam" && b.store !== "Steam") return -1;
        if (a.store !== "Steam" && b.store === "Steam") return 1;
        return b.popularityScore - a.popularityScore;
    });
    
    if (!freeGames.length) return msg ? msg.edit(utils.getText(lang, "noFreeMatch")).catch(() => null) : message.reply(utils.getText(lang, "noFreeMatch"));
    if (msg) await msg.edit(utils.getText(lang, "freeLoaded")).catch(() => null);
    else msg = await message.reply(utils.getText(lang, "freeLoaded"));

    const generateEmbeds = async (page, totalP, currentMode) => {
        const chunk = freeGames.slice(page * utils.ITEMS_PER_PAGE, (page + 1) * utils.ITEMS_PER_PAGE);
        const embedsToReturn = [];
        const startIndex = page * utils.ITEMS_PER_PAGE;

        const firstSteamIdx = freeGames.findIndex(g => g.store === "Steam");
        const firstEpicIdx = freeGames.findIndex(g => g.store === "Epic Games");  

        if (currentMode !== "compact") {   
            for (const d of chunk) { try { await api.enrichDealData(d); } catch(e) {} }  
        }  

        for (let i = 0; i < chunk.length; i++) {  
            const globalIndex = startIndex + i;
            if (globalIndex === firstSteamIdx) {  
                embedsToReturn.push(new EmbedBuilder().setColor(0x1b2838).setTitle(utils.getText(lang, "separatorSteam")));
            }  
            if (globalIndex === firstEpicIdx) {  
                embedsToReturn.push(new EmbedBuilder().setColor(0x313131).setTitle(utils.getText(lang, "separatorEpic")));
            }  
            embedsToReturn.push(utils.buildDealEmbed(chunk[i], currentMode, lang).setFooter({ text: `${utils.getText(lang, "page")} ${page + 1}/${totalP}` }));  
        }  
        return embedsToReturn;
    };

    await utils.handlePagination(msg, message.author.id, "free", freeGames, utils.ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestSingle(message, gameText, guildDoc, lang) {
    if (!gameText) return message.reply(utils.getText(lang, "latestUpdateSyntax", { prefix: utils.PREFIX }));
    const estMs = (await db.getSystemTimes()).single || 2000;
    const loadingMsg = await message.reply(utils.getText(lang, "connecting", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();

    const { game, suggestion } = utils.findGameAndSuggestion(gameText);
    if (!game) {
        let errText = utils.getText(lang, "gameNotFound");
        if (suggestion) errText += utils.getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key });
        return loadingMsg.edit(errText).catch(() => null);
    }

    try {
        let latest;
        if (api.cache.single.has(game.key) && Date.now() < api.cache.single.get(game.key).expiresAt) {
            const cachedVal = api.cache.single.get(game.key);
            api.cache.single.delete(game.key);
            api.cache.single.set(game.key, cachedVal);
            latest = cachedVal.data;
        } else {
            const res = await api.executeFetchWithCircuitBreaker(game);
            if (res.error) throw new Error(res.error);
            latest = res.latest;
            api.cache.single.set(game.key, { data: latest, expiresAt: Date.now() + utils.CACHE_TTL_MS });
            const executionTimes = await db.getSystemTimes(); executionTimes.single = utils.smoothTime(estMs, Date.now() - startTime);
            await db.saveSystemTimes(executionTimes);
        }
        await loadingMsg.edit({ content: utils.getText(lang, "updateSuccess", { name: game.name }), embeds: [utils.buildUpdateEmbed(game.name, latest, guildDoc?.notificationMode || "detailed", lang)] }).catch(() => null);
    } catch (error) {
        await loadingMsg.edit(utils.formatUserError(error, "updateError", lang)).catch(() => null);
    }
}

async function handlePriceSearch(message, gameName, lang) {
    if (!gameName) return message.reply(utils.getText(lang, "priceSyntax", { prefix: utils.PREFIX }));
    const loadingMsg = await message.reply(utils.getText(lang, "searchingDualPrice", { name: gameName }));

    let steamData = null, steamAppId = null, steamEndDate = null;
    try {
        const steamItems = await api.searchSteamGameByName(gameName);
        if (steamItems && steamItems.length > 0) {
            const bestMatch = api.chooseBestSteamMatch(steamItems, gameName);
            if (bestMatch && bestMatch.id) {
                steamAppId = bestMatch.id;
                steamData = await api.fetchSteamPriceDetails(steamAppId);
                if (steamData && steamData.price_overview && steamData.price_overview.discount_percent > 0) {
                    steamEndDate = await api.extractSteamOfferEndDate(steamAppId);
                }
            }
        }
    } catch (e) { utils.logger("WARN", "PRICE_SEARCH", "Steam search/fetch failed", e.message); }

    let epicData = null;
    try { epicData = await api.searchEpicGameByName(gameName); } 
    catch (e) { utils.logger("WARN", "PRICE_SEARCH", "Epic Games search failed", e.message); }

    if (!steamData && !epicData) { return loadingMsg.edit(utils.getText(lang, "noDualResults", { name: gameName })).catch(() => null); }

    try {
        const embed = utils.buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, gameName, lang);
        await loadingMsg.edit({ content: utils.getText(lang, "priceDualSuccess"), embeds: [embed] }).catch(() => null);
    } catch (err) {
        utils.logger("ERROR", "PRICE_SEARCH", "Failed to build or send dual price embed", err.message);
        await loadingMsg.edit(utils.getText(lang, "priceUnexpectedError")).catch(() => null);
    }
}

async function handleDlcSearch(message, gameName, lang) {
    if (!gameName) return message.reply(utils.getText(lang, "dlcSyntax", { prefix: utils.PREFIX }));
    const loadingMsg = await message.reply(utils.getText(lang, "searchingDlc", { name: gameName }));

    try {
        let items;
        try { items = await api.searchSteamGameByName(gameName); } catch (e) { return loadingMsg.edit(utils.getText(lang, "steamError")).catch(() => null); }

        if (!items || items.length === 0) return loadingMsg.edit(utils.getText(lang, "noSteamResults", { name: gameName })).catch(() => null);
        let bestMatch = api.chooseBestSteamMatch(items, gameName);  
        if (!bestMatch || !bestMatch.id) return loadingMsg.edit(utils.getText(lang, "invalidSteamResult")).catch(() => null);
        if (String(bestMatch.type || "").toLowerCase() !== "game") {  
            const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
            if (baseGame) bestMatch = baseGame;  
        }  

        const cacheKey = bestMatch.id;  
        let dlcData;
        if (api.cache.dlc.has(cacheKey) && Date.now() < api.cache.dlc.get(cacheKey).expiresAt) {  
            const cachedVal = api.cache.dlc.get(cacheKey); api.cache.dlc.delete(cacheKey); api.cache.dlc.set(cacheKey, cachedVal);  
            dlcData = cachedVal.data;
        } else {  
            const title = bestMatch.name;  
            let gameDetails;  
            try { gameDetails = await api.fetchSteamPriceDetails(cacheKey); } catch (e) { utils.logger("WARN", "DLC_SEARCH", "Details fetch failed", e.message); }  

            const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;
            const htmlRes = await utils.httpReq('GET', `https://store.steampowered.com/app/${cacheKey}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" }, timeout: 15000 });  
            const $ = cheerio.load(htmlRes.data);
            if ($('#agegate_box').length > 0 || $('.agegate_text_container').length > 0 || htmlRes.request?.path?.includes('agecheck')) {  
                return loadingMsg.edit(utils.getText(lang, "ageGate", { name: title })).catch(() => null);
            }  

            const dlcList = [];  
            const seenDlcIds = new Set();
            $('.game_area_dlc_row').each((i, el) => {  
                const dlcName = $(el).find('.game_area_dlc_name').text().trim();  
                let dlcPrice = $(el).find('.game_area_dlc_price').text().trim();  
                const dlcAppId = $(el).attr('data-ds-appid');  

                let explicitLink = $(el).attr('href');  
                if (!explicitLink) { explicitLink = $(el).find('a').attr('href'); }  
                if (explicitLink) { explicitLink = new URL(explicitLink, "https://store.steampowered.com").href; }  

                dlcPrice = dlcPrice.replace(/\s+/g, ' ');  
                if (!dlcPrice || dlcPrice === "") dlcPrice = utils.getText(lang, "priceUnav");  

                if (dlcName && !seenDlcIds.has(dlcAppId || dlcName)) {   
                    seenDlcIds.add(dlcAppId || dlcName);   
                    let link = explicitLink;  
                    if (!link) { link = dlcAppId ? `https://store.steampowered.com/app/${dlcAppId}` : `https://store.steampowered.com/app/${cacheKey}`; }  
                    dlcList.push({ name: dlcName, price: dlcPrice, link });  
                }  
            });
            if (dlcList.length === 0) {  
                if ($('.game_area_purchase_game').length === 0) return loadingMsg.edit(utils.getText(lang, "pageStructureError", { name: title })).catch(() => null);
                return loadingMsg.edit(utils.getText(lang, "noDlcList", { name: title })).catch(() => null);  
            }  

            const totalExtracted = dlcList.length;
            dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, thumbUrl, totalExtracted };
            api.cache.dlc.set(cacheKey, { data: dlcData, expiresAt: Date.now() + utils.CACHE_TTL_MS });  
        }  

        const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } = dlcData;
        await loadingMsg.edit(utils.getText(lang, "dlcSuccess", { count: totalExtracted, name: title })).catch(() => null);  

        const itemsPerPage = 10;
        const generateEmbeds = async (page, totalP) => {  
            const chunk = dlcList.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
            const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(utils.getText(lang, "dlcPack", { title: title })).setURL(`https://store.steampowered.com/app/${finalAppId}`).setThumbnail(finalThumbUrl);  

            let desc = "";
            chunk.forEach((dlc, index) => {   
                const globalIndex = page * itemsPerPage + index + 1;   
                desc += `**${globalIndex}. ${utils.truncate(dlc.name, 100)}**\n💵 ${dlc.price}\n[${utils.getText(lang, "dlcBuyLink")}](${dlc.link})\n\n`;   
            });
            embed.setDescription(desc);  

            let footerText = `${utils.getText(lang, "page")} ${page + 1}/${totalP} • ${utils.getText(lang, "displayed")}: ${dlcList.length} / ${utils.getText(lang, "extracted")}: ${totalExtracted}`;
            if (totalExtracted >= 100) { footerText += `\n${utils.getText(lang, "dlcMoreNote")}`; }  
            embed.setFooter({ text: footerText });  

            return [embed];  
        };  

        await utils.handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcList, itemsPerPage, generateEmbeds, "detailed", lang);
    } catch (err) {
        utils.logger("ERROR", "DLC_SEARCH", "Fatal error", err.message);
        await loadingMsg.edit(utils.getText(lang, "dlcUnexpectedError")).catch(() => null);
    }
}

async function handleStatusCommand(message, gameText, lang) {
    if (!gameText) return message.reply(utils.getText(lang, "statusHelp", { prefix: utils.PREFIX }));
    const loadingMsg = await message.reply(utils.getText(lang, "connecting", { time: 5 }));
    
    const { game, suggestion } = utils.findGameAndSuggestion(gameText);
    const query = game ? game.name : gameText;

    let steamData = null, steamAppId = null, steamEndDate = null, epicData = null;
    try {
        const steamItems = await api.searchSteamGameByName(query);
        if (steamItems && steamItems.length > 0) {
            const bestMatch = api.chooseBestSteamMatch(steamItems, query);
            if (bestMatch && bestMatch.id) {
                steamAppId = bestMatch.id;
                steamData = await api.fetchSteamPriceDetails(steamAppId);
                if (steamData && steamData.price_overview && steamData.price_overview.discount_percent > 0) {
                    steamEndDate = await api.extractSteamOfferEndDate(steamAppId);
                }
            }
        }
    } catch (e) { }

    try { epicData = await api.searchEpicGameByName(query); } catch (e) { }

    let updateStr = utils.getText(lang, "statusNoUpdate");
    if (game) {
        try {
            let latest;
            if (api.cache.single.has(game.key) && Date.now() < api.cache.single.get(game.key).expiresAt) {
                latest = api.cache.single.get(game.key).data;
            } else {
                const res = await api.executeFetchWithCircuitBreaker(game);
                if (!res.error && res.latest) {
                    latest = res.latest;
                    api.cache.single.set(game.key, { data: latest, expiresAt: Date.now() + utils.CACHE_TTL_MS });
                }
            }
            if (latest) updateStr = `**${latest.title}**\n[${utils.getText(lang, "link")}](${latest.link})`;
        } catch (error) { }
    } else {
        updateStr += ` *(Jocul nu e în baza de date pentru updates. Caut doar prețurile)*`;
        if (suggestion) updateStr += `\n${utils.getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key })}`;
    }

    try {
        const embed = utils.buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, query, lang);
        embed.setTitle(utils.getText(lang, "statusTitle", { name: query }));
        embed.addFields({ name: "🆕 Latest Update", value: updateStr, inline: false });
        await loadingMsg.edit({ content: "✅ Status generat!", embeds: [embed] }).catch(() => null);
    } catch (err) {
        await loadingMsg.edit(utils.getText(lang, "priceUnexpectedError")).catch(() => null);
    }
}

// -------------------------------------------------------------
// INIT ȘI EVENT LISTENER
// -------------------------------------------------------------
let isRunningCron = false;
client.once("ready", () => {
    utils.logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);

    const runChecks = async () => {
        if (isRunningCron) return utils.logger("WARN", "CRON", "Jobul anterior încă rulează pe această instanță, sar peste ciclul actual.");
        isRunningCron = true;
        api.cleanCache();

        try {  
            const updLock = await db.acquireDbLock("global_updates_lock", 120000);  
            if (updLock) {  
                const hb1 = setInterval(() => db.renewDbLock("global_updates_lock", updLock, 120000).catch(()=>{}), 60000);  
                try { await checkForUpdates(); }   
                catch (err) { utils.logger("ERROR", "CRON_UPDATES", "Eroare loop updates", err.message); }   
                finally { clearInterval(hb1); await db.releaseDbLock("global_updates_lock", updLock); }  
            }  

            const discLock = await db.acquireDbLock("global_discounts_lock", 120000);  
            if (discLock) {  
                const hb2 = setInterval(() => db.renewDbLock("global_discounts_lock", discLock, 120000).catch(()=>{}), 60000);  
                try { await checkForDiscounts('all'); }   
                catch (err) { utils.logger("ERROR", "CRON_DISCOUNTS", "Eroare loop discounts", err.message); }   
                finally { clearInterval(hb2); await db.releaseDbLock("global_discounts_lock", discLock); }  
            }  
        } finally {  
            isRunningCron = false;  
        }
    };
    runChecks();
    const min = Number(utils.config.checkIntervalMinutes || 30);
    cron.schedule(min === 60 ? '0 * * * *' : `*/${min} * * * *`, runChecks);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.toLowerCase().startsWith(utils.PREFIX.toLowerCase())) return;

    const guildDoc = await db.GuildModel.findById(message.guild.id).lean();
    const lang = guildDoc?.language || "ro";

    const rawContent = message.content.slice(utils.PREFIX.length).trim();
    const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]"|'[^']')+/g) || [];
    const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ''));
    const command = (rawArgs.shift() || "").toLowerCase();
    const subCommand = (rawArgs[0] || "").toLowerCase();

    if (command === "ping") return message.reply(utils.getText(lang, "pong"));

    if (command === "games" || command === "porecle") {
        const lines = utils.config.games.map(g => {
            let item = `- **${g.name}** (\`${g.key}\`)`;   
            if (g.aliases && g.aliases.length > 0) item += ` [Alias: ${g.aliases.join(", ")}]`;
            return item;
        });
        let currentMsg = utils.getText(lang, "trackedGames");

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

    const joinedSub = rawArgs.join(" ").toLowerCase();
    if (command === "start") {
        if (joinedSub === "free" || joinedSub === "free games") return handleStart(message, "free", message.guild.id, lang);
        return handleStart(message, subCommand, message.guild.id, lang);
    }

    if (command === "stop") {
        if (joinedSub === "free" || joinedSub === "free games") return handleStop(message, "free", message.guild.id, lang);
        return handleStop(message, subCommand, message.guild.id, lang);
    }

    if (command === "set") return handleSetCommand(message, rawArgs, message.guild.id, lang);
    
    if (command === "latest") {
        if (subCommand === "updates") return handleLatestUpdates(message, guildDoc, lang);
        if (subCommand === "deals" || subCommand === "reduceri") return handleLatestDeals(message, guildDoc, lang);
        if (joinedSub === "free" || joinedSub === "free games") return handleLatestFreeGames(message, guildDoc, lang);
        if (subCommand === "price" || subCommand === "pret") return handlePriceSearch(message, rawArgs.slice(1).join(" "), lang);
        if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "), guildDoc, lang);
    }

    if (command === "dlc") return handleDlcSearch(message, rawArgs.join(" "), lang);
    if (command === "status") return handleStatusCommand(message, rawArgs.join(" "), lang);

    if (command === "help") {
        if (rawArgs.length > 0) {
            const cmdQuery = rawArgs.join("").toLowerCase();
            const helpKey = "helpCmd_" + cmdQuery.replace(/\s+/g, '_');
            let desc = utils.getText(lang, helpKey, { items: utils.ITEMS_PER_PAGE, prefix: utils.PREFIX });
            
            if (desc === helpKey) desc = utils.getText(lang, "helpCmdNotFound", { prefix: utils.PREFIX });
            const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(`${utils.getText(lang, "helpDetailedTitle")}: ${rawArgs.join(" ")}`).setDescription(desc);
            return message.reply({ embeds: [embed] });  
        }  

        const helpEmbed = new EmbedBuilder().setColor(0x2b2d31).setTitle(utils.getText(lang, "helpTitle"))  
            .addFields(  
                { name: utils.getText(lang, "helpGeneral"), value: utils.getText(lang, "helpGeneralCmds", { prefix: utils.PREFIX }) },  
                { name: utils.getText(lang, "helpNotif"), value: utils.getText(lang, "helpNotifCmds", { prefix: utils.PREFIX }) },  
                { name: utils.getText(lang, "helpPrefs"), value: utils.getText(lang, "helpPrefsCmds", { prefix: utils.PREFIX }) },  
                { name: utils.getText(lang, "helpManual"), value: utils.getText(lang, "helpManualCmds", { prefix: utils.PREFIX }) }  
            )  
            .setFooter({ text: utils.getText(lang, "helpFooter", { prefix: utils.PREFIX }) });  

        return message.reply({ embeds: [helpEmbed] });
    }
});

async function bootstrap() {
    if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) {
        utils.logger("ERROR", "BOOTSTRAP", "Lipsesc variabilele de mediu MONGO_URI sau DISCORD_TOKEN");
        return process.exit(1);
    }
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });
        await client.login(process.env.DISCORD_TOKEN);
    } catch (err) { process.exit(1); }
}

bootstrap();
