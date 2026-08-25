"use strict";

import type { ChannelLockOutcome } from "../command-security/channelLockUseCase.js";
import type { PurgeOutcome } from "../command-security/purgeMessagesUseCase.js";
import type { SetSecurityChannelOutcome } from "../command-security/setSecurityChannelUseCase.js";
import type { ToggleProtectionOutcome } from "../command-security/toggleProtectionUseCase.js";

export function renderSetChannelOutcome(outcome: SetSecurityChannelOutcome, formatError: (error: unknown) => string): string | null {
  if (outcome.kind === "invalid-channel") return "Eroare: trebuie selectat un canal valid.";
  if (outcome.kind === "missing-permissions") {
    return `Eroare: botul are nevoie de ${outcome.missing.join(", ")} in canalul selectat.`;
  }
  if (outcome.kind === "save-failed") return formatError(outcome.error);
  return `OK: setarea **${outcome.field}** a fost actualizata.`;
}

export function renderToggleProtectionOutcome(outcome: ToggleProtectionOutcome): string | null {
  if (outcome.kind === "unknown-subcommand") return null;
  if (outcome.kind === "channel-not-set") return "Eroare: seteaza mai intai canalul de alerta cu `/set`.";
  if (outcome.kind === "channel-missing-permissions") {
    return "Eroare: canalul configurat nu mai are permisiunile View Channel, Send Messages si Embed Links.";
  }
  if (outcome.kind === "not-ready") {
    return `Eroare: protectia nu poate porni - lipsesc: ${outcome.missing.join(", ")}. Acorda-le botului si reincearca.`;
  }
  if (outcome.kind === "owner-only") {
    return `Eroare: doar proprietarul serverului poate opri **${outcome.subcommand}**.`;
  }
  if (outcome.kind === "confirmation-required") {
    return `Eroare: oprirea protectiei **${outcome.subcommand}** cere \`confirm:true\`. Serverul ramane neprotejat dupa oprire, iar un incident in curs nu se mai finalizeaza automat.`;
  }
  if (outcome.kind === "stop-refused") {
    return `Eroare: ${outcome.reason}`;
  }
  if (outcome.kind === "atomic-stop-failed") {
    return `Eroare: protectia **${outcome.subcommand}** NU a fost oprita, deoarece anularea atomica a aprobarilor active a esuat. Starea anterioara a ramas activa.`;
  }
  if (outcome.kind === "stopped-with-cancellations") {
    const base = `OK: protectia **${outcome.subcommand}** a fost oprita. Solicitari/aprobari active anulate: ${outcome.cancelled}.`;
    return outcome.note ? `${base} ${outcome.note}` : base;
  }
  if (outcome.kind === "started-with-backfill") {
    const unconfirmedNote = outcome.result.sentUnconfirmed > 0
      ? ` ${outcome.result.sentUnconfirmed} au fost trimise si marcate neconfirmate in baza de date (starea protectoare e persistata, deci nu se retrimit).`
      : "";
    const undeterminedNote = outcome.result.undetermined > 0
      ? ` ${outcome.result.undetermined} au fost trimise, dar starea NU a putut fi persistata deloc (nedeterminata): claim-ul ramane blocat, nu se retrimit, si sunt reconciliate automat la urmatoarea pornire.`
      : "";
    return `OK: protectia **${outcome.subcommand}** a fost pornita. Au fost verificate conturile existente si trimise ${outcome.result.delivered} alerte confirmate.${unconfirmedNote}${undeterminedNote}`;
  }
  const status = `OK: protectia **${outcome.subcommand}** a fost ${outcome.command === "start" ? "pornita" : "oprita"}.`;
  return outcome.degraded ? `${status}
${outcome.degraded}` : status;
}

