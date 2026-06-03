## Ce schimba

<!-- Descrie pe scurt schimbarea si de ce. -->

## Checklist obligatoriu

Bifeaza toate inainte de merge (un check CI verifica primele doua). Vezi `RELEASING.md` pentru gate-ul complet de release.

- [ ] **Documentatie** actualizata (Regula 2): `CHANGELOG.md` + docs relevante (`README.md` / `OPERATIONS.md` / `BENCHMARKS.md` / `src/docs/` etc.) reflecta schimbarea.
- [ ] **Teste** pentru functionalitatea noua (Regula 4): teste adaugate/actualizate care acopera comportamentul nou.
- [ ] `npm run check` trece local (typecheck + typecheck:strict + build + no-comments + config/dependinte + toata suita de teste).
- [ ] `npm audit --omit=dev --audit-level=moderate` = 0 vulnerabilitati.
- [ ] Fara comentarii in cod (Regula 1) si fara secrete commit-uite (token Discord, URI Mongo, METRICS_TOKEN, webhook-uri, proxy URLs).

## Note

<!-- Orice context aditional pentru reviewer (decizii, trade-off-uri, follow-up-uri). -->
