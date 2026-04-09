const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const http = require("http");
const cron = require("node-cron");
const Parser = require("rss-parser");
const crypto = require("crypto");
const { z } = require("zod");
const rssParser = new Parser();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

// -------------------------------------------------------------
// CONSTANTE GLOBALE
// -------------------------------------------------------------
const PREFIX = "big_master!";
const MAX_DEALS = 40; 
const MAX_FREE_PER_STORE = 20;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 50;
const GLOBAL_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY = 5;
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/120.0"
];

// -------------------------------------------------------------
// SISTEM DE TRADUCERI (i18n)
// -------------------------------------------------------------
const i18n = {
  ro: {
    adminOnly: "⛔ Doar un admin poate folosi această comandă.",
    pong: "Pong! 🏓",
    setChannelUpdates: "⏳ Setez canalul...",
    updatesActive: "✅ Update-uri automate activate.",
    initError: "Eroare la inițializarea datelor.",
    startUpdatesSyntax: "❌ Sintaxă: `{prefix}start updates`, `{prefix}start deals` sau `{prefix}start free games`.",
    setChannelDeals: "⏳ Setez canalul pentru oferte plătite...",
    dealsActive: "✅ Alertele pentru reduceri (plătite) activate!",
    setChannelFree: "⏳ Setez canalul pentru jocuri gratuite...",
    freeActive: "✅ Alertele pentru jocurile promoționale 100% GRATUITE activate!",
    dealsError: "Eroare internă la preluarea ofertelor.",
    stopUpdates: "🛑 Update-uri oprite.",
    stopDeals: "🛑 Reduceri oprite.",
    stopFree: "🛑 Notificările de jocuri gratuite oprite.",
    stopSyntax: "❌ Sintaxă: `{prefix}stop updates`, `{prefix}stop deals` sau `{prefix}stop free games`.",
    setHelp: "⚙️ Setări: mode, mindiscount, language.",
    invalidMode: "❌ Permise: `compact` sau `detailed`.",
    modeSet: "✅ Mod setat: **{value}**",
    invalidDiscount: "❌ 0-100.",
    discountSet: "✅ Reducere minimă: **{value}%**",
    invalidLang: "❌ Limbi permise: `ro` sau `en`.",
    langSet: "✅ Limba setată: **{value}**",
    unknownSetting: "❌ Setare necunoscută.",
    saveError: "Eroare la salvarea preferințelor.",
    estTime: "⏳ *Durată estimată: **{time} secunde***",
    fetchUpdatesError: "Nu am reușit să obțin update-urile.",
    noData: "❌ Nu am date disponibile.",
    dataLoaded: "✅ Date încărcate!",
    fetchDealsError: "Nu am putut interoga magazinele.",
    noDealsMatch: "❌ Nu am găsit oferte care să corespundă setărilor serverului.",
    noFreeMatch: "❌ Nu am găsit jocuri promoționale 100% gratuite în acest moment.",
    dealsLoaded: "✅ Oferte încărcate!",
    freeLoaded: "✅ Promoții gratuite găsite!",
    latestUpdateSyntax: "❌ Ex: `{prefix}latest update cs2`.",
    connecting: "⏳ *Mă conectez... Durată estimată: **{time} secunde**.*",
    gameNotFound: "❌ Nu am găsit jocul.",
    didYouMean: " Te refereai cumva la **{name}** (`{key}`)?",
    updateSuccess: "✅ Update **{name}**:",
    updateError: "Nu am putut prelua acest update.",
    priceSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}latest price cyberpunk`.",
    searchingDualPrice: "⏳ *Caut prețul pe Steam și Epic Games pentru **{name}**...*",
    steamError: "❌ Eroare la conectarea cu serverele Steam.",
    noSteamResults: "❌ Nu am găsit niciun rezultat pe Steam pentru \"**{name}**\".",
    noDualResults: "❌ Nu am găsit niciun rezultat pe Steam sau Epic Games pentru \"**{name}**\".",
    invalidSteamResult: "❌ Nu am putut selecta un rezultat valid de pe Steam.",
    steamApiError: "❌ Steam API nu a putut returna detaliile.",
    steamDetailsUnavailable: "❌ Detaliile de preț nu sunt disponibile (posibil blocat regional).",
    priceDualSuccess: "✅ Am obținut prețurile!",
    dualPriceTitle: "🏷️ Preț curent: {title}",
    notFoundSteam: "❌ Jocul nu a fost găsit (sau nu are preț public) pe Steam.",
    notFoundEpic: "❌ Jocul nu a fost găsit pe Epic Games.",
    priceUnexpectedError: "❌ A apărut o eroare neașteptată la căutarea prețului.",
    dlcSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}dlc cyberpunk`.",
    searchingDlc: "⏳ *Caut DLC-urile pentru **{name}**...*",
    ageGate: "❌ Pagina de Steam pentru **{name}** necesită verificare de vârstă, iar botul nu o poate accesa direct.",
    pageStructureError: "❌ Structura paginii pentru **{name}** nu a putut fi interpretată (posibil regiune blocată sau pachet special).",
    noDlcList: "❌ Jocul **{name}** nu are niciun DLC listat separat pe magazinul Steam.",
    dlcSuccess: "✅ Am găsit **{count}** DLC-uri pentru **{name}**!",
    dlcUnexpectedError: "❌ A apărut o eroare la căutarea DLC-urilor.",
    statusSyntax: "❌ Trebuie să specifici un joc. Ex: `{prefix}status fortnite`.",
    searchingStatus: "⏳ *Verific statusul serverelor pentru **{name}**...*",
    statusSuccess: "✅ Informații preluate pentru **{name}**:",
    statusError: "❌ A apărut o eroare la preluarea statusului.",
    helpTitle: "🤖 Meniul de Ajutor - Big Master",
    helpDetailedTitle: "📖 Detalii comandă",
    helpCmdNotFound: "❌ Nu am găsit detalii pentru această comandă. Asigură-te că ai scris-o corect.",
    helpFooter: "💡 Tip: Folosește `{prefix}help [comandă]` pentru explicații detaliate",
    helpGeneral: "🛠️ Comenzi pentru Ajutor Utilizator",
    helpNotif: "🔔 Comenzi pentru Notificare",
    helpPrefs: "⚙️ Comenzi Setare Bot Pentru Server",
    helpManual: "🎮 Comenzi Jocuri",
    trackedGames: "🎮 **Jocuri urmărite:**\n",
    onlyAuthor: "Doar autorul comenzii poate naviga!",
    prev: "◀ Ant",
    next: "Urm ▶",
    updateTitleText: "Apasă pe titlu pentru a citi patch-ul.",
    updateDescText: "A apărut un nou update pentru {name}.",
    fallbackUpdateTitle: "Update nou",
    free: "Gratuit",
    discount: "Reducere",
    oldPrice: "Preț Vechi",
    newPrice: "Preț Nou",
    link: "Link",
    details: "Detalii",
    platformsLabel: "Platforme",
    quality: "Calitate",
    popularity: "Popularitate",
    expiresAt: "Expiră la",
    freeUntil: "Gratis până la",
    page: "Pagina",
    displayed: "Afișate",
    extracted: "Extrase",
    dlcMoreNote: "⚠️ Pot exista mai multe DLC-uri pe pagina oficială.",
    notifiedUpdate: "🔔 A apărut un update nou pentru **{name}**!",
    notifiedDeal: "🔥 Ofertă nouă detectată!",
    notifiedFree: "🎁 Un joc GRATUIT (Promoție 100%) a apărut!",
    typeProd: "**Tip produs:**",
    typeGame: "Joc",
    currFree: "Acest titlu este permanent gratuit (Free-to-Play).",
    priceUnav: "Prețul nu este disponibil în acest moment.",
    activeDisc: "Este o reducere activă de **{percent}%**!\n\n~~{old}~~ -> **{new}**",
    expAt: "\n⏳ **Oferta expiră la:** ",
    expUnspec: "Nespecificat (posibil ofertă permanentă sau bundle).",
    noDisc: "Nu este la reducere în acest moment.\n\nPreț standard: **{price}**",
    statusApiErr: "Acest joc nu are un API de status public integrat. Poți verifica link-urile de mai jos.",
    statusServ: "**Status Server:**",
    statusRoblox: "Apasă pe linkul de mai jos pentru a vedea starea oficială Roblox.",
    statusRiot: "Apasă pe linkul de mai jos pentru a vedea starea oficială Riot Games.",
    noLink: "Nu este disponibil un link oficial.",
    statusTitle: "📡 Status Servere: {name}",
    statusOff: "🔗 Pagină Oficială de Status",
    statusCheckText: "Verifică Statusul Aici",
    statusHome: "🏠 Pagină Principală / Steam",
    statusFallbackText: "Accesează Pagina Jocului",
    statusFallbackNote: "\n*(Acesta este link-ul general al jocului, nu o pagină automată de status)*",
    searchDowndetector: "🔍 Caută pe Downdetector",
    dlcPack: "📦 DLC-uri: {title}",
    dlcBuyLink: "🛒 Cumpără / Vezi pe Steam",
    dealOffer: "🏷️ **{store}** oferă o reducere de **{savings}%**!\n\n",
    freeOffer: "🎁 **{store}** oferă acest titlu **GRATUIT** pentru o perioadă limitată!\n\n",
    defaultError: "A apărut o eroare internă.",
    errCircuitBreaker: "Circuit Breaker Activ",
    errSteamPatch: "Lipsă patch notes Steam valabile.",
    errAncore: "Nu am găsit ancore valide.",
    errFortnite: "Nu am găsit postări valide.",
    errFortniteTotal: "Eșec total Fortnite.",
    errAMD: "Eșec AMD.",
    errIntel: "Eșec Intel.",
    errMinecraft: "Lipsă versiune JSON.",
    errRoblox: "Lipsă versiune API.",
    errNvidia: "Eșec Nvidia.",
    errUnknownType: "Tip necunoscut.",
    errNoValidDeals: "Fără oferte valide.",
    helpGeneralCmds: "`{prefix}help`\n`{prefix}help [nume comandă]`\n`{prefix}ping`",
    helpNotifCmds: "`{prefix}start updates`\n`{prefix}stop updates`\n`{prefix}start deals` (sau `reduceri`)\n`{prefix}stop deals`\n`{prefix}start free games` (sau `free`)\n`{prefix}stop free games`",
    helpPrefsCmds: "`{prefix}set mode [compact/detailed]`\n`{prefix}set mindiscount [0-100]`\n`{prefix}set language [ro/en]`",
    helpManualCmds: "`{prefix}games` (sau `{prefix}porecle`)\n`{prefix}latest updates`\n`{prefix}latest deals` (doar jocuri plătite)\n`{prefix}latest free games` (până la 20 Steam/Epic)\n`{prefix}latest update [poreclă]`\n`{prefix}latest price [nume joc]`\n`{prefix}dlc [nume joc]`\n`{prefix}status [nume joc]`",
    excerptFortnite: "Update oficial Fortnite.",
    excerptAmdDriver: "Driver disponibil.",
    excerptAMD: "Update AMD.com.",
    excerptIntel: "Update intel.com detectat.",
    excerptVersion: "Versiunea {v}",
    helpCmd_ping: "🏓 **Ping:** Verifică timpul de răspuns (latența) botului.",
    helpCmd_games: "🎮 **Games/Porecle:** Afișează o listă completă cu toate jocurile monitorizate automat.",
    helpCmd_porecle: "🎮 **Games/Porecle:** Afișează o listă completă cu toate jocurile monitorizate automat.",
    helpCmd_start_updates: "🔔 **Start Updates:** *(Necesită Administrator)* Setează canalul destinație pentru noile Patch Notes.",
    helpCmd_stop_updates: "🛑 **Stop Updates:** *(Necesită Administrator)* Oprește trimiterea automată a update-urilor.",
    helpCmd_start_deals: "🔔 **Start Deals:** *(Necesită Administrator)* Setează destinația pentru alertele cu reduceri (doar jocuri care costă bani).",
    helpCmd_start_reduceri: "🔔 **Start Deals:** *(Necesită Administrator)* Setează destinația pentru alertele cu reduceri (doar jocuri care costă bani).",
    helpCmd_stop_deals: "🛑 **Stop Deals:** *(Necesită Administrator)* Oprește notificările de reduceri.",
    helpCmd_stop_reduceri: "🛑 **Stop Deals:** *(Necesită Administrator)* Oprește notificările de reduceri.",
    helpCmd_start_free_games: "🔔 **Start Free Games:** *(Necesită Administrator)* Setează destinația EXCLUSIV pentru jocurile promoționale (reducere 100%).",
    helpCmd_start_free: "🔔 **Start Free Games:** *(Necesită Administrator)* Setează destinația EXCLUSIV pentru jocurile promoționale (reducere 100%).",
    helpCmd_stop_free_games: "🛑 **Stop Free Games:** *(Necesită Administrator)* Oprește notificările pentru jocurile gratuite.",
    helpCmd_stop_free: "🛑 **Stop Free Games:** *(Necesită Administrator)* Oprește notificările pentru jocurile gratuite.",
    helpCmd_set_mode: "⚙️ **Set Mode:** *(Necesită Administrator)* Schimbă dimensiunea mesajelor (compact/detailed).",
    helpCmd_set_mindiscount: "⚙️ **Set MinDiscount:** *(Necesită Administrator)* Setează pragul minim (în procente) pentru oferte.",
    helpCmd_set_language: "⚙️ **Set Language:** *(Necesită Administrator)* Schimbă limba botului (ro/en).",
    helpCmd_latest_updates: "🔍 **Latest Updates:** Afișează o listă paginată ({items} pe pagină) cu cele mai noi actualizări.",
    helpCmd_latest_deals: "🔍 **Latest Deals:** Afișează cele mai populare reduceri plătite la jocuri (Steam/Epic).",
    helpCmd_latest_reduceri: "🔍 **Latest Deals:** Afișează cele mai populare reduceri plătite la jocuri (Steam/Epic).",
    helpCmd_latest_free_games: "🔍 **Latest Free Games:** Afișează o listă cu până la 20 promoții 100% gratuite Steam și 20 Epic Games disponibile acum.",
    helpCmd_latest_free: "🔍 **Latest Free Games:** Afișează o listă cu până la 20 promoții 100% gratuite Steam și 20 Epic Games disponibile acum.",
    helpCmd_latest_update: "🔍 **Latest Update [nume]:** Caută ultimul update lansat doar pentru jocul specificat.",
    helpCmd_latest_price: "🔍 **Latest Price [nume]:** Caută prețul curent simultan pe **Steam** și pe **Epic Games**.",
    helpCmd_latest_pret: "🔍 **Latest Price [nume]:** Caută prețul curent simultan pe **Steam** și pe **Epic Games**.",
    helpCmd_dlc: "🔍 **DLC [nume joc]:** Extrage lista completă de DLC-uri pentru un joc de pe Steam.",
    helpCmd_status: "📡 **Status [nume joc]:** Interoghează starea curentă a serverelor pentru jocul menționat."
  },
  en: {
    adminOnly: "⛔ Admin only.",
    pong: "Pong! 🏓",
    setChannelUpdates: "⏳ Setting updates channel...",
    updatesActive: "✅ Automatic updates enabled.",
    initError: "Error initializing data.",
    startUpdatesSyntax: "❌ Syntax: `{prefix}start updates`, `{prefix}start deals` or `{prefix}start free games`.",
    setChannelDeals: "⏳ Setting deals channel...",
    dealsActive: "✅ Deal alerts (paid) enabled!",
    setChannelFree: "⏳ Setting free games channel...",
    freeActive: "✅ 100% FREE games alerts enabled!",
    dealsError: "Internal error fetching deals.",
    stopUpdates: "🛑 Updates stopped.",
    stopDeals: "🛑 Deals stopped.",
    stopFree: "🛑 Free games notifications stopped.",
    stopSyntax: "❌ Syntax: `{prefix}stop updates`, `{prefix}stop deals` or `{prefix}stop free games`.",
    setHelp: "⚙️ Settings: mode, mindiscount, language.",
    invalidMode: "❌ Allowed: `compact` or `detailed`.",
    modeSet: "✅ Mode set to: **{value}**",
    invalidDiscount: "❌ 0-100.",
    discountSet: "✅ Minimum discount: **{value}%**",
    invalidLang: "❌ Allowed languages: `ro` or `en`.",
    langSet: "✅ Language set to: **{value}**",
    unknownSetting: "❌ Unknown setting.",
    saveError: "Error saving preferences.",
    estTime: "⏳ *Estimated time: **{time} seconds***",
    fetchUpdatesError: "Failed to fetch updates.",
    noData: "❌ No data available.",
    dataLoaded: "✅ Data loaded!",
    fetchDealsError: "Failed to fetch deals.",
    noDealsMatch: "❌ No deals found matching server settings.",
    noFreeMatch: "❌ No 100% free promotional games found at this moment.",
    dealsLoaded: "✅ Deals loaded!",
    freeLoaded: "✅ Free promotions found!",
    latestUpdateSyntax: "❌ Ex: `{prefix}latest update cs2`.",
    connecting: "⏳ *Connecting... Estimated time: **{time} seconds**.*",
    gameNotFound: "❌ Game not found.",
    didYouMean: " Did you mean **{name}** (`{key}`)?",
    updateSuccess: "✅ Update **{name}**:",
    updateError: "Could not fetch this update.",
    priceSyntax: "❌ You must specify a game. Ex: `{prefix}latest price cyberpunk`.",
    searchingDualPrice: "⏳ *Searching Steam and Epic Games for **{name}**...*",
    steamError: "❌ Error connecting to Steam servers.",
    noSteamResults: "❌ No Steam results found for \"**{name}**\".",
    noDualResults: "❌ No results found on Steam or Epic Games for \"**{name}**\".",
    invalidSteamResult: "❌ Could not select a valid Steam result.",
    steamApiError: "❌ Steam API could not return details.",
    steamDetailsUnavailable: "❌ Price details are unavailable (possibly region blocked).",
    priceDualSuccess: "✅ Prices retrieved!",
    dualPriceTitle: "🏷️ Current Price: {title}",
    notFoundSteam: "❌ Game not found (or has no public price) on Steam.",
    notFoundEpic: "❌ Game not found on Epic Games.",
    priceUnexpectedError: "❌ Unexpected error fetching the price.",
    dlcSyntax: "❌ You must specify a game. Ex: `{prefix}dlc cyberpunk`.",
    searchingDlc: "⏳ *Searching DLCs for **{name}**...*",
    ageGate: "❌ Steam page for **{name}** is age-restricted; bot cannot access it directly.",
    pageStructureError: "❌ Page structure for **{name}** could not be parsed (possibly region blocked or special bundle).",
    noDlcList: "❌ **{name}** has no separately listed DLCs on Steam.",
    dlcSuccess: "✅ Found **{count}** DLCs for **{name}**!",
    dlcUnexpectedError: "❌ Error searching for DLCs.",
    statusSyntax: "❌ You must specify a game. Ex: `{prefix}status fortnite`.",
    searchingStatus: "⏳ *Checking server status for **{name}**...*",
    statusSuccess: "✅ Status retrieved for **{name}**:",
    statusError: "❌ Error retrieving status.",
    helpTitle: "🤖 Help Menu - Big Master",
    helpDetailedTitle: "📖 Command Details",
    helpCmdNotFound: "❌ Details not found for this command. Make sure you typed it correctly.",
    helpFooter: "💡 Tip: Use `{prefix}help [command]` for detailed explanations",
    helpGeneral: "🛠️ General Utility Commands",
    helpNotif: "🔔 Notification Commands",
    helpPrefs: "⚙️ Bot Setup Commands",
    helpManual: "🎮 Game Commands",
    trackedGames: "🎮 **Tracked Games:**\n",
    onlyAuthor: "Only the command author can navigate!",
    prev: "◀ Prev",
    next: "Next ▶",
    updateTitleText: "Click the title to read the patch notes.",
    updateDescText: "A new update for {name} was released.",
    fallbackUpdateTitle: "New Update",
    free: "Free",
    discount: "Discount",
    oldPrice: "Old Price",
    newPrice: "New Price",
    link: "Link",
    details: "Details",
    platformsLabel: "Platforms",
    quality: "Quality",
    popularity: "Popularity",
    expiresAt: "Expires at",
    freeUntil: "Free until",
    page: "Page",
    displayed: "Displayed",
    extracted: "Extracted",
    dlcMoreNote: "⚠️ More DLCs might exist on the official store page.",
    notifiedUpdate: "🔔 A new update for **{name}** was released!",
    notifiedDeal: "🔥 New deal detected!",
    notifiedFree: "🎁 A FREE game (100% Off) is available!",
    typeProd: "**Product Type:**",
    typeGame: "Game",
    currFree: "This title is permanently free (Free-to-Play).",
    priceUnav: "Price is currently unavailable.",
    activeDisc: "There's an active **{percent}%** discount!\n\n~~{old}~~ -> **{new}**",
    expAt: "\n⏳ **Offer expires at:** ",
    expUnspec: "Unspecified (possibly permanent or a bundle).",
    noDisc: "Not on sale right now.\n\nStandard price: **{price}**",
    statusApiErr: "This game doesn't have a public status API. Check the links below.",
    statusServ: "**Server Status:**",
    statusRoblox: "Click the link below to view Roblox's official status.",
    statusRiot: "Click the link below to view Riot Games' official status.",
    noLink: "Official link unavailable.",
    statusTitle: "📡 Server Status: {name}",
    statusOff: "🔗 Official Status Page",
    statusCheckText: "Check Status Here",
    statusHome: "🏠 Main / Steam Page",
    statusFallbackText: "Access Game Page",
    statusFallbackNote: "\n*(This is the general game link, not an automated status page)*",
    searchDowndetector: "🔍 Search on Downdetector",
    dlcPack: "📦 DLCs: {title}",
    dlcBuyLink: "🛒 Buy / View on Steam",
    dealOffer: "🏷️ **{store}** offers a **{savings}%** discount!\n\n",
    freeOffer: "🎁 **{store}** is offering this title for **FREE** for a limited time!\n\n",
    defaultError: "An internal error occurred.",
    errCircuitBreaker: "Circuit Breaker Active",
    errSteamPatch: "No valid Steam patch notes.",
    errAncore: "No valid anchors found.",
    errFortnite: "No valid posts found.",
    errFortniteTotal: "Fortnite fetch failed completely.",
    errAMD: "AMD fetch failed.",
    errIntel: "Intel fetch failed.",
    errMinecraft: "Missing JSON version.",
    errRoblox: "Missing API version.",
    errNvidia: "Nvidia fetch failed.",
    errUnknownType: "Unknown type.",
    errNoValidDeals: "No valid deals found.",
    helpGeneralCmds: "`{prefix}help`\n`{prefix}help [command]`\n`{prefix}ping`",
    helpNotifCmds: "`{prefix}start updates`\n`{prefix}stop updates`\n`{prefix}start deals`\n`{prefix}stop deals`\n`{prefix}start free games` (or `free`)\n`{prefix}stop free games`",
    helpPrefsCmds: "`{prefix}set mode [compact/detailed]`\n`{prefix}set mindiscount [0-100]`\n`{prefix}set language [ro/en]`",
    helpManualCmds: "`{prefix}games` (or `{prefix}aliases`)\n`{prefix}latest updates`\n`{prefix}latest deals` (paid only)\n`{prefix}latest free games` (up to 20 Steam/Epic)\n`{prefix}latest update [alias]`\n`{prefix}latest price [game]`\n`{prefix}dlc [game]`\n`{prefix}status [game]`",
    excerptFortnite: "Official Fortnite update.",
    excerptAmdDriver: "Driver available.",
    excerptAMD: "AMD.com update.",
    excerptIntel: "intel.com update detected.",
    excerptVersion: "Version {v}",
    helpCmd_ping: "🏓 **Ping:** Checks bot's response time (latency).",
    helpCmd_games: "🎮 **Games/Aliases:** Shows a full list of all automatically tracked games.",
    helpCmd_porecle: "🎮 **Games/Aliases:** Shows a full list of all automatically tracked games.",
    helpCmd_aliases: "🎮 **Games/Aliases:** Shows a full list of all automatically tracked games.",
    helpCmd_start_updates: "🔔 **Start Updates:** *(Admin)* Sets the destination channel for new Patch Notes.",
    helpCmd_stop_updates: "🛑 **Stop Updates:** *(Admin)* Stops automatic update notifications.",
    helpCmd_start_deals: "🔔 **Start Deals:** *(Admin)* Sets destination for deal alerts (paid games only).",
    helpCmd_start_reduceri: "🔔 **Start Deals:** *(Admin)* Sets destination for deal alerts (paid games only).",
    helpCmd_stop_deals: "🛑 **Stop Deals:** *(Admin)* Stops deal notifications.",
    helpCmd_stop_reduceri: "🛑 **Stop Deals:** *(Admin)* Stops deal notifications.",
    helpCmd_start_free_games: "🔔 **Start Free Games:** *(Admin)* Sets destination EXCLUSIVELY for 100% FREE promotional games.",
    helpCmd_start_free: "🔔 **Start Free Games:** *(Admin)* Sets destination EXCLUSIVELY for 100% FREE promotional games.",
    helpCmd_stop_free_games: "🛑 **Stop Free Games:** *(Admin)* Stops free games notifications.",
    helpCmd_stop_free: "🛑 **Stop Free Games:** *(Admin)* Stops free games notifications.",
    helpCmd_set_mode: "⚙️ **Set Mode:** *(Admin)* Changes message size (compact/detailed).",
    helpCmd_set_mindiscount: "⚙️ **Set MinDiscount:** *(Admin)* Sets the minimum discount threshold (in %) for deal alerts.",
    helpCmd_set_language: "⚙️ **Set Language:** *(Admin)* Changes bot's language (ro/en).",
    helpCmd_latest_updates: "🔍 **Latest Updates:** Shows a paginated list ({items} per page) of the newest updates.",
    helpCmd_latest_deals: "🔍 **Latest Deals:** Shows the most popular paid deals (Steam/Epic).",
    helpCmd_latest_reduceri: "🔍 **Latest Deals:** Shows the most popular paid deals (Steam/Epic).",
    helpCmd_latest_free_games: "🔍 **Latest Free Games:** Shows up to 20 100% free promotions from Steam and Epic Games.",
    helpCmd_latest_free: "🔍 **Latest Free Games:** Shows up to 20 100% free promotions from Steam and Epic Games.",
    helpCmd_latest_update: "🔍 **Latest Update [name]:** Searches for the latest patch notes for a specific tracked game.",
    helpCmd_latest_price: "🔍 **Latest Price [name]:** Checks the current price on both **Steam** and **Epic Games**.",
    helpCmd_latest_pret: "🔍 **Latest Price [name]:** Checks the current price on both **Steam** and **Epic Games**.",
    helpCmd_dlc: "🔍 **DLC [game name]:** Extracts the full list of DLCs for a Steam game.",
    helpCmd_status: "📡 **Status [game name]:** Checks the current server status for the specified game."
  }
};

