import test from "node:test";
import assert from "node:assert/strict";

import reportModule from "../../features/command-handlers/reportInteractionHandler.js";
import type { BugReportRecord, UserComplaintRecord } from "../../features/feedback/reportRepository.js";

type ReportDeps = Parameters<typeof reportModule.createReportInteractionHandler>[0];

const bugRecord: BugReportRecord = {
  id: "bug-1",
  guildId: "guild-1",
  reportType: "sursa-stricata",
  gameKey: "cs2",
  description: "Sursa Steam nu raspunde deloc",
  authorId: "user-1",
  createdAt: new Date("2026-07-13T10:00:00Z")
};

const complaintRecord: UserComplaintRecord = {
  id: "user-1",
  guildId: "guild-1",
  reporterId: "user-1",
  targetId: "user-2",
  reason: "Mesaje repetate de spam",
  createdAt: new Date("2026-07-13T11:00:00Z")
};

function deps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  return {
    logger: () => undefined,
    enforceCooldown: async () => true,
    safeDefer: async () => undefined,
    safeEdit: async () => null,
    findGameAndSuggestion: query => ({ game: query === "cs2" ? { key: "cs2", name: "Counter-Strike 2", appId: "730" } : null, suggestion: null }),
    saveBug: async () => ({ created: true, record: bugRecord }),
    saveComplaint: async () => ({ created: true, record: complaintRecord }),
    listBugs: async () => [bugRecord],
    listComplaints: async () => [complaintRecord],
    removeBug: async () => true,
    removeComplaint: async () => true,
    adminAlert: async () => undefined,
    handlePagination: async () => undefined,
    MessageFlags: { Ephemeral: 64 },
    ...overrides
  };
}

test("/report bug foloseste formularul si returneaza ID-ul raportului duplicat fara salvare noua", async () => {
  let modalCustomId = "";
  let response: unknown;
  let saveCalls = 0;
  const handler = reportModule.createReportInteractionHandler(deps({
    saveBug: async () => {
      saveCalls += 1;
      return { created: false, record: bugRecord };
    }
  }));
  const interaction = {
    commandName: "report",
    guild: { id: "guild-1" },
    user: { id: "user-1", bot: false },
    options: {
      getSubcommand: () => "bug",
      getSubcommandGroup: () => null,
      getString: (name: string) => name === "joc" ? "cs2" : name === "tip" ? "sursa-stricata" : null,
      getUser: () => null
    },
    showModal: async (modal: unknown) => {
      const json = (modal as { toJSON(): { custom_id: string } }).toJSON();
      modalCustomId = json.custom_id;
    },
    awaitModalSubmit: async () => ({
      customId: modalCustomId,
      user: { id: "user-1" },
      fields: { getTextInputValue: () => "Sursa Steam nu raspunde deloc" },
      deferReply: async () => undefined,
      editReply: async (payload: unknown) => { response = payload; return null; }
    }),
    reply: async () => undefined
  };
  await handler.handle(interaction, [{ key: "cs2", name: "Counter-Strike 2", appId: "730" }]);
  assert.equal(saveCalls, 1);
  assert.match(String(response), /Problema exista deja/);
  assert.match(String(response), /bug-1/);
});

test("/report bug refuza descrierea cu linkuri fara sa salveze (politica linkuri unitara, audit #31)", async () => {
  let modalCustomId = "";
  let response: unknown;
  let saveCalls = 0;
  const handler = reportModule.createReportInteractionHandler(deps({
    saveBug: async () => { saveCalls += 1; return { created: true, record: bugRecord }; }
  }));
  const interaction = {
    commandName: "report",
    guild: { id: "guild-1" },
    user: { id: "user-1", bot: false },
    options: {
      getSubcommand: () => "bug",
      getSubcommandGroup: () => null,
      getString: (name: string) => name === "joc" ? "cs2" : name === "tip" ? "sursa-stricata" : null,
      getUser: () => null
    },
    showModal: async (modal: unknown) => { modalCustomId = (modal as { toJSON(): { custom_id: string } }).toJSON().custom_id; },
    awaitModalSubmit: async () => ({
      customId: modalCustomId,
      user: { id: "user-1" },
      fields: { getTextInputValue: () => "descarca de aici https://malware.example/free.exe" },
      deferReply: async () => undefined,
      editReply: async (payload: unknown) => { response = payload; return null; }
    }),
    reply: async () => undefined
  };
  await handler.handle(interaction, [{ key: "cs2", name: "Counter-Strike 2", appId: "730" }]);
  assert.equal(saveCalls, 0, "raportul cu link nu e salvat");
  assert.match(String(response), /nu poate contine linkuri/);
});

test("/report complaint respinge auto-raportarea si nu deschide formular", async () => {
  let payload: unknown;
  let modalOpened = false;
  const handler = reportModule.createReportInteractionHandler(deps());
  const interaction = {
    commandName: "report",
    guild: { id: "guild-1" },
    user: { id: "user-1", bot: false },
    options: {
      getSubcommand: () => "complaint",
      getSubcommandGroup: () => null,
      getString: () => null,
      getUser: () => ({ id: "user-1", bot: false })
    },
    showModal: async () => { modalOpened = true; },
    reply: async (value: unknown) => { payload = value; }
  };
  await handler.handle(interaction, []);
  assert.equal(modalOpened, false);
  assert.match(JSON.stringify(payload), /nu te poti reclama/);
});

test("/report list bugs citeste numai lista de buguri", async () => {
  let bugCalls = 0;
  let complaintCalls = 0;
  let payload: unknown;
  const handler = reportModule.createReportInteractionHandler(deps({
    listBugs: async () => { bugCalls += 1; return [bugRecord]; },
    listComplaints: async () => { complaintCalls += 1; return [complaintRecord]; },
    safeEdit: async (_interaction, value) => { payload = value; return null; }
  }));
  await handler.handle({
    commandName: "report",
    guild: { id: "guild-1" },
    user: { id: "admin-1" },
    options: {
      getSubcommand: () => "bugs",
      getSubcommandGroup: () => "list",
      getString: () => null,
      getUser: () => null
    }
  }, []);
  assert.equal(bugCalls, 1);
  assert.equal(complaintCalls, 0);
  assert.match(JSON.stringify(payload), /Rapoarte de bug/);
});
