const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { z } = require("zod");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionsBitField } = require("discord.js");

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
        startUpdatesSyntax: "❌ Sintaxă: {prefix}start updates, {prefix}start deals sau {prefix}start free games.",
        setChannelDeals: "⏳ Setez canalul pentru oferte plătite...",
        dealsActive: "✅ Alertele pentru reduceri (plătite) activate!\n*(Trimit ofertele active curente în câteva secunde...)",
        setChannelFree: "⏳ Setez canalul pentru jocuri gratuite...",
        freeActive: "✅ Alertele pentru jocurile promoționale 100% GRATUITE activate!\n(Trimit promoțiile active curente în câteva secunde...)",
        dealsError: "Eroare internă la preluarea ofertelor.",
        stopUpdates: "🛑 Update-uri oprite.",
        stopDeals: "🛑 Reduceri oprite.",
        stopFree: "🛑 Notificările de jocuri gratuite oprite.",
        stopSyntax: "❌ Sintaxă: {prefix}stop updates, {prefix}stop deals sau {prefix}stop free games.",
        setHelp: "⚙️ Setări: mode, mindiscount, language.",
        invalidMode: "❌ Permise: compact sau detailed.",
        modeSet: "✅ Mod setat: {value}",
        invalidDiscount: "❌ 0-100.",
        discountSet: "✅ Reducere minimă: {value}%",
        invalidLang: "❌ Limbi permise: ro sau en.",
        langSet: "✅ Limba setată: {value}",
        unknownSetting: "❌ Setare necunoscută.",
        saveError: "Eroare la salvarea preferințelor.",
        estTime: "⏳ Durată estimată: {time} secunde",
        fetchUpdatesError: "Nu am reușit să obțin update-urile.",
        noData: "❌ Nu am date disponibile.",
        dataLoaded: "✅ Date încărcate!",
        fetchDealsError: "Nu am putut interoga magazinele.",
        noDealsMatch: "❌ Nu am găsit oferte care să corespundă setărilor serverului.",
        noFreeMatch: "❌ Nu am găsit jocuri promoționale 100% gratuite în acest moment.",
        dealsLoaded: "✅ Oferte încărcate!",
        freeLoaded: "✅ Promoții gratuite găsite!",
        separatorSteam: "🎮  ---  PROMOȚII STEAM  ---  🎮",
        separatorEpic: "🛒  ---  PROMOȚII EPIC GAMES  ---  🛒",
        latestUpdateSyntax: "❌ Ex: {prefix}latest update cs2.",
        connecting: "⏳ Mă conectez... Durată estimată: {time} secunde.",
        gameNotFound: "❌ Nu am găsit jocul.",
        didYouMean: " Te refereai cumva la {name} ({key})?",
        updateSuccess: "✅ Update {name}:",
        updateError: "Nu am putut prelua acest update.",
        priceSyntax: "❌ Trebuie să specifici un joc. Ex: {prefix}latest price cyberpunk.",
        searchingDualPrice: "⏳ Caut prețul pe Steam și Epic Games pentru {name}...",
        steamError: "❌ Eroare la conectarea cu serverele Steam.",
        noSteamResults: "❌ Nu am găsit niciun rezultat pe Steam pentru \"{name}\".",
        noDualResults: "❌ Nu am găsit niciun rezultat pe Steam sau Epic Games pentru \"{name}\".",
        invalidSteamResult: "❌ Nu am putut selecta un rezultat valid de pe Steam.",
        steamApiError: "❌ Steam API nu a putut returna detaliile.",
        steamDetailsUnavailable: "❌ Detaliile de preț nu sunt disponibile (posibil blocat regional).",
        priceDualSuccess: "✅ Am obținut prețurile!",
        dualPriceTitle: "🏷️ Preț curent: {title}",
        notFoundSteam: "❌ Jocul nu a fost găsit (sau nu are preț public) pe Steam.",
        notFoundEpic: "❌ Jocul nu a fost găsit pe Epic Games.",
        priceUnexpectedError: "❌ A apărut o eroare neașteptată la căutarea prețului.",
        dlcSyntax: "❌ Trebuie să specifici un joc. Ex: {prefix}dlc cyberpunk.",
        searchingDlc: "⏳ Caut DLC-urile pentru {name}...",
        ageGate: "❌ Pagina de Steam pentru {name} necesită verificare de vârstă, iar botul nu o poate accesa direct.",
        pageStructureError: "❌ Structura paginii pentru {name} nu a putut fi interpretată (posibil regiune blocată sau pachet special).",
        noDlcList: "❌ Jocul {name} nu are niciun DLC listat separat pe magazinul Steam.",
        dlcSuccess: "✅ Am găsit {count} DLC-uri pentru {name}!",
        dlcUnexpectedError: "❌ A apărut o eroare la căutarea DLC-urilor.",
        helpTitle: "🤖 Meniul de Ajutor - Big Master",
        helpDetailedTitle: "📖 Detalii comandă",
        helpCmdNotFound: "❌ Nu am găsit detalii pentru această comandă. Asigură-te că ai scris-o corect.",
        helpFooter: "💡 Tip: Folosește {prefix}help [comandă] pentru explicații detaliate",
        helpGeneral: "🛠️ Comenzi pentru Ajutor Utilizator",
        helpNotif: "🔔 Comenzi pentru Notificare",
        helpPrefs: "⚙️ Comenzi Setare Bot Pentru Server",
        helpManual: "🎮 Comenzi Jocuri",
        trackedGames: "🎮 Jocuri urmărite:\n",
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
        notifiedUpdate: "🔔 A apărut un update nou pentru {name}!",
        notifiedDeal: "🔥 Ofertă nouă detectată!",
        notifiedFree: "🎁 Un joc GRATUIT (Promoție 100%) a apărut!",
        typeProd: "Tip produs:",
        typeGame: "Joc",
        currFree: "Acest titlu este permanent gratuit (Free-to-Play).",
        priceUnav: "Prețul nu este disponibil în acest moment.",
        activeDisc: "Este o reducere activă de {percent}%!\n\n~~{old}~~ -> {new}",
        expAt: "\n⏳ Oferta expiră la: ",
        expUnspec: "Nespecificat (posibil ofertă permanentă sau bundle).",
        noDisc: "Nu este la reducere în acest moment.\n\nPreț standard: {price}",
        dlcPack: "📦 DLC-uri: {title}",
        dlcBuyLink: "🛒 Cumpără / Vezi pe Steam",
        dealOffer: "🏷️ {store} oferă o reducere de {savings}%!\n\n",
        freeOffer: "🎁 {store} oferă acest titlu GRATUIT pentru o perioadă limitată!\n\n",
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
        helpGeneralCmds: "{prefix}help\n{prefix}help [nume comandă]\n{prefix}ping",
        helpNotifCmds: "{prefix}start updates\n{prefix}stop updates\n{prefix}start deals (sau reduceri)\n{prefix}stop deals\n{prefix}start free games (sau free)\n{prefix}stop free games",
        helpPrefsCmds: "{prefix}set mode [compact/detailed]\n{prefix}set mindiscount [0-100]\n{prefix}set language [ro/en]",
        helpManualCmds: "{prefix}games (sau {prefix}porecle)\n{prefix}latest updates\n{prefix}latest deals (doar jocuri plătite)\n{prefix}latest free games (până la 20 Steam/Epic)\n{prefix}latest update [poreclă]\n{prefix}latest price [nume joc]\n{prefix}dlc [nume joc]\n{prefix}status [nume joc]",
        excerptFortnite: "Update oficial Fortnite.",
        excerptAmdDriver: "Driver disponibil.",
        excerptAMD: "Update AMD.com.",
        excerptIntel: "Update intel.com detectat.",
        excerptVersion: "Versiunea {v}",
        helpCmd_ping: "🏓 Ping: Verifică timpul de răspuns (latența) botului.",
        helpCmd_games: "🎮 Games/Porecle: Afișează o listă completă cu toate jocurile monitorizate automat.",
        helpCmd_porecle: "🎮 Games/Porecle: Afișează o listă completă cu toate jocurile monitorizate automat.",
        helpCmd_start_updates: "🔔 Start Updates: (Necesită Administrator) Setează canalul destinație pentru noile Patch Notes.",
        helpCmd_stop_updates: "🛑 Stop Updates: (Necesită Administrator) Oprește trimiterea automată a update-urilor.",
        helpCmd_start_deals: "🔔 Start Deals: (Necesită Administrator) Setează destinația pentru alertele cu reduceri (doar jocuri care costă bani).",
        helpCmd_start_reduceri: "🔔 Start Deals: (Necesită Administrator) Setează destinația pentru alertele cu reduceri (doar jocuri care costă bani).",
        helpCmd_stop_deals: "🛑 Stop Deals: (Necesită Administrator) Oprește notificările de reduceri.",
        helpCmd_stop_reduceri: "🛑 Stop Deals: (Necesită Administrator) Oprește notificările de reduceri.",
        helpCmd_start_free_games: "🔔 Start Free Games: (Necesită Administrator) Setează destinația EXCLUSIV pentru jocurile promoționale (reducere 100%).",
        helpCmd_start_free: "🔔 Start Free Games: (Necesită Administrator) Setează destinația EXCLUSIV pentru jocurile promoționale (reducere 100%).",
        helpCmd_stop_free_games: "🛑 Stop Free Games: (Necesită Administrator) Oprește notificările pentru jocurile gratuite.",
        helpCmd_stop_free: "🛑 Stop Free Games: (Necesită Administrator) Oprește notificările pentru jocurile gratuite.",
        helpCmd_set_mode: "⚙️ Set Mode: (Necesită Administrator) Schimbă dimensiunea mesajelor (compact/detailed).",
        helpCmd_set_mindiscount: "⚙️ Set MinDiscount: (Necesită Administrator) Setează pragul minim (în procente) pentru oferte.",
        helpCmd_set_language: "⚙️ Set Language: (Necesită Administrator) Schimbă limba botului (ro/en).",
        helpCmd_latest_updates: "🔍 Latest Updates: Afișează o listă paginată ({items} pe pagină) cu cele mai noi actualizări.",
        helpCmd_latest_deals: "🔍 Latest Deals: Afișează cele mai populare reduceri plătite la jocuri (Steam/Epic).",
        helpCmd_latest_reduceri: "🔍 Latest Deals: Afișează cele mai populare reduceri plătite la jocuri (Steam/Epic).",
        helpCmd_latest_free_games: "🔍 Latest Free Games: Afișează o listă cu promoții 100% gratuite, grupate clar pe magazin.",
        helpCmd_latest_free: "🔍 Latest Free Games: Afișează o listă cu promoții 100% gratuite, grupate clar pe magazin.",
        helpCmd_latest_update: "🔍 Latest Update [nume]: Caută ultimul update lansat doar pentru jocul specificat.",
        helpCmd_latest_price: "🔍 Latest Price [nume]: Caută prețul curent simultan pe Steam și pe Epic Games.",
        helpCmd_latest_pret: "🔍 Latest Price [nume]: Caută prețul curent simultan pe Steam și pe Epic Games.",
        helpCmd_dlc: "🔍 DLC [nume joc]: Extrage lista completă de DLC-uri pentru un joc de pe Steam.",
        statusTitle: "📊 Status complet: {name}",
        statusNoUpdate: "Nu am găsit update-uri recente în baza de date.",
        statusHelp: "🔍 Status [nume]: Afișează un raport complet (preț, update-uri, reduceri) pentru un joc anume.",
        helpCmd_status: "🔍 Status [nume]: Verifică prețul curent și ultimul update disponibil pentru un joc."
    },
    en: {
        adminOnly: "⛔ Admin only.",
        pong: "Pong! 🏓",
        setChannelUpdates: "⏳ Setting updates channel...",
        updatesActive: "✅ Automatic updates enabled.",
        initError: "Error initializing data.",
        startUpdatesSyntax: "❌ Syntax: {prefix}start updates, {prefix}start deals or {prefix}start free games.",
        setChannelDeals: "⏳ Setting deals channel...",
        dealsActive: "✅ Deal alerts (paid) enabled!\n(Sending current active deals right now...)",
        setChannelFree: "⏳ Setting free games channel...",
        freeActive: "✅ 100% FREE games alerts enabled!\n(Sending active promotions right now...)*",
        dealsError: "Internal error fetching deals.",
        stopUpdates: "🛑 Updates stopped.",
        stopDeals: "🛑 Deals stopped.",
        stopFree: "🛑 Free games notifications stopped.",
        stopSyntax: "❌ Syntax: {prefix}stop updates, {prefix}stop deals or {prefix}stop free games.",
        setHelp: "⚙️ Settings: mode, mindiscount, language.",
        invalidMode: "❌ Allowed: compact or detailed.",
        modeSet: "✅ Mode set to: {value}",
        invalidDiscount: "❌ 0-100.",
        discountSet: "✅ Minimum discount: {value}%",
        invalidLang: "❌ Allowed languages: ro or en.",
        langSet: "✅ Language set to: {value}",
        unknownSetting: "❌ Unknown setting.",
        saveError: "Error saving preferences.",
        estTime: "⏳ Estimated time: {time} seconds",
        fetchUpdatesError: "Failed to fetch updates.",
        noData: "❌ No data available.",
        dataLoaded: "✅ Data loaded!",
        fetchDealsError: "Failed to fetch deals.",
        noDealsMatch: "❌ No deals found matching server settings.",
        noFreeMatch: "❌ No 100% free promotional games found at this moment.",
        dealsLoaded: "✅ Deals loaded!",
        freeLoaded: "✅ Free promotions found!",
        separatorSteam: "🎮  ---  STEAM PROMOTIONS  ---  🎮",
        separatorEpic: "🛒  ---  EPIC GAMES PROMOTIONS  ---  🛒",
        latestUpdateSyntax: "❌ Ex: {prefix}latest update cs2.",
        connecting: "⏳ Connecting... Estimated time: {time} seconds.",
        gameNotFound: "❌ Game not found.",
        didYouMean: " Did you mean {name} ({key})?",
        updateSuccess: "✅ Update {name}:",
        updateError: "Could not fetch this update.",
        priceSyntax: "❌ You must specify a game. Ex: {prefix}latest price cyberpunk.",
        searchingDualPrice: "⏳ Searching Steam and Epic Games for {name}...",
        steamError: "❌ Error connecting to Steam servers.",
        noSteamResults: "❌ No Steam results found for \"{name}\".",
        noDualResults: "❌ No results found on Steam or Epic Games for \"{name}\".",
        invalidSteamResult: "❌ Could not select a valid Steam result.",
        steamApiError: "❌ Steam API could not return details.",
        steamDetailsUnavailable: "❌ Price details are unavailable (possibly region blocked).",
        priceDualSuccess: "✅ Prices retrieved!",
        dualPriceTitle: "🏷️ Current Price: {title}",
        notFoundSteam: "❌ Game not found (or has no public price) on Steam.",
        notFoundEpic: "❌ Game not found on Epic Games.",
        priceUnexpectedError: "❌ Unexpected error fetching the price.",
        dlcSyntax: "❌ You must specify a game. Ex: {prefix}dlc cyberpunk.",
        searchingDlc: "⏳ Searching DLCs for {name}...",
        ageGate: "❌ Steam page for {name} is age-restricted; bot cannot access it directly.",
        pageStructureError: "❌ Page structure for {name} could not be parsed (possibly region blocked or special bundle).",
        noDlcList: "❌ {name} has no separately listed DLCs on Steam.",
        dlcSuccess: "✅ Found {count} DLCs for {name}!",
        dlcUnexpectedError: "❌ Error searching for DLCs.",
        helpTitle: "🤖 Help Menu - Big Master",
        helpDetailedTitle: "📖 Command Details",
        helpCmdNotFound: "❌ Details not found for this command. Make sure you typed it correctly.",
        helpFooter: "💡 Tip: Use {prefix}help [command] for detailed explanations",
        helpGeneral: "🛠️ General Utility Commands",
        helpNotif: "🔔 Notification Commands",
        helpPrefs: "⚙️ Bot Setup Commands",
        helpManual: "🎮 Game Commands",
        trackedGames: "🎮 Tracked Games:\n",
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
        notifiedUpdate: "🔔 A new update for {name} was released!",
        notifiedDeal: "🔥 New deal detected!",
        notifiedFree: "🎁 A FREE game (100% Off) is available!",
        typeProd: "Product Type:",
        typeGame: "Game",
        currFree: "This title is permanently free (Free-to-Play).",
        priceUnav: "Price is currently unavailable.",
        activeDisc: "There's an active {percent}% discount!\n\n~~{old}~~ -> {new}",
        expAt: "\n⏳ Offer expires at: ",
        expUnspec: "Unspecified (possibly permanent or a bundle).",
        noDisc: "Not on sale right now.\n\nStandard price: {price}",
        dlcPack: "📦 DLCs: {title}",
        dlcBuyLink: "🛒 Buy / View on Steam",
        dealOffer: "🏷️ {store} offers a {savings}% discount!\n\n",
        freeOffer: "🎁 {store} is offering this title for FREE for a limited time!\n\n",
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
        helpGeneralCmds: "{prefix}help\n{prefix}help [command]\n{prefix}ping",
        helpNotifCmds: "{prefix}start updates\n{prefix}stop updates\n{prefix}start deals\n{prefix}stop deals\n{prefix}start free games (or free)\n{prefix}stop free games",
        helpPrefsCmds: "{prefix}set mode [compact/detailed]\n{prefix}set mindiscount [0-100]\n{prefix}set language [ro/en]",
        helpManualCmds: "{prefix}games (or {prefix}aliases)\n{prefix}latest updates\n{prefix}latest deals (paid only)\n{prefix}latest free games (up to 20 Steam/Epic)\n{prefix}latest update [alias]\n{prefix}latest price [game]\n{prefix}dlc [game]",
        excerptFortnite: "Official Fortnite update.",
        excerptAmdDriver: "Driver available.",
        excerptAMD: "AMD.com update.",
        excerptIntel: "intel.com update detected.",
        excerptVersion: "Version {v}",
        helpCmd_ping: "🏓 Ping: Checks bot's response time (latency).",
        helpCmd_games: "🎮 Games/Aliases: Shows a full list of all automatically tracked games.",
        helpCmd_porecle: "🎮 Games/Aliases: Shows a full list of all automatically tracked games.",
        helpCmd_aliases: "🎮 Games/Aliases: Shows a full list of all automatically tracked games.",
        helpCmd_start_updates: "🔔 Start Updates: (Admin) Sets the destination channel for new Patch Notes.",
        helpCmd_stop_updates: "🛑 Stop Updates: (Admin) Stops automatic update notifications.",
        helpCmd_start_deals: "🔔 Start Deals: (Admin) Sets destination for deal alerts (paid games only).",
        helpCmd_start_reduceri: "🔔 Start Deals: (Admin) Sets destination for deal alerts (paid games only).",
        helpCmd_stop_deals: "🛑 Stop Deals: (Admin) Stops deal notifications.",
        helpCmd_stop_reduceri: "🛑 Stop Deals: (Admin) Stops deal notifications.",
        helpCmd_start_free_games: "🔔 Start Free Games: (Admin) Sets destination EXCLUSIVELY for 100% FREE promotional games.",
        helpCmd_start_free: "🔔 Start Free Games: (Admin) Sets destination EXCLUSIVELY for 100% FREE promotional games.",
        helpCmd_stop_free_games: "🛑 Stop Free Games: (Admin) Stops free games notifications.",
        helpCmd_stop_free: "🛑 Stop Free Games: (Admin) Stops free games notifications.",
        helpCmd_set_mode: "⚙️ Set Mode: (Admin) Changes message size (compact/detailed).",
        helpCmd_set_mindiscount: "⚙️ Set MinDiscount: (Admin) Sets the minimum discount threshold (in %) for deal alerts.",
        helpCmd_set_language: "⚙️ Set Language: (Admin) Changes bot's language (ro/en).",
        helpCmd_latest_updates: "🔍 Latest Updates: Shows a paginated list ({items} per page) of the newest updates.",
        helpCmd_latest_deals: "🔍 Latest Deals: Shows the most popular paid deals (Steam/Epic).",
        helpCmd_latest_reduceri: "🔍 Latest Deals: Shows the most popular paid deals (Steam/Epic).",
        helpCmd_latest_free_games: "🔍 Latest Free Games: Shows 100% free promotions clearly grouped by store.",
        helpCmd_latest_free: "🔍 Latest Free Games: Shows 100% free promotions clearly grouped by store.",
        helpCmd_latest_update: "🔍 Latest Update [name]: Searches for the latest patch notes for a specific tracked game.",
        helpCmd_latest_price: "🔍 Latest Price [name]: Checks the current price on both Steam and Epic Games.",
        helpCmd_latest_pret: "🔍 Latest Price [name]: Checks the current price on both Steam and Epic Games.",
        helpCmd_dlc: "🔍 DLC [game name]: Extracts the full list of DLCs for a Steam game.",
        statusTitle: "📊 Full Status: {name}",
        statusNoUpdate: "No recent updates found in database.",
        helpCmd_status: "🔍 Status [game name]: Shows price and latest update for a game."
    }
};

