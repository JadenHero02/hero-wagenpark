// src/routes/wachtlijst.js
// Wie wacht op een auto, sinds wanneer, welke auto gewenst. Koppelen zodra er een auto vrij is (gaat via toewijzen).

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { clean, cleanDate } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const rows = await db.all(`SELECT w.*, ve.naam AS vestiging, b.id AS b_id, b.email, v.kenteken, (current_date - w.datum_aanvraag) AS dagen
    FROM wachtlijst w LEFT JOIN vestigingen ve ON ve.id = w.vestiging_id LEFT JOIN bestuurders b ON b.id = w.bestuurder_id LEFT JOIN voertuigen v ON v.id = w.voertuig_id
    ORDER BY CASE w.status WHEN 'open' THEN 0 ELSE 1 END, w.datum_aanvraag NULLS LAST, w.id`);
  const vrij = await db.one("SELECT COUNT(*) AS n FROM voertuigen WHERE status = 'op_voorraad'");
  res.render("wachtlijst/index", { title: "Wachtlijst", rows, vrij: vrij.n });
});
router.get("/nieuw", auth.requireRole("beheerder"), async (req, res) => {
  res.render("wachtlijst/form", { title: "Op de wachtlijst", vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"), bestuurders: await db.all("SELECT id, naam FROM bestuurders WHERE actief ORDER BY naam"), vandaag: new Date().toISOString().slice(0, 10) });
});
router.post("/", auth.requireRole("beheerder"), async (req, res) => {
  const bid = Number(req.body.bestuurder_id) || null;
  let naam = clean(req.body.naam);
  if (bid) naam = ((await db.one("SELECT naam FROM bestuurders WHERE id = $1", [bid])) || {}).naam || naam;
  if (!naam) { res.flash("Kies een bestuurder of vul een naam in.", "error"); return res.redirect("/wachtlijst/nieuw"); }
  await db.insert("INSERT INTO wachtlijst (naam, bestuurder_id, vestiging_id, datum_aanvraag, gewenste_auto, opmerking) VALUES ($1,$2,$3,$4,$5,$6)", [naam, bid, Number(req.body.vestiging_id) || null, cleanDate(req.body.datum_aanvraag) || new Date().toISOString().slice(0, 10), clean(req.body.gewenste_auto), clean(req.body.opmerking)]);
  res.flash(`${naam} staat op de wachtlijst.`);
  res.redirect("/wachtlijst");
});
router.post("/:id/status", auth.requireRole("beheerder"), async (req, res, next) => {
  const w = await db.one("SELECT * FROM wachtlijst WHERE id = $1", [req.params.id]);
  if (!w) return next();
  const status = ["open", "vervallen", "gekoppeld"].includes(req.body.status) ? req.body.status : w.status;
  await db.run("UPDATE wachtlijst SET status = $2 WHERE id = $1", [w.id, status]);
  res.flash("Opgeslagen.");
  res.redirect("/wachtlijst");
});

module.exports = { router };
