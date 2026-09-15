// src/routes/msauth.js
// Inloggen met het Microsoft 365-account van Hero, via Supabase Auth (dezelfde deur als het ATS en de andere Hero-tools).
//   1. GET /auth/microsoft   maakt een geheime code (verifier), zet die in een cookie en stuurt naar Supabase
//   2. Supabase stuurt door naar Microsoft; de gebruiker komt terug op /auth/callback?code=...
//   3. Wij ruilen die code bij Supabase in voor de gebruikersgegevens (e-mail, naam, id)
//   4. Staat het e-mailadres actief op de medewerkerslijst (framework.users), dan loggen we in
// Instellen: SUPABASE_URL en SUPABASE_ANON_KEY, en in Supabase onder Authentication, URL Configuration
// het adres <PUBLIC_BASE_URL>/auth/callback toestaan.

const crypto = require("node:crypto");
const express = require("express");
const auth = require("../auth");
const employees = require("../employees");

const router = express.Router();
const STATE_COOKIE = "wp_sb_state";

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return { url, key, domains: (process.env.MS_ALLOWED_DOMAINS || "hero.eu").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) };
}
const isEnabled = () => config() !== null;
const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const redirectUri = (req) => `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`}/auth/callback`;

function fail(req, res, message, status = 400) {
  return res.status(status).render("auth/login", { title: "Inloggen", error: message, next: "/", msLoginEnabled: isEnabled(), devLogin: devLoginEmail() });
}
const devLoginEmail = () => (process.env.NODE_ENV === "production" ? null : process.env.DEV_LOGIN_EMAIL || null);

router.get("/auth/microsoft", (req, res) => {
  const cfg = config();
  if (!cfg) return fail(req, res, "Inloggen met Microsoft is nog niet ingesteld.", 404);
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const next = typeof req.query.next === "string" && req.query.next.startsWith("/") ? req.query.next : "/";
  res.cookie(STATE_COOKIE, JSON.stringify({ verifier, next }), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 10 * 60 * 1000, path: "/" });
  const params = new URLSearchParams({ provider: "azure", redirect_to: redirectUri(req), code_challenge: challenge, code_challenge_method: "s256", scopes: "openid profile email" });
  res.redirect(`${cfg.url}/auth/v1/authorize?${params}`);
});

router.get("/auth/callback", async (req, res) => {
  const cfg = config();
  if (!cfg) return fail(req, res, "Inloggen met Microsoft is niet ingesteld.", 404);
  let saved = null;
  try { saved = JSON.parse(auth.parseCookies(req.headers.cookie)[STATE_COOKIE] || "null"); } catch { saved = null; }
  res.clearCookie(STATE_COOKIE, { path: "/" });
  if (req.query.error) return fail(req, res, `Inloggen is niet gelukt: ${req.query.error_description || req.query.error}`);
  if (!saved || !saved.verifier) return fail(req, res, "De inlogpoging is verlopen of ongeldig. Probeer het opnieuw.");
  if (!req.query.code) return fail(req, res, "Geen inlogcode ontvangen.");
  try {
    const tokenRes = await fetch(`${cfg.url}/auth/v1/token?grant_type=pkce`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify({ auth_code: String(req.query.code), code_verifier: saved.verifier }),
    });
    const session = await tokenRes.json();
    if (!tokenRes.ok || !session.user) throw new Error(session.error_description || session.msg || session.message || "Supabase gaf geen sessie terug.");
    const sbUser = session.user;
    const meta = sbUser.user_metadata || {};
    const email = String(sbUser.email || meta.email || "").trim().toLowerCase();
    let name = String(meta.full_name || meta.name || email.split("@")[0]).trim();
    if (!email) return fail(req, res, "Microsoft gaf geen e-mailadres terug voor dit account.", 403);

    let isAdmin = false;
    if (employees.enabled()) {
      const employee = await employees.findEmployee(email);
      if (!employee) return fail(req, res, `${email} staat niet op de lijst met actieve Hero-medewerkers. Klopt dat niet? Vraag IT om je account in de medewerkerslijst te zetten.`, 403);
      if (employee.name) name = employee.name;
      isAdmin = employee.isAdmin;
    } else if (!cfg.domains.includes(email.split("@")[1] || "")) {
      return fail(req, res, `Het account ${email} hoort niet bij ${cfg.domains.join(" of ")}. Log in met je Hero-account.`, 403);
    }
    const user = await auth.upsertUser({ email, name, supabaseUserId: sbUser.id, isAdmin });
    if (!user.is_active) return fail(req, res, "Dit account is uitgezet. Vraag de admin om het weer aan te zetten.", 403);
    auth.setSessionCookie(req, res, await auth.createSession(user.id));
    res.redirect(saved.next && saved.next.startsWith("/") ? saved.next : "/");
  } catch (err) {
    console.error("Microsoft-login mislukt:", err.message);
    return fail(req, res, `Inloggen met Microsoft is niet gelukt: ${err.message}`);
  }
});

module.exports = { router, isEnabled, devLoginEmail };