function getText(lang, key, params = {}) {
    let text = i18n[lang]?.[key] || i18n["ro"]?.[key] || key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, v);
    }
    return text;
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
    console.error("Eroare validare config.json", err.issues || err.message);
    process.exit(1);
}

// -------------------------------------------------------------
// UTILAJE DE BAZĂ
// -------------------------------------------------------------
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

function cleanText(text) { 
    return String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/"/gi, '"').replace(/'/gi, "'").replace(/'/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

function truncate(str, maxLen) { 
    const t = String(str || ""); 
    return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t; 
}

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

// -------------------------------------------------------------
// HTTP & PROXY
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
            await new Promise(res => setTimeout(res, backoff));
            backoff *= 2;
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

// -------------------------------------------------------------
// GENERATORI DE EMBEDS
// -------------------------------------------------------------
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
    
    const embed = new EmbedBuilder().setColor(isFree ? 0x2ecc71 : 0xe74c3c).setTitle(truncate(`${isFree ? "🎁 [" + deal.store.toUpperCase() + "]" : "🏷️ " + discText + ": "}${deal.title}`, 256));
    
    if (isCompact) {
        embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? freeText.toUpperCase() : "$" + deal.salePrice}**\n[${getText(lang, "link")}](${deal.link})`);
    } else {
        let statsStr = "";
        if (deal.qualityScore > 0 || deal.totalReviews > 0) {
            statsStr = `⭐ **${getText(lang, "quality")}:** ${deal.qualityScore}% | 👥 **${getText(lang, "popularity")}:** ${deal.totalReviews > 0 ? deal.totalReviews : "N/A"}\n\n`;
        }

        let displayDate = deal.endDateStr;
        if (displayDate) {  
            if (displayDate.includes("T") && displayDate.includes("Z")) {  
                const d = new Date(displayDate);
                if (!isNaN(d.getTime())) {  
                    displayDate = d.toLocaleDateString(lang === "ro" ? "ro-RO" : "en-US");
                }  
            } else {  
                displayDate = displayDate.replace(/Offer ends\s+/i, '').trim();
            }  
        }  

        const offerText = isFree ? getText(lang, "freeOffer", { store: deal.store }) : getText(lang, "dealOffer", { store: deal.store, savings: deal.savings });
        
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
    
    let currentPage = 0; 
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
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
        const key = String(game.key).toLowerCase().replace(/[-]/g, " ");
        const name = String(game.name).toLowerCase().replace(/[-]/g, " ");
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

module.exports = {
    config,
    PREFIX,
    MAX_DEALS,
    MAX_FREE_PER_STORE,
    ITEMS_PER_PAGE,
    DEALS_HISTORY_LIMIT,
    GLOBAL_CACHE_TTL_MS,
    CACHE_TTL_MS,
    FETCH_CONCURRENCY,
    getText,
    smoothTime,
    safeStringify,
    logger,
    formatUserError,
    levenshtein,
    canSendEmbeds,
    cleanText,
    truncate,
    normalizeUpdate,
    httpReq,
    fetchWithProxy,
    buildUpdateEmbed,
    buildDealEmbed,
    buildDualPriceEmbed,
    handlePagination,
    findGameAndSuggestion
};
