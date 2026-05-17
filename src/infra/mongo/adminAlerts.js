"use strict";

module.exports = (ctx) => {
  const { env, AdminAlertCooldownModel, axios, logger } = ctx;

const ADMIN_ALERT_COOLDOWN_MS = env.ADMIN_ALERT_COOLDOWN_MS;

async function adminAlert(kind, title, body) {
  const url = env.ADMIN_WEBHOOK_URL;
  if (!url) return;
  const now = new Date();
  const cooldownThreshold = new Date(now.getTime() - ADMIN_ALERT_COOLDOWN_MS);

  // Atomic check-and-set: doar dacă lastSentAt e mai vechi decât pragul
  // sau dacă nu există documentul, putem trimite. Două instanțe care rulează
  // simultan vor concura aici și doar una va câștiga.
  let allowed = false;
  try {
    const result = await AdminAlertCooldownModel.findOneAndUpdate(
      { _id: kind, lastSentAt: { $lte: cooldownThreshold } },
      { $set: { lastSentAt: now } },
      { new: false }
    );
    if (result) {
      // Am updatat un doc existent în afara cooldown-ului → noi suntem câștigătorul
      allowed = true;
    } else {
      // Fie nu există documentul, fie cooldown-ul e încă activ.
      // Încercăm insert (unic pe _id); dacă cineva a inserat în paralel,
      // primim duplicate key error și știm că suntem în cooldown.
      try {
        await AdminAlertCooldownModel.create({ _id: kind, lastSentAt: now });
        allowed = true;
      } catch (err) {
        if (err.code === 11000) {
          allowed = false; // alt proces a câștigat
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    logger("WARN", "ADMIN_ALERT", "Eroare la cooldown DB, sar alerta", err.message);
    return;
  }

  if (!allowed) return;

  const payload = {
    embeds: [{
      title: `\u26A0\uFE0F ${title}`,
      description: String(body || "").slice(0, 3500),
      color: 0xe74c3c,
      timestamp: now.toISOString(),
      footer: { text: `kind=${kind}` }
    }]
  };
  try {
    await axios.post(url, payload, { timeout: 5000 });
    logger("INFO", "ADMIN_ALERT", `Alertă trimisă: ${kind} - ${title}`);
  } catch (err) {
    logger("WARN", "ADMIN_ALERT", "Nu am putut trimite webhook admin", err.message);
  }
}

  Object.assign(ctx, { adminAlert });
};