function getText(lang, key, params = {}) {
  let text = i18n[lang]?.[key] || i18n["ro"]?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}

// --- UTILAJE DE BAZĂ ---
function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function safeStringify(value) {
  try { return JSON.stringify(value); }
  catch (e) { return String(value); }
}

function logger(level, context, message, meta = "") {
  const timestamp = new Date().toISOString();
  const format = `[${timestamp}] [${level}] [${context}] ${message} ${meta ? safeStringify(meta) : ""}`;
  if (level === "ERROR") console.error(format);
  else if (level === "WARN") console.warn(format);
  else console.log(format);
}

function formatUserError(err, defaultMsgKey, lang = "ro") {
  const defaultMsg = getText(lang, defaultMsgKey);
  if (err) {
    const errorDetails = err.stack ? err.stack : (err.message || err);
    logger("WARN", "USER_COMMAND", defaultMsg, errorDetails);
    const specificMsg = i18n[lang]?.[err.message];
    if (specificMsg) {
      return `❌ ${specificMsg}`;
    }
  }
  return `❌ ${defaultMsg}`;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, 
        matrix[i][j - 1] + 1, 
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]);
}

// -------------------------------------------------------------
// 2. VALIDARE CONFIG CU ZOD
// -------------------------------------------------------------
const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["steam", "intel", "nvidia", "amd", "roblox", "minecraft", "epic_games", "listing_based"]),
  aliases: z.array(z.string()).optional(),
  appId: z.string().optional(),
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional()
}).superRefine((game, ctx) => {
  if (game.type === "steam" && !game.appId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Steam "${game.name}" trebuie să aibă appId.` });
  if (game.type === "intel" && !game.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Intel "${game.name}" trebuie să aibă url.` });
  if (game.type === "listing_based" || (game.type === "epic_games" && game.key !== "fortnite")) {
    const hasListing = game.listingUrl || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
    if (!hasListing) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită listingUrl/Urls.` });
    if (!game.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită baseUrl.` });
  }
});

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().int().positive().refine(
    (v) => [5, 10, 15, 20, 30, 60].includes(v),
    { message: "checkIntervalMinutes trebuie să fie 5, 10, 15, 20, 30 sau 60." }
  ),
  games: z.array(GameSchema).min(1).superRefine((games, ctx) => {
    const keys = games.map(g => g.key);
    const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
    if (duplicates.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chei duplicate: ${[...new Set(duplicates)].join(', ')}` });
  })
});

let config;
try {
  const CONFIG_PATH = path.join(__dirname, "config.json");
  config = ConfigSchema.parse(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
} catch (err) {
  logger("ERROR", "CONFIG", "Eroare validare config.json", err.issues || err.message);
  process.exit(1);
}

// -------------------------------------------------------------
// 3. MONGODB & DISCORD CLIENT
// -------------------------------------------------------------
const guildSchema = new mongoose.Schema({
  _id: String,
  language: { type: String, enum: ["ro", "en"], default: "ro" },
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Map, of: [String], default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] }, 
  freeSubscribed: { type: Boolean, default: false },
  freeChannelId: { type: String, default: null },
  seenFree: { type: [String], default: [] },
  minDiscountPercent: { type: Number, default: 70 },
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" }
}, { minimize: false });

const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null }
}, { minimize: false });

const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: { all: { type: Number, default: 35000 }, single: { type: Number, default: 2000 }, deals: { type: Number, default: 10000 }, free: { type: Number, default: 10000 } }
}, { minimize: false });

const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
  _id: String,
  lockedUntil: { type: Date, default: null, index: true },
  ownerToken: { type: String, default: null }
}, { minimize: false });

const JobLockModel = mongoose.model("JobLock", jobLockSchema);
const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const lockToken = crypto.randomUUID();

  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: expires, ownerToken: lockToken } },
      { new: true } 
    );
    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    try {
      await JobLockModel.create({
        _id: `lock_${jobName}`,
        lockedUntil: expires,
        ownerToken: lockToken
      });
      activeLocks.set(jobName, lockToken);
      return lockToken;
    } catch (createErr) {
      if (createErr.code === 11000) return null;
      throw createErr;
    }
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la obținerea lock-ului", err.message);
    return null;
  }
}

async function renewDbLock(jobName, token, ttlMs = 120000) {
  if (!token) return false;
  const expires = new Date(Date.now() + ttlMs);
  try {
    const res = await JobLockModel.updateOne({ _id: `lock_${jobName}`, ownerToken: token }, { $set: { lockedUntil: expires } });
    return res.modifiedCount > 0;
  } catch (err) { return false; }
}

async function releaseDbLock(jobName, token) {
  if (!token) return;
  try {
    await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
    activeLocks.delete(jobName);
  } catch (err) {}
}

async function getSystemTimes() {
  let sys = await SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: { all: 35000, single: 2000, deals: 10000, free: 10000 } } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return sys.executionTimes || { all: 35000, single: 2000, deals: 10000, free: 10000 };
}

async function saveSystemTimes(times) { 
    await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// -------------------------------------------------------------
// 4. SERVER WEB PENTRU HEALTHCHECK
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/health") {
    const mongoOk = mongoose.connection.readyState === 1;
    const discordOk = typeof client.isReady === "function" && client.isReady();
    if (mongoOk && discordOk) { 
      res.writeHead(200, { "Content-Type": "application/json" }); 
      return res.end(JSON.stringify({ ok: true, mongoOk, discordOk, message: "Toate sistemele sunt online." })); 
    }
    res.writeHead(503, { "Content-Type": "application/json" }); 
    return res.end(JSON.stringify({ ok: false, mongoOk, discordOk, message: "Sisteme indisponibile." }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

// -------------------------------------------------------------
// 5. SHUTDOWN GRACEFUL
// -------------------------------------------------------------
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  try {
    for (const [jobName, token] of activeLocks.entries()) await releaseDbLock(jobName, token);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy(); process.exit(0);
  } catch (err) { process.exit(1); }
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// CACHE ȘI CROSS-PLATFORM STEAM ID MEMORY
// -------------------------------------------------------------
const cache = { 
  updates: { data: null, expiresAt: 0 }, 
  deals: { data: null, expiresAt: 0 }, 
  single: new Map(),
  dlc: new Map()
};

// Map pentru a salva asocierile Title Epic -> AppId Steam (sau null)
const steamIdCache = new Map();

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
  if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
  for (const [key, value] of cache.single.entries()) { if (value.expiresAt < now) cache.single.delete(key); }
  for (const [key, value] of cache.dlc.entries()) { if (value.expiresAt < now) cache.dlc.delete(key); }
  if (cache.dlc.size > 100) { const oldestKeys = [...cache.dlc.keys()].slice(0, 20); oldestKeys.forEach(k => cache.dlc.delete(k)); }
  if (cache.single.size > 100) { const oldestKeys = [...cache.single.keys()].slice(0, 20); oldestKeys.forEach(k => cache.single.delete(k)); }

  // Anti-memory leak: Comportament LRU simplificat.
  if (steamIdCache.size > 500) {
      const firstKey = steamIdCache.keys().next().value;
      steamIdCache.delete(firstKey);
  }
}

async function getSteamIdForTitle(title) {
  // Implementare LRU autentică la nivel de citire
  if (steamIdCache.has(title)) {
      const val = steamIdCache.get(title);
      steamIdCache.delete(title);
      steamIdCache.set(title, val);
      return val;
  }
  try {
    const searchItems = await searchSteamGameByName(title);
    if (searchItems && searchItems.length > 0) {
      const bestMatch = chooseBestSteamMatch(searchItems, title);
      const steamName = String(bestMatch.name).toLowerCase();
      const epicName = String(title).toLowerCase();

      // Heuristica imbunatatita
      if (bestMatch && bestMatch.id && 
         (steamName === epicName || steamName.includes(epicName) || epicName.includes(steamName))) {
        steamIdCache.set(title, bestMatch.id);
        return bestMatch.id;
      }
    }
  } catch(e) {}
  steamIdCache.set(title, null); 
  return null;
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & EMBEDS
// -------------------------------------------------------------
function cleanText(text) { return String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
function truncate(str, maxLen) { const t = String(str || ""); return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t; }

function normalizeUpdate(data) {
  return { 
    id: String(data.id || ""), 
    title: data.title ? truncate(data.title, 250) : null, 
    link: String(data.link || ""), 
    excerpt: truncate(data.excerpt || "", 700), 
    excerptKey: data.excerptKey || null,
    excerptParams: data.excerptParams || null,
    fullText: truncate(data.fullText || "", 3500), 
    image: data.image || null, 
    thumbnail: data.thumbnail || null, 
    timestamp: data.timestamp || "" 
  };
}

function buildUpdateEmbed(gameName, latest, mode = "detailed", lang = "ro") {
  const isCompact = mode === "compact";
  const displayTitle = latest.title || getText(lang, "fallbackUpdateTitle");
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle(truncate(displayTitle, 256)).setFooter({ text: truncate(gameName, 2048) }); 
  if (latest.link) embed.setURL(latest.link);

  let safeExcerpt = latest.excerpt;
  if (latest.excerptKey) {
    safeExcerpt = getText(lang, latest.excerptKey, latest.excerptParams || {});
  }

  if (isCompact) {
    embed.setDescription(latest.link ? getText(lang, "updateTitleText") : getText(lang, "updateDescText", { name: gameName }));
  } else {
    embed.setDescription(truncate(safeExcerpt || getText(lang, "updateDescText", { name: gameName }), 4096));
    if (latest.image) embed.setImage(latest.image);
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) { const d = new Date(latest.timestamp); if (!Number.isNaN(d.getTime())) embed.setTimestamp(d); }
  }
  return embed;
}

function buildDealEmbed(deal, mode = "detailed", lang = "ro") {
  const isFree = parseFloat(deal.salePrice) === 0 && deal.savings === 100;
  const isCompact = mode === "compact";
  const freeText = getText(lang, "free");
  const discText = getText(lang, "discount");
  const embed = new EmbedBuilder().setColor(isFree ? 0x2ecc71 : 0xe74c3c).setTitle(truncate(`${isFree ? `🎁 ${freeText.toUpperCase()}: ` : `🏷️ ${discText}: `}${deal.title}`, 256));

  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? freeText.toUpperCase() : "$" + deal.salePrice}**\n[${getText(lang, "link")}](${deal.link})`);
  } else {
    let statsStr = "";
    if (deal.qualityScore > 0 || deal.totalReviews > 0) {
      statsStr = `⭐ **${getText(lang, "quality")}:** ${deal.qualityScore}% | 👥 **${getText(lang, "popularity")}:** ${deal.totalReviews > 0 ? deal.totalReviews : "N/A"}\n\n`;
    }

    let displayDate = deal.endDateStr;
    if (displayDate) {
        const d = new Date(displayDate);
        if (!isNaN(d.getTime())) {
            displayDate = d.toLocaleDateString(lang === "ro" ? "ro-RO" : "en-US");
        }
    }

    const offerText = isFree 
        ? getText(lang, "freeOffer", { store: deal.store }) 
        : getText(lang, "dealOffer", { store: deal.store, savings: deal.savings });

    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(offerText + statsStr + (displayDate ? `⏳ **${isFree ? getText(lang, "freeUntil") : getText(lang, "expiresAt")}:** ${displayDate}\n\n` : ""), 4096))
      .addFields(
        { name: getText(lang, "oldPrice"), value: `~~$${deal.normalPrice}~~`, inline: true },
        { name: getText(lang, "newPrice"), value: isFree ? `🔥 ${freeText.toUpperCase()} 🔥` : `$${deal.salePrice}`, inline: true },
        { name: getText(lang, "link"), value: `[Link](${deal.link})`, inline: false }
      );

    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);

    let detailsVal = "";
    if (deal.platformsInfo) {
      detailsVal += `**${getText(lang, "platformsLabel")}:** ${deal.platformsInfo}\n`;
    }
    if (deal.extraDetails) {
      detailsVal += deal.extraDetails;
    }
    if (detailsVal.trim()) {
      embed.addFields({ name: getText(lang, "details"), value: truncate(detailsVal.trim(), 1024), inline: false });
    }
  }
  return embed;
}

function buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, query, lang) {
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle(getText(lang, "dualPriceTitle", { title: query }));

    let steamVal = "";
    if (!steamData) {
        steamVal = getText(lang, "notFoundSteam");
    } else {
        const title = steamData.name;
        const isFree = steamData.is_free;
        const priceOverview = steamData.price_overview;
        steamVal += `**${title}**\n`;
        if (isFree) {
            steamVal += getText(lang, "currFree");
        } else if (!priceOverview) {
            steamVal += getText(lang, "priceUnav");
        } else {
            const normalPrice = (priceOverview.initial / 100).toFixed(2);
            const currentPrice = (priceOverview.final / 100).toFixed(2);
            const discount = priceOverview.discount_percent;
            if (discount > 0) {
                const displayNewPrice = currentPrice === "0.00" ? getText(lang, "free").toUpperCase() : `$${currentPrice}`;
                steamVal += getText(lang, "activeDisc", { percent: discount, old: `$${normalPrice}`, new: displayNewPrice });
                if (steamEndDate) steamVal += `\n${getText(lang, "expAt")} ${steamEndDate}`;
            } else {
                steamVal += getText(lang, "noDisc", { price: `$${normalPrice}` });
            }
        }
        steamVal += `\n[${getText(lang, "link")}](https://store.steampowered.com/app/${steamAppId})`;
        if (!embed.data.thumbnail && steamData.header_image) embed.setThumbnail(steamData.header_image);
    }
    embed.addFields({ name: "🎮 Steam", value: steamVal, inline: false });

    let epicVal = "";
    if (!epicData) {
        epicVal = getText(lang, "notFoundEpic");
    } else {
        const title = epicData.title;
        const priceInfo = epicData.price?.totalPrice;
        epicVal += `**${title}**\n`;
        if (!priceInfo) {
            epicVal += getText(lang, "priceUnav");
        } else {
            const normalPrice = (priceInfo.originalPrice / 100).toFixed(2);
            const currentPrice = (priceInfo.discountPrice / 100).toFixed(2);
            const isFree = currentPrice === "0.00";
            let savings = 0;
            if (priceInfo.originalPrice > 0) savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);

            if (isFree && normalPrice === "0.00") {
                 epicVal += getText(lang, "currFree");
            } else if (savings > 0) {
                const displayNewPrice = isFree ? getText(lang, "free").toUpperCase() : `$${currentPrice}`;
                epicVal += getText(lang, "activeDisc", { percent: savings, old: `$${normalPrice}`, new: displayNewPrice });
                const promos = epicData.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
                if (promos && promos.endDate) {
                    const d = new Date(promos.endDate);
                    if (!isNaN(d.getTime())) {
                        epicVal += `\n${getText(lang, "expAt")} ${d.toLocaleDateString(lang === "ro" ? "ro-RO" : "en-US")}`;
                    }
                }
            } else {
                epicVal += getText(lang, "noDisc", { price: `$${normalPrice}` });
            }
        }
        let urlSlug = epicData.urlSlug || epicData.id;
        if (!epicData.urlSlug && epicData.catalogNs && epicData.catalogNs.mappings && epicData.catalogNs.mappings.length > 0) {
            urlSlug = epicData.catalogNs.mappings[0].pageSlug;
        }
        epicVal += `\n[${getText(lang, "link")}](https://store.epicgames.com/en-US/p/${urlSlug})`;

        if (!embed.data.thumbnail) {
           if (epicData.keyImages) {
               const img = epicData.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
               if (img) embed.setThumbnail(img.url);
           }
        }
    }
    embed.addFields({ name: "🛒 Epic Games", value: epicVal, inline: false });

    return embed;
}

