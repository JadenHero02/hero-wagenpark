// src/routes/documenten.js
// Documenten per auto, in de app (geen Teams-map): uploaden, bekijken, downloaden, verwijderen.
// De inhoud staat in de database (document_inhoud), tot 10 MB per bestand. Een APK-rapport keurt een beheerder goed,
// met de nieuwe APK-datum; daarmee sluiten de APK-taken.

const express = require("express");
const multer = require("multer");
const db = require("../db");
const auth = require("../auth");
const taken = require("../taken");
const { clean, cleanDate, formatDate, LABELS } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
const TOEGESTAAN = /^(application\/pdf|image\/(jpeg|png|heic|heif|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))|text\/plain)$/i;

// Wie mag bij de documenten van deze auto: directie en hoger, of de bestuurder van de auto
async function toegang(req, res, voertuigId) {
  if (res.locals.can("directie")) return true;
  if (!req.bestuurder) return false;
  return Boolean(await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [voertuigId, req.bestuurder.id]));
}
const mags = (req, res) => res.locals.can("beheerder") || Boolean(req.bestuurder);

// Slaat bestanden op; geeft de ids terug. Ook gebruikt door incidenten (foto's).
async function bewaar({ voertuigId, files, soort, omschrijving = null, incidentId = null, userId }, t = db) {
  const ids = [];
  for (const f of files || []) {
    if (!f || !f.size) continue;
    if (!TOEGESTAAN.test(f.mimetype)) throw new Error(`Bestandstype niet toegestaan: ${f.originalname}. Gebruik pdf, jpg, png, Word of Excel.`);
    const naam = String(f.originalname || "bestand").replace(/[\\/]+/g, "_").slice(0, 200);
    const id = await t.insert("INSERT INTO documenten (voertuig_id, soort, bestandsnaam, opslagpad, grootte, mimetype, geupload_door, omschrijving, incident_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [voertuigId, LABELS.document[soort] ? soort : "overig", naam, `db:${voertuigId}`, f.size, f.mimetype, userId, omschrijving, incidentId]);
    await t.run("INSERT INTO document_inhoud (document_id, inhoud) VALUES ($1, $2)", [id, f.buffer]);
    ids.push(id);
  }
  return ids;
}

// Lijst en upload per auto
router.get("/voertuigen/:id/documenten", async (req, res, next) => {
  const v = await db.one("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.id = $1", [req.params.id]);
  if (!v) return next();
  if (!await toegang(req, res, v.id)) return res.status(403).render("error", { title: "Geen toegang", message: "Je kunt alleen de documenten van je eigen auto zien." });
  const documenten = await db.all("SELECT d.*, u.name AS geupload_door_naam, g.name AS goedgekeurd_door_naam FROM documenten d LEFT JOIN users u ON u.id = d.geupload_door LEFT JOIN users g ON g.id = d.goedgekeurd_door WHERE d.voertuig_id = $1 ORDER BY d.created_at DESC", [v.id]);
  res.render("documenten/index", { title: `Documenten · ${v.kenteken || v.merk}`, v, documenten, soort: LABELS.document[req.query.soort] ? req.query.soort : "overig", LABELS, mijn: !res.locals.can("directie") });
});
router.post("/voertuigen/:id/documenten", (req, res, next) => upload.array("bestanden", 10)(req, res, (err) => (err ? (res.flash(err.code === "LIMIT_FILE_SIZE" ? "Bestand is groter dan 10 MB." : err.message, "error"), res.redirect(`/voertuigen/${req.params.id}/documenten`)) : next())), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  if (!await toegang(req, res, v.id) || !mags(req, res)) return res.status(403).send("Geen toegang.");
  const soort = LABELS.document[req.body.soort] ? req.body.soort : "overig";
  const terug = req.body.terug && String(req.body.terug).startsWith("/") ? req.body.terug : `/voertuigen/${v.id}/documenten`;
  try {
    const ids = await db.tx((t) => bewaar({ voertuigId: v.id, files: req.files, soort, omschrijving: clean(req.body.omschrijving), userId: req.user.id }, t));
    if (!ids.length) { res.flash("Kies een bestand.", "error"); return res.redirect(terug); }
    await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'document',$4)", [v.id, req.bestuurder ? req.bestuurder.id : null, req.user.id, `${ids.length} ${ids.length === 1 ? "document" : "documenten"} (${LABELS.document[soort]}) geüpload door ${req.user.name}`]);
    if (soort === "apk_rapport") {
      await db.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE status = 'open' AND voertuig_id = $1 AND soort = 'apk_rapport' AND voor = 'bestuurder'", [v.id, req.user.id]);
      await taken.maak({ voertuig_id: v.id, soort: "apk_rapport", titel: `APK-rapport beoordelen · ${taken.autoNaam(v)}`, omschrijving: `${req.user.name} heeft het keuringsrapport geüpload. Controleer het en zet de nieuwe APK-datum.`, deadline: taken.addDays(taken.nlNow().date, 3), voor: "beheerder", sleutel: `apk_beoordelen:${v.id}:${ids[0]}` });
      res.flash("Rapport geüpload. Een beheerder keurt het goed en zet de nieuwe APK-datum.");
    } else res.flash(ids.length === 1 ? "Document opgeslagen." : `${ids.length} documenten opgeslagen.`);
  } catch (err) { res.flash(err.message, "error"); }
  res.redirect(terug);
});

