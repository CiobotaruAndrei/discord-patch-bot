# Release gate

Nu se face release decat daca **toate** verificarile de mai jos trec. Acesta este gate-ul
obligatoriu inainte de a publica o versiune (tag `vX.Y.Z`, imagine Docker GHCR, GitHub Release).

## Gate obligatoriu (toate trebuie sa fie verzi)

1. **CI (`check`) verde pe `main`** — typecheck + typecheck:strict + build (TS + Rust) + no-comments +
   config/dependencies + toata suita de teste (`npm run check`). Branch protection cere deja acest
   check ca status obligatoriu pe `main`.
2. **Dependency Review verde** — `actions/dependency-review-action` ruleaza pe fiecare PR si e status
   check obligatoriu; plus `npm audit --omit=dev --audit-level=moderate` = 0 vulnerabilitati.
3. **Staging smoke automat verde** — `npm run smoke:staging` (health + `/metrics`) si
   `npm run smoke:staging:discord` (gateway + slash commands + permisiuni + trimitere reala) au trecut
   pe instanta de staging cu versiunea ce urmeaza a fi lansata. Workflow-ul `Staging Smoke` ruleaza
   aceste probe (saptamanal + `workflow_dispatch`).
4. **Manual Discord smoke** — checklist-ul din `STAGING_SMOKE.md` a fost parcurs manual pe un server de
   staging cu bot real (slash commands interactive, notificari live fara duplicate, ping de rol,
   shutdown curat) — partea pe care probele automate nu o pot simula.
5. **CHANGELOG actualizat** — sectiunea versiunii in `CHANGELOG.md` (folosita de
   `extract-release-notes.js` pentru notele de release).

## Ce se impune automat

Workflow-ul `release.yml` se declanseaza **doar prin `workflow_dispatch`** — nu exista trigger pe push
de tag, deci nu se poate ocoli confirmarea smoke. La rulare:

- gate-ul cere `smoke_confirmed=true` (confirmarea explicita ca pasii 3 si 4 — staging smoke automat +
  manual Discord smoke — au fost facuti); altfel **esueaza** primul, inainte de orice build, cu un mesaj
  care trimite la acest document;
- ruleaza `npm run check` pe commit-ul tag-uit (release-ul **esueaza** daca CI nu trece);
- ruleaza `npm audit --omit=dev --audit-level=moderate` (release-ul **esueaza** la vulnerabilitati).

Pasii 3–4 nu pot fi verificati complet de un job de CI (necesita o instanta live de staging si
interactiune Discord reala), deci confirmarea lor ramane responsabilitatea celui care lanseaza, impusa
prin `smoke_confirmed`.

## Cum lansezi

1. Asigura-te ca pasii 1–5 de mai sus sunt indepliniti.
2. Creeaza si impinge tag-ul: `git tag vX.Y.Z && git push origin vX.Y.Z`. Push-ul de tag **nu**
   declanseaza singur un release (nu exista trigger pe push de tag).
3. Porneste release-ul prin **`workflow_dispatch`** pe workflow-ul `Release`, cu `tag = vX.Y.Z` si
   `smoke_confirmed = true`. Aceasta este singura cale de release, deci confirmarea smoke este
   obligatorie.
4. Workflow-ul verifica gate-ul (`smoke_confirmed`), ruleaza CI + audit pe tag, construieste imaginea
   Docker GHCR si creeaza GitHub Release-ul cu notele extrase din `CHANGELOG.md`.