function buildPaginationButtons(prefix, sessionId, page, totalPages, lang = "ro") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel(getText(lang, "prev")).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel(getText(lang, "next")).setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed", lang = "ro") {
  if (!items || items.length === 0) return;
  let currentPage = 0; const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = Date.now().toString() + Math.random().toString(36).substring(7);
  let collector = null;

  const updateMessage = async () => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      const components = [buildPaginationButtons(prefix, sessionId, currentPage, totalPages, lang)];
      await interactionMessage.edit({ embeds, components }).catch(() => null);
    } catch (err) { 
      logger("WARN", "PAGINATION", "Error updating message", err.message);
      if (collector) collector.stop("error"); 
    }
  };

  await updateMessage();
  collector = interactionMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: getText(lang, "onlyAuthor"), ephemeral: true }).catch(() => null);
    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;

    if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));

    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });

  collector.on("end", () => {
    if (interactionMessage.editable) {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel(getText(lang, "prev")).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel(getText(lang, "next")).setStyle(ButtonStyle.Primary).setDisabled(true)
      );
      interactionMessage.edit({ components: [disabledRow] }).catch(() => null);
    }
  });
}

function findGameAndSuggestion(text) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length < 2) {
    const exact = config.games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  let candidates = [];
  for (const game of config.games) {
    const key = String(game.key).toLowerCase().replace(/[-_]/g, " ");
    const name = String(game.name).toLowerCase().replace(/[-_]/g, " ");
    const aliases = Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " ")) : [];
    const allIdentifiers = [key, name, ...aliases];

    if (allIdentifiers.includes(search)) return { game, suggestion: null };

    let bestDistForGame = Infinity;
    let isStartsWith = false;
    let isIncludes = false;

    for (const val of allIdentifiers) {
        if (val.startsWith(search)) isStartsWith = true;
        if (val.includes(search)) isIncludes = true;
        const dist = levenshtein(search, val);
        if (dist < bestDistForGame) bestDistForGame = dist;
    }
    candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
  }

  candidates.sort((a, b) => {
      if (a.isStartsWith && !b.isStartsWith) return -1;
      if (!a.isStartsWith && b.isStartsWith) return 1;
      if (a.dist !== b.dist) return a.dist - b.dist;
      if (a.isIncludes && !b.isIncludes) return -1;
      if (!a.isIncludes && b.isIncludes) return 1;
      return 0;
  });
  const best = candidates[0];
  if (!best) return { game: null, suggestion: null };

  const dynamicThreshold = Math.max(1, Math.floor(search.length * 0.3));
  if (best.dist <= 1) return { game: best.game, suggestion: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) return { game: null, suggestion: best.game };
  return { game: null, suggestion: null };
}

