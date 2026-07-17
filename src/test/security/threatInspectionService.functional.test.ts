import test from "node:test";
import assert from "node:assert/strict";

import { createThreatInspectionService, reputationEngineConfigured } from "../../features/command-security/threatInspectionService.js";
import { isRecentAccount, recentAccountCutoff } from "../../features/command-security/recentAccountPolicy.js";

test("politica de cont nou foloseste exact trei luni calendaristice", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  assert.equal(recentAccountCutoff(now).toISOString(), "2026-04-30T12:00:00.000Z");
  assert.equal(isRecentAccount(new Date("2026-04-30T12:00:00.000Z").getTime(), now), true);
  assert.equal(isRecentAccount(new Date("2026-04-30T11:59:59.999Z").getTime(), now), false);
});

test("inspectia detecteaza executabilele prin continut ca tip riscant, NU ca malware confirmat", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });

  const result = await inspector.inspectMessage("", [{
    id: "attachment-1",
    name: "document",
    url: "https://cdn.example.test/resource"
  }]);

  assert.equal(result.verdict, "risky-file", "tipul de fisier e confirmat prin semnatura, dar intentia malware nu — nu e verdict confirmed");
  assert.match(result.reason, /executabil|script/);
});

test("@everyone si invitatiile Discord sunt incalcari de politica, nu amenintari informatice confirmate", async () => {
  const inspector = createThreatInspectionService({});

  const mention = await inspector.inspectMessage("@everyone salut", []);
  const invite = await inspector.inspectMessage("intra pe https://discord.gg/abcdef", []);

  assert.equal(mention.verdict, "policy-violation");
  assert.match(mention.reason, /politica de protectie/);
  assert.equal(invite.verdict, "policy-violation");
  assert.match(invite.reason, /invitatie Discord/);
});

test("inspectia recunoaste semnatura 7z si pastreaza documentele neconfirmate", async () => {
  const responses = [
    {
      data: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
      headers: { "content-type": "application/x-7z-compressed" },
      status: 200
    },
    {
      data: Buffer.from("%PDF-1.7"),
      headers: { "content-type": "application/pdf" },
      status: 200
    }
  ];
  const inspector = createThreatInspectionService({
    httpReq: async () => responses.shift() ?? { status: 404 }
  });

  const archive = await inspector.inspectMessage("https://example.test/archive", []);
  const document = await inspector.inspectMessage("https://example.test/document", []);

  assert.equal(archive.verdict, "uncertain");
  assert.equal(document.verdict, "uncertain");
});

test("analiza mesajului NU se opreste la prima incalcare de politica: toate resursele sunt inspectate, verdictul final e cel mai sever (raport post-#705, #3)", async () => {
  let fetches = 0;
  const inspector = createThreatInspectionService({
    httpReq: async () => {
      fetches++;
      return {
        data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
        headers: { "content-type": "application/octet-stream" },
        status: 200
      };
    }
  });

  const result = await inspector.inspectMessage("@everyone uite fisierul https://cdn.example.test/tool", []);

  assert.equal(fetches, 1, "linkul din mesaj e inspectat desi exista o incalcare de politica");
  assert.equal(result.verdict, "risky-file", "verdictul final e cel mai sever (fisier riscant > incalcare de politica)");
  assert.match(result.reason, /mentionare in masa/, "motivul incalcarii de politica e pastrat");
  assert.match(result.reason, /executabil|script/, "motivul fisierului riscant e pastrat");
  assert.deepEqual(result.detectedVerdicts, ["risky-file", "policy-violation"], "toate categoriile detectate sunt expuse, ordonate dupa severitate");
});

test("doua incalcari de politica in acelasi mesaj pastreaza ambele motive", async () => {
  const inspector = createThreatInspectionService({});

  const result = await inspector.inspectMessage("@everyone intrati pe https://discord.gg/abcdef", []);

  assert.equal(result.verdict, "policy-violation");
  assert.match(result.reason, /mentionare in masa/);
  assert.match(result.reason, /invitatie Discord/);
});

test("o resursa care nu poate fi verificata ramane uncertain, nu este declarata periculoasa", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => {
      throw new Error("network unavailable");
    }
  });

  const result = await inspector.inspectMessage("https://example.test/file", []);

  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /nu a putut fi inspectata/);
});

test("verdictul confirmed NU e produs de euristici fara un motor de reputatie configurat (raport post-#705, #2)", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });
  assert.equal(reputationEngineConfigured({}), false, "fara reputationScan, motorul de reputatie NU e configurat");

  const result = await inspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/file" }]);

  assert.equal(result.verdict, "risky-file", "cel mai sever verdict al euristicilor ramane risky-file, NU confirmed");
  assert.notEqual(result.verdict, "confirmed", "malware confirmat necesita un serviciu extern; nu se produce din semnaturi");
});

test("cu un motor de reputatie configurat care raporteaza malware, verdictul escaladeaza la confirmed (raport post-#705, #2)", async () => {
  const scanInputs: Array<{ kind: string; mime: string }> = [];
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    }),
    reputationScan: async input => {
      scanInputs.push({ kind: input.kind, mime: input.mime });
      return "malware";
    }
  });
  assert.equal(reputationEngineConfigured({ reputationScan: async () => "clean" }), true);

  const result = await inspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/file" }]);

  assert.equal(result.verdict, "confirmed", "motorul de reputatie ridica verdictul la malware confirmat");
  assert.match(result.reason, /motorul extern de reputatie/);
  assert.equal(scanInputs[0].kind, "executable", "motorul primeste tipul de fisier detectat");
});