export function renderChannelLockOutcome(
  outcome: ChannelLockOutcome,
  context: { channelId: string; formatError: (error: unknown) => string }
): string {
  if (outcome.kind === "channel-not-editable") return "Eroare: canalul selectat nu permite modificarea permisiunilor.";
  if (outcome.kind === "permissions-unreadable") {
    return "Eroare: permisiunile efective ale botului nu pot fi verificate pentru canalul selectat.";
  }
  if (outcome.kind === "missing-permissions") {
    return `Eroare: botul nu are permisiunile efective necesare in acel canal pentru blocare/deblocare: ${outcome.missing.join(", ")}. Acorda-le si reincearca.`;
  }
  if (outcome.kind === "channel-cannot-receive-notice") {
    return "Eroare: canalul selectat nu poate primi mesajul obligatoriu de blocare.";
  }
  if (outcome.kind === "not-locked") return "Eroare: canalul nu este blocat de bot.";
  if (outcome.kind === "already-locked") return "Eroare: canalul este deja blocat de bot.";
  if (outcome.kind === "invalid-reason") return outcome.message;
  if (outcome.kind === "reason-required") return "Eroare: blocarea necesita motiv text sau un atasament direct.";
  if (outcome.kind === "previous-state-unknown") return "Eroare: starea anterioara a permisiunii nu este disponibila.";
  if (outcome.kind === "notice-failed") {
    return `Atentie: blocarea a esuat la trimiterea mesajului si compensarea a fost partiala (persistenta: ${outcome.persistenceReverted ? "revenita" : "ESUATA"}, permisiune Discord: ${outcome.discordReverted ? "revenita" : "ESUATA"}). Canalul necesita verificare manuala.`;
  }
  if (outcome.kind === "failed") return context.formatError(outcome.error);
  if (outcome.kind === "applied") {
    return outcome.command === "lock-channel"
      ? `OK: canalul a fost blocat${outcome.reason ? ` (motiv: ${outcome.reason})` : ""}.`
      : "OK: canalul a fost deblocat.";
  }
  return renderDivergedLock(outcome, context.channelId);
}

function renderDivergedLock(outcome: Extract<ChannelLockOutcome, { kind: "diverged" }>, channelId: string): string {
  const recoveryNote = outcome.recoveryScheduled
    ? " Divergenta a fost inregistrata pentru recovery automat: un worker idempotent reincearca restaurarea si o inchide doar dupa ce Discord si baza de date converg (nu suprascrie o schimbare legitima facuta intre timp)."
    : " Divergenta NU a putut fi inregistrata pentru recovery automat, deci necesita interventie manuala.";
  const locking = outcome.command === "lock-channel";
  const discordStateLabel = locking ? "blocat (SendMessages=deny)" : "deblocat";
  return `Atentie: ${locking ? "blocarea" : "deblocarea"} canalului <#${channelId}> a modificat permisiunea in Discord, dar persistenta a esuat, iar revenirea permisiunii a esuat si dupa reincercare. Stare divergenta: Discord = ${discordStateLabel}, persistenta = NESALVATA. Restaureaza manual SendMessages la \`${outcome.previous}\` pentru acel canal.${recoveryNote}`;
}

export function renderPurgeOutcome(outcome: PurgeOutcome, formatError: (error: unknown) => string): string {
  if (outcome.kind === "invalid-amount") {
    return `Eroare: numarul de mesaje trebuie sa fie intre ${outcome.min} si ${outcome.max}.`;
  }
  if (outcome.kind === "channel-not-purgeable") return "Eroare: canalul curent nu permite stergerea mesajelor.";
  if (outcome.kind === "missing-permissions") {
    return `Eroare: botul nu are permisiunile efective necesare in acest canal pentru stergerea in masa: ${outcome.missing.join(", ")}. Acorda-le si reincearca.`;
  }
  if (outcome.kind === "purge-failed") return formatError(outcome.error);
  return `OK: au fost sterse ${outcome.deleted} mesaje. Discord nu permite stergerea in masa a mesajelor mai vechi de 14 zile; ${outcome.skipped} mesaje au fost omise sau nu mai existau.`;
}
