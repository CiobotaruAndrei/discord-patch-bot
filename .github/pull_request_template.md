## Ce schimba

<!-- Descrie pe scurt schimbarea si de ce. -->

## Checklist obligatoriu (regulile din `docs/Reguli de respectat.md`)

Bifeaza toate inainte de merge. Un check CI (`PR Checklist`) verifica bifele cheie. Vezi `RELEASING.md` pentru gate-ul complet de release.

- [ ] **Documentatie** actualizata: `CHANGELOG.md` + docs relevante (`README.md` / `OPERATIONS.md` / `BENCHMARKS.md` / `ROADMAP.md` / `src/docs/` etc.) reflecta schimbarea.
- [ ] **Teste** pentru functionalitatea noua: teste adaugate/actualizate care acopera comportamentul nou.
- [ ] **Fara comentarii** in cod si fara secrete commit-uite (token Discord, URI Mongo, METRICS_TOKEN, webhook-uri, proxy URLs).
- [ ] **Benchmark** daca s-a atins un hot-path sau s-a adaugat/scos cod nativ: `npm run benchmark:cpu` rulat si `BENCHMARKS.md` reflecta decizia TS-vs-Rust pe baza de date masurate. Bifeaza si daca nu e cazul (N/A — nu e hot-path, fara schimbare de limbaj).
- [ ] **Fara conflict cu `main`**: branch nou plecat din `main`-ul curent, fara conflicte; branch protection cere branch up-to-date (strict) + check-urile CI verzi.
- [ ] **Tooling nativ**: daca s-a atins `native/`, `cargo test` + `cargo clippy --all-targets -- -D warnings` trec (rulate si in CI, plus `npm run check:native` local). Bifeaza si daca nu e cazul (N/A).
- [ ] **Fisiere noi numite dupa functionalitate**: fisierele noi au nume descriptive, nu generice sau dupa autor.
- [ ] `npm run check` trece local (typecheck strict global + build + no-comments + config/dependinte + toata suita de teste).
- [ ] `npm audit --omit=dev --audit-level=moderate` = 0 vulnerabilitati.

## Note

<!-- Orice context aditional pentru reviewer (decizii, trade-off-uri, follow-up-uri). -->
