// src/routes/processen.js
// Checklists per auto: overzicht van lopende processen, een proces starten, stappen afvinken.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const processen = require("../processen");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const lopend = await db.all(`SELECT p.*, v.kenteken, v.merk, v.model, ve.naam AS vestiging, u.name AS gestart_door_naam,
      (SELECT COUNT(*) FROM processtappen s WHERE s.proces_id = p.id) AS totaal, (SELECT COUNT(*) FROM processtappen s WHERE s.proces_id = p.id AND s.afgevinkt_op IS NOT NULL) AS klaar,
      (SELECT s.omschrijving FROM processtappen s WHERE s.proces_id = p.id AND s.afgevinkt_op IS NULL ORDER BY s.nr LIMIT 1) AS volgende
    FROM processen p JOIN voertuigen v ON v.id = p.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN users u ON u.id = p.gestart_door
    WHERE p.afgerond_op IS NULL ORDER BY p.gestart_op DESC`);
  const afgerond = await db.all(`SELECT p.*, v.kenteken, v.merk, v.model FROM processen p JOIN voertuigen v ON v.id = p.voertuig_id WHERE p.afgerond_op IS NOT NULL ORDER BY p.afgerond_op DESC LIMIT 15`);
  res.render("processen/index", { title: "Processen", lopend, afgerond, STAPPEN: processen.STAPPEN, NAMEN: processen.NAMEN });
});

router.get("/start", auth.requireRole("beheerder"), async (req, res) => {
  const v = Number(req.query.voertuig) ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [Number(req.query.voertuig)]) : null;
  const voertuigen = await db.all("SELECT id, kenteken, merk, model, status FROM voertuigen WHERE status <> 'archief' ORDER BY kenteken NULLS LAST");
  const lopend = v ? await db.all("SELECT soort FROM processen WHERE voertuig_id = $1 AND afgerond_op IS NULL", [v.id]) : [];
  res.render("processen/start", { title: "Proces starten", v, voertuigen, soort: processen.STAPPEN[req.query.soort] ? req.query.soort : null, lopend: lopend.map((p) => p.soort), STAPPEN: processen.STAPPEN, NAMEN: processen.NAMEN });
});
router.post("/start", auth.requireRole("beheerder"), async (req, res) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [Number(req.body.voertuig_id) || 0]);
  const soort = req.body.soort;
  if (!v || !processen.STAPPEN[soort]) { res.flash("Kies een auto en een proces.", "error"); return res.redirect("/processen/start"); }
  if (soort === "uitgifte") { res.flash("Uitgifte begint met toewijzen: de checklist start daar vanzelf.", "error"); return res.redirect(`/uitleen/toewijzen?voertuig=${v.id}`); }
  if (soort === "inname") { res.flash("Inname begint met de inleverdatum.", "error"); return res.redirect(`/uitleen/innemen?voertuig=${v.id}`); }
  const klaar = soort === "instroom" ? ["aanmaken"] : [];
  const id = await processen.start({ voertuigId: v.id, soort, userId: req.user.id, klaar });
  res.redirect(`/processen/${id}`);
});

router.get("/:id", auth.requireRole("directie"), async (req, res, next) => {
  const p = await processen.laad(req.params.id);
  if (!p) return next();
  const tw = p.toewijzing_id ? await db.one("SELECT t.*, b.naam AS bestuurder FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.id = $1", [p.toewijzing_id]) : null;
  res.render("processen/show", { title: `${p.naam} · ${p.kenteken || p.merk}`, p, tw });
});
router.post("/:id/stappen/:stap", auth.requireRole("beheerder"), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.stap)) return next();
  const p = await processen.laad(req.params.id);
  if (!p) return next();
  if (p.afgerond_op) { res.flash("Dit proces is al afgerond.", "error"); return res.redirect(`/processen/${p.id}`); }
  await processen.afvinken(p.id, Number(req.params.stap), req.user, req.body.ongedaan === "1");
  const na = await processen.laad(p.id);
  if (na.afgerond_op) { res.flash(`${na.naam} afgerond.`); return res.redirect(`/voertuigen/${na.voertuig_id}`); }
  res.redirect(`/processen/${p.id}`);
});
router.post("/:id/stoppen", auth.requireRole("beheerder"), async (req, res, next) => {
  const p = await processen.laad(req.params.id);
  if (!p) return next();
  await db.run("DELETE FROM processen WHERE id = $1 AND afgerond_op IS NULL", [p.id]);
  await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'proces',$3)", [p.voertuig_id, req.user.id, `Proces ${p.naam.toLowerCase()} gestopt door ${req.user.name}`]);
  res.flash("Proces gestopt.");
  res.redirect(`/voertuigen/${p.voertuig_id}`);
});

module.exports = { router };