// -------------------------------------------------------------
// HTTP & PROXY & SCRAPING
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  const reqConfig = { method, url, timeout: options.timeout || 15000, headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)], ...options.headers } };
  if (options.data) reqConfig.data = options.data;
  for (let i = 0; i <= retries; i++) {
    try { return await axios(reqConfig); } 
    catch (err) {
      const status = err.response?.status || "N/A";
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw err;
      if (i === retries) {
        logger("ERROR", "HTTP", `Eșec final request [${status}] după ${retries} încercări: ${url}`, err.message);
        throw err;
      }
      logger("WARN", "HTTP", `Eșec request [${status}] (încercarea ${i + 1}/${retries}), reîncerc în ${backoff}ms: ${url}`, err.message);
      await new Promise(res => setTimeout(res, backoff)); backoff *= 2;
    }
  }
}

async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`];
  let lastErr;
  for (const proxy of proxies) {
    try {
      const res = await httpReq('GET', proxy, options);
      return proxy.includes("allorigins") ? String(res?.data?.contents || "") : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
}

function absoluteUrl(base, maybeRelative) { try { return new URL(maybeRelative, base).href; } catch { return ""; } }
function isGoodSteamArticleUrl(url) { const v = String(url || "").trim().toLowerCase(); return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn")); }
function extractDateScore(url) { const u = url.toLowerCase(); const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/); if (m1) { const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`); if (!isNaN(d.getTime())) return d.getTime(); } return 0; }
function scoreCandidate(candidate, keywords) { const haystack = `${candidate.href} ${candidate.text}`.toLowerCase(); let score = 0; for (const k of keywords) if (haystack.includes(String(k).toLowerCase())) score += 1; return score; }
function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;
  const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
  if (badWordsInTitle.some((word) => title.includes(word))) return false;
  if (tags.includes("patchnotes") || tags.includes("update")) return true;
  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];
  return goodWords.some((word) => text.includes(word));
}

async function fetchSteamUpdate(game) {
  const response = await httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements") && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  if (!patchNotes.length) throw new Error("errSteamPatch");
  const latest = patchNotes[0];

  const rawContents = String(latest.contents || "").replace(/\[\/?(?:b|i|u|h1|h2|h3|url=?[^\]]*|list|\*|spoiler|img|table|tr|th|td)\]/gi, "");
  return normalizeUpdate({ id: String(latest.gid), title: cleanText(latest.title), link: String(latest.url), excerpt: rawContents, fullText: rawContents, timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : "" });
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
  let collected = [];
  for (const url of listingUrls) {
    try {
      const listRes = await httpReq('GET', url);
      const $ = cheerio.load(String(listRes.data));
      let position = 0;
      $('a').each((i, el) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr('href'));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(el).text()), position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) { logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, err.message); }
  }

  const seen = new Set();
  const unique = collected.filter(item => { if (!item.href || seen.has(item.href)) return false; seen.add(item.href); return true; });
  unique.sort((a, b) => { 
    if (keywords.length) { const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords); if(s!==0) return s; }
    const d = extractDateScore(b.href) - extractDateScore(a.href); if(d!==0) return d;
    return a.position - b.position; 
  });
  if (!unique.length) throw new Error("errAncore");
  const articleUrl = unique[0].href;
  const articleRes = await httpReq('GET', articleUrl);
  const $art = cheerio.load(String(articleRes.data || ""));
  const ogTitle = $art('meta[property="og:title"]').attr('content') || $art('title').text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr('content') || "";
  $art('script, style, nav, footer, header').remove();
  const rawContent = $art('article').text() || $art('main').text() || $art('body').text();
  return normalizeUpdate({ id: String(articleUrl), title: cleanText(ogTitle) || `${game.name} Update`, link: articleUrl, excerpt: cleanText(ogDesc), fullText: cleanText(rawContent), thumbnail: game.thumbnail });
}

async function fetchFortniteUpdate() {
  try {
    const posts = JSON.parse(await fetchWithProxy("https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US", { timeout: 15000 }) || "{}")?.blogList;
    const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("errFortnite");
    const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({ id: String(latest.slug), title: cleanText(latest.title), link: `https://www.fortnite.com/news/${latest.slug}`, excerpt: cleanText(latest.shareDescription), excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: latest.date });
  } catch (err) {
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq('GET', backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("errFortniteTotal");
    return normalizeUpdate({ id: feed.items[0].link, title: cleanText(feed.items[0].title), link: feed.items[0].link, excerpt: "Update oficial Fortnite.", excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: feed.items[0].pubDate });
  }
}

async function fetchAmdUpdate(game) {
  try {
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (match) return normalizeUpdate({ id: match[1], title: `AMD Radeon Adrenalin v${match[1]}`, link: "https://www.amd.com", excerpt: "Driver disponibil.", excerptKey: "excerptAmdDriver", thumbnail: game.thumbnail });
  } catch (err) {
    logger("WARN", "AMD_UPDATE", "Failed proxy fetch", err.message);
  }
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("errAMD");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update AMD.com.", excerptKey: "excerptAMD", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchIntelUpdate(game) {
  try {
    const rawContent = await fetchWithProxy(game.url);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) return normalizeUpdate({ id: match[1], title: `${game.name} v${match[1]}`, link: game.url, excerpt: `Versiune găsită: ${match[1]}`, excerptKey: "excerptVersion", excerptParams: { v: match[1] }, thumbnail: game.thumbnail });
  } catch (err) {
    logger("WARN", "INTEL_UPDATE", "Failed proxy fetch", err.message);
  }
  const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("errIntel");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update intel.com detectat.", excerptKey: "excerptIntel", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchMinecraftUpdate() { 
  try {
      const r = await httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"); 
      const v = r?.data?.latest?.release;
      if(!v) throw new Error("errMinecraft"); 
      return normalizeUpdate({ id: v, title: `Minecraft ${v}`, link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`, excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: v }, thumbnail: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c7/Grass_Block_Revision_6.png" });
  } catch (err) {
      logger("WARN", "MINECRAFT", "Failed to fetch update", err.message);
      throw err;
  }
}

async function fetchRobloxUpdate() { 
  try {
      const r = await httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer"); 
      const v = r?.data?.clientVersionUpload;
      if(!v) throw new Error("errRoblox"); 
      return normalizeUpdate({ id: String(v), title: "Roblox Update", link: "https://en.help.roblox.com/hc/en-us", excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: String(v) }, thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg" });
  } catch (err) {
      logger("WARN", "ROBLOX", "Failed to fetch update", err.message);
      throw err;
  }
}

async function fetchNvidiaUpdate(g) { 
  try {
      const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
      const r = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`); 
      const f = await rssParser.parseString(r.data);
      if (!f.items || f.items.length === 0) throw new Error("errNvidia");
      return normalizeUpdate({ id: f.items[0].link, title: cleanText(f.items[0].title).split(" - ")[0], link: f.items[0].link, thumbnail: g.thumbnail });
  } catch (err) {
      logger("WARN", "NVIDIA", "Failed to fetch update", err.message);
      throw err;
  }
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL ȘI REDUCERI 
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  const t = game.type;
  if (!t || t === "steam") return await fetchSteamUpdate(game);
  if (t === "minecraft") return await fetchMinecraftUpdate();
  if (t === "epic_games" && game.key === "fortnite") return await fetchFortniteUpdate(); 
  if (t === "roblox") return await fetchRobloxUpdate();
  if (t === "nvidia") return await fetchNvidiaUpdate(game);
  if (t === "intel") return await fetchIntelUpdate(game);
  if (t === "amd") return await fetchAmdUpdate(game);
  if (t === "listing_based" || t === "epic_games") return await fetchListingBasedUpdate(game);
  throw new Error("errUnknownType");
}

async function executeFetchWithCircuitBreaker(game) {
  let cb = await CircuitBreakerModel.findById(game.key);
  if (!cb) cb = new CircuitBreakerModel({ _id: game.key });

  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "errCircuitBreaker" };
  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0 || cb.cooldownUntil) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); }
    return { game, latest, error: null };
  } catch (error) {
    cb.fails += 1;
    if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000); 
    await cb.save();
    return { game, latest: null, error: error.message };
  }
}

async function getLatestForAllGames() {
  const results = [];
  for (let i = 0; i < config.games.length; i += FETCH_CONCURRENCY) {
    const chunk = config.games.slice(i, i + FETCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (game) => await executeFetchWithCircuitBreaker(game)));
    results.push(...chunkResults);
  }
  return results;
}

async function fetchSteamReviewData(appId) {
  try {
    const res = await httpReq('GET', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent };
    }
  } catch (err) {
    logger("WARN", "STEAM_REVIEW", "Failed to fetch review data", err.message);
  }
  return { totalReviews: 0, qualityPercent: 0 };
}

