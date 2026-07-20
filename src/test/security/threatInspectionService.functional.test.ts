import test from "node:test";
import assert from "node:assert/strict";

import { createThreatInspectionService, reputationEngineConfigured, describeResponseCompleteness, passiveDocumentIndicators } from "../../features/command-security/threatInspectionService.js";
import { hasObfuscatedPdfActionName, inspectCompoundFileBinary } from "../../features/command-security/passiveArchiveInspection.js";
import { isRecentAccount, recentAccountCutoff } from "../../features/command-security/recentAccountPolicy.js";

function storedZip(entries: Array<{ name: string; data: Buffer; declaredSize?: number }>): Buffer {
  return Buffer.concat(entries.map(({ name, data, declaredSize }) => {
    const encodedName = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(declaredSize ?? data.length, 22);
    header.writeUInt16LE(encodedName.length, 26);
    return Buffer.concat([header, encodedName, data]);
  }));
}

function compoundFile(entries: Array<{ name: string; type: number }>): Buffer {
  const sectorSize = 512;
  const buffer = Buffer.alloc(512 + sectorSize * 2, 0);
  buffer.writeUInt32BE(0xd0cf11e0, 0);
  buffer.writeUInt32BE(0xa1b11ae1, 4);
  buffer.writeUInt16LE(9, 30);
  buffer.writeUInt16LE(6, 32);
  buffer.writeUInt32LE(1, 44);
  buffer.writeUInt32LE(1, 48);
  buffer.writeUInt32LE(0, 76);
  for (let i = 1; i < 109; i++) buffer.writeUInt32LE(0xffffffff, 76 + i * 4);
  const fatBase = 512;
  for (let i = 0; i < 128; i++) buffer.writeUInt32LE(0xffffffff, fatBase + i * 4);
  buffer.writeUInt32LE(0xfffffffd, fatBase);
  buffer.writeUInt32LE(0xfffffffe, fatBase + 4);
  const dirBase = 1024;
  entries.slice(0, 4).forEach((entry, index) => {
    const entryOffset = dirBase + index * 128;
    const nameBuffer = Buffer.from(entry.name, "utf16le");
    nameBuffer.copy(buffer, entryOffset);
    buffer.writeUInt16LE(nameBuffer.length + 2, entryOffset + 64);
    buffer.writeUInt8(entry.type, entryOffset + 66);
  });
  return buffer;
}

test("inspectCompoundFileBinary: parser structural CFB detecteaza macro VBA in document OLE (ce scanarea latin1 pierde)", () => {
  const withMacros = compoundFile([{ name: "Root Entry", type: 5 }, { name: "Macros", type: 1 }, { name: "WordDocument", type: 2 }]);
  assert.deepEqual(inspectCompoundFileBinary(withMacros), ["macro VBA in document OLE (parser structural CFB)"]);
});

test("inspectCompoundFileBinary: detecteaza obiect OLE incorporat si nu escaladeaza documente OLE curate", () => {
  const withObject = compoundFile([{ name: "Root Entry", type: 5 }, { name: "ObjectPool", type: 1 }]);
  assert.deepEqual(inspectCompoundFileBinary(withObject), ["obiect OLE incorporat in document OLE (parser structural CFB)"]);

  const clean = compoundFile([{ name: "Root Entry", type: 5 }, { name: "WordDocument", type: 2 }, { name: "1Table", type: 2 }]);
  assert.deepEqual(inspectCompoundFileBinary(clean), [], "documentul OLE curat nu primeste indicatori (fara escaladare doar dupa extensie)");

  assert.deepEqual(inspectCompoundFileBinary(Buffer.from("nu e CFB")), [], "buffer non-CFB -> fara indicatori");
});

test("passiveDocumentIndicators: ruteaza documentele OLE prin parserul structural CFB", () => {
  const doc = compoundFile([{ name: "Root Entry", type: 5 }, { name: "_VBA_PROJECT", type: 2 }]);
  assert.ok(
    passiveDocumentIndicators(doc).includes("macro VBA in document OLE (parser structural CFB)"),
    "un .doc OLE cu _VBA_PROJECT e prins structural, nu doar prin scanarea latin1 a primului MiB (unde numele UTF-16 nu se potrivesc)"
  );
});

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

