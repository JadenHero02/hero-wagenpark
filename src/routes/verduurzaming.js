// src/routes/verduurzaming.js
// Verduurzaming op een eigen pagina (feedback Annemiek 16-09): de verdeling benzine, elektrisch, hybride en diesel over het
// wagenpark en per vestiging, plus hoe compleet de gegevens zijn. Stond eerst op het dashboard, maar is daar niet voor iedereen van belang.

const express = require("express");
const db = require("../db");
const auth = require("../auth");

const router = express.Router();

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const totaal = await db.all("SELECT COALESCE(milieu, 'onbekend') AS milieu, COUNT(*) AS n FROM voertuigen WHERE status IN ('actief','uitgeleend','op_voorraad') GROUP BY 1 ORDER BY n DESC");
  const perVestiging = await db.all(`SELECT ve.naam, COUNT(v.id) AS n,
      COUNT(v.id) FILTER (WHERE v.milieu = 'elektrisch') AS elektrisch, COUNT(v.id) FILTER (WHERE v.milieu = 'hybride') AS hybride,
      COUNT(v.id) FILTER (WHERE v.milieu = 'benzine') AS benzine, COUNT(v.id) FILTER (WHERE v.milieu = 'diesel') AS diesel,
      COUNT(v.id) FILTER (WHERE v.milieu IS NULL) AS onbekend
    FROM vestigingen ve LEFT JOIN voertuigen v ON v.vestiging_id = ve.id AND v.status IN ('actief','uitgeleend','op_voorraad')
    GROUP BY ve.id, ve.naam, ve.volgorde ORDER BY ve.volgorde`);
  const besteld = await db.all("SELECT COALESCE(milieu, 'onbekend') AS milieu, COUNT(*) AS n FROM voertuigen WHERE status = 'besteld' GROUP BY 1 ORDER BY n DESC");
  const counts = await db.one(`SELECT COUNT(*) FILTER (WHERE kenteken IS NOT NULL) AS met_kenteken,
      COUNT(*) FILTER (WHERE kenteken IS NOT NULL AND EXISTS (SELECT 1 FROM documenten d WHERE d.voertuig_id = v.id AND d.soort = 'kentekenbewijs')) AS doc_ok,
      COUNT(*) FILTER (WHERE rdw_opgehaald_op IS NOT NULL) AS rdw_ok,
      ROUND(AVG((rdw_extra->>'co2')::numeric) FILTER (WHERE rdw_extra->>'co2' IS NOT NULL)) AS co2_gem
    FROM voertuigen v WHERE status IN ('actief','uitgeleend','op_voorraad')`);
  res.render("verduurzaming", { title: "Verduurzaming", totaal, perVestiging, besteld, counts });
});

module.exports = { router };
