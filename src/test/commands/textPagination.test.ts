import test from "node:test";
import assert from "node:assert/strict";

import { paginateTextLines, sendTextPages } from "../../features/command-presentation/textPagination.js";

test("paginarea respecta limita Discord si livreaza toate paginile ephemeral", async () => {
  const pages = paginateTextLines(["12345", "67890", "abcde"], 11);
  const payloads: unknown[] = [];

  assert.deepEqual(pages, ["12345\n67890", "abcde"]);

  const firstPage = "a".repeat(1000);
  const secondPage = "b".repeat(1000);
  await sendTextPages({
    reply: async payload => {
      payloads.push(payload);
      return payload;
    },
    followUp: async payload => {
      payloads.push(payload);
      return payload;
    }
  }, [firstPage, secondPage], "gol", true);

  assert.equal(payloads.length, 2);
  assert.match(JSON.stringify(payloads[0]), /a{100}/);
  assert.match(JSON.stringify(payloads[1]), /b{100}/);
});
