import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_FUZZY_LENGTH,
  NEAR_IDENTICAL_MAX_DISTANCE,
  fingerprintDistance,
  fingerprintFor,
  nearIdentical
} from "../../features/command-security/antiRaidFingerprint.js";
import { MAX_CLUSTER_SCAN, createRaidDetector, normalizeMessageText, signalsFromMessage } from "../../features/command-security/antiRaidDetection.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS } from "../../features/command-security/antiRaidThresholds.js";

import type { RaidDetectionVerdict } from "../../features/command-security/antiRaidDetection.js";

function print(text: string): string {
  return fingerprintFor(normalizeMessageText(text));
}

test("un mesaj cu cateva caractere schimbate ramane aproape identic (F-35)", () => {
  const original = print("intra pe serverul meu acum, avem cele mai bune reduceri la jocuri");
  const varied = print("intra pe serverul meu acuma, avem cele mai bune reduceri la jocuri");

  assert.equal(nearIdentical(original, varied), true, "variatia de cateva caractere ocolea pragul cand se cerea egalitate exacta");
});

test("un cuvant schimbat intr-un mesaj lung nu scapa de prag (F-35)", () => {
  const original = print("cumpara skinuri ieftine de pe site-ul nostru, livrare instant si garantie completa");
  const varied = print("cumpara skinuri ieftine de pe site-ul vostru, livrare instant si garantie completa");

  assert.equal(nearIdentical(original, varied), true);
});

test("doua mesaje diferite NU sunt tratate ca aproape identice (F-35)", () => {
  const first = print("salut tuturor, cine mai joaca diseara ceva cooperativ pe steam");
  const second = print("am terminat de instalat driverele si acum merge mult mai bine placa video");

  assert.equal(nearIdentical(first, second), false, "protectia impotriva falsurilor pozitive: conversatia obisnuita nu declanseaza pragul");
});

test("distanta e marginita si simetrica, deci pragul e verificabil (F-35)", () => {
  const first = print("intra pe serverul meu acum, avem cele mai bune reduceri la jocuri");
  const second = print("salut tuturor, cine mai joaca diseara ceva cooperativ pe steam");

  const distance = fingerprintDistance(first, second);
  assert.ok(distance !== null && distance > NEAR_IDENTICAL_MAX_DISTANCE);
  assert.equal(fingerprintDistance(second, first), distance, "distanta Hamming e simetrica");
});

test("mesajele scurte raman pe egalitate exacta, ca sa nu se ciocneasca intre ele (F-35)", () => {
  const yes = print("da");
  const no = print("nu");

  assert.ok(yes.startsWith("exact:"), `sub ${MIN_FUZZY_LENGTH} caractere se pastreaza potrivirea exacta`);
  assert.equal(nearIdentical(yes, no), false, "doua raspunsuri scurte diferite nu au voie sa se grupeze");
  assert.equal(nearIdentical(yes, print("DA")), true, "normalizarea face acelasi mesaj scurt sa se potriveasca");
});

test("amprenta e marginita ca lucru, indiferent de lungimea mesajului (F-35)", () => {
  const long = "reclama ".repeat(5000);

  const started = Date.now();
  const fingerprint = print(long);
  const elapsed = Date.now() - started;

  assert.ok(fingerprint.length < 40, "amprenta ramane compacta, nu creste cu mesajul");
  assert.ok(elapsed < 100, `calculul amprentei trebuie sa ramana ieftin, a durat ${elapsed}ms`);
});

test("pragul e calibrat pe o separare masurata, nu ales la intamplare (F-35)", () => {
  const nearPairs: ReadonlyArray<readonly [string, string]> = [
    ["intra pe serverul meu acum, avem cele mai bune reduceri la jocuri", "intra pe serverul meu acuma, avem cele mai bune reduceri la jocuri"],
    ["cumpara skinuri ieftine de pe site-ul nostru, livrare instant si garantie", "cumpara skinuri ieftine de pe site-ul vostru, livrare instant si garantie"]
  ];
  const farPairs: ReadonlyArray<readonly [string, string]> = [
    ["salut tuturor, cine mai joaca diseara ceva cooperativ pe steam", "am terminat de instalat driverele si acum merge mult mai bine placa video"],
    ["intra pe serverul meu acum, avem cele mai bune reduceri la jocuri", "salut tuturor, cine mai joaca diseara ceva cooperativ pe steam"]
  ];

  const near = nearPairs.map(([left, right]) => fingerprintDistance(print(left), print(right)) ?? Number.NaN);
  const far = farPairs.map(([left, right]) => fingerprintDistance(print(left), print(right)) ?? Number.NaN);

  const worstNear = Math.max(...near);
  const bestFar = Math.min(...far);

  assert.ok(worstNear <= NEAR_IDENTICAL_MAX_DISTANCE, `variantele apropiate raman sub prag (max ${worstNear})`);
  assert.ok(bestFar > NEAR_IDENTICAL_MAX_DISTANCE, `mesajele diferite raman peste prag (min ${bestFar})`);
  assert.ok(
    bestFar - worstNear >= 8,
    `pragul are nevoie de o marja reala intre cele doua clase; masurat: apropiate<=${worstNear}, diferite>=${bestFar}`
  );
});

