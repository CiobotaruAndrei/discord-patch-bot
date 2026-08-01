import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const descriptors = fs.readFileSync(
  path.join(srcRoot, "features", "command-registry", "commandHandlerDescriptors.ts"),
  "utf8"
);
const registry = fs.readFileSync(path.join(srcRoot, "features", "command-registry", "commandRegistry.ts"), "utf8");

test("descriptorul isi pastreaza domeniul in tip, nu il pierde printr-un cast", () => {
  assert.match(
    descriptors,
    /export interface CommandHandlerDescriptor<D extends CommandHandlerDomain[^>]*> \{/,
    "descriptorul e generic pe domeniu; altfel `build` primeste serviciile complete si orice handler poate " +
      "atinge orice dependenta, indiferent ce declara domeniul lui"
  );
  assert.match(
    descriptors,
    /build\(context: CommandDomainDeps\[D\]\): CommandHandler;/,
    "semnatura lui build trebuie sa fie cea ingusta a domeniului, nu contextul global"
  );
  assert.ok(
    !descriptors.includes("as CommandHandlerDescriptor[\"build\"]"),
    "castul din `define` era exact locul unde se pierdea precizia castigata de `CommandDomainDeps`"
  );
});

test("nu mai exista un ambalaj identitate intre descriptor si apel", () => {
  assert.ok(
    !descriptors.includes("buildNarrowCommandHandler"),
    "`buildNarrowCommandHandler` era `factory(services)`, adica identitate; singurul lui efect real era sa " +
      "ascunda castul de dedesubt"
  );
  assert.ok(
    !registry.includes("buildNarrowCommandHandler"),
    "registrul cheama acum direct `descriptor.build(ctx)`, ceea ce lasa compilatorul sa verifice potrivirea"
  );
});

test("compozitia comenzilor e impartita pe domenii, nu o singura lista care le stie pe toate", async () => {
  const dir = path.join(srcRoot, "features", "command-registry", "descriptors");
  const module = fs.readdirSync(dir).filter(name => name.endsWith("Descriptors.ts")).sort();
  assert.deepEqual(
    module,
    ["adminDescriptors.ts", "coreDescriptors.ts", "gamesDescriptors.ts", "notificationsDescriptors.ts", "routingDescriptors.ts"],
    "fiecare grup de comenzi isi importa doar handler-ele lui; o lista unica obliga fisierul central sa " +
      "importe toate cele 39 de handlere, deci orice comanda noua atinge acelasi fisier"
  );

  for (const name of module) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const importate = text.match(/^import attach\w+ from/gm) ?? [];
    assert.ok(importate.length > 0, `${name} nu importa niciun handler`);
    assert.ok(
      !text.includes("CommandAppServices"),
      `${name} nu are voie sa vada serviciile complete; primeste define, care ii da doar dependintele domeniului`
    );
  }

  assert.ok(
    !descriptors.match(/^import attach\w+ from/m),
    "fisierul central nu mai importa handlere; el tine doar tipurile si `define`"
  );
});

test("nicio comanda nu s-a pierdut la impartire", async () => {
  const { createCommandHandlerDescriptors } = await import("../../features/command-registry/commandHandlerDescriptors.js");
  const lista = createCommandHandlerDescriptors();
  assert.equal(lista.length, 39, `impartirea trebuie sa pastreze toate comenzile; gasite ${lista.length}`);
  assert.equal(new Set(lista.map(d => d.id)).size, lista.length, "identificatorii raman unici dupa concatenare");
});

test("ordinea de dispatch ramane o constrangere explicita, nu un accident de asezare", async () => {
  const { createCommandHandlerDescriptors } = await import("../../features/command-registry/commandHandlerDescriptors.js");
  const lista = createCommandHandlerDescriptors();
  assert.equal(
    lista[0].id,
    "autocomplete",
    "autocomplete-ul trebuie sa ramana primul; altfel o comanda cu acelasi nume i-ar putea prelua interactiunile"
  );
  assert.equal(
    lista[lista.length - 1].id,
    "fallback",
    "fallback-ul e catch-all: mutat mai sus, ar inghiti interactiuni inainte sa ajunga la handler-ul lor. " +
      "Prima varianta a impartirii pe domenii a rupt exact asta, fiindca ordinea era implicita in lista plata"
  );

  const central = fs.readFileSync(path.join(srcRoot, "features", "command-registry", "commandHandlerDescriptors.ts"), "utf8");
  assert.ok(
    central.indexOf("routingLeadingDescriptors(define)") < central.indexOf("coreDescriptors(define)"),
    "pozitia capetelor de rutare trebuie sa se vada in compozitie, nu sa depinda de ordinea din interiorul unui modul"
  );
  assert.ok(
    central.indexOf("routingTrailingDescriptors(define)") > central.indexOf("gamesDescriptors(define)"),
    "capatul de inchidere sta dupa toate domeniile"
  );
});