// Bekijken of downloaden
router.get("/documenten/:id", async (req, res, next) => {
  const d = await db.one("SELECT * FROM documenten WHERE id = $1", [req.params.id]);
  if (!d) return next();
  if (!await toegang(req, res, d.voertuig_id)) return res.status(403).render("error", { title: "Geen toegang", message: "Dit document hoort niet bij jouw auto." });
  const inhoud = await db.one("SELECT inhoud FROM document_inhoud WHERE document_id = $1", [d.id]);
  if (!inhoud) return next();
  res.setHeader("Content-Type", d.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", inhoud.inhoud.length);
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(d.bestandsnaam)}`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.end(inhoud.inhoud);
});

// APK-rapport goedkeuren: nieuwe APK-datum zetten, afspraak wissen, taken sluiten
router.post("/documenten/:id/goedkeuren", auth.requireRole("beheerder"), async (req, res, next) => {
  const d = await db.one("SELECT d.*, v.kenteken, v.merk, v.model, v.apk_vervaldatum FROM documenten d JOIN voertuigen v ON v.id = d.voertuig_id WHERE d.id = $1", [req.params.id]);
  if (!d) return next();
  const nieuw = cleanDate(req.body.apk_vervaldatum);
  if (d.soort === "apk_rapport" && !nieuw) { res.flash("Vul de nieuwe APK-vervaldatum in.", "error"); return res.redirect(`/voertuigen/${d.voertuig_id}/documenten`); }
  await db.tx(async (t) => {
    await t.run("UPDATE documenten SET goedgekeurd_door = $2, goedgekeurd_op = local_now() WHERE id = $1", [d.id, req.user.id]);
    if (d.soort === "apk_rapport") {
      await t.run("UPDATE voertuigen SET apk_vervaldatum = $2, apk_afspraak = NULL, updated_at = local_now() WHERE id = $1", [d.voertuig_id, nieuw]);
      await t.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE status = 'open' AND voertuig_id = $1 AND soort IN ('apk','apk_rapport')", [d.voertuig_id, req.user.id]);
      await t.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'apk',$3)", [d.voertuig_id, req.user.id, `APK-rapport goedgekeurd door ${req.user.name}; APK geldig tot ${formatDate(nieuw)} (was ${formatDate(d.apk_vervaldatum) || "onbekend"})`]);
    } else {
      await t.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'document',$3)", [d.voertuig_id, req.user.id, `${d.bestandsnaam} goedgekeurd door ${req.user.name}`]);
    }
  });
  res.flash(d.soort === "apk_rapport" ? `APK-rapport goedgekeurd. APK geldig tot ${formatDate(nieuw)}.` : "Document goedgekeurd.");
  res.redirect(req.body.terug && String(req.body.terug).startsWith("/") ? req.body.terug : `/voertuigen/${d.voertuig_id}`);
});

router.post("/documenten/:id/verwijderen", auth.requireRole("beheerder"), async (req, res, next) => {
  const d = await db.one("SELECT * FROM documenten WHERE id = $1", [req.params.id]);
  if (!d) return next();
  await db.run("DELETE FROM documenten WHERE id = $1", [d.id]);
  await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'document',$3)", [d.voertuig_id, req.user.id, `Document ${d.bestandsnaam} verwijderd door ${req.user.name}`]);
  res.flash("Document verwijderd.");
  res.redirect(req.body.terug && String(req.body.terug).startsWith("/") ? req.body.terug : `/voertuigen/${d.voertuig_id}/documenten`);
});

module.exports = { router, bewaar, upload };
