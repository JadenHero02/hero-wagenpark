// src/routes/bestuurders.js
// Wie rijdt wat: overzicht, detail met historie, nieuw en bewerken.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { clean, cleanDate, yes } = require("../helpers");

const router = express.Router();
// Alleen cijfers als id; anders valt het verzoek door naar de 404
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));
const lookups = async () => ({ vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde") });

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const q = clean(req.query.q);
  const vId = Number(req.query.vestiging) || null;
  const where = ["b.actief"]; const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(b.naam ILIKE $${params.length} OR b.email ILIKE $${params.length} OR v.kenteken ILIKE $${params.length})`); }
  if (vId) { params.push(vId); where.push(`b.vestiging_id = $${params.length}`); }
  if (req.query.zonder === "1") where.push("v.id IS NULL");
  const rows = await db.all(`
    SELECT b.*, ve.naam AS vestiging, v.id AS voertuig_id, v.kenteken, v.merk, v.model, t.soort AS toewijzing_soort, u.role
    FROM bestuurders b LEFT JOIN vestigingen ve ON ve.id = b.vestiging_id
    LEFT JOIN toewijzingen t ON t.bestuurder_id = b.id AND t.status = 'actief'
    LEFT JOIN voertuigen v ON v.id = t.voertuig_id
    LEFT JOIN users u ON u.id = b.user_id
    WHERE ${where.join(" AND ")} ORDER BY ve.volgorde NULLS LAST, b.naam`, params);
  res.render("bestuurders/index", { title: "Bestuurders", rows, q, vId, zonder: req.query.zonder === "1", ...(await lookups()) });
});

router.get("/nieuw", auth.requireRole("beheerder"), async (req, res) => res.render("bestuurders/form", { title: "Nieuwe bestuurder", b: {}, ...(await lookups()) }));

const fromBody = (x) => ({ naam: clean(x.naam), email: clean(x.email) ? clean(x.email).toLowerCase() : null, telefoon: clean(x.telefoon), vestiging_id: Number(x.vestiging_id) || null, rijbewijs_geldig_tot: cleanDate(x.rijbewijs_geldig_tot), is_extern: yes(x.is_extern), opmerking: clean(x.opmerking) });

router.post("/", auth.requireRole("beheerder"), async (req, res) => {
  const b = fromBody(req.body);
  if (!b.naam) { res.flash("Een naam is verplicht.", "error"); return res.redirect("/bestuurders/nieuw"); }
  const id = await db.insert("INSERT INTO bestuurders (naam, email, telefoon, vestiging_id, rijbewijs_geldig_tot, is_extern, opmerking) VALUES ($1,$2,$3,$4,$5,$6,$7)", [b.naam, b.email, b.telefoon, b.vestiging_id, b.rijbewijs_geldig_tot, b.is_extern, b.opmerking]);
  if (b.email) await db.run("UPDATE bestuurders SET user_id = (SELECT id FROM users WHERE lower(email) = $2) WHERE id = $1 AND user_id IS NULL", [id, b.email]);
  res.flash("Bestuurder aangemaakt.");
  res.redirect(`/bestuurders/${id}`);
});

router.get("/:id", auth.requireRole("directie"), async (req, res, next) => {
  const b = await db.one("SELECT b.*, ve.naam AS vestiging, u.role, u.last_login_at FROM bestuurders b LEFT JOIN vestigingen ve ON ve.id = b.vestiging_id LEFT JOIN users u ON u.id = b.user_id WHERE b.id = $1", [req.params.id]);
  if (!b) return next();
  const toewijzingen = await db.all("SELECT t.*, v.kenteken, v.merk, v.model, v.id AS voertuig_id FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.bestuurder_id = $1 ORDER BY t.status = 'actief' DESC, t.van DESC NULLS LAST, t.id DESC", [b.id]);
  const boetes = await db.all("SELECT b.*, v.kenteken FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id WHERE b.bestuurder_id = $1 ORDER BY datum DESC", [b.id]);
  const logboek = await db.all("SELECT l.*, v.kenteken FROM logboek l LEFT JOIN voertuigen v ON v.id = l.voertuig_id WHERE l.bestuurder_id = $1 ORDER BY l.created_at DESC LIMIT 8", [b.id]);
  res.render("bestuurders/show", { title: b.naam, b, toewijzingen, boetes, logboek });
});

router.get("/:id/bewerken", auth.requireRole("beheerder"), async (req, res, next) => {
  const b = await db.one("SELECT * FROM bestuurders WHERE id = $1", [req.params.id]);
  if (!b) return next();
  res.render("bestuurders/form", { title: `Bewerken · ${b.naam}`, b, ...(await lookups()) });
});
router.post("/:id", auth.requireRole("beheerder"), async (req, res, next) => {
  const cur = await db.one("SELECT * FROM bestuurders WHERE id = $1", [req.params.id]);
  if (!cur) return next();
  const b = fromBody(req.body);
  await db.run("UPDATE bestuurders SET naam = $2, email = $3, telefoon = $4, vestiging_id = $5, rijbewijs_geldig_tot = $6, is_extern = $7, opmerking = $8, actief = $9, updated_at = local_now() WHERE id = $1", [cur.id, b.naam || cur.naam, b.email, b.telefoon, b.vestiging_id, b.rijbewijs_geldig_tot, b.is_extern, b.opmerking, !yes(req.body.inactief)]);
  if (b.email) await db.run("UPDATE bestuurders SET user_id = (SELECT id FROM users WHERE lower(email) = $2) WHERE id = $1 AND user_id IS NULL", [cur.id, b.email]);
  res.flash("Opgeslagen.");
  res.redirect(`/bestuurders/${cur.id}`);
});

module.exports = { router };
