// src/routes/incidenten.js
// Incidenten: schade, ongeval, diefstal, pech. Een bestuurder meldt het vanaf de telefoon (Mijn auto), met foto's;
// een beheerder kan het ook invoeren. Elk incident wordt een taak voor de beheerder en een mail naar de beheerders van de vestiging.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const mail = require("../mail");
const taken = require("../taken");
const documenten = require("./documenten");
const { clean, cleanDate, cleanNumber, formatDate, LABELS } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const status = LABELS.incident_status[req.query.status] ? req.query.status : null;
  const rows = await db.all(`SELECT i.*, v.kenteken, v.merk, v.model, ve.naam AS vestiging, b.naam AS bestuurder, u.name AS gemeld_door_naam, (SELECT COUNT(*) FROM documenten d WHERE d.incident_id = i.id) AS fotos
    FROM incidenten i JOIN voertuigen v ON v.id = i.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN bestuurders b ON b.id = i.bestuurder_id LEFT JOIN users u ON u.id = i.gemeld_door
    ${status ? "WHERE i.status = $1" : ""} ORDER BY CASE i.status WHEN 'gemeld' THEN 0 WHEN 'in_behandeling' THEN 1 ELSE 2 END, i.datum DESC LIMIT 200`, status ? [status] : []);
  res.render("incidenten/index", { title: "Incidenten", rows, status, LABELS });
});

router.get("/nieuw", async (req, res) => {
  let voertuigen;
  if (res.locals.can("beheerder")) voertuigen = await db.all("SELECT v.id, v.kenteken, v.merk, v.model, b.naam AS bestuurder FROM voertuigen v LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief' LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE v.status <> 'besteld' AND v.status <> 'archief' ORDER BY v.kenteken NULLS LAST");
  else if (req.bestuurder) voertuigen = await db.all("SELECT v.id, v.kenteken, v.merk, v.model FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.bestuurder_id = $1 AND t.status = 'actief'", [req.bestuurder.id]);
  else voertuigen = [];
  if (!voertuigen.length) { res.flash("Er staat geen auto op jouw naam.", "error"); return res.redirect("/mijn-auto"); }
  res.render("incidenten/form", { title: "Incident melden", voertuigen, form: { voertuig_id: Number(req.query.voertuig) || (voertuigen.length === 1 ? voertuigen[0].id : null), datum: taken.nlNow().date, soort: "schade" }, LABELS, mijn: !res.locals.can("directie") });
});

