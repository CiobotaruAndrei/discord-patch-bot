# Cat dureaza CI-ul, si de ce nu se mai imparte

Documentul asta exista ca sa nu se re-decida din intuitie. Intrebarea „paralelizam CI-ul?" a
primit deja un raspuns bazat pe masuratori; aici sunt masuratorile, cu provenienta lor, ca
oricine sa poata re-masura si compara in loc sa reia discutia de la zero.

## Masuratoare

Run `30664418123` (workflow CI, PR verde, 2026-07-31), pe `ubuntu-latest`.

### Jobul `check` — 2m45s

| Pas | Durata |
|---|---|
| Pornirea containerului Mongo | 25,4s |
| Checkout + Setup Node | 2,1s |
| `apt-get install` (librariile C) | 13,1s |
| Setup Rust | 9,4s |
| Restaurarea cache-ului Rust | 7,3s |
| `npm ci` | 5,5s |
| `npm run check:native` (clippy + cargo test) | 30,7s |
| `npm run check` (build + gate-uri + ~2500 teste) | 51,1s |
| `npm run benchmark:guard:prebuilt` | 10,7s |
| `npm run test:e2e:prebuilt` | 0,4s |

**Cost fix pana la primul pas util: 62,8s. Munca propriu-zisa: 92,9s.**

### Jobul `gates` — 30s

Checkout 1,2s, Setup Node 3,9s, `npm ci` 7,4s, `npm run build:ts` 7,1s, gate-uri + lint 8s.
Ruleaza in paralel cu `check` si nu are nevoie nici de Rust, nici de Mongo.

### Jobul `ci` — 4s

Agregatorul pentru protectia de branch.

**Wall clock total: ~2m56s.**

## Decizia: nu se mai imparte `check`

Aritmetica, cu numerele de mai sus. Daca `check` s-ar imparti in doua joburi — validarea Rust
separat de verificarile TypeScript — fiecare plateste din nou cei 62,8s de cost fix:

- job A (clippy + cargo test): 62,8 + 30,7 = **93,5s**
- job B (`npm run check` + benchmark + e2e): 62,8 + 62,2 = **125s**
- wall clock nou: **125s**, fata de 165s acum

Adica ~40s castigate (24%), platite cu ~63s in plus de timp de runner. Si castigul real e mai
mic decat atat, pentru un motiv care nu apare in tabel: `npm run check` ruleaza `build:rust`, iar
`check:native` ruleaza clippy si `cargo test` pe **acelasi** `target/<triplet>/release`. Sunt in
acelasi job tocmai ca al doilea sa refoloseasca ce a compilat primul. Separate pe runnere diferite,
munca aceea se face de doua ori.

Concluzia nu e „paralelizarea nu ajuta niciodata", ci „la 3 minute total si cu 38% cost fix,
nu se merita". Pragul la care merita re-discutat: cand `npm run check` singur trece de ~2 minute,
sau cand costul fix scade sub ~20% din job.

## Ce s-a impartit deja, si de ce acolo a meritat

Jobul `gates` e chiar despartirea care se plateste: da feedback in 30s pe cea mai frecventa clasa
de esec (gate-uri structurale, tipare, comentarii, straturi) si **nu plateste** costul fix mare,
fiindca nu are nevoie nici de toolchain-ul Rust, nici de librariile C, nici de Mongo. Asta e
criteriul: un job paralel merita cand poate sari peste costul fix, nu cand il duplica.