test("ZIP curat este inspectat pasiv si ramane neconfirmat pana la verdictul extern", async () => {
  const zip = storedZip([{ name: "document.txt", data: Buffer.from("continut curat") }]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: zip, headers: { "content-type": "application/zip" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/clean.zip", []);
  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /inspectata pasiv fara indicatori/);
});

test("ZIP Office cu macro si ZIP imbricat cu executabil expun indicatorii fara verdict malware euristic", async () => {
  const nested = storedZip([{ name: "payload.exe", data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]) }]);
  const zip = storedZip([
    { name: "word/vbaProject.bin", data: Buffer.from("macro") },
    { name: "nested.zip", data: nested }
  ]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: zip, headers: { "content-type": "application/zip" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/nested.zip", []);
  assert.equal(result.verdict, "risky-file");
  assert.match(result.reason, /macro sau script Office intern/);
  assert.match(result.reason, /executabil/);
  assert.notEqual(result.verdict, "confirmed");
});

test("ZIP Office cu obiect OLE incorporat (embeddings/oleObject) expune indicatorul, dar ramane uncertain (audit #1, 154)", async () => {
  const zip = storedZip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/embeddings/oleObject1.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }
  ]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: zip, headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/doc.docx", []);
  assert.match(result.reason, /obiect OLE incorporat/, "obiectul OLE incorporat este semnalat structural dupa cale");
  assert.equal(result.verdict, "uncertain", "obiectul OLE e semnalat, dar nu escaladeaza fara confirmare externa");
  assert.notEqual(result.verdict, "confirmed");
});

test("ZIP cu raport de compresie declarat peste limita se opreste sigur si ramane uncertain", async () => {
  const zip = storedZip([{ name: "huge.txt", data: Buffer.from("x"), declaredSize: 10_000_000 }]);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: zip, headers: { "content-type": "application/zip" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/bomb.zip", []);
  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /limita|raportul maxim/);
});

test("verdicturile externe phishing, frauda si exploit confirma amenintarea fara a expune resursa", async () => {
  for (const verdict of ["phishing", "fraud", "exploit"] as const) {
    const inspector = createThreatInspectionService({
      httpReq: async () => ({ data: Buffer.from("pagina"), headers: { "content-type": "text/html" }, status: 200 }),
      reputationScan: async () => verdict
    });
    const result = await inspector.inspectMessage("https://example.test/resource", []);
    assert.equal(result.verdict, "confirmed");
    assert.doesNotMatch(result.reason, /example\.test/);
  }
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

test("atasamentele cu risc declarat au prioritate fata de linkuri cand plafonul e atins (audit conformitate, #25)", async () => {
  const httpCalls: string[] = [];
  const inspector = createThreatInspectionService({
    maxResources: 2,
    httpReq: async (_method, url) => {
      httpCalls.push(url);
      return { data: Buffer.from("ok"), headers: { "content-type": "text/plain" }, status: 200 };
    }
  });

  await inspector.inspectMessage(
    "https://example.test/first https://example.test/second",
    [{ id: "a", name: "installer", url: "https://cdn.example.test/installer", contentType: "application/x-msdownload" }]
  );

  assert.equal(httpCalls[0], "https://cdn.example.test/installer");
  assert.equal(httpCalls.length, 2);
});

test("describeResponseCompleteness: Content-Range cu total > primit => incomplet; total == primit => complet (audit, #7)", () => {
  assert.deepEqual(describeResponseCompleteness(206, { "content-range": "bytes 0-1048575/5242880" }, 1048576, 1048576), { complete: false, totalLength: 5242880 });
  assert.deepEqual(describeResponseCompleteness(206, { "content-range": "bytes 0-999/1000" }, 1000, 1048576), { complete: true, totalLength: 1000 });
});

test("describeResponseCompleteness: 200 cu Content-Length foloseste totalul; 206 fara total ramane incomplet (audit, #7)", () => {
  assert.deepEqual(describeResponseCompleteness(200, { "content-length": "500" }, 500, 1048576), { complete: true, totalLength: 500 });
  assert.deepEqual(describeResponseCompleteness(200, { "content-length": "9000000" }, 1048576, 1048576), { complete: false, totalLength: 9000000 });
  assert.deepEqual(describeResponseCompleteness(206, {}, 1048576, 1048576), { complete: false, totalLength: null });
});

test("describeResponseCompleteness: 200 fara antete e complet doar daca nu s-a atins plafonul (audit, #7)", () => {
  assert.deepEqual(describeResponseCompleteness(200, {}, 4, 1048576), { complete: true, totalLength: null });
  assert.deepEqual(describeResponseCompleteness(200, {}, 1048576, 1048576), { complete: false, totalLength: null });
});

test("verdict extern periculos pe un fragment partial NU escaladeaza la confirmed (audit, #7)", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream", "content-range": "bytes 0-3/5242880" },
      status: 206
    }),
    reputationScan: async () => "malware"
  });
  const result = await inspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/big" }]);
  assert.notEqual(result.verdict, "confirmed", "un fragment nu poate fi confirmat pe baza motorului extern");
  assert.equal(result.verdict, "risky-file", "ramane la verdictul de tip de fisier, nu escaladeaza si nu coboara");
});

