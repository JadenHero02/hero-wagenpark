// server.js
// Wagenparkbeheer in de Hero-app. Startpunt: webserver, algemene middleware en de routes.
// Starten: npm start -> http://localhost:3000. Heeft DATABASE_URL nodig (zie README en .env.example).

require("./src/env");
const path = require("node:path");
const express = require("express");
const db = require("./src/db");
const auth = require("./src/auth");
const helpers = require("./src/helpers");
const versies = require("./src/versies");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const ASSET_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || String(Date.now()).slice(-6);
app.use("/fonts", express.static(path.join(__dirname, "public/fonts"), { maxAge: "30d", immutable: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(auth.loadUser);

// Korte bevestiging na een actie: res.flash("Opgeslagen.") of res.flash("Mislukt.", "error"); reist mee in een cookie van tien seconden
const FLASH_COOKIE = "wp_flash";
app.use((req, res, next) => {
  const match = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]*)`));
  if (match) {
    try {
      let text = decodeURIComponent(match[1]);
      res.locals.flashKind = "ok";
      if (text.startsWith("error|")) { res.locals.flashKind = "error"; text = text.slice(6); }
      res.locals.flash = text;
    } catch { res.locals.flash = null; }
    res.clearCookie(FLASH_COOKIE, { path: "/" });
  }
  res.flash = (message, kind = "ok") => res.cookie(FLASH_COOKIE, (kind === "error" ? "error|" : "") + message, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 10_000, secure: req.secure });
  next();
});

// Waarden en hulpfuncties voor elke template
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.publicBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.h = helpers;
  res.locals.title = "Wagenpark";
  res.locals.badges = {};
  res.locals.versie = { huidige: versies.huidige(), commit: versies.commit(), omgeving: versies.omgeving() };
  next();
});

app.get("/health", async (req, res) => {
  try { await db.query("SELECT 1"); res.json({ ok: true, node: process.version, db: "ok", schema: db.SCHEMA }); }
  catch (err) { res.status(500).json({ ok: false, db: err.message }); }
});

// ---- Inloggen ----
app.use("/", require("./src/routes/auth").router);
app.use("/", require("./src/routes/msauth").router);

// ---- Alles hierna is alleen voor ingelogde gebruikers ----
app.use(auth.requireLogin);
// Tellers in het keuzemenu: open taken en leenverzoeken (alleen voor wie het menu ziet)
app.use(async (req, res, next) => {
  if (req.method !== "GET" || !res.locals.can("directie")) return next();
  try {
    const t = await db.one("SELECT (SELECT COUNT(*) FROM taken WHERE status = 'open' AND voor = 'beheerder') AS taken, (SELECT COUNT(*) FROM leenverzoeken WHERE status = 'open') AS uitleen, (SELECT COUNT(*) FROM wachtlijst WHERE status = 'open') AS wachtlijst, (SELECT COUNT(*) FROM boetes WHERE status IN ('nieuw','uitzondering_gevraagd')) AS boetes, (SELECT COUNT(*) FROM incidenten WHERE status = 'gemeld') AS incidenten");
    res.locals.badges = { taken: t.taken || "", uitleen: t.uitleen || "", wachtlijst: t.wachtlijst || "", boetes: t.boetes || "", incidenten: t.incidenten || "" };
  } catch (err) { console.error("Tellers menu:", err.message); }
  next();
});
app.use("/", require("./src/routes/dashboard").router);
app.use("/", require("./src/routes/documenten").router);
const voertuigen = require("./src/routes/voertuigen");
app.use("/voertuigen", voertuigen.router);
app.use("/archief", voertuigen.archief);
app.use("/bestuurders", require("./src/routes/bestuurders").router);
app.use("/contacten", require("./src/routes/contacten").router);
app.use("/uitleen", require("./src/routes/uitleen").router);
app.use("/taken", require("./src/routes/taken").router);
app.use("/processen", require("./src/routes/processen").router);
app.use("/boetes", require("./src/routes/boetes").router);
app.use("/incidenten", require("./src/routes/incidenten").router);
app.use("/wachtlijst", require("./src/routes/wachtlijst").router);
app.use("/instellingen", require("./src/routes/instellingen").router);
app.use("/", require("./src/routes/versie").router);

// 404 en fouten
app.use((req, res) => res.status(404).render("error", { title: "Niet gevonden", message: "Deze pagina bestaat niet." }));
app.use((err, req, res, next) => {
  console.error(`Fout bij ${req.method} ${req.path}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).render("error", { title: "Er ging iets mis", message: process.env.NODE_ENV === "production" ? "Probeer het later opnieuw." : err.message });
});

db.init()
  .then(() => {
    app.listen(PORT, () => console.log(`Hero Wagenpark draait op http://localhost:${PORT}`));
    auth.cleanupSessions();
    setInterval(auth.cleanupSessions, 6 * 60 * 60 * 1000);
    // De takenmotor: automatische taken en mails (APK, banden, contract, rijbewijs, leenauto's, dagmail)
    if ((process.env.TAKEN_RONDE || "on") !== "off") require("./src/taken").start();
  })
  .catch((err) => { console.error("Starten mislukt:", err.message); process.exit(1); });