const activeEnrichments = new Map();
async function enrichDealData(deal) {
  if (deal.enriched) return deal; 
  if (activeEnrichments.has(deal.id)) return activeEnrichments.get(deal.id);

  const enrichTask = (async () => {
    if (deal.store === "Steam" && deal.steamAppID) {
      try {
        const res = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}&cc=US&l=english`, { timeout: 5000 });
        const data = res.data[deal.steamAppID]?.data;
        if (data && data.platforms) {
          deal.platformsInfo = [
            data.platforms.windows ? "Win" : "", 
            data.platforms.mac ? "Mac" : "", 
            data.platforms.linux ? "Lin" : ""
          ].filter(Boolean).join(", ");
        }
        const htmlRes = await httpReq('GET', deal.link, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
        const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
        if (match && match[1]) deal.endDateStr = match[1].trim();
      } catch (e) {
        logger("WARN", "STEAM_ENRICH", "Failed to enrich deal data", e.message);
      }
    }
    deal.enriched = true;
    return deal;
  })();
  activeEnrichments.set(deal.id, enrichTask);
  try { await enrichTask; } finally { activeEnrichments.delete(deal.id); }
  return deal;
}

// -------------------------------------------------------------
// FETCH DEALS COMPUS (CU CROSS-PLATFORM EPIC -> STEAM)
// -------------------------------------------------------------
async function fetchDeals() {
  const deals = [];

  // 1. STEAM DEALS
  try {
    const steamRes = await httpReq('GET', 'https://store.steampowered.com/api/featuredcategories/?cc=US&l=english');
    const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, 40);
    const reviewsData = [];
    for (let i = 0; i < steamSpecials.length; i += 5) {
      const chunk = steamSpecials.slice(i, i + 5);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      await new Promise(res => setTimeout(res, 500));
    }
    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const normalPrice = (item.original_price / 100).toFixed(2);
      const salePrice = (item.final_price / 100).toFixed(2);
      const savings = item.discount_percent || 0;

      let hybridScore = (savings * 0.8) + (revData.qualityPercent * 1.0) + Math.min(25, Math.floor(revData.totalReviews / 1000));

      deals.push({
        id: `steam_${item.id}`, steamAppID: item.id, title: item.name, salePrice: salePrice, normalPrice: normalPrice, savings: savings, store: "Steam", link: `https://store.steampowered.com/app/${item.id}`, popularityScore: hybridScore, totalReviews: revData.totalReviews, qualityScore: revData.qualityPercent, endDateStr: null, extraDetails: "", platformsInfo: null, enriched: false, thumbnail: item.header_image || null
      });
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message); }

  // 2. EPIC GAMES DEALS
  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug catalogNs { mappings { pageSlug } } keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    const epicVars = { category: "games/edition/base|bundles/games", count: 30, country: "US", locale: "en-US", onSale: true, withPrice: true };
    const epicRes = await httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
    const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];

    const epicDealsTemp = [];
    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;
      const normalPriceNum = priceInfo.originalPrice / 100;
      const normalPrice = normalPriceNum.toFixed(2);
      const salePrice = (priceInfo.discountPrice / 100).toFixed(2);

      let savings = 0;
      if (priceInfo.originalPrice > 0) savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);

      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img) thumb = img.url;
      }
      let endDate = null;
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = promos.endDate;

      let urlSlug = item.urlSlug || item.id;
      if (!item.urlSlug && item.catalogNs && item.catalogNs.mappings && item.catalogNs.mappings.length > 0) {
          urlSlug = item.catalogNs.mappings[0].pageSlug;
      }
      epicDealsTemp.push({
         id: `epic_${item.id}`, steamAppID: null, title: item.title, salePrice: salePrice, normalPrice: normalPrice, normalPriceNum: normalPriceNum, savings: savings, store: "Epic Games", link: `https://store.epicgames.com/en-US/p/${urlSlug}`, endDateStr: endDate, platformsInfo: null, enriched: true, thumbnail: thumb 
      });
    }

    // CROSS-PLATFORM SCORING: Obținem recenzii Steam pentru jocurile Epic
    const epicReviewsData = [];
    for (let i = 0; i < epicDealsTemp.length; i += 5) {
      const chunk = epicDealsTemp.slice(i, i + 5);
      const chunkPromises = chunk.map(async (deal) => {
          const steamId = await getSteamIdForTitle(deal.title);
          if (steamId) return await fetchSteamReviewData(steamId);
          return null;
      });
      epicReviewsData.push(...(await Promise.all(chunkPromises)));
      await new Promise(res => setTimeout(res, 500)); // Pază împotriva rate-limit-ului Steam
    }

    for (let i = 0; i < epicDealsTemp.length; i++) {
       const deal = epicDealsTemp[i];
       const revData = epicReviewsData[i];

       if (revData && revData.totalReviews > 0) {
           deal.popularityScore = (deal.savings * 0.8) + (revData.qualityPercent * 1.0) + Math.min(25, Math.floor(revData.totalReviews / 1000));
           deal.qualityScore = revData.qualityPercent;
           deal.totalReviews = revData.totalReviews;
           deal.extraDetails = "\n*(Scor comunitar preluat via Steam)*";
       } else {
           deal.popularityScore = (deal.savings * 0.8) + 85.0 + Math.min(25, deal.normalPriceNum / 2);
           deal.qualityScore = 85;
           deal.totalReviews = 0;
           deal.extraDetails = "\n*(Exclusiv Epic/Fără recenzii publice)*";
       }
       deals.push(deal);
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", err.message); }

  return deals;
}

// -------------------------------------------------------------
// HELPERE PENTRU CĂUTAREA PREȚURILOR ȘI DLC-urilor
// -------------------------------------------------------------
async function searchSteamGameByName(query) {
  const searchRes = await httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`);
  return searchRes.data?.items || [];
}

async function searchEpicGameByName(query) {
  const epicQuery = `query searchStoreQuery($keywords: String, $count: Int, $country: String!, $locale: String, $withPrice: Boolean = false) { Catalog { searchStore(keywords: $keywords, count: $count, country: $country, locale: $locale) { elements { title id urlSlug catalogNs { mappings { pageSlug } } keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
  const epicVars = { keywords: query, count: 5, country: "US", locale: "en-US", withPrice: true };
  try {
    const res = await httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
    const elements = res.data?.data?.Catalog?.searchStore?.elements || [];
    if (!elements.length) return null;
    return chooseBestEpicMatch(elements, query);
  } catch (err) { 
    logger("WARN", "EPIC_SEARCH", "Epic GraphQL search failed", err.message);
    return null; 
  }
}

function chooseBestEpicMatch(items, query) {
  const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normTarget = normalize(query);
  let bestMatch = items[0];
  let bestScore = Infinity;
  for (const item of items) {
      const normItemName = normalize(item.title);
      let score = levenshtein(normTarget, normItemName);
      if (normItemName === normTarget) score -= 100;
      else if (normItemName.startsWith(normTarget)) score -= 20;
      else if (normItemName.includes(normTarget)) score -= 10;
      if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch;
}

function chooseBestSteamMatch(items, query) {
  const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
  const extraTypes = new Set(["dlc", "demo", "music"]);

  let bestMatch = items[0];
  let bestScore = Infinity;

  for (const item of items) {
    const itemName = String(item.name || "").toLowerCase();
    const normItemName = normalize(itemName);
    let score = levenshtein(normTarget, normItemName);

    if (normItemName === normTarget) score -= 100;
    else if (normItemName.startsWith(normTarget)) score -= 20;
    else if (normItemName.includes(normTarget)) score -= 10;

    if (!wantsDLC) {
      const isExtraByName = dlcKeywords.some(kw => itemName.includes(kw));
      const isExtraByType = typeof item.type === "string" && extraTypes.has(item.type.toLowerCase());
      if (isExtraByName || isExtraByType) score += 50;
    }
    if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch; 
}

async function fetchSteamPriceDetails(appId) {
  const detailsRes = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`);
  return detailsRes.data[appId]?.data || null;
}

async function extractSteamOfferEndDate(appId) {
  try {
    const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${appId}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
    const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
    return match && match[1] ? match[1].trim() : null;
  } catch (err) { 
    logger("WARN", "STEAM_OFFER_DATE", "Failed to extract offer end date", err.message);
    return null; 
  }
}

// -------------------------------------------------------------
// STATUS SERVERE
// -------------------------------------------------------------
async function fetchGameStatus(game, lang = "ro") {
  let statusText = getText(lang, "statusApiErr");
  let statusLink = "";
  let homepageLink = "";
  let color = 0x3498db;

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      statusText = `${getText(lang, "statusServ")} ${res.data.status.description}`;
      statusLink = "https://status.epicgames.com/";
      color = res.data.status.indicator === "none" ? 0x2ecc71 : 0xe74c3c;
    } catch (e) {
      logger("WARN", "EPIC_STATUS", "Status fetch failed", e.message);
      statusText = getText(lang, "statusError");
      statusLink = "https://status.epicgames.com/";
    }
  } else if (game.key === "roblox") {
    statusLink = "https://status.roblox.com/";
    statusText = getText(lang, "statusRoblox");
  } else if (game.key === "valorant" || game.key === "lol") {
    statusLink = "https://status.riotgames.com/";
    statusText = getText(lang, "statusRiot");
  } else if (game.key === "minecraft") {
    statusLink = "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-Status";
  } else {
    homepageLink = game.url || game.baseUrl || (game.appId ? `https://store.steampowered.com/app/${game.appId}` : "");
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(getText(lang, "statusTitle", { name: game.name }))
    .setDescription(statusText);

  if (statusLink && statusLink.startsWith("http")) {
    embed.addFields({ name: getText(lang, "statusOff"), value: `[${getText(lang, "statusCheckText")}](${statusLink})` });
  } else {
    if (homepageLink && homepageLink.startsWith("http")) {
      embed.addFields({ name: getText(lang, "statusHome"), value: `[${getText(lang, "statusFallbackText")}](${homepageLink})${getText(lang, "statusFallbackNote")}` });
    }
    const downDetectorUrl = `https://downdetector.com/search/?q=${encodeURIComponent(game.name)}`;
    embed.addFields({ name: "Downdetector", value: `[${getText(lang, "searchDowndetector")}](${downDetectorUrl})` });
  }

  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

// -------------------------------------------------------------
// FUNCȚII CRON JOB
// -------------------------------------------------------------
async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  const results = await getLatestForAllGames();
  const validResults = results.filter(r => r.latest !== null);
  if (!validResults.length) return;

  for (const guild of guilds) {
    let channel;
    const lang = guild.language || "ro";
    try { channel = await client.channels.fetch(guild.notificationChannelId); } catch (err) { continue; } 
    if (!canSendEmbeds(channel, client.user.id)) continue;

    let updatePayload = {};
    if (!guild.seen) guild.seen = {};
    let sentUpdatesCount = 0; 

    for (const { game, latest } of validResults) {
      const seenIds = Array.isArray(guild.seen[game.key]) ? [...guild.seen[game.key]] : [];
      if (!seenIds.includes(latest.id)) {
        if (sentUpdatesCount < 5) { 
          const embed = buildUpdateEmbed(game.name, latest, guild.notificationMode || "detailed", lang);
          try {
            await channel.send({ content: getText(lang, "notifiedUpdate", { name: game.name }), embeds: [embed] });
            await new Promise(r => setTimeout(r, 800)); 
            sentUpdatesCount++;
            seenIds.push(latest.id);
            if (seenIds.length > 20) seenIds.shift();
            guild.seen[game.key] = seenIds;
            updatePayload[`seen.${game.key}`] = seenIds;
            await GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });
          } catch (err) {
            logger("WARN", "CRON_UPDATE", "Failed to send embed", err.message);
          }
        } else {
           break;
        }
      }
    }
  }
}

async function checkForDiscounts() {
  const guilds = await GuildModel.find({ 
    $or: [
        { discountsSubscribed: true, discountChannelId: { $ne: null } },
        { freeSubscribed: true, freeChannelId: { $ne: null } }
    ]
  }).lean();

  if (!guilds.length) return;

  let allDeals;
  try { allDeals = await fetchDeals(); } catch (err) { return; }

  const paidDeals = allDeals
    .filter(d => parseFloat(d.salePrice) > 0)
    .sort((a, b) => b.popularityScore - a.popularityScore);

  const freeDeals = allDeals
    .filter(d => parseFloat(d.salePrice) === 0 && d.savings === 100)
    .sort((a, b) => b.popularityScore - a.popularityScore);

  for (const guild of guilds) {
    const lang = guild.language || "ro";

    // 1. Notificări Reduceri
    if (guild.discountsSubscribed && guild.discountChannelId) {
        let channel;
        try { channel = await client.channels.fetch(guild.discountChannelId); } catch (err) {}

        if (channel && canSendEmbeds(channel, client.user.id)) {
            const minDisc = guild.minDiscountPercent || 0;
            const validPaidDeals = paidDeals.filter(deal => deal.savings >= minDisc);

            let sentCountPaid = 0;
            if (!guild.seenDiscounts) guild.seenDiscounts = [];

            for (const deal of validPaidDeals) {
              const hash = crypto.createHash('sha1').update(`${deal.title}_${deal.store}_${deal.salePrice}_${deal.normalPrice}`).digest('hex');
              if (!guild.seenDiscounts.includes(hash)) {
                if (sentCountPaid < 8) { 
                  try { await enrichDealData(deal); } catch (e) { } 
                  const embed = buildDealEmbed(deal, guild.notificationMode || "detailed", lang);
                  try {
                    await channel.send({ content: getText(lang, "notifiedDeal"), embeds: [embed] });
                    await new Promise(r => setTimeout(r, 800)); 
                    sentCountPaid++;
                    guild.seenDiscounts.push(hash); 
                    if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();
                    await GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
                  } catch (err) { logger("WARN", "CRON_DEAL", "Failed to send embed", err.message); }
                } else {
                   break;
                }
              }
            }
        }
    }

    // 2. Notificări Jocuri Gratuite (Promoții)
    if (guild.freeSubscribed && guild.freeChannelId) {
        let channelFree;
        try { channelFree = await client.channels.fetch(guild.freeChannelId); } catch (err) {}

        if (channelFree && canSendEmbeds(channelFree, client.user.id)) {
            let sentCountFree = 0;
            if (!guild.seenFree) guild.seenFree = [];

            for (const deal of freeDeals) {
              const hash = crypto.createHash('sha1').update(`FREE_${deal.title}_${deal.store}`).digest('hex');
              if (!guild.seenFree.includes(hash)) {
                  if (sentCountFree < 8) {
                      try { await enrichDealData(deal); } catch (e) { } 
                      const embed = buildDealEmbed(deal, guild.notificationMode || "detailed", lang);
                      try {
                          await channelFree.send({ content: getText(lang, "notifiedFree"), embeds: [embed] });
                          await new Promise(r => setTimeout(r, 800));
                          sentCountFree++;
                          guild.seenFree.push(hash);
                          if (guild.seenFree.length > DEALS_HISTORY_LIMIT) guild.seenFree.shift();
                          await GuildModel.updateOne({ _id: guild._id }, { $set: { seenFree: guild.seenFree } });
                      } catch (err) { logger("WARN", "CRON_FREE", "Failed to send embed", err.message); }
                  } else {
                      break; 
                  }
              }
            }
        }
    }
  }
}

// -------------------------------------------------------------
// COMMAND HANDLERS 
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));

  if (subCommand === "updates") {
    const msg = await message.reply(getText(lang, "setChannelUpdates"));
    try {
      const results = await getLatestForAllGames();
      const setPayload = { subscribed: true, notificationChannelId: message.channel.id };
      for (const r of results) if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
      return msg.edit(getText(lang, "updatesActive")).catch(() => null);
    } catch (err) { return msg.edit(formatUserError(err, "initError", lang)).catch(() => null); }
  } 

  if (subCommand === "deals" || subCommand === "reduceri") {
    const msg = await message.reply(getText(lang, "setChannelDeals"));
    try {
      const allDeals = await fetchDeals(); 
      const paidDeals = allDeals
        .filter(d => parseFloat(d.salePrice) > 0)
        .sort((a, b) => b.popularityScore - a.popularityScore);

      const initHashes = paidDeals.map(d => crypto.createHash('sha1').update(`${d.title}_${d.store}_${d.salePrice}_${d.normalPrice}`).digest('hex')).slice(-DEALS_HISTORY_LIMIT);
      await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: initHashes } }, { upsert: true });
      return msg.edit(getText(lang, "dealsActive")).catch(() => null);
    } catch (err) { return msg.edit(formatUserError(err, "dealsError", lang)).catch(() => null); }
  }

  if (subCommand === "free") {
    const msg = await message.reply(getText(lang, "setChannelFree"));
    try {
      const allDeals = await fetchDeals();
      const freeDeals = allDeals
        .filter(d => parseFloat(d.salePrice) === 0 && d.savings === 100)
        .sort((a, b) => b.popularityScore - a.popularityScore);

      const initHashes = freeDeals.map(d => crypto.createHash('sha1').update(`FREE_${d.title}_${d.store}`).digest('hex')).slice(-DEALS_HISTORY_LIMIT);
      await GuildModel.updateOne({ _id: guildId }, { $set: { freeSubscribed: true, freeChannelId: message.channel.id, seenFree: initHashes } }, { upsert: true });
      return msg.edit(getText(lang, "freeActive")).catch(() => null);
    } catch (err) { return msg.edit(formatUserError(err, "dealsError", lang)).catch(() => null); }
  }

  return message.reply(getText(lang, "startUpdatesSyntax", { prefix: PREFIX }));
}

