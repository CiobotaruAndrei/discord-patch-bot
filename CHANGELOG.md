# Changelog

Toate schimbarile importante ale proiectului sunt documentate aici.

Formatul urmeaza ideea din [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), iar versiunile folosesc [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Documentatie publica completa pentru setup, variabile `.env`, comenzi, teste, Docker si release.
- `SECURITY.md` pentru raportarea vulnerabilitatilor.
- `LICENSE` MIT.
- `.env.example` cu variabilele importante pentru Discord, MongoDB, cron, health/metrics, logging si proxy.
- Teste functionale pentru fluxurile principale de comenzi, notificari, repository-ul `seen` si E2E pentru update-uri/reduceri.
- Teste directe pentru shape drift in `sources/updates`, `sources/deals` si `sources/steam`.
- Workflow de release pregatit pentru GitHub Release si imagine Docker GHCR la tag-uri `v*`.

### Changed

- Build-ul si start-ul sunt separate: `npm run build` compileaza, iar `npm start` ruleaza `dist/app/main.js`.
- CI foloseste `npm ci` pe baza `package-lock.json`.
- Dependintele runtime si dev sunt pin-uite exact in `package.json` si lockfile.
- Docker Compose nu mai expune MongoDB pe host implicit; serviciul este accesibil doar in reteaua interna Docker.
- Dockerfile ruleaza procesul runtime ca user non-root.
- Codul este organizat pe functionalitati sub `src/`: `app`, `config`, `domain`, `features`, `infra`, `shared`, `sources` si `native`.
- Handler-ele pentru `/ping`, `/games`, `/help`, `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status` si autocomplete sunt extrase in `src/features/command-handlers/`.
- `commandRegistry.ts` ramane strat de wiring pentru modulele de comenzi, nu fisier cu logica de business.
- `fallbackInteractionHandler.ts` inlocuieste vechiul router legacy si ramane doar fallback de final pentru interactiuni neacoperite.
- `notifications/index.ts` a fost redus la wiring; logica pentru update-uri si reduceri este in `updateNotificationService.ts` si `discountNotificationService.ts`.
- `commandCache.ts`, `commandPresentation.ts` si `mongoContext.ts` expun factory-uri explicite, cu atasare pe context pastrata doar pentru compatibilitate.
- Handler-ele de start/stop, filtre jocuri, roluri, prezentarea comenzilor, registry-urile de surse/Mongo si scrapers principali folosesc acum tipuri structurale locale in loc de `any` in runtime.
- Filtrarea ofertelor foloseste acum Rust/N-API pentru hot-path-ul pur `dealPassesFilters`, cu fallback TypeScript identic cand addon-ul nativ lipseste.
- Autocomplete-ul pentru jocuri foloseste acum Rust/N-API pentru scoring, sortare si limitarea optiunilor Discord, cu fallback TypeScript identic.
- Documentatia interna a fost sincronizata cu structura actuala si nu mai prezinta `command-router` ca arhitectura curenta.
- Documentatia istorica versionata si `legacy-dynamic.d.ts` au fost eliminate.

### Security

- Comenzile administrative au verificari runtime de administrator in handler-ele sensibile, pe langa permisiunile slash command declarate.
- Endpoint-ul `/metrics` poate fi protejat cu token si comparatie `timingSafeEqual`.
- Workflow-ul de dependency review poate bloca PR-uri cand Dependency Graph este disponibil.
- Dependabot este configurat pentru actualizari npm si GitHub Actions.
- Clientul HTTP valideaza hosturile prin URL + DNS/IP inainte de request si prin lookup-ul agentului, pentru protectie SSRF mai stricta.

## [1.0.0] - 2026-05-21

### Added

- Bot Discord pentru update-uri, DLC-uri si reduceri.
- Slash commands pentru `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status` si `/help`.
- Persistenta MongoDB pentru guild-uri, jocuri urmarite si elemente deja vazute.
- Cron jobs pentru update-uri si reduceri.
- Parsere si fallback-uri pentru surse externe.
- Health check si metrics locale.
- Teste pentru parsere, filtre, cooldown-uri, deduplicare si guard-uri principale.
- Dockerfile si docker-compose pentru rulare locala.
