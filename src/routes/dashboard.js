// src/routes/dashboard.js
// Het dashboard van de beheerder: wat er vandaag moet gebeuren, daaronder de aantallen. Per vestiging te filteren.
// Een bestuurder zonder beheerdersrol komt op Mijn auto.

const express = require("express");
const db = require("../db");
const auth = require("../auth");

const router = express.Router();

router.get("/", async (req, res) => {
  if (!res.locals.can("directie")) return res.redirect("/mijn-auto");
  const vestigingen = await db.all("SELECT * FROM vestigingen ORDER BY volgorde");
  const vId = Number(req.query.vestiging) || (req.user.vestiging_id && !req.query.vestiging ? null : null);
  const where = vId ? "AND v.vestiging_id = $1" : "";
  const params = vId ? [vId] : [];

  const counts = await db.one(`
    SELECT COUNT(*) FILTER (WHERE v.status IN ('actief','uitgeleend')) AS actief,
           COUNT(*) FILTER (WHERE v.status = 'besteld') AS besteld,
           COUNT(*) FILTER (WHERE v.status = 'op_voorraad') AS op_voorraad,
           COUNT(*) FILTER (WHERE v.status = 'uitgeleend') AS uitgeleend,
           COUNT(*) FILTER (WHERE v.status <> 'archief') AS totaal
    FROM voertuigen v WHERE v.status <> 'archief' ${where}`, params);
  const perVestiging = await db.all(`
    SELECT ve.naam, COUNT(v.id) AS n FROM vestigingen ve LEFT JOIN voertuigen v ON v.vestiging_id = ve.id AND v.status IN ('actief','uitgeleend','op_voorraad')
    GROUP BY ve.id, ve.naam, ve.volgorde ORDER BY ve.volgorde`);
  const openTaken = await db.one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE t.deadline < current_date) AS te_laat FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.status = 'open' ${where}`, params);

  // Vandaag voor jou: verstreken en naderende APK's, leenauto's over de retourdatum, uitleen zonder retourdatum
  const apk = await db.all(`
    SELECT v.id, v.kenteken, v.merk, v.model, v.apk_vervaldatum, ve.naam AS vestiging, b.naam AS bestuurder, (v.apk_vervaldatum - current_date) AS dagen
    FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief' AND t.soort = 'vast' LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE v.status IN ('actief','uitgeleend','op_voorraad') AND v.apk_vervaldatum IS NOT NULL AND v.apk_vervaldatum < current_date + 30 ${where}
    ORDER BY v.apk_vervaldatum LIMIT 12`, params);
  const uitleenTeLaat = await db.all(`
    SELECT v.id, v.kenteken, v.merk, v.model, t.tot, COALESCE(b.naam, t.extern_naam) AS wie, ve.naam AS vestiging, (current_date - t.tot) AS dagen
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE t.status = 'actief' AND t.soort = 'uitleen' AND t.tot IS NOT NULL AND t.tot < current_date ${where} ORDER BY t.tot`, params);
  const uitleenOpen = await db.one(`SELECT COUNT(*) AS n FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.status = 'actief' AND t.soort = 'uitleen' AND t.tot IS NULL ${where}`, params);
  const wachtlijst = await db.one(`SELECT COUNT(*) AS n FROM wachtlijst w LEFT JOIN voertuigen v ON false WHERE w.status = 'open' ${vId ? "AND w.vestiging_id = $1" : ""}`, params);
  const kmOntbreekt = await db.one(`
    SELECT COUNT(*) AS n FROM voertuigen v WHERE v.status IN ('actief','uitgeleend') ${where}
    AND NOT EXISTS (SELECT 1 FROM kilometerstanden k WHERE k.voertuig_id = v.id AND k.datum > current_date - 60)`, params);
  const bandenwissel = await db.one(`SELECT COUNT(*) AS n FROM voertuigen v WHERE v.status IN ('actief','uitgeleend','op_voorraad') AND v.banden = 'winter_zomer' ${where}`, params);
  const milieu = await db.all(`SELECT COALESCE(v.milieu, 'onbekend') AS milieu, COUNT(*) AS n FROM voertuigen v WHERE v.status IN ('actief','uitgeleend','op_voorraad') ${where} GROUP BY 1 ORDER BY n DESC`, params);

  res.render("dashboard/index", { title: "Dashboard", vestigingen, vId, counts, perVestiging, openTaken, apk, uitleenTeLaat, uitleenOpen: uitleenOpen.n, wachtlijst: wachtlijst.n, kmOntbreekt: kmOntbreekt.n, bandenwissel: bandenwissel.n, milieu });
});

// Mijn auto: de bestuurder op de telefoon. Voorlopig de kern; de rest volgt donderdag.
router.get("/mijn-auto", async (req, res) => {
  const b = req.bestuurder;
  const autos = b ? await db.all(`
    SELECT v.*, t.soort AS toewijzing_soort, t.van, t.tot, ve.naam AS vestiging,
      (SELECT stand FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_stand,
      (SELECT datum FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_datum
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    WHERE t.bestuurder_id = $1 AND t.status = 'actief' ORDER BY t.soort, t.van DESC`, [b.id]) : [];
  const garages = await db.all("SELECT * FROM contacten WHERE soort = 'garage' ORDER BY naam");
  res.render("mijn-auto", { title: "Mijn auto", autos, garages });
});

module.exports = { router };
