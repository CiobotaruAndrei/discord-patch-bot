# Benchmarks & decizii de performanta

Documentul aduna masuratori reproductibile pentru zonele sensibile la performanta si
deciziile de design care decurg din ele (in special: ce sta in Rust si ce sta in
TypeScript, conform regulii „nu se scoate o bucata de limbaj decat daca inlocuitorul
face botul mai bun si mai eficient").

Rerulare:

```bash
cd src
npm run benchmark:cpu        # native vs TS pentru hot-path-urile CPU
npm run benchmark:inspection # motorul de inspectie: blocare event loop + concurenta
npm run benchmark:outbox   # drenare outbox job-by-job pe Mongo real (MONGO_URI)
npm run benchmark          # scalare notificari (update-uri/reduceri) pe 100/500/1000 guild-uri
```

Cifrele de mai jos sunt orientative (masinile difera); ce conteaza este raportul si forma
scalarii, nu valoarea absoluta.

## 1. CPU hot-path: fuzzy matching (Rust vs TypeScript)

`npm run benchmark:cpu` masoara `levenshtein` (folosit la fiecare cautare fuzzy de joc,
peste toate jocurile urmarite) pe acelasi set de perechi, native vs fallback TS.

Masuratoare reprezentativa (200.000 iteratii x 8 perechi):

| Implementare | Apeluri/s | Note |
| --- | --- | --- |
| Rust native | ~2,38M | addonul NAPI |
| TS fallback | ~1,26M | `levenshteinFallback` |
| Speedup | ~1.9x | paritate native==TS: OK |

### Per zona: TS vs Rust (regula limbajului demonstrata cu date, nu doar respectata tehnic)

`npm run benchmark:cpu` masoara acum si fiecare functie nativa fata de fallback-ul TS
echivalent, pe acelasi input (`runAreaBenchmarks`), cu verificare de paritate a rezultatului.
Masuratoare reprezentativa (100.000 iteratii; cifrele difera intre masini, conteaza raportul):

| Zona (functie) | TS (apeluri/s) | Rust (apeluri/s) | Rust vs TS | Paritate |
| --- | --- | --- | --- | --- |
| `levenshtein` | ~1,27M | ~2,40M | **~1.9x** (Rust mai rapid) | OK |
| `dealHash` (hashing) | ~1,11M | ~1,70M | **~1.5x** (Rust mai rapid) | OK |
| `findGameKeys` (fuzzy-match) | ~107k | ~76k | ~0.7x (Rust mai lent) | OK |
| `buildAutocompleteChoices` | ~1,15M | ~99k | ~0.09x (Rust mai lent) | OK |
| `dealPassesFilters` | ~37M | ~3,1M | ~0.08x (Rust mai lent) | OK |
| `rankListingCandidates` (listing-rank) | ~24k | ~30k | **~1.25x** (Rust mai rapid) | OK |
| `extractAndRankListingCandidates` (listing-batch) | ~16k | ~37k | **~2.3x** (Rust mai rapid) | OK |
| `selectLatestSteamPatchNote` (steam-patch) | ~270k | ~21k | ~0.08x (Rust mai lent) | OK |
| `chooseBestSteamMatch` (steam-match) | ~33k | ~83k | **~2.5x** (Rust mai rapid) | OK |
| `dedupeAndRankDeals` (deals-dedupe, 200 oferte) | ~40k | ~10k | ~0.26x (Rust mai lent) | OK |

Interpretare onesta: Rust castiga clar doar acolo unde calculul e dominant si argumentele sunt
ieftine de trecut peste granita JS<->Rust — `levenshtein` (string-uri) si `dealHash` (SHA-256 pe string-uri;
~1.5x si dupa trecerea de la SHA-1 la SHA-256, cu paritate native==TS).
Pentru `findGameKeys` si `buildAutocompleteChoices`, fiecare apel trece un **array de candidati**
peste granita NAPI (marshaling), iar pentru `dealPassesFilters` calculul e trivial; in aceste
cazuri overhead-ul apelului nativ depaseste castigul, deci Rust e mai lent decat TS in microbenchmark.

**Decizie:**

- `levenshtein` si hashing-ul de dedupe (`dealHash` / `stableUpdateId`) **raman in Rust** — castig
  masurat (~1.5–1.9x) + paritate; sunt si cele cu adevarat hot (fuzzy peste toate jocurile, hash la
  fiecare update/reducere).
- `rankListingCandidates` (ordonarea ancorelor unei pagini de listing) **trece in Rust** (~1.25x vs
  fallback-ul TS, paritate verificata). Spre deosebire de `findGameKeys`/`buildAutocompleteChoices`,
  aici marshaling-ul array-ului se amortizeaza: scanarea de data (byte-level) + sortarea se fac complet
  nativ intr-un **singur** apel NAPI. Bonus algoritmic: codul vechi recalcula scorul + data in
  comparatorul de sort (O(n log n) apeluri native pe ancora); acum se calculeaza o singura data per
  ancora (O(n)) — castigul real fata de productia veche e mult peste 1.25x.
- `extractAndRankListingCandidates` (pipeline-ul complet de listing, Prioritate 1) **trece in Rust**
  (~2.3x vs fallback-ul TS, paritate verificata). Consolideaza intr-un **singur** apel NAPI intreg
  hot-path-ul CPU care inainte facea multe apeluri native mici per ancora: `cleanText` per ancora +
  `scoreListingCandidate` per ancora + un apel separat `rankListingCandidates`. Acum TypeScript
  (`listingUpdates.ts`) extrage cu Cheerio doar perechile ancora `{ href, rawText }` (href deja
  absolutizat + trecut prin regex, operatii pur-JS non-native) si trimite tot lotul o singura data;
  Rust curata textul, filtreaza scorul 0 cand exista keywords, deduplica dupa href, calculeaza scorul
  + scorul de data, ordoneaza si intoarce doar cei mai buni `max_results` (compact `{ href, text }`).
  Fata de productia veche, care traversa granita NAPI de `2N+1` ori per pagina, castigul real e mult
  peste 2.3x. Parsarea HTML ramane intentionat in Cheerio (parser lenient, referinta de paritate);
  a muta si parsarea DOM in Rust ar adauga un parser HTML cu risc de divergenta pe HTML invalid, fara
  castig CPU proportional.
- `chooseBestSteamMatch` (alegerea celui mai bun rezultat Steam pentru un query, PDF Prioritate 3
  „conditionat") **trece in Rust** (~2.5x vs fallback-ul TS, paritate verificata). Spre deosebire de
  `selectLatestSteamPatchNote`, aici calculul **nu** e trivial: normalizarea + `levenshtein` pe nume
  lungi de jocuri (editii/DLC-uri) e O(n·m) per candidat, deci Rust-ul isi amortizeaza marshaling-ul
  array-ului si castiga stabil. Codul vechi apela `levenshtein` nativ **per candidat** (N traversari
  NAPI); acum filtrarea games-only + scoringul complet (bonus egal/prefix/includere, penalizare
  DLC/demo/music) se fac intr-un **singur** apel batch care intoarce doar indexul castigatorului
  (`steam/index.ts` reconstruieste `items[index]`). Pragul de warn e mai ridicat (`1.3x`) fiindca
  avantajul masurat e clar.
- `findGameKeys`, `buildAutocompleteChoices`, `dealPassesFilters`, `selectLatestSteamPatchNote`,
  `dedupeAndRankDeals` sunt acum
  **TS-primary**: wrapper-ele publice din `native/fuzzy.ts` apeleaza direct implementarea TypeScript
  (masurat mai rapida — Rust pierde pe marshaling-ul NAPI al array-urilor de candidati / calcul trivial),
  iar rezultatul e identic (paritate verificata). Functiile native raman expuse prin `getNativeFuzzy()`
  doar pentru benchmark si testele de paritate, dar nu mai sunt pe calea de productie. Astfel regula
  limbajului e respectata in ambele sensuri: limbajul mai rapid pentru fiecare zona, demonstrat cu masuratori.
- `dedupeAndRankDeals` (deduplicare + ordonare oferte, PDF Prioritate 4 „conditionat") **ramane TS**.
  Benchmark la 200 de oferte (dimensiune realista: Steam + Epic specials): Rust **~0.26x** vs fallback-ul
  TS, paritate OK. Calculul (normalize + dedup Map + sort) e trivial, iar marshaling-ul a 200 de obiecte
  string domina — exact conditia din PDF („se pastreaza varianta Rust numai daca avantajul ramane stabil
  la dimensiunile reale, nu doar la loturi artificiale foarte mari"). Castigul real vine tot din
  consolidare in TS: `dealHelpers.ts` nu mai apeleaza `normalizeTitleForDedupe` nativ per oferta
  (N traversari NAPI), ci o singura functie TS `dedupeAndRankDealsIndex` (0 traversari) care intoarce
  indecsii. Functia Rust `dedupe_and_rank_deals` + paritatea raman doar pentru benchmark/inregistrare.
- `selectLatestSteamPatchNote` (alegerea celui mai nou patch note dintr-un feed Steam de pana la 50 de
  stiri) merita o nota aparte: PDF-ul „Patru bucati concrete de trecut in Rust" il propunea drept
  Prioritate 2 (a colapsa multele apeluri native per stire — `isGoodSteamArticleUrl` +
  `classifyPatchNote` — intr-un singur apel batch). Masuratoarea infirma ipoteza Rust: batch-ul Rust
  transfera 50 de obiecte cu campuri string peste granita NAPI, iar calculul (contains pe string-uri) e
  trivial, deci pierde masiv (~0.08x) fata de o singura trecere pur-TS. Castigul real fata de **productia
  veche** vine totusi din consolidare: `steamUpdates.ts` nu mai apeleaza `isGoodSteamArticleUrl` +
  `classifyPatchNote` per stire (~100 apeluri native per feed), ci o singura functie TS
  (`selectLatestSteamPatchNoteIndex`) care face totul intr-o singura trecere, fara nicio traversare NAPI.
  Deci Prioritatea 2 se livreaza ca **batch TS**, nu Rust — exact ce cere metodologia PDF-ului: candidatul
  intra in productie doar daca benchmark-ul arata avantaj, iar aici avantajul e al TS-ului.

Fallback-ul TS exista pentru robustete (cand addonul nu poate fi incarcat), nu ca implementare
principala — cu exceptia notata mai sus, unde ar fi chiar mai eficient.

### Motor batch asincron: `inspectUntrustedContent` (inspectia pasiva de continut neincredibil)

Toate zonele de mai sus sunt apeluri **sincrone**, deci metrica relevanta e apeluri/s. Inspectia
pasiva a atasamentelor este alt tip de workload: un singur apel poate traversa o arhiva intreaga
(ZIP/TAR/GZIP recursiv, parser structural CFB/OLE, de-ofuscare PDF), pana la bugetul de 8 MiB
decomprimati si 64 de intrari. In TypeScript asta rula **sincron pe event loop**, deci un singur
atasament ostil bloca tot botul (heartbeat-ul Discord, cron-ul, drenarea outbox) cat dura analiza.

Motorul e acum un **singur apel batch asincron** — `inspect_untrusted_content(input) -> InspectionReport`
in `src/native/core/src/inspection.rs`, expus prin N-API `AsyncTask` (`src/native/src/lib.rs`), deci
intreaga traversare ruleaza pe thread pool-ul libuv, nu pe event loop. TypeScript pastreaza tot ce e
I/O si decizie: descarcarea fisierului, integrarea Discord, apelul catre motorul extern de reputatie,
decizia de alerta/stergere, logarea si persistenta. Rust primeste doar `bytes + filename + mime + mode +
limite` si intoarce `status / indicators / reason / entriesInspected / expandedBytes / elapsedMs`.

`npm run benchmark:inspection` masoara pe o arhiva ZIP realista (~1,4 MB, 24 de intrari deflate cu
continut incompresibil, deci fara scurtcircuitul de raport de compresie):

| Metrica | TS sincron | Rust `AsyncTask` | Raport |
| --- | --- | --- | --- |
| Blocare main thread / inspectie | ~2,05 ms | ~0,18 ms (doar marshaling) | **~11x mai putina blocare** |
| Latenta secventiala / inspectie | ~2,05 ms | ~2,02 ms | ~1,0x (egalitate) |
| 8 atasamente deodata | ~16,4 ms (secvential, blocant) | ~4,1 ms (paralel pe thread pool) | **~4,0x** |
| Paritate raport native==TS | — | — | OK (16 fixtures) |

Interpretare onesta: **castigul nu e viteza bruta de calcul** — pe o singura inspectie Rust e la egalitate
cu TypeScript (zlib e deja nativ in Node, iar restul e scanare de bytes, la fel de ieftina in ambele).
Castigul e ca munca **iese de pe event loop** (~11x mai putina blocare per inspectie) si ca inspectiile
concurente chiar ruleaza in paralel (~4x la 8 atasamente simultane, plafonat de dimensiunea thread pool-ului
libuv). De aceea guard-ul masoara pentru aceasta zona **reducerea blocarii**, nu latenta secventiala:
raportarea unui „speedup" de ~1.0x ar fi corecta ca numar si complet inselatoare ca decizie.

**Decizie:** motorul de inspectie **trece in Rust ca task asincron**, native-first cu fallback TS complet
(`inspectUntrustedContentFallback`) pentru cand addonul lipseste. Modul (`archive` / `document` / `auto`)
ramane decis de TypeScript (`classifyResource`), fiindca un `.docx` este fizic un ZIP: daca Rust ar
autodetecta formatul, un document ar fi tratat brusc ca arhiva si verdictele ar diverge tacut fata de
comportamentul actual. Limitele (adancime, intrari, bytes decomprimati, raport de compresie, timeout) sunt
parametri de apel, identici in ambele implementari, verificati prin teste de paritate.

Ce **nu** s-a mutat, deliberat: descarcarea si HTTP-ul, apelul catre motorul extern de reputatie, deciziile
de moderare si persistenta — sunt I/O si politica, nu calcul (vezi sectiunea 4).

**PDF si OOXML** sunt parcurse structural, nu doar prin fereastra de scanare. Pentru PDF, motorul
localizeaza obiectele `stream`/`endstream`, decomprima fluxurile `/FlateDecode` (bounded de aceleasi
limite de bytes decomprimati si timp) si scaneaza continutul DECODAT — asa se prinde un `/JavaScript`
sau un `/EmbeddedFile` ascuns intr-un flux comprimat, complet invizibil pentru scanarea latin1 a
bytes-ului brut. Pentru OOXML, fisierele `.rels` sunt parsate ca **graf de relatii** (`Type`, `Target`,
`TargetMode`), nu doar cautate dupa siruri: relatiile `attachedTemplate`/`frame` cu `TargetMode="External"`
(vectorul clasic de sablon Word incarcat de la distanta) primesc indicator dedicat, iar `oleObject`,
`package` si `vbaProject` sunt clasificate dupa tipul relatiei, nu dupa numele intrarii. Parsarea
grafului elimina si un fals pozitiv real: pana acum ORICE `.rels` era marcat „referinta externa" fiindca
`xmlns="http://schemas.openxmlformats.org/..."` contine `http://`.

**RAR si 7z** sunt acum parcurse structural **la nivel de header**, in acelasi task Rust: RAR4 (blocuri
`FILE_HEAD`) si RAR5 (headere cu `vint`) sunt enumerate ca nume de intrari, iar 7z isi expune tipul
headerului urmator (`kHeader` simplu vs `kEncodedHeader` codificat/criptat). Numele obtinute trec prin
aceeasi clasificare ca intrarile ZIP/TAR, deci un `installer.exe` sau un `macros/auto.vbs` dintr-un RAR
produce indicator **fara sa fie decomprimat nimic**. Continutul comprimat tot nu are decodor pasiv local,
deci verdictul ramane `uncertain` (escaladat la motorul extern, nu declarat curat) — dar motivul e acum
precis: arhiva criptata, header criptat, structura trunchiata sau „inspectata doar la nivel de header (N
intrari)". Bugetul de intrari se aplica si scanarii de headere, iar intrarile de tip director nu produc
indicatori de fisier.

### Detectia tipului real (`inspectMagic`) si de ce NU s-a linkat libmagic

PDF-ul „Librarii C/C++ pentru discord-patch-bot" propune un program de 15 etape care incepe cu
`libmagic` pentru identificarea tipului real. Capabilitatea e livrata (etapa 1), dar **fara a lega o
librarie C** — decizia se ia pe aceleasi criterii ca restul documentului, aplicate onest:

- **Cost de build real.** CI ruleaza pe `ubuntu-latest` fara pachete dev, iar Dockerfile-ul are doar
  `build-essential pkg-config python3`. Fiecare librarie C din lista cere apt in CI, apt in stage-ul de
  build **si** in cel de runtime (pentru `.so`-uri), plus vcpkg pe masina de dezvoltare Windows. Un
  singur artefact lipsa opreste `npm run check` si declanseaza fail-fast-ul „addon nativ obligatoriu in
  productie".
- **Ce aduce efectiv libmagic** e baza de semnaturi, nu algoritmul. Pentru suprafata reala a botului —
  atasamente Discord — un tabel de semnaturi fixat in Rust acopera formatele care conteaza si e testabil
  determinist, fara dependinta externa versionata separat.
- **Regula documentului insusi**: „C++ nu devine al treilea limbaj de business. Rust ramane
  coordonatorul nativ." Aici nu exista nimic „greu de reimplementat corect" — clasificarea dupa magic
  bytes e exact genul de cod pentru care Rust e potrivit.

Ce inlocuieste `magicKind` (8 semnaturi hardcodate, fara MIME): `inspect_magic` intoarce MIME real,
descriere, encoding, `kind` pentru rutarea parserului si un camp de **flag-uri de nepotrivire** —
extensie falsa, MIME declarat contradictoriu, poliglot, executabil deghizat, continut trunchiat.
Containerele sunt tratate pe **familii** (DOCX/XLSX/PPTX/APK/JAR/ODF sunt toate ZIP; MSI/DOC/XLS/PPT
sunt toate OLE), deci un `.docx` numit `.zip` nu mai produce o nepotrivire falsa.

Politica ceruta de PDF e respectata: **detectia clasifica tipul, nu intentia**. O nepotrivire produce
cel mult `uncertain` si o ruta de inspectie mai stricta; niciodata `confirmed`. Paritatea native == TS
e verificata pe un corpus de 39 de tipuri in `contentTypeDetection.test.ts`.

Pentru etapele urmatoare din PDF (YARA, decodare RAR/7z, PDF structural complet, PE/ELF/Mach-O, IDN),
aceeasi intrebare se pune separat de fiecare data: exista o implementare Rust matura care ofera aceeasi
capabilitate fara costul de build si de suprafata de atac al unei librarii C? Cand raspunsul e nu,
librarie C — dar dupa acelasi benchmark si aceleasi gate-uri.
### libyara: prima librarie C legata efectiv (etapa 2 din PDF-ul de librarii)

Etapa 2 din PDF-ul „Librarii C/C++" cere un motor de reguli actualizabil fara recompilarea
botului. Aici raspunsul la intrebarea „exista un echivalent Rust suficient?" este **nu**:
valoarea YARA nu e algoritmul, ci **ecosistemul de reguli** — regulile scrise de comunitate
si de furnizorii de threat intel tintesc dialectul libyara. Deci libyara se leaga efectiv.

**Cum se leaga, fara sa strice build-ul nimanui**: crate-ul `yara` cu feature-urile
`vendored` + `bundled-4_5_5`. Sursa C a libyara este compilata din surse de `cc` si legata
**static**; bindings-urile sunt pre-generate, deci nu e nevoie de `libclang`. Rezultatul
practic, verificat pe aceasta masina (Windows + MSVC):

- **zero** `apt-get` in CI si in Dockerfile;
- **zero** vcpkg pe masina de dezvoltare;
- **zero** `.so` de instalat in stage-ul de runtime (linkare statica);
- acelasi build pe Linux, Windows si in container, fara pasi de platforma.

Costul real e timpul de compilare: libyara se compileaza o data per `target/` curat
(~15 s pe aceasta masina, cache-uit dupa aceea). Asta e pretul acceptat pentru a NU adauga
patru fronturi de instalare per librarie.

Feature-ul cargo `yara` este **activ implicit**; cand e dezactivat, modulul se compileaza cu
o implementare inlocuitoare care raporteaza onest `unavailable`, iar botul functioneaza
identic, fara scanare pe reguli.

**Politica de verdict, exact ca in PDF (sectiunea 6):** o potrivire YARA **nu** produce
niciodata `confirmed`. Regulile locale semnaleaza; confirmarea ramane exclusiv a motorului
extern care a scanat obiectul complet si a raspuns pentru acelasi hash. Un match ridica
verdictul cel mult la `uncertain` si adauga indicatori descriptivi in raport.

Ruleset-ul se incarca la pornire din `YARA_RULES_PATH` (fisier sau director cu `.yar`/`.yara`,
plafonat la 8 MiB), primeste un `rulesetId` derivat din continut — folosit in audit si in
cache key, cum cere PDF-ul — iar un set invalid **nu** inlocuieste setul valid deja incarcat.
Seriile `bot_yara_rules_loaded` si `bot_yara_engine_available` expun starea operational.

### libarchive: decodarea continutului RAR/7z (etapa 3 din PDF-ul de librarii)

Etapa 1 a livrat scanarea structurala de **headere** RAR/7z: numele intrarilor produc indicatori
fara sa se decomprime nimic, dar continutul ramanea neinspectat si verdictul `uncertain`. Etapa 3
adauga decodarea reala, prin libarchive.

**Cum se leaga**: crate-ul `libarchive2-sys`, care vendoreaza sursa libarchive 3.8.1 si o compileaza
cu CMake, legata **static**. Spre deosebire de libyara (care se compileaza doar cu `cc`), libarchive
are nevoie de un lant complet de dependinte de compresie:

| Platforma | Cum sunt aduse |
| --- | --- |
| Linux (CI + Docker) | `apt`: `cmake clang libclang-dev libssl-dev zlib1g-dev libbz2-dev liblzma-dev libzstd-dev liblz4-dev libxml2-dev libacl1-dev`; runtime-ul primeste bibliotecile partajate corespunzatoare |
| Windows (dezvoltare) | `vcpkg` cu tripletul `x64-windows` pentru `zlib bzip2 liblzma zstd lz4 openssl`, plus `CMAKE_TOOLCHAIN_FILE` si `VCPKG_INSTALLATION_ROOT` |

`libclang` apare in lista din cauza `bindgen`: spre deosebire de libyara, `libarchive2-sys` **genereaza**
bindings-urile la build din `archive.h`, deci are nevoie de un clang functional. Imaginea `node:24-slim`
nu il aduce, iar runner-ul GitHub il are preinstalat — o diferenta care a facut build-ul de container sa
pice singur, dupa ce CI trecuse. De aceea pachetul e cerut explicit in ambele locuri, nu lasat pe seama
imaginii de baza.

Asta e diferenta onesta fata de etapa 2: **libyara nu a cerut niciun pachet de sistem, libarchive cere.**
Costul e documentat aici tocmai pentru ca urmatoarele etape (PDFium, FFmpeg, libvips) vor semana mai
mult cu libarchive decat cu libyara.

**Stratificare, nu inlocuire.** Decodorul nativ e o imbunatatire peste scanarea de headere, nu un
inlocuitor: cand libarchive esueaza sa parseze (arhiva trunchiata, format necunoscut, varianta
nesuportata), motorul **cade inapoi** pe scanarea de headere din etapa 1, care tot produce nume de
intrari si un motiv precis. Cand libarchive reuseste, fiecare intrare decodata trece prin exact
aceleasi verificari ca intrarile ZIP/TAR — `content_indicators` plus `inspect_nested` pentru
recursivitate — sub aceleasi bugete de intrari, bytes decomprimati si timp.

Constrangerile cerute de PDF sunt respectate: citire exclusiv din memorie (`archive_read_open_memory`),
nimic nu se materializeaza pe disc, numele absolute / `../` / `C:\` si link-urile simbolice sau hard
sunt **raportate ca indicatori** fara sa fie urmarite, iar o intrare criptata opreste traversarea cu
verdict `uncertain`, niciodata „curat".

**Fallback-ul TypeScript nu decodeaza continut RAR/7z** — nu exista echivalent pur-JS rezonabil. Cand
addonul nativ lipseste, comportamentul degradeaza la scanarea de headere: tot `uncertain`, niciodata
un fals „curat". Paritatea native==TS din corpusul de fixtures se pastreaza fiindca fixture-urile
sintetice de acolo nu sunt arhive RAR/7z valide, deci ambele cai ajung pe scanarea de headere.

### qpdf: analiza structurala completa a PDF-urilor (etapa 4 din PDF-ul de librarii)

Parserul rapid din Rust cauta `stream`/`endstream`, decomprima **doar** FlateDecode sub buget si cauta
actiuni automate in rezultat. Acoperirea aceea ramane calea ieftina si ruleaza prima. Ce nu putea face:
xref streams, object streams, lanturi de filtre, criptare, arbori de nume si actualizari incrementale —
adica exact locurile in care se ascunde continutul care conteaza.

**Cum se leaga**: crate-ul `qpdf` 0.3.5 (bindings MIT/Apache peste API-ul C `qpdf-c.h`), cu feature-ul
`vendored`. Spre deosebire de libarchive, aici **nu apare niciun pachet de sistem nou**:

| Aspect | libyara (etapa 2) | libarchive (etapa 3) | qpdf (etapa 4) |
| --- | --- | --- | --- |
| Sistem de build | `cc` | CMake | `cc` |
| Pachete apt noi | niciunul | 9 | **niciunul** |
| `libclang` la build | nu | da (bindgen) | **nu** (bindings pre-generate pentru tintele noastre) |
| Ce se compileaza | libyara | libarchive | zlib + libjpeg + libqpdf |

Cerinta reala e doar un compilator C++17, pe care `build-essential` din imaginea de build il aduce deja.
Costul e in timpul de compilare (~100 de fisiere `.cc`), nu in lantul de dependinte.

**Escaladare, nu inlocuire.** qpdf **nu** ruleaza pe fiecare PDF. Motorul verifica intai daca structura
chiar o cere — `/Encrypt`, `/ObjStm`, `/XRefStm`, un filtru diferit de Flate, sau mai mult de un
`startxref` (actualizari incrementale). Un PDF simplu produce exact acelasi raport ca inainte; un test
verifica explicit asta, ca escaladarea sa nu devina tacit calea implicita.

**Ce castiga concret.** Un `/Launch (calc.exe)` ascuns intr-un flux `ASCIIHexDecode` era complet invizibil
pentru calea rapida — care decomprima doar Flate. Acum qpdf decodeaza fluxul, iar continutul intra prin
**aceleasi** verificari ca orice payload intern (`content_indicators`), deci produce indicatorul obisnuit
de actiune PDF plus mentiunea explicita a filtrului folosit. Testul din `inspectionEngineParity.test.ts`
compara direct cele doua motoare pe acelasi fisier si cere ca setul nativ sa fie strict mai bogat.

**Read-only, fara exceptie.** Fara randare, fara executie de JavaScript, fara rescriere sau reparare a
fisierului primit. Erorile qpdf sunt capturate in wrapper si devin coduri de eroare; cand analiza esueaza,
motorul **cade inapoi** pe parserul rapid, la fel ca la libarchive. Un PDF criptat cu parola nu este
deschis: se raporteaza ca atare, cu verdict neconfirmat.

**Limita onesta pe care am ales-o.** `get_data` din qpdf decodeaza un flux intreg in memorie, fara sa
poata fi oprit la jumatate. Ca sa nu existe o bomba de decompresie neplafonata, fluxurile a caror forma
**bruta** depaseste 64 KiB nu se decodeaza deloc — sunt raportate ca „peste plafonul de decodare".
Marginea e aleasa asa incat cel mai rau caz teoretic (~1000:1 la zlib) sa ramana in ordinul zecilor de MiB
pentru un singur flux, iar bugetul total de bytes decodati opreste oricum traversarea imediat dupa. E un
compromis, nu o acoperire completa: un payload mare intr-un flux mare nu e inspectat, doar semnalat.

Graful de obiecte e parcurs cu set de vizitate pe `(id, generatie)`, deci un ciclu de referinte se
termina; un test construieste ciclul explicit.

**Fallback-ul TypeScript** nu are echivalent qpdf. Ramane parserul rapid: mai putini indicatori, dar
niciodata un fals „curat" — contractul verificat de teste este ca setul nativ le **contine** pe cele ale
fallback-ului, niciodata invers.

### Analiza executabilelor: de ce NU s-a folosit LIEF (etapa 6 din PDF-ul de librarii)

PDF-ul cere LIEF pentru PE/ELF/Mach-O si noteaza ca „expune API C++ si Rust". Am verificat calea Rust
inainte de a o folosi, si acolo se opreste recomandarea.

**Ce face build script-ul crate-ului `lief`:**

```
const GH_URL: &str = "https://github.com/lief-project/LIEF/releases/download";
const DEFAULT_S3_URL: &str = "https://lief-rs.s3.fr-par.scw.cloud";
let mut resp = reqwest::blocking::get(url).expect("failed to download LIEF cache");
zip.extract(&dst_dir)
```

Descarca un ZIP precompilat de pe retea si il extrage. Consecintele, pentru **componenta care parseaza
executabile ostile**:

- binarul nu e acoperit de integritatea `Cargo.lock`, spre deosebire de orice alt crate;
- build-ul cere retea, deci pica in medii izolate;
- un bucket S3 tert intra in lantul de aprovizionare al unei componente de securitate.

**Ce s-a folosit in loc:** `goblin` — parser pur Rust pentru PE, ELF si Mach-O, ~14 milioane de
descarcari pe luna, fara cod C++, fara build script, fara retea.

Argumentul decisiv nu e insa comoditatea, ci suprafata de atac. Parsarea unui executabil controlat de
atacator e cea mai riscanta parsare din tot lantul. In C++, un bug de parser inseamna coruptie de
memorie in proces — exact motivul pentru care etapa 5 a trebuit sa adauge un sandbox de syscall peste
librariile C. In Rust sigur pe memorie, acelasi bug inseamna cel mult un `Err` sau un panic prins.
**A alege C++ aici ar fi insemnat sa adaugam risc si apoi sa construim inca o aparare impotriva lui.**

Regula arhitecturala din PDF spune ca librariile C/C++ furnizeaza „capabilitati mature greu de
reimplementat corect". `goblin` **este** implementarea matura; se intampla sa fie Rust, nu C++. Deviatia
e de la mijloc, nu de la scop.

**Ce se raporteaza**, conform tabelului din PDF: header si arhitectura, sectiuni cu dimensiuni raw vs
virtual si entropie Shannon calculata pe continutul real, permisiuni (semnalam explicit sectiunile si
scriibile si executabile), biblioteci si simboluri importate cu risc (injectie in proces, anti-depanare,
descarcare, lansare de proces), prezenta semnaturii Authenticode, si octetii de dupa ultima sectiune
(overlay). Numele de sectiuni ale packerelor cunoscute (UPX, ASPack, Themida, VMProtect, MPRESS, Petite)
au indicator propriu.

**Ce NU face**, tot conform PDF-ului: niciun disassembler. Sectiunile, importurile si anomaliile
structurale sunt suficiente pentru acest bot; analiza de instructiuni ar fi o cerinta separata.

**Nu produce niciodata `confirmed`.** Un executabil impachetat nu e malware; e doar un executabil
impachetat. Indicatorii ridica verdictul cel mult la `uncertain`, iar confirmarea ramane a motorului
extern — aceeasi politica ca la YARA.

**Cost de build: zero pachete de sistem, zero cod C++, zero descarcari.** Prima etapa din program care
nu adauga nimic la lantul de dependinte.

### ICU4C + libpsl: identitatea domeniului (etapa 6b din PDF-ul de librarii)

PDF-ul cere ICU4C `USpoofChecker` pentru homograph si scripturi mixte, si libpsl pentru eTLD+1. Aceeasi
verificare ca la LIEF: exista echivalente Rust mature pentru fiecare capabilitate?

| Capabilitate ceruta | Ce s-a folosit | De ce |
| --- | --- | --- |
| Punycode si forma Unicode | `idna` (~168M descarcari/luna) | implementarea UTS#46 pe care o foloseste si crate-ul `url` |
| Confusables, scripturi mixte, skeleton | `unicode-security` | implementeaza chiar UTS#39, standardul pe care il implementeaza si `USpoofChecker` |
| Public suffix, eTLD+1 | `publicsuffix` | **lista se incarca la rulare**, nu e compilata in binar |

Ultimul rand e motivul principal, si vine chiar din PDF: *„Cache key-ul include versiunea ICU, versiunea
Public Suffix List si politica de branduri."* O lista care se poate versiona presupune ca se poate
**inlocui fara recompilare**. Legarea libpsl ar fi inghetat un instantaneu in binar; aici lista se
incarca dintr-o sursa externa si primeste un identificator derivat din continut, exact ca ruleset-ul
YARA din etapa 2. Raportul poarta si `unicode_version`, deci ambele componente ale cheii de cache sunt
disponibile apelantului.

Ce se raporteaza, conform cerintelor: host-ul in **ambele** forme (Unicode si Punycode, pastrate
simultan, nu una in locul celeilalte), domeniul inregistrat si sufixul public, skeleton-ul UTS#39,
setul de alfabete si nivelul de restrictie Unicode.

Indicatorii acopera cele doua atacuri distincte pe care PDF-ul le cere separate:

- **homograf** — `disсord.com` scris cu un „с" chirilic are acelasi skeleton ca `discord`, dar nu e
  `discord`; se semnaleaza si amestecul de alfabete, si forma Punycode;
- **subdomeniu inselator** — `login.discord.example.com` are domeniul inregistrat `example.com`, nu
  `discord.com`. Un test verifica explicit ca `cdn.discord.com` NU produce niciun indicator, ca sa nu
  transformam politica intr-o sursa de fals pozitive pe propriile domenii ale brandurilor.

**Nu confirma phishing niciodata.** Un semnal local ridica verdictul cel mult la `uncertain` si trimite
URL-ul mai departe catre motorul extern, la fel ca YARA si ca analiza de executabile.

**Cost de build: zero pachete de sistem, zero C/C++.** ICU4C ar fi adus zeci de MB de date si un build
lung pentru capabilitati pe care standardul le defineste public si crate-urile le implementeaza.

### native-inspector + libseccomp: sandbox de syscall (etapa 5 din PDF-ul de librarii)

Etapele 1-4 au adaugat capabilitati **in procesul existent**: libmagic-like, libyara, libarchive si qpdf
ruleaza toate in addon-ul N-API, adica in acelasi proces cu botul. Etapa 5 schimba altceva: parserele
native complexe primesc fisiere controlate de utilizatori, iar izolarea reala cere un proces separat cu
filtru de syscall-uri, nu doar bugete si timeout-uri.

**Ce contine.** Un binar Rust nou (`native/inspector`), care citeste cereri prin stdin, ruleaza aceeasi
`inspect_untrusted_content` din core si raspunde prin stdout. Dupa ce librariile sunt incarcate si
descriptorii deschisi — si abia atunci — se activeaza filtrul seccomp, care devine **ireversibil**
pentru proces.

**Protocolul e binar, nu JSON.** Cadre cu lungime prefixata, semnatura `DPBI`/`DPBO`, plafoane pe fiecare
camp text si pe continut. La o granita de securitate, suprafata de parsare conteaza: un parser JSON pe
partea care primeste date de la un proces ce tocmai a mestecat un fisier ostil ar fi fost un pas inapoi.

**Politica.** Allowlist minima (read, write, mmap/munmap, futex, ceas, exit si ce cere runtime-ul);
tot restul omoara procesul. Interzise explicit si verificate prin teste: `execve`, `ptrace`, `mount`,
`unshare`, `socket`/`connect`, `openat`, `bpf`, `init_module`. Un test verifica si ca allowlist-ul si
denylist-ul nu se suprapun — o politica ambigua e mai rea decat una stricta.

**Dovada ca filtrul chiar taie.** Un test de integratie, exclusiv pe Linux, reporneste binarul de test
ca sonda: activeaza filtrul, apoi cheama `socket()`. Testul cere ca procesul sa moara cu **SIGSYS**, nu
sa continue. Acelasi lucru pentru `fork()`. Si invers: un apel din allowlist (`clock_gettime`) trebuie sa
treaca, altfel filtrul ar ucide procesul inainte sa apuce sa raspunda.

**Ce NU pot verifica local.** Seccomp exista doar pe Linux. Pe Windows am putut testa protocolul,
supervizorul, repornirea si degradarea; faptul ca un syscall interzis chiar omoara procesul se verifica
**exclusiv in CI**. De aceea `check:native` a fost extins sa ruleze si testele crate-ului de inspectie:
altfel testul care apara filtrul nu ar fi rulat niciodata nicaieri.

**Supervizorul, si de ce ramane optional deocamdata.** Partea TypeScript porneste procesul, trimite
cereri cu termen, si trateaza trei feluri de esec — proces ucis, termen depasit, raspuns necitibil —
identic: **fara raport**, jobul ramane neconfirmat, procesul se reporneste, metricile cresc
(`bot_native_inspector_kills_total`, `_restarts_total`, `_timeouts_total`, `bot_native_inspector_sandboxed`).

Inspectia nu e rutata implicit prin acest proces. Motivul e cel de mai sus: nu am putut verifica local
filtrul, iar calea aceasta ar deveni calea fiecarui atasament. Un IPC per fisier, pe o componenta al
carei mecanism principal de aparare nu poate fi exersat pe masina de dezvoltare, nu se pune implicit pe
drumul critic doar pe baza unei rulari verzi de CI. Comutarea implicitului cere masuratori pe staging
(latenta per atasament, rata de repornire) si e un pas separat, nu o nota de subsol aici.

### Costul de CI al librariilor native (masurat, nu estimat)

Fiecare librarie C/C++ legata static se compileaza din surse. Fara cache, costul se aduna la fiecare
rulare de CI, nu doar la prima. Masuratoare pe jobul `check`, aceleasi trei etape:

| Pas | inainte de librarii (20 iul) | + libyara si libarchive | + qpdf |
| --- | --- | --- | --- |
| Validate Rust (clippy + teste) | 14s | 1m37s | 3m08s |
| Run project checks (napi build + teste) | 47s | 1m20s | 2m10s |
| Benchmark hot-path guard | 5m41s | 5m26s | 5m39s |

Doua concluzii, ambele contraintuitive:

1. **Pasul dominant a fost dintotdeauna benchmark-ul**, nu compilarea. Cei ~5m40s sunt costul lui
   legitim: best-of-N pe fiecare functie hot-path, ca pragurile din acest document sa fie stabile
   statistic. Nu se reduce prin taierea iteratiilor fara sa slabeasca gate-ul.
2. **Compilarea C a adaugat ~4 minute pe rulare fiindca `ci.yml` nu avea niciun cache de cargo.**
   Aceleasi surse se recompilau identic la fiecare push.

Solutia e `Swatinem/rust-cache` in `ci.yml`, cu cheia derivata din `Cargo.lock`: dependintele si
librariile C compilate raman intre rulari, iar o schimbare reala de dependinte invalideaza corect
cache-ul. Prima rulare dupa o astfel de schimbare ramane la costul intreg; restul refolosesc.

Acelasi rationament se aplica si build-ului de container din `container-scan.yml`, care recompila
librariile C **inca o data**, in imagine, la fiecare rulare. Acolo cache-ul de layere are insa o
capcana proprie: cu layere refolosite, `apt-get upgrade` din stage-ul de runtime nu se mai executa,
iar Trivy ar scana o imagine veche si ar raporta curat pe baza unor pachete pe care productia nu le
mai are. De aceea cache-ul e activ pe push si pe pull request — unde intrebarea e „a introdus
schimbarea mea o vulnerabilitate?" — si **dezactivat explicit pe rularea programata saptamanal**,
unde intrebarea e „au aparut CVE-uri noi in imaginea de baza?". Fara aceasta exceptie, cron-ul
saptamanal ar fi devenit decorativ.

`release.yml` **NU** primeste cache in mod deliberat: artefactele publicate se construiesc de fiecare
data din surse, ca binarul livrat sa nu depinda de continutul unui cache. Cele cateva minute in plus
pe un workflow rar sunt un pret corect pentru asta.

Nota pentru etapele urmatoare din programul de librarii: PDFium, FFmpeg si Tesseract sunt cu un ordin
de marime mai grele decat qpdf. Fara cache-ul de mai sus, CI-ar fi devenit impracticabil in jurul
etapei 8, nu la sfarsit.

### Guard automat in CI (deciziile de mai sus, impuse)

Pentru ca deciziile „ramane in Rust pentru ca e mai rapid" sa nu se erodeze tacut, exista un guard
automat care leaga acest document de CI: `npm run benchmark:guard` (`scripts/benchmarkGuard.ts`), rulat
in `ci.yml` dupa `npm run check` (cand addonul nativ e deja construit). Guard-ul masoara, best-of-N
(`BENCH_GUARD_RUNS`, implicit 3), functiile hot-path pe care le pastram in Rust — `levenshtein`,
`dealHash`, `stableUpdateId`, `rankListingCandidates`, `extractAndRankListingCandidates`,
`chooseBestSteamMatch` si `inspectUntrustedContent` — fata de fallback-ul TS, si:

- **esueaza** (`::error::`, exit 1) daca o functie hot-path e **mai lenta decat TS** sub pragul de esec
  (`BENCH_HOTPATH_FAIL_RATIO`, implicit `0.85x`) — semn ca decizia din acest document nu mai e valabila
  (regula limbajului: ramane doar daca e mai bun/eficient), deci trebuie mutata in TS sau investigata regresia;
- **esueaza** daca paritatea native != TS (rezultate divergente) — bug de corectitudine, nu de viteza;
- **avertizeaza** (`::warning::`, fara a pica) daca speedup-ul scade sub pragul asteptat documentat aici
  (`levenshtein` < `1.4x`, `dealHash` < `1.2x`, `stableUpdateId` < `1.2x`, `rankListingCandidates` < `1.1x`, `extractAndRankListingCandidates` < `1.1x`, `chooseBestSteamMatch` < `1.3x`, `inspectUntrustedContent` < `4x`), ca semnal ca avantajul Rust se erodeaza;
- masoara pentru `inspectUntrustedContent` **alta metrica**, declarata explicit in raport
  (`metric`): reducerea blocarii event loop-ului (TS sincron / Rust `AsyncTask`), nu latenta
  secventiala — vezi sectiunea despre motorul batch asincron pentru de ce latenta secventiala ar fi
  o metrica inselatoare aici;
- se **sare** (CI-safe, exit 0) cand addonul nativ nu e disponibil — **cu exceptia** modului strict
  `BENCH_GUARD_REQUIRE_NATIVE=true` (setat in `ci.yml`), unde absenta addonului devine **esec**: in CI
  build-ul Rust ruleaza inainte de guard, deci un addon lipsa inseamna o problema de build, nu un skip
  acceptabil. Local (fara variabila) guard-ul ramane CI-safe si sare cand nativul lipseste.

#### Cum isi alege guard-ul durata de masurare (si de ce nu prin taierea iteratiilor)

Guard-ul rula `runAreaBenchmarks()`, care masoara **toate** ariile, si folosea apoi doar cinci dintre
ele. Jumatate din munca se arunca, de trei ori la rand. Acum guard-ul cere explicit doar ariile pe care
le noteaza; raportul complet `npm run benchmark` continua sa le acopere pe toate.

A doua schimbare tine de metodologie. Numarul de iteratii era fixat in cod (200.000 pentru
`levenshtein`, 100.000 pentru fiecare arie) si nu exista nicio faza de incalzire, deci costul de JIT
intra direct in fereastra masurata: N-ul urias facea pe ascuns si treaba de warmup. Acum fiecare arie
primeste o **calibrare**: se incalzeste, se cronometreaza o sonda scurta, si din ea se deduce cate
iteratii incap intr-un buget de timp (`CPU_BENCH_BUDGET_MS`, implicit 250 ms; incalzire
`CPU_BENCH_WARMUP_MS`, implicit 50 ms). `CPU_BENCH_ITER` ramane disponibil si, cand e setat, forteaza
numarul fix de iteratii — util pentru reproducerea unei masuratori vechi.

Detaliu care conteaza pentru corectitudinea raportului: numarul calibrat se deduce din partea **TS**
si se aplica **identic** ambelor implementari. Altfel fiecare parte ar rula pana la acelasi buget si
raportul `tsMs / nativeMs` ar iesi mereu ~1, adica exact metrica pe care o apara acest document.

**Ce s-a schimbat in cifre.** Comparatie pe aceeasi masina, metodologia veche vs cea calibrata:

| arie | iteratii fixe | calibrat | diferenta |
| --- | --- | --- | --- |
| levenshtein | 1.83x | 1.85x | in zgomot |
| dealHash | 1.42x | 1.40x | in zgomot |
| stableUpdateId | 2.01x | 2.04x | in zgomot |
| rankListingCandidates | 1.39x | 1.37x | in zgomot |
| extractAndRankListingCandidates | 2.23x | 2.27x | in zgomot |
| chooseBestSteamMatch | 2.07x | ~2.37x | **real, reproductibil** |

Sase din sapte coincid in ~2%. `chooseBestSteamMatch` raporteaza consecvent mai mult (2.33–2.45 pe
rulari repetate). **Cauza nu a fost izolata**: nu e incalzirea (fara ea valoarea ramane ~2.36) si nu e
fereastra prea scurta (la buget de 250 ms, 1 s si 2,5 s valorile sunt 2.45 / 2.35 / 2.38, adica plate).
E consemnata aici ca observatie deschisa, nu explicata. Ambele valori sunt insa mult peste pragul de
avertizare al ariei (`1.3x`) si cu un ordin de marime peste pragul de esec (`0.85x`), deci nicio
decizie a gate-ului nu se schimba; efectul practic e ca o eroziune reala a acestei arii ar trebui sa
fie ceva mai mare inainte sa treaca pragul.

**Ce NU s-a facut:** nu s-au taiat iteratii ca sa iasa timpul. Aia ar fi fost slabirea gate-ului
deghizata in optimizare. Calibrarea pastreaza aceeasi bucla stransa, fara ceas in interior; se schimba
doar felul in care se alege lungimea ei, plus incalzirea care scoate JIT-ul din fereastra masurata.

Pragurile sunt deliberat tolerante la zgomotul masinilor de CI (best-of-N + prag de esec sub `1.0x`),
deci nu pica la variatii mici, doar la o regresie clara (Rust devine efectiv mai lent decat TS).
Logica de evaluare (`evaluateBenchmarkGuard`) este acoperita de teste deterministe in
`benchmarkGuard.test.ts` (mai rapid -> OK, sub asteptat -> avertisment, mai lent -> esec, paritate
divergenta -> esec, nativ indisponibil -> sarit).

## 2. Outbox: drenare job-by-job (I/O-bound)

`npm run benchmark:outbox` seedeaza N joburi in `notificationOutbox` (Mongo real) si
masoara o drenare completa cu `deliver` no-op (deci timpul reflecta strict costul de DB +
bucla de drenare, fara latenta Discord).

Masuratoare reprezentativa (Mongo local):

| Joburi | Total | ms/job | joburi/s |
| --- | --- | --- | --- |
| 1.000 | ~1.7s | ~1.7 | ~590 |
| 5.000 | ~7.3s | ~1.5 | ~680 |
| 10.000 | ~14s | ~1.4 | ~710 |

Costul per job e dominat de round-trip-urile sincrone catre Mongo (claim atomic
`findOneAndUpdate` + verificare `notificationOutboxSent` + `markSent` + `deleteOne`).
Scalarea este **liniara** (~1.4ms/job stabil), deci drenarea job-by-job **nu** devine
brusc bottleneck — pur si simplu dureaza proportional cu numarul de joburi.

`runOutboxPhaseBreakdown` (in acelasi script) descompune cei ~1.3ms/job de Mongo pe faze
si ii pune in context fata de o trimitere Discord tipica (masuratoare reprezentativa, Mongo
local, `deliver` mock, `OUTBOX_BENCH_SEND_MS=100`):

| Faza per job | ms/job |
| --- | --- |
| claim (`findOneAndUpdate`) | ~0.46 |
| dedupe-check (`exists`) | ~0.26 |
| markSent (`updateOne`) | ~0.36 |
| delete (`deleteOne`) | ~0.25 |
| **TOTAL Mongo** | **~1.33** |
| vs trimitere Discord tipica ~100ms | **Mongo = ~1.3% din timpul real per job** |

Asta cuantifica de ce optimizarea ramane viitoare: per job, **~98.7% din timp e trimiterea
Discord (rate-limited)**, iar Mongo e ~1.3%. Un claim in batch / `bulkWrite` ar reduce doar
faza `claim` (~0.46ms) — celelalte trei raman per-job din **corectitudine** (claim atomic +
`markSent`-inainte-de-`deleteOne` pentru crash-safety), deci plafonul realist de castig e
**sub ~1.3%** pe o cale dominata de Discord. La ~700 joburi/s pe care Mongo le sustine deja
vs ritmul mult mai mic impus de rate-limit-ul Discord, exista ~60x rezerva de Mongo peste
ce permite Discord — deci batch-claim ar mari o rezerva oricum nefolosita, cu riscul de a
rescrie claim-ul atomic multi-instanta (clasa de bug #237). Decizia pe date: **nu acum.**

**Decizie:**

- Outbox-ul **ramane in TypeScript**. Bottleneck-ul este I/O (Mongo + Discord), nu CPU;
  rescrierea in Rust nu ar aduce niciun castig (timpul se duce in round-trip-uri de retea,
  nu in calcul).
- Drenarea **job-by-job (cu lease atomic)** ramane implementarea curenta fiindca garanteaza
  exact-once la nivel de claim si e corecta intre instante. Un `bulkWrite` / claim in batch
  ar reduce numarul de round-trip-uri, dar este o optimizare **viitoare** cu praguri de
  declansare concrete documentate in `ROADMAP.md` („Outbox: claim in batch"): pe scurt,
  `bot_outbox_queue_depth` > 500 sustinut ≥ 2h sau `bot_outbox_oldest_job_age_seconds` > 900
  sustinut ≥ 30 min **in timp ce worker-ul chiar dreneaza** (nu pe pauza). Alerta
  `OutboxBatchDrainRecommended` semnaleaza automat aceasta conditie. La ~700 joburi/s per
  drenare, cu worker pe interval scurt si rate-limit Discord ca factor dominant real, volumul
  tipic este acoperit confortabil sub aceste praguri.

## 3. Scalare notificari

`npm run benchmark` (vezi `scripts/notificationBenchmark.ts`) arata ca faza de fetch este
O(surse) (partajata intre guild-uri), iar dispatch-ul este O(guild-uri) cu un singur mesaj
batch (pana la 10 embed-uri) per guild — deci costul creste cu numarul de servere abonate,
nu cu numarul de jocuri.

## 4. Politica limbaje: cand folosim Rust si cand TypeScript

Regula practica derivata din masuratorile de mai sus (si aliniata cu regulile 6 si 20 din
`docs/Reguli de respectat.md`):

- **Rust merita doar pentru logica pura CPU-bound**: fuzzy matching pe volume mari,
  normalizare masiva de text, parsare/scoring de preturi sau dedupe pe liste mari. Chiar si
  acolo, decizia se ia pe benchmark real (`npm run benchmark:cpu`), nu pe intuitie —
  sectiunea 1 arata ca `buildAutocompleteChoices` a iesit ~0.09x in Rust (boundary cost NAPI
  peste un workload mic), deci a ramas TS-primary.
- **Rust merita si pentru munca lunga care blocheaza event loop-ul**, chiar la egalitate de viteza
  bruta: daca un singur apel poate rula milisecunde bune pe input controlat de atacator (inspectia
  pasiva a atasamentelor), mutarea lui intr-un `AsyncTask` scoate blocarea de pe event loop si permite
  paralelism real. Metrica de decizie acolo e blocarea main thread-ului si throughput-ul concurent, nu
  latenta unui apel izolat (vezi sectiunea despre motorul batch asincron).
- **Nu mutam I/O in Rust**: orchestrarea Discord, Mongo, HTTP, cron si fluxul YouTube sunt
  dominate de latenta de retea/DB (sectiunea 2: outbox-ul e I/O-bound, rate-limit Discord e
  factorul real), unde Rust nu aduce nimic si complica build-ul si review-ul. Pentru acestea
  TypeScript ramane alegerea corecta.
- **Orice mutare noua in Rust cere**: benchmark inainte/dupa in acest fisier, prag de
  regresie in `benchmarkGuard` (gardul pica daca avantajul Rust dispare) si fallback TS
  echivalent testat pentru paritate.

**Confirmare review "Backlog Refactor" #10 (2026-07-04).** Recomandarea review-ului — "nu muta
HTTP/Mongo/Discord in Rust; investigheaza doar hot-path-uri CPU-bound cu benchmark:
dedupe/ranking oferte, normalizare string, scoring fuzzy suplimentar, eventual packing de
loturi mari" — coincide cu politica de mai sus, iar candidatii numiti sunt deja masurati si
decisi cu date in sectiunea 1: dedupe-ul de oferte (`dealHash`) si ranking-ul
(`rankListingCandidates`) ruleaza in crate-ul Rust (cu praguri in `benchmarkGuard`),
normalizarea de string (`normalize_title_for_dedupe`/`clean_text`) si fuzzy matching-ul
(`find_game_keys`/`levenshtein`) la fel, iar scoring-ul suplimentar de autocomplete
(`buildAutocompleteChoices`) a iesit ~0.09x in Rust si a ramas intentionat TS-primary.
Singurul candidat numit si nemasurat — "packing de loturi mari" (gruparea embed-urilor in
mesaje batch si a joburilor de outbox) — nu e un hot-path CPU: gruparea e slicing liniar pe
liste mici (max 10 embed-uri/mesaj), iar costul real e I/O-ul Discord (sectiunea 2, ~98.7%
Discord-bound), deci ramane TypeScript; devine candidat de benchmark doar daca profilarea
arata altceva la volume mult mai mari. Concluzie: niciun port nou in Rust fara un benchmark
care arata castig real — exact regula existenta, confirmata.
