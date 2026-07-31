"use strict";

import type { ModerationOutcome } from "./moderationSanctionUseCase.js";

const PERMISSION_LABELS: Record<string, string> = {
  ModerateMembers: "Moderate Members",
  KickMembers: "Kick Members",
  BanMembers: "Ban Members"
};

const SANCTION_LABELS: Record<"timeout" | "mute", string> = { timeout: "timeout", mute: "mute" };

const LIFT_COMMANDS: Record<"timeout" | "mute", string> = { timeout: "remove-timeout", mute: "unmute" };

const UNAVAILABLE_ACTIONS: Record<"timeout" | "remove-timeout" | "kick" | "ban", string> = {
  timeout: "Eroare: Discord nu permite timeout pentru acest utilizator.",
  "remove-timeout": "Eroare: Discord nu permite eliminarea sanctiunii.",
  kick: "Eroare: kick indisponibil.",
  ban: "Eroare: ban indisponibil."
};

const AUTO_BAN_SUFFIX: Record<"not-reached" | "applied" | "failed", string> = {
  "not-reached": "",
  applied: " Utilizatorul a fost banat automat dupa atingerea limitei.",
  failed: " Avertismentul a fost salvat, dar auto-ban-ul a esuat si necesita interventie administrativa."
};

export function moderationOutcomeMessage(outcome: ModerationOutcome, subject: string): string {
  switch (outcome.kind) {
    case "invalid-reason":
      return outcome.message;
    case "invalid-limit":
      return "Eroare: limita trebuie sa fie un numar intreg pozitiv.";
    case "limit-changed":
      return `OK: limita de warn-uri a fost schimbata: ${outcome.previous} -> ${outcome.limit}.`;
    case "user-required":
      return "Eroare: trebuie sa selectezi un utilizator.";
    case "unban-unavailable":
      return "Eroare: botul nu poate debana utilizatori.";
    case "unbanned":
      return `OK: ${subject} a fost debanat.`;
    case "target-unavailable":
      return "Eroare: utilizatorul nu poate fi sanctionat din cauza ierarhiei, a tipului de cont sau a absentei pe server.";
    case "invalid-duration":
      return "Eroare: durata trebuie sa fie intre 1s si 28d (exemplu: 30m, 2h, 1d).";
    case "bot-missing-permission":
      return `Eroare: botul nu are permisiunea ${PERMISSION_LABELS[outcome.permission] ?? outcome.permission}.`;
    case "discord-action-unavailable":
      return UNAVAILABLE_ACTIONS[outcome.action];
    case "sanctioned":
      return `OK: ${subject} a primit ${SANCTION_LABELS[outcome.command]} pana <t:${Math.floor(outcome.expiresAt.getTime() / 1000)}:F>.`;
    case "conflicting-sanctions":
      return "Eroare: persistenta contine simultan timeout si mute pentru acest utilizator. Ruleaza reconcilierea inainte de eliminare.";
    case "wrong-sanction-type":
      return `Eroare: utilizatorul are ${SANCTION_LABELS[outcome.has]}, nu ${SANCTION_LABELS[outcome.asked]}. Foloseste \`/${LIFT_COMMANDS[outcome.has]}\`.`;
    case "no-active-sanction":
      return `Nu exista un ${SANCTION_LABELS[outcome.asked]} activ pentru ${subject}.`;
    case "sanction-removed":
      return `OK: sanctiunea a fost eliminata pentru ${subject}.`;
    case "member-removed":
      return `OK: ${subject} a fost ${outcome.command === "kick" ? "eliminat" : "banat"}.`;
    case "warn-removed":
      return `OK: ${subject} are ${outcome.remaining} warn(uri) ramase.`;
    case "no-warnings":
      return "Utilizatorul nu are warn-uri active.";
    case "warn-needs-evidence":
      return "Eroare: warn-ul necesita motiv text sau un atasament direct.";
    case "warn-channel-required":
      return "Eroare: selecteaza optiunea `canal` pentru a configura canalul dedicat de warn.";
    case "warn-channel-missing-permissions":
      return `Eroare: canalul selectat nu poate primi warn-uri. Lipsesc: ${outcome.missing.join(", ")}.`;
    case "warn-channel-without-id":
      return "Eroare: canalul selectat nu are un ID valid.";
    case "warn-channel-unavailable":
      return "Eroare: canalul de warn nu mai este disponibil.";
    case "warn-orphaned":
      return `Atentie: warn-ul pentru ${subject} a fost salvat, dar mesajul pe canal nu a putut fi livrat si compensarea a esuat. Inregistrarea ramane si necesita interventie manuala (\`/remove-warn\`).`;
    case "warned":
      return `OK: ${subject} a primit warn-ul #${outcome.count}.${AUTO_BAN_SUFFIX[outcome.autoBan]}`;
    case "unknown-command":
      return "Eroare: comanda de moderare nu este recunoscuta.";
  }
}
