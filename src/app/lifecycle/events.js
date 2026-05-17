"use strict";

function registerDiscordEvents({
  client, logger, commands, env, adminAlert, requestContext,
  games, crypto, errorMessage, errorDetail, startHousekeeping, scheduleNextCron
}) {
  client.once("ready", async () => {
    const userTag = client.user?.tag || "unknown";
    logger("INFO", "DISCORD", `Conectat ca ${userTag}`);
    try {
      await commands.registerSlashCommands(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID);
    } catch (err) {
      logger("ERROR", "DISCORD", "Esec inregistrare slash commands", errorMessage(err));
      adminAlert("slash:register-failed", "Slash commands nu au putut fi inregistrate", errorMessage(err)).catch(() => null);
    }
    startHousekeeping();
    scheduleNextCron();
  });

  client.on("interactionCreate", async (interaction) => {
    const reqId = crypto.randomBytes(6).toString("hex");
    await requestContext.run({ requestId: reqId }, async () => {
      try { await commands.handleInteraction(interaction, games); }
      catch (err) {
        logger("ERROR", "INTERACTION", "Eroare top-level la interactionCreate", errorDetail(err));
      }
    });
  });

  client.on("error", (err) => logger("ERROR", "DISCORD", "Eroare client Discord", errorMessage(err)));
  client.on("warn", (msg) => logger("WARN", "DISCORD", msg));
  client.on("shardError", (err) => logger("ERROR", "DISCORD", "Shard error", errorMessage(err)));
}

function registerMongoEvents({ mongoose, logger, errorMessage }) {
  mongoose.connection.on("connected", () => logger("INFO", "DB", "Conectat la MongoDB"));
  mongoose.connection.on("disconnected", () => logger("WARN", "DB", "Deconectat de la MongoDB"));
  mongoose.connection.on("error", (err) => logger("ERROR", "DB", "Eroare MongoDB", errorMessage(err)));
  mongoose.connection.on("reconnected", () => logger("INFO", "DB", "Reconectat la MongoDB"));
}

module.exports = { registerDiscordEvents, registerMongoEvents };
