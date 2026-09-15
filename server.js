// server.js
// Wagenparkbeheer in de Hero-app. Startpunt: webserver, algemene middleware en de routes.
// Starten: npm start -> http://localhost:3000. Heeft DATABASE_URL nodig (zie README en .env.example).

require("./src/env");
const path = require("node:path");
const express = require("express");
const db = require("./src/db");
const auth = require("./src/auth");
const helpers = require("./src/helpers");

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
app.use("/", require("./src/routes/dashboard").router);
app.use("/voertuigen", require("./src/routes/voertuigen").router);
app.use("/bestuurders", require("./src/routes/bestuurders").router);
app.use("/contacten", require("./src/routes/contacten").router);

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
  })
  .catch((err) => { console.error("Starten mislukt:", err.message); process.exit(1); });