test("detectorul prinde trei variante usor diferite ale aceluiasi mesaj (F-35)", () => {
  const detector = createRaidDetector({ thresholds: DEFAULT_ANTI_RAID_THRESHOLDS });
  const variants = [
    "intra pe serverul meu acum, avem cele mai bune reduceri la jocuri",
    "intra pe serverul meu acuma, avem cele mai bune reduceri la jocuri",
    "intra pe serverul meu acum!, avem cele mai bune reduceri la jocurii"
  ];

  const verdicts: RaidDetectionVerdict[] = variants.map((content, index) => detector.observeAll(
    signalsFromMessage({ actorId: "u1", bot: false, channelId: "c1", content, at: index * 100, mentionCount: 0, attachmentCount: 0 }),
    index * 100
  ));
  const verdict = verdicts[verdicts.length - 1];

  assert.equal(verdict.triggered, true, "atacatorul varia cateva caractere si ocolea pragul de mesaje identice");
  assert.ok(verdict.kinds.includes("identical"));
});

test("detectorul NU declanseaza pe o conversatie obisnuita cu mesaje diferite (F-35)", () => {
  const detector = createRaidDetector({ thresholds: DEFAULT_ANTI_RAID_THRESHOLDS });
  const messages = [
    "salut tuturor, cine mai joaca diseara ceva cooperativ pe steam",
    "am terminat de instalat driverele si acum merge mult mai bine placa video",
    "daca vrea cineva sa testam modul nou de maine seara, sa imi spuna"
  ];

  const verdicts: RaidDetectionVerdict[] = messages.map((content, index) => detector.observeAll(
    signalsFromMessage({ actorId: "u1", bot: false, channelId: "c1", content, at: index * 100, mentionCount: 0, attachmentCount: 0 }),
    index * 100
  ));
  const verdict = verdicts[verdicts.length - 1];

  assert.equal(verdict.triggered, false, "protectia impotriva falsurilor pozitive trebuie sa tina la nivel de detector, nu doar de amprenta");
});

test("un mesaj scurt de patru cuvinte se grupeaza tot fuzzy (review PR #955)", () => {
  const variants = ["cumpara skinuri ieftine acum", "cumpara skinuri ieftine acuma", "cumpara skinuri ieftine acumm"];
  const prints = variants.map(print);

  for (let index = 1; index < prints.length; index += 1) {
    const distance = fingerprintDistance(prints[0], prints[index]);
    assert.ok(
      distance !== null && distance <= NEAR_IDENTICAL_MAX_DISTANCE,
      `amprenta pe cuvinte facea ca un mesaj de patru cuvinte sa sara peste prag; distanta masurata: ${distance}`
    );
  }
});

test("detectorul prinde trei variante ale unui mesaj scurt (review PR #955)", () => {
  const detector = createRaidDetector({ thresholds: DEFAULT_ANTI_RAID_THRESHOLDS });
  const variants = ["cumpara skinuri ieftine acum", "cumpara skinuri ieftine acuma", "cumpara skinuri ieftine acumm"];

  const verdicts: RaidDetectionVerdict[] = variants.map((content, index) => detector.observeAll(
    signalsFromMessage({ actorId: "u1", bot: false, channelId: "c1", content, at: index * 100, mentionCount: 0, attachmentCount: 0 }),
    index * 100
  ));

  assert.equal(verdicts[verdicts.length - 1].triggered, true);
});

test("gruparea nu scaneaza toata fereastra, ci o coada marginita (review PR #955)", () => {
  const detector = createRaidDetector({ thresholds: DEFAULT_ANTI_RAID_THRESHOLDS });
  const repeated = "cumpara skinuri ieftine de pe site-ul nostru cu livrare instant";
  const total = MAX_CLUSTER_SCAN * 3;

  let last: RaidDetectionVerdict | null = null;
  for (let index = 0; index < total; index += 1) {
    last = detector.observeAll(
      signalsFromMessage({ actorId: "u1", bot: false, channelId: "c1", content: repeated, at: index, mentionCount: 0, attachmentCount: 0 }),
      index
    );
  }

  assert.equal(last?.triggered, true, "mesajele repetate trebuie sa declanseze");
  assert.equal(
    detector.size() >= total,
    true,
    "fereastra chiar contine toate semnalele, deci limita de scanare nu vine din curatarea ferestrei"
  );
});

test("cu mii de amprente distincte evaluarea ramane sub o limita clara (review PR #955)", () => {
  const detector = createRaidDetector({ thresholds: DEFAULT_ANTI_RAID_THRESHOLDS });
  for (let index = 0; index < 1500; index += 1) {
    detector.observeAll(
      signalsFromMessage({
        actorId: "u1",
        bot: false,
        channelId: "c1",
        content: `mesaj complet diferit numarul ${index} despre subiectul ${index * 7}`,
        at: index,
        mentionCount: 0,
        attachmentCount: 0
      }),
      index
    );
  }

  const started = Date.now();
  detector.evaluate(1500);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 50, `evaluarea trebuie sa ramana instantanee pe calea de mesaje; a durat ${elapsed}ms`);
});
