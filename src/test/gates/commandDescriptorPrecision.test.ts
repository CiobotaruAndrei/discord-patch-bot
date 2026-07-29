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
