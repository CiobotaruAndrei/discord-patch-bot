# Release gate

Nu se face release decat daca **toate** verificarile de mai jos trec. Acesta este gate-ul
obligatoriu inainte de a publica o versiune (tag `vX.Y.Z`, imagine Docker GHCR, GitHub Release).

## Gate obligatoriu (toate trebuie sa fie verzi)

1. **CI (`check`) verde pe `main`** — typecheck (strict global) + build (TS + Rust) + no-comments +
   config/dependencies + toata suita de teste (`npm run check`). Branch protection cere deja acest
   check ca status obligatoriu pe `main`.
2. **Dependency Review verde** — `actions/dependency-review-action` ruleaza pe fiecare PR si e status
   check obligatoriu; plus `npm audit --omit=dev --audit-level=moderate` = 0 vulnerabilitati.
3. **Staging smoke automat verde** — `npm run smoke:staging` (health + `/metrics`) si
   `npm run smoke:staging:discord` (gateway + slash commands + permisiuni + trimitere reala) au trecut
   pe instanta de staging cu versiunea ce urmeaza a fi lansata. Workflow-ul `Staging Smoke` ruleaza
   aceste probe (saptamanal + `workflow_dispatch`); pentru release **dispatch-uieste-l cu input-ul
   `ref=<tag>`** (ex. `ref=v1.2.3`), ca probele sa ruleze exact codul tag-ului indiferent de branch-ul
   ales in dropdown. Workflow-ul rezolva SHA-ul real din checkout (`git rev-parse HEAD`) si **salveaza
   rezultatul ca artifact al carui nume poarta acel SHA** (`staging-smoke-result-<sha>`:
   `staging-smoke-http.json` + `staging-smoke-discord.json`, fiecare cu `ok`/`skipped`/`checks`).
   Release-ul **verifica automat** acest artifact (vezi mai jos), deci nu se bazeaza doar pe o bifa
   manuala.
4. **Manual Discord smoke** — checklist-ul din `STAGING_SMOKE.md` a fost parcurs manual pe un server de
   staging cu bot real (slash commands interactive, notificari live fara duplicate, ping de rol,
   shutdown curat) — partea pe care probele automate nu o pot simula.
5. **CHANGELOG actualizat** — sectiunea versiunii in `CHANGELOG.md` este sursa unica pentru
   body-ul GitHub Release (`extract-release-notes.js` scrie `release-notes.md`; workflow-ul nu
   combina acest body cu notele generate automat de GitHub).

## Ce se impune automat

Workflow-ul `release.yml` se declanseaza **doar prin `workflow_dispatch`** — nu exista trigger pe push
de tag, deci nu se poate ocoli confirmarea smoke. La rulare:

- gate-ul cere `smoke_confirmed=true` (confirmarea explicita ca pasul 4 — manual Discord smoke — a fost
  facut); altfel **esueaza** primul, inainte de orice build, cu un mesaj care trimite la acest document;
- **verifica artifactul de staging smoke** (pasul 3, automat, greu de fatat): cauta in ultimele
  `STAGING_SMOKE_MAX_AGE_DAYS` zile (variabila de repo, implicit 7) o rulare **reusita** a workflow-ului
  `Staging Smoke` care a urcat artifactul **`staging-smoke-result-<sha-ul commit-ului tag-ului>`** —
  numele artifactului poarta SHA-ul rezolvat din checkout-ul rularii de smoke, deci o rulare facuta pe
  alt ref (ex. `main` din greseala) nu poate trece gate-ul; il descarca si **esueaza** daca vreuna
  dintre probe a fost sarita (`skipped=true`, ex. secrete lipsa) sau a esuat (`ok=false`). Astfel o
  bifa `smoke_confirmed=true` singura nu este suficienta — trebuie sa existe un rezultat real, recent,
  trecut si produs exact pe codul tag-ului;
- ruleaza `npm run check` pe commit-ul tag-uit (release-ul **esueaza** daca CI nu trece);
- ruleaza `npm audit --omit=dev --audit-level=moderate` (release-ul **esueaza** la vulnerabilitati).

Pasul 4 (manual Discord smoke) nu poate fi verificat de un job de CI (necesita interactiune Discord
reala), deci confirmarea lui ramane responsabilitatea celui care lanseaza, impusa prin `smoke_confirmed`.
Pasul 3 (staging smoke automat) este insa verificat din artifactul produs de workflow-ul `Staging
Smoke`, nu doar declarat.

## Cum lansezi

1. Asigura-te ca pasii 1–5 de mai sus sunt indepliniti.
2. Ruleaza workflow-ul `Staging Smoke` (`workflow_dispatch`) cu secretele de staging setate, astfel
   incat sa produca un artifact `staging-smoke-result` recent si trecut (`ok=true`, `skipped=false`).
   Release-ul il va verifica automat.
3. Creeaza si impinge tag-ul: `git tag vX.Y.Z && git push origin vX.Y.Z`. Push-ul de tag **nu**
   declanseaza singur un release (nu exista trigger pe push de tag).
4. Porneste release-ul prin **`workflow_dispatch`** pe workflow-ul `Release`, cu `tag = vX.Y.Z` si
   `smoke_confirmed = true`. Aceasta este singura cale de release, deci confirmarea smoke este
   obligatorie.
5. Workflow-ul verifica gate-ul (`smoke_confirmed`) **si** artifactul de staging smoke (inclusiv
   check-ul `send` reusit in proba Discord — fara proba reala de trimitere release-ul e blocat), ruleaza CI +
   audit pe tag si **canary-ul live de surse** (`npm run canary:sources`, fail-closed pe API-urile
   fiabile) pe codul exact al tag-ului. Imaginea Docker se construieste **local**, trece prin gate-ul
   **Trivy blocant** (CRITICAL/HIGH fixabile, `exit-code 1`) pe imaginea exacta, si abia apoi se
   publica pe GHCR (`docker tag` + `docker push` pe bytes-ii scanati, fara rebuild). La final se
   creeaza GitHub Release-ul cu body-ul extras din `CHANGELOG.md`.