test("un motor de reputatie care raporteaza clean/unknown NU escaladeaza; erorile lui nu strica verdictul de baza", async () => {
  const cleanInspector = createThreatInspectionService({
    httpReq: async () => ({ data: Buffer.from([0x4d, 0x5a]), headers: { "content-type": "application/octet-stream" }, status: 200 }),
    reputationScan: async () => "clean"
  });
  const clean = await cleanInspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/file" }]);
  assert.equal(clean.verdict, "risky-file", "clean pastreaza verdictul de tip de fisier, nu il coboara sub risky-file");

  const throwingInspector = createThreatInspectionService({
    httpReq: async () => ({ data: Buffer.from([0x4d, 0x5a]), headers: { "content-type": "application/octet-stream" }, status: 200 }),
    reputationScan: async () => { throw new Error("reputation service down"); }
  });
  const resilient = await throwingInspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/file" }]);
  assert.equal(resilient.verdict, "risky-file", "un motor de reputatie cazut nu degradeaza verdictul euristic");
});

test("analiza pasiva de documente: un OLE/Office cu indicator de macro VBA ramane uncertain, nu risky/dangerous, si semnaleaza macro (audit, #20)", async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("...vbaProject.bin...")]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: ole, headers: { "content-type": "application/vnd.ms-excel" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/report.xls", []);
  assert.equal(result.verdict, "uncertain", "documentul cu macro ramane uncertain (nu se sterge fara confirmare)");
  assert.match(result.reason, /macro VBA/);
});

test("analiza pasiva PDF: un PDF cu /JavaScript e semnalat ca script/actiune automata, dar ramane uncertain (audit, #20)", async () => {
  const pdf = Buffer.from("%PDF-1.7\n<< /OpenAction << /JavaScript (app.alert) >> >>");
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: pdf, headers: { "content-type": "application/pdf" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/doc.pdf", []);
  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /script\/actiune automata/);
});

test("arhiva criptata ramane unknown/uncertain, NU dangerous automat (audit, #20)", async () => {
  const encryptedZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x01, 0x00, 0x08, 0x00]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: encryptedZip, headers: { "content-type": "application/zip" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/secret.zip", []);
  assert.equal(result.verdict, "uncertain", "arhiva criptata nu e declarata periculoasa");
  assert.match(result.reason, /arhiva criptata/);
});

test("un atasament e trimis O SINGURA DATA la motorul extern de reputatie, chiar daca URL-ul apare si in continut (audit, #22)", async () => {
  const scanCalls: string[] = [];
  const httpCalls: string[] = [];
  const sharedUrl = "https://cdn.example.test/installer";
  const inspector = createThreatInspectionService({
    httpReq: async (_method, url) => { httpCalls.push(url); return { data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), headers: { "content-type": "application/octet-stream" }, status: 200 }; },
    reputationScan: async input => { scanCalls.push(input.url ?? ""); return "clean"; }
  });

  await inspector.inspectMessage(sharedUrl, [{ id: "a", name: "installer", url: sharedUrl }]);

  assert.equal(scanCalls.length, 1, "acelasi URL, prezent si ca link si ca atasament, e scanat o singura data la motorul extern");
  assert.equal(httpCalls.filter(url => url === sharedUrl).length, 1, "resursa partajata e descarcata o singura data");
});

test("un atasament cu continut sigur dar MIME riscant nu dubleaza apelul la motorul de reputatie (audit, #22)", async () => {
  const scanCalls: number[] = [];
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: Buffer.from("text inofensiv"), headers: { "content-type": "text/plain" }, status: 200 }),
    reputationScan: async () => { scanCalls.push(1); return "clean"; }
  });

  await inspector.inspectMessage("", [{ id: "a", name: "setup.exe", url: "https://cdn.example.test/setup", contentType: "application/x-msdownload" }]);

  assert.equal(scanCalls.length, 1, "un singur apel de reputatie per atasament, nu unul pentru continut si altul pentru MIME");
});

test("plafon TOTAL de resurse pe mesaj: linkuri + atasamente sunt limitate impreuna, iar surplusul devine uncertain (audit, #23)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const httpCalls: string[] = [];
  const inspector = createThreatInspectionService({
    maxResources: 3,
    httpReq: async (_method, url) => {
      httpCalls.push(url);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { data: Buffer.from("ok"), headers: { "content-type": "text/plain" }, status: 200 };
    }
  });

  const content = "https://example.test/a https://example.test/b https://example.test/c https://example.test/d https://example.test/e";
  const result = await inspector.inspectMessage(content, []);

  assert.equal(httpCalls.length, 3, "doar primele 3 resurse (plafonul total) sunt inspectate, nu toate 5");
  assert.ok(maxInFlight <= 2, "concurenta ramane strict sub plafon");
  assert.equal(result.verdict, "uncertain", "surplusul neinspectat produce un verdict uncertain, nu e ignorat tacit");
  assert.match(result.reason, /2 resurse suplimentare nu au fost inspectate/);
});