test("un fisier altfel sigur descarcat doar partial devine uncertain, nu safe (audit, #7)", async () => {
  const big = Buffer.alloc(1048576, 0x20);
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: big,
      headers: { "content-type": "text/plain", "content-range": "bytes 0-1048575/4000000" },
      status: 206
    })
  });
  const result = await inspector.inspectMessage("https://example.test/large.txt", []);
  assert.equal(result.verdict, "uncertain", "o resursa peste limita de inspectie nu poate fi declarata sigura");
  assert.match(result.reason, /doar primul fragment/);
});

test("verdict extern periculos pe obiectul complet ramane confirmed (audit, #7)", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream", "content-length": "4" },
      status: 200
    }),
    reputationScan: async () => "malware"
  });
  const result = await inspector.inspectMessage("", [{ id: "a", name: "installer", url: "https://cdn.example.test/small" }]);
  assert.equal(result.verdict, "confirmed", "un obiect complet confirmat de motorul extern ramane confirmed");
});

test("passiveDocumentIndicators detecteaza structuri PDF/Office periculoase suplimentare (audit, #5)", () => {
  assert.deepEqual(passiveDocumentIndicators(Buffer.from("%PDF-1.7 << /OpenAction << /Launch (calc.exe) >> >>")), [
    "indicator de script/actiune automata in document",
    "indicator de lansare de proces sau continut incorporat"
  ]);
  assert.ok(passiveDocumentIndicators(Buffer.from("%PDF-1.7 /EmbeddedFile foo")).includes("indicator de lansare de proces sau continut incorporat"));
  assert.ok(passiveDocumentIndicators(Buffer.from("%PDF-1.7 /RichMedia annot")).includes("indicator de lansare de proces sau continut incorporat"));
  assert.ok(passiveDocumentIndicators(Buffer.from("catalog /AA << >>")).includes("indicator de script/actiune automata in document"));
  assert.ok(passiveDocumentIndicators(Buffer.from("field DDEAUTO c:\\windows\\system32")).includes("indicator de camp DDE (executie externa)"));
  assert.ok(passiveDocumentIndicators(Buffer.from("form /XFA data")).includes("formular XFA cu potential de script"));
  assert.ok(passiveDocumentIndicators(Buffer.from("stream _VBA_PROJECT here")).includes("indicator de macro VBA"));
});

test("passiveDocumentIndicators nu semnaleaza un document curat (audit, #5)", () => {
  assert.deepEqual(passiveDocumentIndicators(Buffer.from("%PDF-1.7 continut simplu de text fara actiuni")), []);
});

test("passiveDocumentIndicators detecteaza actiuni PDF ofuscate prin escape-uri hex de nume (audit #1)", () => {
  assert.ok(
    passiveDocumentIndicators(Buffer.from("%PDF-1.7 << /J#61vaScript (x) >>")).includes("indicator de script/actiune automata in document"),
    "numele PDF ofuscat /J#61vaScript se decodeaza in /JavaScript si e semnalat, desi scanarea directa de bytes nu l-ar prinde"
  );
  assert.ok(
    passiveDocumentIndicators(Buffer.from("%PDF-1.7 << /OpenAct#69on << >> >>")).includes("indicator de script/actiune automata in document")
  );
  assert.deepEqual(
    passiveDocumentIndicators(Buffer.from("%PDF-1.7 << /Titl#65 (doc) >>")),
    [],
    "un nume hex care se decodeaza intr-un token benign (/Title) nu produce fals-pozitiv"
  );
});

test("hasObfuscatedPdfActionName decodeaza numai numele cu escape-uri hex periculoase (audit #1)", () => {
  assert.equal(hasObfuscatedPdfActionName("/J#61vaScript"), true, "/J#61vaScript -> /JavaScript");
  assert.equal(hasObfuscatedPdfActionName("/Launc#68"), true, "/Launc#68 -> /Launch");
  assert.equal(hasObfuscatedPdfActionName("/JavaScript"), false, "numele neofuscat e deja prins de regex-urile existente, nu de acest helper");
  assert.equal(hasObfuscatedPdfActionName("/Titl#65 /Auth#6Fr"), false, "numele hex benigne nu declanseaza");
});

test("un PDF cu /Launch e semnalat structural dar ramane uncertain, nu se sterge (audit, #5)", async () => {
  const pdf = Buffer.from("%PDF-1.7\n<< /OpenAction << /Launch (cmd.exe) >> >>");
  const inspector = createThreatInspectionService({
    httpReq: async () => ({ data: pdf, headers: { "content-type": "application/pdf" }, status: 200 })
  });
  const result = await inspector.inspectMessage("https://example.test/doc.pdf", []);
  assert.equal(result.verdict, "uncertain", "documentul cu lansare de proces ramane uncertain, nu se sterge fara confirmare");
  assert.match(result.reason, /lansare de proces/);
});
