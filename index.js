const http = require("http");
const cron = require("node-cron");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");

const db = require("./database");
const utils = require("./utils");
const api = require("./api");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

http.createServer((req, res) => { res.writeHead(200); res.end("OK\n"); }).listen(process.env.PORT || 3000);

let isShuttingDown = false;
const gracefulShutdown = async () => {
    if (isShuttingDown) return; isShuttingDown = true;
    for (const [jobName, token] of db.activeLocks.entries()) await db.releaseDbLock(jobName, token);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy(); process.exit(0);
};
process.on("SIGTERM", gracefulShutdown); process.on("SIGINT", gracefulShutdown);

async function checkForUpdates() {
    const guilds = await db.GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
    if (!guilds.length) return;
    const results = (await api.getLatestForAllGames()).filter(r => r.latest !== null);
    for (const guild of guilds) {
        try {
            const channel = await client.channels.fetch(guild.notificationChannelId);
            if (!utils.canSendEmbeds(channel, client.user.id)) continue;
            let payload = {}, sentCount = 0;
            if (!guild.seen) guild.seen = {};
            for (const { game, latest } of results) {
                const seenIds = Array.isArray(guild.seen[game.key]) ? [...guild.seen[game.key]] : [];
                if (!seenIds.includes(latest.id) && sentCount < 5) {
                    await channel.send({ content: utils.getText(guild.language || "ro", "notifiedUpdate", { name: game.name }), embeds: [utils.buildUpdateEmbed(game.name, latest, guild.notificationMode, guild.language || "ro")] });
                    sentCount++; seenIds.push(latest.id); if (seenIds.length > 20) seenIds.shift();
                    guild.seen[game.key] = seenIds; payload[`seen.${game.key}`] = seenIds;
                    await db.GuildModel.updateOne({ _id: guild._id }, { $set: payload });
                }
            }
        } catch (e) {}
    }
}

async function handleStatusCommand(message, gameText, lang) {
    if (!gameText) return message.reply(utils.getText(lang, "statusHelp", { prefix: utils.PREFIX }));
    const loadingMsg = await message.reply(utils.getText(lang, "connecting", { time: 5 }));
    const { game, suggestion } = api.findGameAndSuggestion(gameText);
    const query = game ? game.name : gameText;

    let steamData = null, steamAppId = null, steamEndDate = null, epicData = null;
    try {
        const items = await api.searchSteamGameByName(query);
        if (items.length) { steamAppId = api.chooseBestSteamMatch(items, query).id; steamData = await api.fetchSteamPriceDetails(steamAppId); steamEndDate = await api.extractSteamOfferEndDate(steamAppId); }
        epicData = await api.searchEpicGameByName(query);
    } catch (e) {}

    let updateStr = utils.getText(lang, "statusNoUpdate");
    if (game) {
        try { const res = await api.executeFetchWithCircuitBreaker(game); if (res.latest) updateStr = `**${res.latest.title}**\n[${utils.getText(lang, "link")}](${res.latest.link})`; } catch (e) {}
    } else { updateStr += ` *(Doar preț)*`; if (suggestion) updateStr += `\n${utils.getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key })}`; }

    try {
        const embed = utils.buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, query, lang);
        embed.setTitle(utils.getText(lang, "statusTitle", { name: query })).addFields({ name: "🆕 Latest Update", value: updateStr, inline: false });
        await loadingMsg.edit({ content: "✅ Status generat!", embeds: [embed] });
    } catch (e) { await loadingMsg.edit(utils.getText(lang, "priceUnexpectedError")); }
}

let isRunningCron = false;
client.once("ready", () => {
    utils.logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);
    const min = Number(utils.config.checkIntervalMinutes || 30);
    cron.schedule(`*/${min} * * * *`, async () => {
        if (isRunningCron) return; isRunningCron = true; api.cleanCache();
        const updLock = await db.acquireDbLock("global_updates_lock", 120000);
        if (updLock) { try { await checkForUpdates(); } finally { await db.releaseDbLock("global_updates_lock", updLock); } }
        isRunningCron = false;
    });
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.toLowerCase().startsWith(utils.PREFIX.toLowerCase())) return;

    const guildDoc = await db.GuildModel.findById(message.guild.id).lean();
    const lang = guildDoc?.language || "ro";
    const args = message.content.slice(utils.PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === "ping") return message.reply(utils.getText(lang, "pong"));
    if (command === "status") return handleStatusCommand(message, args.join(" "), lang);
    if (command === "start" && args[0] === "updates" && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await db.GuildModel.updateOne({ _id: message.guild.id }, { $set: { subscribed: true, notificationChannelId: message.channel.id } }, { upsert: true });
        return message.reply(utils.getText(lang, "updatesActive"));
    }
});

async function bootstrap() {
    await mongoose.connect(process.env.MONGO_URI);
    await client.login(process.env.DISCORD_TOKEN);
}
bootstrap();
