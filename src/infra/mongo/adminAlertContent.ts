"use strict";

export type AdminAlertSeverity = "fatal" | "warning" | "info";

export interface AdminAlertGuidance {
  severity: AdminAlertSeverity;
  meaning: string;
  action: string;
}

const EXACT_GUIDANCE: Record<string, AdminAlertGuidance> = {
  "boot:fatal": {
    severity: "fatal",
    meaning: "Botul nu a putut porni (eroare fatala in bootstrap) si procesul a iesit non-zero.",
    action: "Verifica log-urile de pornire si variabilele de mediu (MONGO_URI, DISCORD_TOKEN, DISCORD_CLIENT_ID). Orchestratorul ar trebui sa reporneasca procesul; daca intra in crash-loop, cauza e persistenta. Vezi OPERATIONS.md."
  },
  "boot:migrations": {
    severity: "warning",
    meaning: "Migrari DB au esuat la boot, dar botul a pornit oricum (MIGRATIONS_CONTINUE_ON_ERROR=true).",
    action: "Schema poate fi inconsistenta (risc de notificari duplicate). Remediaza datele/migrarea, apoi scoate MIGRATIONS_CONTINUE_ON_ERROR ca sa revii la fail-fast. Vezi OPERATIONS.md - 'Migrari DB la boot'."
  },
  "boot:housekeeping": {
    severity: "warning",
    meaning: "Job-ul de housekeeping (curatare periodica) nu a pornit.",
    action: "Curatarea de baza ramane pe indexurile TTL, dar verifica log-urile [HOUSEKEEPING] si reporneste daca persista."
  },
  "boot:cron": {
    severity: "fatal",
    meaning: "Cron-ul de fetch nu a putut fi programat — botul nu va mai cauta update-uri/reduceri.",
    action: "Verifica configuratia cron si log-urile de pornire, apoi reporneste botul."
  },
  "boot:outbox": {
    severity: "warning",
    meaning: "Worker-ul outbox nu a pornit — notificarile din coada nu se vor drena.",
    action: "Verifica NOTIFICATION_OUTBOX_ENABLED si log-urile [OUTBOX]; reporneste. Vezi OPERATIONS.md - sectiunile de outbox."
  },
  "http:listen": {
    severity: "warning",
    meaning: "Serverul HTTP de health/metrics nu a putut asculta (probabil portul e ocupat).",
    action: "Verifica portul de health (env PORT, implicit 3000) si daca alt proces il foloseste deja; health/metrics raman indisponibile pana la remediere."
  },
  "slash:register-failed": {
    severity: "warning",
    meaning: "Inregistrarea slash command-urilor a esuat — comenzile pot lipsi in Discord.",
    action: "Verifica DISCORD_TOKEN / DISCORD_CLIENT_ID si permisiunile aplicatiei (scope applications.commands), apoi reporneste."
  },
  "cron:lock": {
    severity: "info",
    meaning: "Botul nu a obtinut lock-ul cron — alta instanta ruleaza deja ciclul.",
    action: "Normal intr-un setup multi-instanta. Daca rulezi o singura instanta si persista, verifica un lock ramas in colectia joblocks. Vezi OPERATIONS.md."
  },
  "cron:fatal": {
    severity: "warning",
    meaning: "Un ciclu cron a esuat complet (nu doar o sursa).",
    action: "Verifica reteaua si log-urile [CRON]; daca persista pe mai multe cicluri, sursele sau Mongo pot fi indisponibile."
  },
  "outbox:recovery-read": {
    severity: "warning",
    meaning: "Recovery-verify nu a putut citi istoricul canalului (lipseste probabil Read Message History).",
    action: "Acorda botului permisiunea Read Message History pe canalele de notificari sau dezactiveaza recovery-verify. Vezi OPERATIONS.md - 'bot_outbox_recovery_verify_failures'."
  },
  "outbox:mark-sent": {
    severity: "warning",
    meaning: "Un mesaj a fost trimis dar nu a putut fi marcat in istoricul de dedup (risc de re-trimitere).",
    action: "Verifica conectivitatea Mongo si conditiile de scriere. Vezi OPERATIONS.md - 'bot_outbox_mark_sent_failures'."
  }
};

