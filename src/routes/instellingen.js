// src/routes/instellingen.js
// Alleen voor de admin: termijnen en bandenwisseldata, het HR-adres, wie welke rol krijgt, en het maillog
// (elke mail die de app stuurde of, zolang Microsoft Graph niet is ingesteld, had willen sturen).

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const mail = require("../mail");
const { clean, LABELS } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));
router.use(auth.requireRole("admin"));

const VELDEN = [
  ["hr_email", "E-mailadres van HR", "Ontvangt toewijzingen, innames en doorbelaste boetes. Meerdere adressen met een komma."],
  ["apk_termijnen", "APK-herinneringen (dagen vooraf)", "Bijvoorbeeld 90,30,7"],
  ["contract_termijnen", "Contract-herinneringen (dagen vooraf)", ""],
  ["rijbewijs_termijnen", "Rijbewijs-herinneringen (dagen vooraf)", ""],
  ["bandenwissel_winter", "Winterbanden vanaf (mm-dd)", "Bijvoorbeeld 10-01"],
  ["bandenwissel_zomer", "Zomerbanden vanaf (mm-dd)", "Bijvoorbeeld 04-01"],
  ["uitleen_herinnering_dagen", "Herinnering leenauto (dagen voor retour)", ""],
  ["dagmail_uur", "Dagmail voor beheerders om (uur)", "Elke werkdag, bijvoorbeeld 7"],
  ["pincode_bevestiging_minuten", "Pincode: bevestiging geldig (minuten)", "Hoe lang een nieuwe login telt als extra bevestiging"],
  ["admin_emails", "Admin bij eerste login", "E-mailadressen, met komma. Geldt voor nieuwe accounts; bestaande wijzig je hieronder."],
  ["beheerder_emails", "Beheerder bij eerste login", ""],
  ["directie_emails", "Directie bij eerste login", ""],
];

router.get("/", async (req, res) => {
  const rows = await db.all("SELECT * FROM instellingen");
  const waarden = Object.fromEntries(rows.map((r) => [r.sleutel, r.waarde]));
  const users = await db.all("SELECT u.*, ve.naam AS vestiging FROM users u LEFT JOIN vestigingen ve ON ve.id = u.vestiging_id ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'beheerder' THEN 1 WHEN 'directie' THEN 2 ELSE 3 END, u.name");
  const mails = await db.one("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE status = 'fout') AS fout FROM mail_log");
  res.render("instellingen/index", { title: "Instellingen", VELDEN, waarden, users, vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"), mailMode: mail.mode(), mailFrom: mail.from(), mailTest: process.env.MAIL_TEST_TO || null, mails, LABELS });
});
router.post("/", async (req, res) => {
  for (const [key] of VELDEN) {
    if (req.body[key] === undefined) continue;
    await db.run("INSERT INTO instellingen (sleutel, waarde) VALUES ($1, $2) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde", [key, clean(req.body[key])]);
  }
  res.flash("Instellingen opgeslagen.");
  res.redirect("/instellingen");
});
router.post("/gebruikers/:id", async (req, res, next) => {
  const u = await db.one("SELECT * FROM users WHERE id = $1", [req.params.id]);
  if (!u) return next();
  const role = auth.ROLES.includes(req.body.role) ? req.body.role : u.role;
  const active = req.body.is_active !== "0";
  if (u.id === req.user.id && (role !== "admin" || !active)) { res.flash("Je kunt je eigen adminrol niet weghalen.", "error"); return res.redirect("/instellingen"); }
  await db.run("UPDATE users SET role = $2, is_active = $3, vestiging_id = $4 WHERE id = $1", [u.id, role, active, Number(req.body.vestiging_id) || null]);
  if (!active) await db.run("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  res.flash(`${u.name}: ${LABELS.role[role]}${active ? "" : ", uitgezet"}.`);
  res.redirect("/instellingen");
});
router.get("/mail", async (req, res) => {
  const rows = await db.all("SELECT id, naar, cc, onderwerp, soort, status, fout, verstuurd_op FROM mail_log ORDER BY id DESC LIMIT 150");
  res.render("instellingen/mail", { title: "Maillog", rows, mailMode: mail.mode(), mailFrom: mail.from(), mailTest: process.env.MAIL_TEST_TO || null });
});
router.get("/mail/:id", async (req, res, next) => {
  const m = await db.one("SELECT * FROM mail_log WHERE id = $1", [req.params.id]);
  if (!m) return next();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(m.inhoud || `<p>Geen inhoud bewaard voor deze mail.</p>`);
});

module.exports = { router };
