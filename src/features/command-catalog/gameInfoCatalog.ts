import type { CommandAccessRule, CommandCatalogHelpEntry } from "./commandCatalogTypes";

export const GAME_INFO_COMMAND_ACCESS: readonly CommandAccessRule[] = [
  { command: "dlc", access: "public", discordAdminPermissions: false },
  { command: "price-check", access: "public", discordAdminPermissions: false },
  { command: "deal-score", access: "public", discordAdminPermissions: false },
  { command: "best", access: "public", discordAdminPermissions: false },
  { command: "ending", access: "public", discordAdminPermissions: false },
  { command: "review-trend", access: "public", discordAdminPermissions: false },
  { command: "crossplay", access: "public", discordAdminPermissions: false },
  { command: "platforms", access: "public", discordAdminPermissions: false },
  { command: "co-op", access: "public", discordAdminPermissions: false },
  { command: "system", access: "public", discordAdminPermissions: false },
  { command: "game-size", access: "public", discordAdminPermissions: false },
  { command: "player-count", access: "public", discordAdminPermissions: false },
  { command: "top", access: "public", discordAdminPermissions: false }
];

export const GAME_INFO_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  { command: "/price-check", description: "Cauta pretul jocului pe Steam si il compara cu ofertele comparabile din sursele externe de reduceri folosite de bot. Pretul Steam este afisat in embed verde.", example: "/price-check joc:elden-ring" },
  { command: "/deal-score", description: "Calculeaza un scor 1-10 pentru oferta activa a unui joc pe baza reducerii, pretului curent, semnalelor de calitate/popularitate si magazinului.", example: "/deal-score game:elden-ring" },
  { command: "/best deals under", description: "Cauta cele mai bune reduceri sub bugetul ales in toate sursele de deals active, nu doar in watchlist-ul serverului.", example: "/best deals under buget:50 currency:EUR numar:5" },
  { command: "/ending deals", description: "Afiseaza ofertele care au termen de expirare detectat si le sorteaza dupa cat de aproape este expirarea.", example: "/ending deals currency:EUR numar:5" },
  { command: "/review-trend game", description: "Afiseaza semnalul curent al review-urilor Steam pentru joc: procent pozitiv, numar de review-uri si interpretare operationala.", example: "/review-trend game game:elden-ring" },
  { command: "/crossplay game", description: "Verifica metadatele Steam pentru semnale de crossplay si cross-save. Daca sursa nu confirma, raspunsul spune explicit ca nu este detectat.", example: "/crossplay game game:elden-ring" },
  { command: "/platforms game", description: "Afiseaza platformele Steam detectate si magazinele externe gasite in sursele de reduceri pentru jocul cautat.", example: "/platforms game game:elden-ring" },
  { command: "/co-op game", description: "Afiseaza modurile detectate in Steam pentru joc: single-player, online co-op, local/split-screen co-op, PvP sau MMO.", example: "/co-op game game:elden-ring" },
  { command: "/system requirements game", description: "Afiseaza cerintele minime si recomandate returnate de Steam pentru joc.", example: "/system requirements game game:elden-ring" },
  { command: "/game-size game", description: "Extrage dimensiunea aproximativa de instalare din cerintele de sistem Steam, cand informatia este disponibila.", example: "/game-size game game:elden-ring" },
  { command: "/player-count game", description: "Afiseaza numarul curent de jucatori activi pe Steam pentru jocul ales, cand jocul are Steam appId configurat.", example: "/player-count game game:Counter-Strike 2" },
  { command: "/top active games", description: "Afiseaza topul global al jocurilor cunoscute de bot care au Steam appId, sortat dupa player-count Steam. Nu este limitat de watchlist-ul sau filtrul de jocuri al serverului.", example: "/top active games numar:5" },
  { command: "/dlc", description: "Cauta DLC-uri pentru un joc.", example: "/dlc joc:Counter-Strike 2" }
];
