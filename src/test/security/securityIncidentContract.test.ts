import test from "node:test";
import assert from "node:assert/strict";

import {
  SECURITY_INCIDENT_VERSION,
  dedupeIncidents,
  orderIncidents,
  securityIncident,
  severityRank,
  toLogEntry
} from "../../features/command-security/securityIncidentContract.js";
import {
  projectAdAttempts,
  projectAdRequest,
  projectAuditEntry,
  projectPermissionRequest,
  projectRaidIncident
} from "../../features/command-security/securityIncidentProjection.js";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

test("fiecare depozit se proiecteaza in acelasi contract versionat (F-44)", () => {
  const incidents = [
    projectAuditEntry({ userId: "mod-1", action: "warn", serverId: "g1", details: "spam", at: new Date(NOW) }),
    projectRaidIncident({
      _id: "raid-1", guildId: "g1", stage: "containment", startedAt: new Date(NOW), confirmedAt: null,
      resolvedAt: null, lastActivityAt: new Date(NOW), triggerReason: "mesaje identice", manual: false,
      dryRun: false, participants: [], lockedChannels: [], pendingActions: [], errors: [],
      raidWebhookIds: [], restoreProgress: 0
    }),
    projectPermissionRequest({
      _id: "req-1", guildId: "g1", type: "bot-add", requesterId: "u1", target: "bot-1", action: "add",
      reason: "integrare", status: "approved", requestedAt: new Date(NOW), respondedAt: new Date(NOW), ownerId: "owner-1"
    }),
    projectAdRequest({
      _id: "ad-1", guildId: "g1", requesterId: "u2", adText: "reclama", fingerprint: "f", link: null,
      invite: null, attachmentUrl: null, target: null, status: "approved",
      requestedAt: new Date(NOW), respondedAt: new Date(NOW), ownerId: "owner-1", usedAt: null, expiresAt: new Date(NOW + 3_600_000)
    }),
    ...projectAdAttempts({
      _id: "g1:u3", guildId: "g1", userId: "u3", strikes: 1, totalDeleted: 1, totalWarns: 0,
      lastAttemptAt: new Date(NOW), lastChannelId: "c1",
      history: [{ at: new Date(NOW), channelId: "c1", summary: "reclama blocata", warned: false }]
    })
  ];

  for (const incident of incidents) {
    assert.equal(incident.version, SECURITY_INCIDENT_VERSION, "orice incident poarta versiunea contractului");
    assert.ok(incident.incidentId.length > 0, "fara incidentId nu exista dedup global");
    assert.ok(incident.module.length > 0);
    assert.ok(incident.result.length > 0, "fiecare incident spune ce s-a intamplat, nu doar ca s-a intamplat");
    assert.ok(["info", "warning", "critical"].includes(incident.severity));
  }

  assert.deepEqual(
    [...new Set(incidents.map(incident => incident.module))].sort(),
    ["ad-protection", "anti-raid", "audit", "moderation-guard"],
    "modulele sunt cele care produc incidentele, nu numele depozitelor"
  );
});

test("aprobarea ramane legata de incidentul ei prin approvalId (F-44)", () => {
  const incident = projectPermissionRequest({
    _id: "req-9", guildId: "g1", type: "webhook", requesterId: "u1", target: "chan-1", action: "create",
    reason: "integrare RSS", status: "approved", requestedAt: new Date(NOW), respondedAt: new Date(NOW), ownerId: "owner-1"
  });

  assert.equal(incident.approvalId, "req-9");
  assert.equal(incident.target, "chan-1");
  assert.match(toLogEntry(incident).summary, /aprobare req-9/, "legatura aprobare-incident trebuie sa fie vizibila in cronologie");
});

test("acelasi incident venit de doua ori apare o singura data, cu varianta cea mai noua (F-44)", () => {
  const early = securityIncident({
    incidentId: "raid-1", module: "anti-raid", source: "raid", at: new Date(NOW - 1000),
    result: "incident activ in etapa confirmed", severity: "critical"
  });
  const late = securityIncident({
    incidentId: "raid-1", module: "anti-raid", source: "raid", at: new Date(NOW),
    result: "incident inchis", severity: "warning"
  });

  const deduped = dedupeIncidents([early, late]);

  assert.equal(deduped.length, 1, "fara dedup global, acelasi incident apare de mai multe ori in cronologie");
  assert.equal(deduped[0].result, "incident inchis");
});

test("cronologia unificata e ordonata descrescator peste toate modulele (F-44)", () => {
  const ordered = orderIncidents([
    securityIncident({ incidentId: "a", module: "audit", source: "audit", at: new Date(NOW - 5000), result: "vechi", severity: "info" }),
    securityIncident({ incidentId: "b", module: "anti-raid", source: "raid", at: new Date(NOW), result: "nou", severity: "critical" }),
    securityIncident({ incidentId: "c", module: "ad-protection", source: "ad", at: new Date(NOW - 1000), result: "mijloc", severity: "warning" })
  ]);

  assert.deepEqual(ordered.map(incident => incident.result), ["nou", "mijloc", "vechi"]);
});

test("dovezile sunt redactate in contract, nu la afisare (F-44)", () => {
  const incident = securityIncident({
    incidentId: "x", module: "audit", source: "audit", at: new Date(NOW),
    result: "inregistrat", severity: "info",
    evidence: "a scris https://evil.example/x si a mentionat 123456789012345678"
  });

  assert.match(incident.evidence, /\[link redactat\]/);
  assert.doesNotMatch(incident.evidence, /123456789012345678/);
});

test("severitatea are o ordine verificabila, nu doar nume (F-44)", () => {
  assert.ok(severityRank("critical") > severityRank("warning"));
  assert.ok(severityRank("warning") > severityRank("info"));
});

test("in /security-log o reclama nestearsa nu e raportata ca stearsa (review PR #969)", () => {
  const [incident] = projectAdAttempts({
    _id: "g1:u3", guildId: "g1", userId: "u3", strikes: 1, totalDeleted: 0, totalWarns: 0,
    lastAttemptAt: new Date(NOW), lastChannelId: "c1",
    history: [{ at: new Date(NOW), channelId: "c1", summary: "reclama blocata", warned: false, deleted: false }]
  });

  assert.match(incident.result, /NU a putut fi stearsa/, "cronologia repeta exact inconsistenta pe care o repara PR-ul");
  assert.equal(incident.severity, "warning", "un mesaj ramas vizibil nu e o simpla informare");
});

test("intrarile vechi, fara marcajul de stergere, raman raportate ca sterse (review PR #969)", () => {
  const [incident] = projectAdAttempts({
    _id: "g1:u4", guildId: "g1", userId: "u4", strikes: 1, totalDeleted: 1, totalWarns: 0,
    lastAttemptAt: new Date(NOW), lastChannelId: "c1",
    history: [{ at: new Date(NOW), channelId: "c1", summary: "reclama blocata", warned: false }]
  });

  assert.equal(incident.result, "reclama stearsa", "istoricul dinaintea campului nou nu trebuie reinterpretat ca esec");
});