const FAMILY_GUIDANCE: Record<string, AdminAlertGuidance> = {
  drift: {
    severity: "warning",
    meaning: "O sursa raspunde HTTP OK dar intoarce 0 rezultate valide mai multe cicluri la rand — probabil s-a schimbat HTML-ul/API-ul (schema drift).",
    action: "Verifica selectorii CSS / endpoint-ul sursei pentru jocul din titlu. Ruleaza canary:sources ca sa confirmi. Sursa intra in cooldown automat. Vezi OPERATIONS.md - 'Canary surse'."
  },
  cb: {
    severity: "warning",
    meaning: "Circuit breaker activat — o sursa a esuat repetat si a fost pusa in cooldown.",
    action: "Verifica daca site-ul sursa e down sau a blocat/limitat botul; revine automat dupa cooldown. Daca persista, sursa poate necesita un proxy sau un adaptor nou."
  },
  process: {
    severity: "warning",
    meaning: "Eveniment de proces neasteptat (semnal sau exceptie/respingere neprinsa).",
    action: "Verifica log-urile; la uncaughtException/unhandledRejection investigheaza stack-ul. La SIGTERM/SIGINT e o oprire controlata (deploy/restart), nu necesita actiune."
  },
  feedback: {
    severity: "info",
    meaning: "Un utilizator a trimis un raport prin comanda /report.",
    action: "Citeste raportul; daca semnaleaza sursa stricata / joc lipsa / duplicat, investigheaza sursa sau filtrul respectiv. Istoricul rapoartelor are TTL ~90 zile."
  }
};

const DEFAULT_GUIDANCE: AdminAlertGuidance = {
  severity: "warning",
  meaning: "Alerta de sistem.",
  action: "Verifica log-urile pentru detalii si contextul evenimentului."
};

const SEVERITY_META: Record<AdminAlertSeverity, { color: number; emoji: string; label: string }> = {
  fatal: { color: 0xe74c3c, emoji: "⛔", label: "FATAL" },
  warning: { color: 0xe67e22, emoji: "⚠️", label: "WARNING" },
  info: { color: 0x3498db, emoji: "ℹ️", label: "INFO" }
};

export function alertKindFamily(kind: string): string {
  const separatorIndex = kind.indexOf(":");
  return separatorIndex === -1 ? kind : kind.slice(0, separatorIndex);
}

export function getAlertGuidance(kind: string): AdminAlertGuidance {
  if (EXACT_GUIDANCE[kind]) return EXACT_GUIDANCE[kind];
  const familyGuidance = FAMILY_GUIDANCE[alertKindFamily(kind)];
  return familyGuidance || DEFAULT_GUIDANCE;
}

export interface AdminAlertEmbedField {
  name: string;
  value: string;
}

export interface AdminAlertEmbedPayload {
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    timestamp: string;
    fields: AdminAlertEmbedField[];
    footer: { text: string };
  }>;
}

export function buildAdminAlertEmbed(kind: string, title: string, body: unknown, now: Date): AdminAlertEmbedPayload {
  const guidance = getAlertGuidance(kind);
  const meta = SEVERITY_META[guidance.severity];
  const cause = String(body ?? "").slice(0, 1024) || "(fara detalii)";
  return {
    embeds: [{
      title: `${meta.emoji} [${meta.label}] ${title}`.slice(0, 256),
      description: `**Cauza:**\n${cause}`.slice(0, 4096),
      color: meta.color,
      timestamp: now.toISOString(),
      fields: [
        { name: "Ce inseamna", value: guidance.meaning.slice(0, 1024) },
        { name: "Ce trebuie facut", value: guidance.action.slice(0, 1024) }
      ],
      footer: { text: `kind=${kind} - severity=${guidance.severity}` }
    }]
  };
}