async function handleStop(message, subCommand, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));
  try {
    if (subCommand === "updates") { await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null } }); return message.reply(getText(lang, "stopUpdates")); }
    if (subCommand === "deals" || subCommand === "reduceri") { await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null } }); return message.reply(getText(lang, "stopDeals")); }
    if (subCommand === "free") { await GuildModel.updateOne({ _id: guildId }, { $set: { freeSubscribed: false, freeChannelId: null } }); return message.reply(getText(lang, "stopFree")); }
  } catch (err) {}
  return message.reply(getText(lang, "stopSyntax", { prefix: PREFIX }));
}

async function handleSetCommand(message, args, guildId, lang) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply(getText(lang, "adminOnly"));
  const setting = (args[0] || "").toLowerCase();
  const value = (args[1] || "").toLowerCase();

  if (!setting || !value) return message.reply(getText(lang, "setHelp"));
  const updateDoc = {};
  let confirmMsg = "";

  switch (setting) {
    case "mode":
      if (!["compact", "detailed"].includes(value)) return message.reply(getText(lang, "invalidMode"));
      updateDoc.notificationMode = value; confirmMsg = getText(lang, "modeSet", { value }); break;
    case "mindiscount":
      const min = parseInt(value);
      if (isNaN(min) || min < 0 || min > 100) return message.reply(getText(lang, "invalidDiscount"));
      updateDoc.minDiscountPercent = min; confirmMsg = getText(lang, "discountSet", { value: min }); break;
    case "language":
      if (!["ro", "en"].includes(value)) return message.reply(getText(lang, "invalidLang"));
      updateDoc.language = value; confirmMsg = getText(value, "langSet", { value: value.toUpperCase() }); break;
    default: return message.reply(getText(lang, "unknownSetting"));
  }
  try { await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true }); return message.reply(confirmMsg); } 
  catch (err) { return message.reply(formatUserError(err, "saveError", lang)); }
}

async function handleLatestUpdates(message, guildDoc, lang) {
  let msg = null;
  if (!cache.updates.data) {
    const estMs = (await getSystemTimes()).all || 35000;
    msg = await message.reply(getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();
    try {
        const results = await getLatestForAllGames();
        cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes();
        sys.all = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "fetchUpdatesError", lang)).catch(() => null); }
  }
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) return msg ? msg.edit(getText(lang, "noData")).catch(() => null) : message.reply(getText(lang, "noData"));

  const mode = guildDoc?.notificationMode || "detailed";
  if (msg) await msg.edit(getText(lang, "dataLoaded")).catch(() => null);
  else msg = await message.reply(getText(lang, "dataLoaded"));
  const generateEmbeds = async (page, totalP, currentMode) => valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r => buildUpdateEmbed(r.game.name, r.latest, currentMode, lang).setFooter({ text: `${r.game.name} • ${getText(lang, "page")} ${page + 1}/${totalP}` }));
  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestDeals(message, guildDoc, lang) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).deals || 10000;
    msg = await message.reply(getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();
    try {
        const rawDeals = await fetchDeals();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes();
        sys.deals = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "fetchDealsError", lang)).catch(() => null); }
  }

  const mode = guildDoc?.notificationMode || "detailed";
  const minDisc = guildDoc?.minDiscountPercent || 0;

  const top = cache.deals.data
    .filter(deal => parseFloat(deal.salePrice) > 0 && deal.savings >= minDisc)
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_DEALS);

  if (!top.length) return msg ? msg.edit(getText(lang, "noDealsMatch")).catch(() => null) : message.reply(getText(lang, "noDealsMatch"));
  if (msg) await msg.edit(getText(lang, "dealsLoaded")).catch(() => null);
  else msg = await message.reply(getText(lang, "dealsLoaded"));

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    if (currentMode !== "compact") { 
      for (const d of chunk) { try { await enrichDealData(d); } catch(e) {} }
    }
    return chunk.map(d => buildDealEmbed(d, currentMode, lang).setFooter({ text: `${getText(lang, "page")} ${page + 1}/${totalP}` }));
  };
  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestFreeGames(message, guildDoc, lang) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).free || 10000;
    msg = await message.reply(getText(lang, "estTime", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
    const startTime = Date.now();
    try {
        const rawDeals = await fetchDeals();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes();
        sys.free = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "fetchDealsError", lang)).catch(() => null); }
  }

  const mode = guildDoc?.notificationMode || "detailed";

  const freeSteam = cache.deals.data
    .filter(deal => parseFloat(deal.salePrice) === 0 && deal.savings === 100 && deal.store === "Steam")
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_FREE_PER_STORE);

  const freeEpic = cache.deals.data
    .filter(deal => parseFloat(deal.salePrice) === 0 && deal.savings === 100 && deal.store === "Epic Games")
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_FREE_PER_STORE);

  const freeGames = [...freeSteam, ...freeEpic];

  if (!freeGames.length) return msg ? msg.edit(getText(lang, "noFreeMatch")).catch(() => null) : message.reply(getText(lang, "noFreeMatch"));
  if (msg) await msg.edit(getText(lang, "freeLoaded")).catch(() => null);
  else msg = await message.reply(getText(lang, "freeLoaded"));

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = freeGames.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    if (currentMode !== "compact") { 
      for (const d of chunk) { try { await enrichDealData(d); } catch(e) {} }
    }
    return chunk.map(d => buildDealEmbed(d, currentMode, lang).setFooter({ text: `${getText(lang, "page")} ${page + 1}/${totalP}` }));
  };
  await handlePagination(msg, message.author.id, "free", freeGames, ITEMS_PER_PAGE, generateEmbeds, mode, lang);
}

async function handleLatestSingle(message, gameText, guildDoc, lang) {
  if (!gameText) return message.reply(getText(lang, "latestUpdateSyntax", { prefix: PREFIX }));
  const estMs = (await getSystemTimes()).single || 2000;
  const loadingMsg = await message.reply(getText(lang, "connecting", { time: Math.max(1, Math.ceil(estMs / 1000)) }));
  const startTime = Date.now();

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = getText(lang, "gameNotFound");
    if (suggestion) errText += getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key });
    return loadingMsg.edit(errText).catch(() => null);
  }
  try {
    let latest;
    if (cache.single.has(game.key) && Date.now() < cache.single.get(game.key).expiresAt) {
        const cachedVal = cache.single.get(game.key);
        cache.single.delete(game.key);
        cache.single.set(game.key, cachedVal);
        latest = cachedVal.data;
    } else {
      const res = await executeFetchWithCircuitBreaker(game);
      if (res.error) throw new Error(res.error);
      latest = res.latest;
      cache.single.set(game.key, { data: latest, expiresAt: Date.now() + CACHE_TTL_MS });
      const executionTimes = await getSystemTimes(); executionTimes.single = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(executionTimes);
    }
    await loadingMsg.edit({ content: getText(lang, "updateSuccess", { name: game.name }), embeds: [buildUpdateEmbed(game.name, latest, guildDoc?.notificationMode || "detailed", lang)] }).catch(() => null);
  } catch (error) { 
    await loadingMsg.edit(formatUserError(error, "updateError", lang)).catch(() => null);
  }
}