router.post("/", (req, res, next) => documenten.upload.array("fotos", 10)(req, res, (err) => (err ? (res.flash(err.code === "LIMIT_FILE_SIZE" ? "Een foto is groter dan 10 MB." : err.message, "error"), res.redirect("/incidenten/nieuw")) : next())), async (req, res) => {
  const f = { voertuig_id: Number(req.body.voertuig_id) || null, datum: cleanDate(req.body.datum) || taken.nlNow().date, soort: LABELS.incident_soort[req.body.soort] ? req.body.soort : "overig", omschrijving: clean(req.body.omschrijving), tegenpartij: clean(req.body.tegenpartij), kosten: cleanNumber(req.body.kosten) };
  const v = f.voertuig_id ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [f.voertuig_id]) : null;
  if (!v) { res.flash("Kies een auto.", "error"); return res.redirect("/incidenten/nieuw"); }
  const own = req.bestuurder && await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [v.id, req.bestuurder.id]);
  if (!res.locals.can("beheerder") && !own) return res.status(403).send("Geen toegang.");
  if (!f.omschrijving) { res.flash("Beschrijf kort wat er is gebeurd.", "error"); return res.redirect(`/incidenten/nieuw?voertuig=${v.id}`); }
  const bestuurder = own ? req.bestuurder : await taken.bestuurderVan(v.id);
  let id;
  try {
    id = await db.tx(async (t) => {
      const iid = await t.insert("INSERT INTO incidenten (voertuig_id, bestuurder_id, datum, soort, omschrijving, tegenpartij, kosten, gemeld_door) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [v.id, bestuurder ? bestuurder.id : null, f.datum, f.soort, f.omschrijving, f.tegenpartij, f.kosten, req.user.id]);
      await documenten.bewaar({ voertuigId: v.id, files: req.files, soort: "fotos", omschrijving: `Incident ${formatDate(f.datum)}`, incidentId: iid, userId: req.user.id }, t);
      const tid = await t.insert("INSERT INTO taken (voertuig_id, bestuurder_id, soort, titel, omschrijving, deadline, voor, sleutel) VALUES ($1,$2,'incident',$3,$4,current_date + 2,'beheerder',$5)", [v.id, bestuurder ? bestuurder.id : null, `Incident afhandelen · ${taken.autoNaam(v)}`, `${LABELS.incident_soort[f.soort]} op ${formatDate(f.datum)}: ${f.omschrijving}`, `incident:${iid}`]);
      await t.run("UPDATE incidenten SET taak_id = $2 WHERE id = $1", [iid, tid]);
      await t.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'incident',$4)", [v.id, bestuurder ? bestuurder.id : null, req.user.id, `Incident gemeld door ${req.user.name}: ${LABELS.incident_soort[f.soort]}, ${f.omschrijving}`]);
      return iid;
    });
  } catch (err) { res.flash(err.message, "error"); return res.redirect(`/incidenten/nieuw?voertuig=${v.id}`); }
  const fotos = (req.files || []).length;
  await mail.send({ to: await mail.beheerders(v.vestiging_id), subject: `Incident: ${LABELS.incident_soort[f.soort]} met ${v.kenteken}`, soort: "incident", ref: `incident:${id}`, html: mail.layout({ titel: `${LABELS.incident_soort[f.soort]} gemeld`, regels: [["Auto", taken.autoNaam(v)], ["Bestuurder", bestuurder ? bestuurder.naam : "onbekend"], ["Datum", formatDate(f.datum)], ["Wat", f.omschrijving], ["Tegenpartij", f.tegenpartij || "–"], ["Foto's", fotos ? `${fotos} bijgevoegd in de app` : "geen"], ["Gemeld door", req.user.name]], knop: { tekst: "Naar het incident", url: `${mail.baseUrl()}/incidenten/${id}` } }) });
  res.flash("Incident gemeld. De beheerder van je vestiging is geïnformeerd.");
  res.redirect(res.locals.can("directie") ? `/incidenten/${id}` : "/mijn-auto");
});

router.get("/:id", async (req, res, next) => {
  const i = await db.one(`SELECT i.*, v.kenteken, v.merk, v.model, ve.naam AS vestiging, b.naam AS bestuurder, u.name AS gemeld_door_naam, t.status AS taak_status
    FROM incidenten i JOIN voertuigen v ON v.id = i.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN bestuurders b ON b.id = i.bestuurder_id LEFT JOIN users u ON u.id = i.gemeld_door LEFT JOIN taken t ON t.id = i.taak_id WHERE i.id = $1`, [req.params.id]);
  if (!i) return next();
  const own = req.bestuurder && i.bestuurder_id === req.bestuurder.id;
  if (!own && !res.locals.can("directie")) return res.status(403).render("error", { title: "Geen toegang", message: "Dit incident is niet van jou." });
  const fotos = await db.all("SELECT * FROM documenten WHERE incident_id = $1 ORDER BY id", [i.id]);
  res.render("incidenten/show", { title: `Incident · ${i.kenteken}`, i, fotos, LABELS });
});

router.post("/:id/status", auth.requireRole("beheerder"), async (req, res, next) => {
  const i = await db.one("SELECT * FROM incidenten WHERE id = $1", [req.params.id]);
  if (!i) return next();
  const status = LABELS.incident_status[req.body.status] ? req.body.status : i.status;
  await db.run("UPDATE incidenten SET status = $2, kosten = COALESCE($3, kosten), tegenpartij = COALESCE($4, tegenpartij), gemeld_bij = COALESCE($5, gemeld_bij), garage_ingeschakeld_op = COALESCE($6, garage_ingeschakeld_op) WHERE id = $1", [i.id, status, cleanNumber(req.body.kosten), clean(req.body.tegenpartij), clean(req.body.gemeld_bij), require("../helpers").cleanDate(req.body.garage_ingeschakeld_op)]);
  if (status === "afgerond" && i.taak_id) await db.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE id = $1 AND status = 'open'", [i.taak_id, req.user.id]);
  await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'incident',$4)", [i.voertuig_id, i.bestuurder_id, req.user.id, `Incident van ${formatDate(i.datum)} op ${LABELS.incident_status[status].toLowerCase()} gezet door ${req.user.name}`]);
  res.flash("Opgeslagen.");
  res.redirect(`/incidenten/${i.id}`);
});

module.exports = { router };
