// src/routes/contacten.js
// Garages per merk, verzekeraar, tankpas, bestickering, wasstraat, en per vestiging de celdirecteur en wagenparkbeheerder.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { clean, LABELS } = require("../helpers");

const router = express.Router();
// Alleen cijfers als id; anders valt het verzoek door naar de 404
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));
const lookups = async () => ({ vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"), soorten: LABELS.contact });

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const rows = await db.all("SELECT c.*, ve.naam AS vestiging FROM contacten c LEFT JOIN vestigingen ve ON ve.id = c.vestiging_id ORDER BY CASE c.soort WHEN 'garage' THEN 1 WHEN 'verzekeraar' THEN 2 WHEN 'tankpas' THEN 3 WHEN 'bestickering' THEN 4 WHEN 'wasstraat' THEN 5 WHEN 'celdirecteur' THEN 6 WHEN 'wagenparkbeheer' THEN 7 ELSE 8 END, c.naam");
  const groups = {};
  for (const r of rows) (groups[r.soort] = groups[r.soort] || []).push(r);
  res.render("contacten/index", { title: "Contacten", groups, ...(await lookups()) });
});
router.get("/nieuw", auth.requireRole("beheerder"), async (req, res) => res.render("contacten/form", { title: "Nieuw contact", c: { soort: "garage" }, ...(await lookups()) }));
const fromBody = (x) => ({ naam: clean(x.naam), soort: LABELS.contact[x.soort] ? x.soort : "overig", merk: clean(x.merk), adres: clean(x.adres), website: clean(x.website), telefoon: clean(x.telefoon), email: clean(x.email), opmerking: clean(x.opmerking), vestiging_id: Number(x.vestiging_id) || null });
router.post("/", auth.requireRole("beheerder"), async (req, res) => {
  const c = fromBody(req.body);
  if (!c.naam) { res.flash("Een naam is verplicht.", "error"); return res.redirect("/contacten/nieuw"); }
  await db.insert("INSERT INTO contacten (naam, soort, merk, adres, website, telefoon, email, opmerking, vestiging_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [c.naam, c.soort, c.merk, c.adres, c.website, c.telefoon, c.email, c.opmerking, c.vestiging_id]);
  res.flash("Contact aangemaakt."); res.redirect("/contacten");
});
router.get("/:id/bewerken", auth.requireRole("beheerder"), async (req, res, next) => {
  const c = await db.one("SELECT * FROM contacten WHERE id = $1", [req.params.id]);
  if (!c) return next();
  res.render("contacten/form", { title: `Bewerken · ${c.naam}`, c, ...(await lookups()) });
});
router.post("/:id", auth.requireRole("beheerder"), async (req, res, next) => {
  const cur = await db.one("SELECT * FROM contacten WHERE id = $1", [req.params.id]);
  if (!cur) return next();
  const c = fromBody(req.body);
  await db.run("UPDATE contacten SET naam=$2, soort=$3, merk=$4, adres=$5, website=$6, telefoon=$7, email=$8, opmerking=$9, vestiging_id=$10 WHERE id=$1", [cur.id, c.naam || cur.naam, c.soort, c.merk, c.adres, c.website, c.telefoon, c.email, c.opmerking, c.vestiging_id]);
  res.flash("Opgeslagen."); res.redirect("/contacten");
});
router.post("/:id/verwijderen", auth.requireRole("admin"), async (req, res) => {
  await db.run("DELETE FROM contacten WHERE id = $1", [req.params.id]);
  res.flash("Contact verwijderd."); res.redirect("/contacten");
});
module.exports = { router };