async function handlePriceSearch(message, gameName, lang) {
  if (!gameName) return message.reply(getText(lang, "priceSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingDualPrice", { name: gameName }));

  let steamData = null;
  let steamAppId = null;
  let steamEndDate = null;

  try {
    const steamItems = await searchSteamGameByName(gameName);
    if (steamItems && steamItems.length > 0) {
      const bestMatch = chooseBestSteamMatch(steamItems, gameName);
      if (bestMatch && bestMatch.id) {
        steamAppId = bestMatch.id;
        steamData = await fetchSteamPriceDetails(steamAppId);
        if (steamData && steamData.price_overview && steamData.price_overview.discount_percent > 0) {
            steamEndDate = await extractSteamOfferEndDate(steamAppId);
        }
      }
    }
  } catch (e) {
    logger("WARN", "PRICE_SEARCH", "Steam search/fetch failed", e.message);
  }

  let epicData = null;
  try {
    epicData = await searchEpicGameByName(gameName);
  } catch (e) {
    logger("WARN", "PRICE_SEARCH", "Epic Games search failed", e.message);
  }

  if (!steamData && !epicData) {
      return loadingMsg.edit(getText(lang, "noDualResults", { name: gameName })).catch(() => null);
  }

  try {
      const embed = buildDualPriceEmbed(steamData, steamAppId, steamEndDate, epicData, gameName, lang);
      await loadingMsg.edit({ content: getText(lang, "priceDualSuccess"), embeds: [embed] }).catch(() => null);
  } catch (err) {
      logger("ERROR", "PRICE_SEARCH", "Failed to build or send dual price embed", err.message);
      await loadingMsg.edit(getText(lang, "priceUnexpectedError")).catch(() => null);
  }
}

async function handleDlcSearch(message, gameName, lang) {
  if (!gameName) return message.reply(getText(lang, "dlcSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingDlc", { name: gameName }));

  try {
    let items;
    try { items = await searchSteamGameByName(gameName); } catch (e) { return loadingMsg.edit(getText(lang, "steamError")).catch(() => null); }
    if (!items || items.length === 0) return loadingMsg.edit(getText(lang, "noSteamResults", { name: gameName })).catch(() => null);

    let bestMatch = chooseBestSteamMatch(items, gameName);
    if (!bestMatch || !bestMatch.id) return loadingMsg.edit(getText(lang, "invalidSteamResult")).catch(() => null);

    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
      if (baseGame) bestMatch = baseGame;
    }

    const cacheKey = bestMatch.id;
    let dlcData;
    if (cache.dlc.has(cacheKey) && Date.now() < cache.dlc.get(cacheKey).expiresAt) {
      const cachedVal = cache.dlc.get(cacheKey); cache.dlc.delete(cacheKey); cache.dlc.set(cacheKey, cachedVal); dlcData = cachedVal.data;
    } else {
      const title = bestMatch.name;
      let gameDetails;
      try { gameDetails = await fetchSteamPriceDetails(cacheKey); } catch (e) { logger("WARN", "DLC_SEARCH", "Details fetch failed", e.message); }
      const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;
      const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${cacheKey}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" }, timeout: 15000 });
      const $ = cheerio.load(htmlRes.data);

      if ($('#agegate_box').length > 0 || $('.agegate_text_container').length > 0 || htmlRes.request?.path?.includes('agecheck')) {
        return loadingMsg.edit(getText(lang, "ageGate", { name: title })).catch(() => null);
      }

      const dlcList = [];
      const seenDlcIds = new Set();
      $('.game_area_dlc_row').each((i, el) => {
        const dlcName = $(el).find('.game_area_dlc_name').text().trim();
        let dlcPrice = $(el).find('.game_area_dlc_price').text().trim();
        const dlcAppId = $(el).attr('data-ds-appid');

        let explicitLink = $(el).attr('href');
        if (!explicitLink) {
            explicitLink = $(el).find('a').attr('href');
        }

        if (explicitLink) {
            explicitLink = absoluteUrl("https://store.steampowered.com", explicitLink);
        }

        dlcPrice = dlcPrice.replace(/\s+/g, ' ');
        if (!dlcPrice || dlcPrice === "") dlcPrice = getText(lang, "priceUnav");

        if (dlcName && !seenDlcIds.has(dlcAppId || dlcName)) { 
            seenDlcIds.add(dlcAppId || dlcName); 

            let link = explicitLink;
            if (!link) {
                link = dlcAppId ? `https://store.steampowered.com/app/${dlcAppId}` : `https://store.steampowered.com/app/${cacheKey}`;
            }

            dlcList.push({ name: dlcName, price: dlcPrice, link }); 
        }
      });
      if (dlcList.length === 0) {
        if ($('.game_area_purchase_game').length === 0) return loadingMsg.edit(getText(lang, "pageStructureError", { name: title })).catch(() => null);
        return loadingMsg.edit(getText(lang, "noDlcList", { name: title })).catch(() => null);
      }

      const totalExtracted = dlcList.length;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, thumbUrl, totalExtracted };
      cache.dlc.set(cacheKey, { data: dlcData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } = dlcData;
    await loadingMsg.edit(getText(lang, "dlcSuccess", { count: totalExtracted, name: title })).catch(() => null);

    const itemsPerPage = 10;
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcList.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
      const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(getText(lang, "dlcPack", { title: title })).setURL(`https://store.steampowered.com/app/${finalAppId}`).setThumbnail(finalThumbUrl);
      let desc = "";
      chunk.forEach((dlc, index) => { 
          const globalIndex = page * itemsPerPage + index + 1; 
          desc += `**${globalIndex}. ${truncate(dlc.name, 100)}**\n💵 ${dlc.price}\n[${getText(lang, "dlcBuyLink")}](${dlc.link})\n\n`; 
      });
      embed.setDescription(desc);

      let footerText = `${getText(lang, "page")} ${page + 1}/${totalP} • ${getText(lang, "displayed")}: ${dlcList.length} / ${getText(lang, "extracted")}: ${totalExtracted}`;
      if (totalExtracted >= 100) {
          footerText += `\n${getText(lang, "dlcMoreNote")}`;
      }
      embed.setFooter({ text: footerText });

      return [embed];
    };
    await handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcList, itemsPerPage, generateEmbeds, "detailed", lang);

  } catch (err) { 
    logger("ERROR", "DLC_SEARCH", "Fatal error", err.message);
    await loadingMsg.edit(getText(lang, "dlcUnexpectedError")).catch(() => null); 
  }
}

async function handleStatus(message, gameText, lang) {
  if (!gameText) return message.reply(getText(lang, "statusSyntax", { prefix: PREFIX }));
  const loadingMsg = await message.reply(getText(lang, "searchingStatus", { name: gameText }));

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = getText(lang, "gameNotFound");
    if (suggestion) errText += getText(lang, "didYouMean", { name: suggestion.name, key: suggestion.key });
    return loadingMsg.edit(errText).catch(() => null);
  }

  try {
    const embed = await fetchGameStatus(game, lang);
    await loadingMsg.edit({ content: getText(lang, "statusSuccess", { name: game.name }), embeds: [embed] }).catch(() => null);
  } catch (err) { 
    logger("ERROR", "STATUS_CMD", "Failed to get status", err.message);
    await loadingMsg.edit(getText(lang, "statusError")).catch(() => null); 
  }
}

// -------------------------------------------------------------
// INIT 
// -------------------------------------------------------------
let isRunningCron = false;
client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);
  const runChecks = async () => {
    if (isRunningCron) return logger("WARN", "CRON", "Jobul anterior încă rulează pe această instanță, sar peste ciclul actual.");
    isRunningCron = true;
    cleanCache();
    const lockToken = await acquireDbLock("main_cron_job", 120000);
    if (!lockToken) { isRunningCron = false; return; }

    const hb = setInterval(() => renewDbLock("main_cron_job", lockToken, 120000).catch(()=>{}), 60000);
    try { await checkForUpdates(); await checkForDiscounts(); } 
    catch (err) { logger("ERROR", "CRON", "Eroare loop principal", err.message); } 
    finally { clearInterval(hb); await releaseDbLock("main_cron_job", lockToken); isRunningCron = false; }
  };
  runChecks();
  const min = Number(config.checkIntervalMinutes || 30);
  cron.schedule(min === 60 ? '0 * * * *' : `*/${min} * * * *`, runChecks);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.toLowerCase().startsWith(PREFIX.toLowerCase())) return;

  const guildDoc = await GuildModel.findById(message.guild.id).lean();
  const lang = guildDoc?.language || "ro";

  const rawContent = message.content.slice(PREFIX.length).trim();
  const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ''));
  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();

  if (command === "ping") return message.reply(getText(lang, "pong"));
  if (command === "games" || command === "porecle") {
    const lines = config.games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });
    let currentMsg = getText(lang, "trackedGames");
    for (const line of lines) {
        if (currentMsg.length + line.length > 1900) {
            if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
            currentMsg = "";
        }
        currentMsg += line + "\n";
    }
    if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
    return;
  }

  const joinedSub = rawArgs.join(" ").toLowerCase();

  if (command === "start") {
    if (joinedSub === "free" || joinedSub === "free games") {
      return handleStart(message, "free", message.guild.id, lang);
    }
    return handleStart(message, subCommand, message.guild.id, lang);
  }

  if (command === "stop") {
    if (joinedSub === "free" || joinedSub === "free games") {
      return handleStop(message, "free", message.guild.id, lang);
    }
    return handleStop(message, subCommand, message.guild.id, lang);
  }

  if (command === "set") return handleSetCommand(message, rawArgs, message.guild.id, lang);

  if (command === "latest") {
    if (subCommand === "updates") return handleLatestUpdates(message, guildDoc, lang);
    if (subCommand === "deals" || subCommand === "reduceri") return handleLatestDeals(message, guildDoc, lang);

    if (joinedSub === "free" || joinedSub === "free games") return handleLatestFreeGames(message, guildDoc, lang);

    if (subCommand === "price" || subCommand === "pret") return handlePriceSearch(message, rawArgs.slice(1).join(" "), lang);
    if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "), guildDoc, lang);
  }

  if (command === "dlc") return handleDlcSearch(message, rawArgs.join(" "), lang);
  if (command === "status") return handleStatus(message, rawArgs.join(" "), lang);

  if (command === "help") {
    if (rawArgs.length > 0) {
        const cmdQuery = rawArgs.join("_").toLowerCase();
        const helpKey = "helpCmd_" + cmdQuery;
        let desc = getText(lang, helpKey, { items: ITEMS_PER_PAGE, prefix: PREFIX });

        if (desc === helpKey) { 
            desc = getText(lang, "helpCmdNotFound", { prefix: PREFIX });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle(`${getText(lang, "helpDetailedTitle")}: ${rawArgs.join(" ")}`)
            .setDescription(desc);

        return message.reply({ embeds: [embed] });
    }

    const helpEmbed = new EmbedBuilder().setColor(0x2b2d31).setTitle(getText(lang, "helpTitle"))
      .addFields(
        { name: getText(lang, "helpGeneral"), value: getText(lang, "helpGeneralCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpNotif"), value: getText(lang, "helpNotifCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpPrefs"), value: getText(lang, "helpPrefsCmds", { prefix: PREFIX }) },
        { name: getText(lang, "helpManual"), value: getText(lang, "helpManualCmds", { prefix: PREFIX }) }
      )
      .setFooter({ text: getText(lang, "helpFooter", { prefix: PREFIX }) });
    return message.reply({ embeds: [helpEmbed] });
  }
});

async function bootstrap() {
  if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) {
    logger("ERROR", "BOOTSTRAP", "Lipsesc variabilele de mediu MONGO_URI sau DISCORD_TOKEN");
    return process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) { process.exit(1); }
}

bootstrap();
