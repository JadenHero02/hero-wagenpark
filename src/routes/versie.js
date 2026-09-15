// src/routes/versie.js
// Over deze versie: wat er nieuw is per versie, gemelde bugs en wensen, en het formulier om er een te melden.
// Een melding neemt automatisch de versie, het scherm (de pagina waar je vandaan kwam) en het apparaat (browser) mee.
// /version.json is voor de browser: staat er een nieuwe versie, dan vernieuwt de pagina zodra hij even niet gebruikt wordt.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const mail = require("../mail");
const versies = require("../versies");
const { clean } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

const STATUS = { open: "Open", in_behandeling: "In behandeling", opgelost: "Opgelost", afgewezen: "Niet gedaan" };
const SOORT = { nieuw: "Nieuw", verbeterd: "Verbeterd", opgelost: "Opgelost" };

// Kort en leesbaar: "Chrome op Windows", "Safari op iPhone"
function apparaat(ua) {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "onbekend";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${browser} op ${os}`;
}

router.get("/version.json", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ versie: versies.huidige(), commit: versies.commit(), omgeving: versies.omgeving() });
});

router.get("/versie", async (req, res) => {
  const admin = res.locals.can("admin");
  const mijn = await db.all("SELECT m.*, u.name AS door FROM meldingen m LEFT JOIN users u ON u.id = m.user_id WHERE m.user_id = $1 ORDER BY m.created_at DESC", [req.user.id]);
  const alle = admin ? await db.all("SELECT m.*, u.name AS door, a.name AS afgehandeld_door_naam FROM meldingen m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users a ON a.id = m.afgehandeld_door ORDER BY CASE m.status WHEN 'open' THEN 0 WHEN 'in_behandeling' THEN 1 ELSE 2 END, m.created_at DESC") : mijn;
  const tab = ["bugs", "wensen"].includes(req.query.tab) ? req.query.tab : "nieuw";
  res.render("versie/index", { title: `Versie ${versies.huidige()}`, VERSIES: versies.VERSIES, huidige: versies.huidige(), commit: versies.commit(), omgeving: versies.omgeving(), mijn, alle, admin, tab, STATUS, SOORT });
});

router.get("/versie/melden", (req, res) => {
  const soort = req.query.soort === "wens" ? "wens" : "bug";
  const scherm = clean(req.query.scherm) || (req.get("referer") || "").replace(/^https?:\/\/[^/]+/, "") || null;
  res.render("versie/melden", { title: soort === "bug" ? "Bug melden" : "Wens indienen", soort, scherm, versieNr: versies.huidige(), apparaat: apparaat(req.get("user-agent")) });
});
router.post("/versie/melden", async (req, res) => {
  const soort = req.body.soort === "wens" ? "wens" : "bug";
  const titel = clean(req.body.titel);
  if (!titel) { res.flash("Vul in één zin in wat er mis is of wat je wilt.", "error"); return res.redirect(`/versie/melden?soort=${soort}`); }
  const scherm = clean(req.body.scherm);
  const ua = apparaat(req.get("user-agent"));
  const id = await db.insert("INSERT INTO meldingen (soort, titel, omschrijving, versie, commit, scherm, apparaat, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [soort, titel, clean(req.body.omschrijving), versies.huidige(), versies.commit(), scherm, ua, req.user.id]);
  const admins = (await db.all("SELECT email FROM users WHERE is_active AND role = 'admin'")).map((u) => u.email);
  await mail.send({ to: admins, subject: `${soort === "bug" ? "Bug" : "Wens"} #${id} van ${req.user.name}: ${titel}`, soort: "melding", ref: `melding:${id}`, html: mail.layout({ titel: soort === "bug" ? "Bug gemeld in Wagenpark" : "Wens voor Wagenpark", regels: [["Van", req.user.name], ["Wat", titel], ["Toelichting", clean(req.body.omschrijving) || "–"], ["Versie", versies.huidige()], ["Scherm", scherm || "–"], ["Apparaat", ua]], knop: { tekst: "Bekijken", url: `${mail.baseUrl()}/versie?tab=${soort === "bug" ? "bugs" : "wensen"}` } }) });
  res.flash(soort === "bug" ? `Bedankt, bug #${id} is gemeld. Je ziet de status op deze pagina.` : `Bedankt, wens #${id} staat genoteerd.`);
  res.redirect(`/versie?tab=${soort === "bug" ? "bugs" : "wensen"}`);
});

// Admin: status en antwoord
router.post("/versie/meldingen/:id", auth.requireRole("admin"), async (req, res, next) => {
  const m = await db.one("SELECT * FROM meldingen WHERE id = $1", [req.params.id]);
  if (!m) return next();
  const status = STATUS[req.body.status] ? req.body.status : m.status;
  const klaar = status === "opgelost" || status === "afgewezen";
  await db.run("UPDATE meldingen SET status = $2, antwoord = $3, afgehandeld_door = CASE WHEN $4 THEN $5 ELSE NULL END, afgehandeld_op = CASE WHEN $4 THEN local_now() ELSE NULL END WHERE id = $1", [m.id, status, clean(req.body.antwoord), klaar, req.user.id]);
  const melder = m.user_id ? await db.one("SELECT email, name FROM users WHERE id = $1", [m.user_id]) : null;
  if (melder && status !== m.status) await mail.send({ to: melder.email, subject: `${m.soort === "bug" ? "Bug" : "Wens"} #${m.id}: ${STATUS[status].toLowerCase()}`, soort: "melding", ref: `melding_status:${m.id}:${status}`, html: mail.layout({ titel: `Je ${m.soort} is ${STATUS[status].toLowerCase()}`, regels: [["Wat", m.titel], ["Status", STATUS[status]], ["Antwoord", clean(req.body.antwoord) || "–"]], knop: { tekst: "Bekijken", url: `${mail.baseUrl()}/versie?tab=${m.soort === "bug" ? "bugs" : "wensen"}` } }) });
  res.flash("Opgeslagen.");
  res.redirect(`/versie?tab=${m.soort === "bug" ? "bugs" : "wensen"}`);
});

module.exports = { router, STATUS };
