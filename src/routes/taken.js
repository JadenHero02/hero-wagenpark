// src/routes/taken.js
// De takenlijst van de beheerder: automatische taken (APK, banden, contract, rijbewijs, leenauto) en handmatige.
// Afronden, laten vervallen, nieuwe taak. Een bestuurder ziet en rondt alleen zijn eigen taken af (via Mijn auto).

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const taken = require("../taken");
const { clean, cleanDate, LABELS } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

router.get("/", auth.requireRole("directie"), async (req, res) => {
  const f = { status: ["afgerond", "vervallen", "alle"].includes(req.query.status) ? req.query.status : "open", voor: clean(req.query.voor), soort: clean(req.query.soort), vestiging: Number(req.query.vestiging) || null, laat: req.query.laat === "1" };
  const where = []; const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.status !== "alle") add("t.status = ?", f.status);
  if (f.voor) add("t.voor = ?", f.voor);
  if (f.soort) add("t.soort = ?", f.soort);
  if (f.vestiging) add("COALESCE(v.vestiging_id, b.vestiging_id) = ?", f.vestiging);
  if (f.laat) where.push("t.deadline < current_date AND t.status = 'open'");
  const rows = await db.all(`SELECT t.*, v.kenteken, v.merk, v.model, b.naam AS bestuurder, ve.naam AS vestiging, u.name AS afgerond_door_naam, (t.deadline - current_date) AS dagen
    FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id LEFT JOIN vestigingen ve ON ve.id = COALESCE(v.vestiging_id, b.vestiging_id) LEFT JOIN users u ON u.id = t.afgerond_door
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.deadline NULLS LAST, t.id DESC LIMIT 200`, params);
  const counts = await db.one("SELECT COUNT(*) FILTER (WHERE status = 'open') AS open, COUNT(*) FILTER (WHERE status = 'open' AND deadline < current_date) AS te_laat, COUNT(*) FILTER (WHERE status = 'open' AND voor = 'bestuurder') AS bestuurder, COUNT(*) FILTER (WHERE status = 'open' AND voor = 'beheerder') AS beheerder FROM taken");
  res.render("taken/index", { title: "Taken", rows, f, counts, vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"), LABELS });
});

router.get("/nieuw", auth.requireRole("beheerder"), async (req, res) => {
  res.render("taken/form", { title: "Nieuwe taak", form: { voertuig_id: Number(req.query.voertuig) || null, bestuurder_id: Number(req.query.bestuurder) || null, voor: "beheerder" }, voertuigen: await db.all("SELECT id, kenteken, merk, model FROM voertuigen WHERE status <> 'archief' ORDER BY kenteken NULLS LAST"), bestuurders: await db.all("SELECT id, naam FROM bestuurders WHERE actief ORDER BY naam") });
});
router.post("/", auth.requireRole("beheerder"), async (req, res) => {
  const titel = clean(req.body.titel);
  if (!titel) { res.flash("Geef de taak een titel.", "error"); return res.redirect("/taken/nieuw"); }
  const voertuigId = Number(req.body.voertuig_id) || null;
  let bestuurderId = Number(req.body.bestuurder_id) || null;
  const voor = req.body.voor === "bestuurder" ? "bestuurder" : "beheerder";
  if (voor === "bestuurder" && !bestuurderId && voertuigId) { const b = await taken.bestuurderVan(voertuigId); bestuurderId = b ? b.id : null; }
  if (voor === "bestuurder" && !bestuurderId) { res.flash("Een taak voor een bestuurder heeft een bestuurder nodig (of een auto met bestuurder).", "error"); return res.redirect("/taken/nieuw"); }
  const id = await taken.maak({ voertuig_id: voertuigId, bestuurder_id: bestuurderId, soort: "handmatig", titel, omschrijving: clean(req.body.omschrijving), deadline: cleanDate(req.body.deadline), voor });
  if (voertuigId) await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'taak',$4)", [voertuigId, bestuurderId, req.user.id, `Taak aangemaakt door ${req.user.name}: ${titel}`]);
  res.flash("Taak aangemaakt.");
  res.redirect(req.body.terug && String(req.body.terug).startsWith("/") ? req.body.terug : `/taken${id ? "" : ""}`);
});

async function mag(req, res, t) {
  if (res.locals.can("beheerder")) return true;
  return Boolean(req.bestuurder && t.bestuurder_id === req.bestuurder.id);
}
const back = (req) => (req.body.terug && String(req.body.terug).startsWith("/") ? req.body.terug : "/taken");

router.post("/:id/afronden", async (req, res, next) => {
  const t = await db.one("SELECT * FROM taken WHERE id = $1", [req.params.id]);
  if (!t) return next();
  if (!await mag(req, res, t)) return res.status(403).send("Geen toegang.");
  if (t.status !== "open") { res.flash("Deze taak is al afgehandeld.", "error"); return res.redirect(back(req)); }
  await db.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE id = $1", [t.id, req.user.id]);
  // Bandenwissel afgerond: ook de seizoensregistratie bijwerken
  if (t.soort === "banden" && t.sleutel) { const sz = t.sleutel.split(":")[2]; if (sz) await db.run("UPDATE bandenwissels SET gewisseld = true, gewisseld_op = current_date WHERE voertuig_id = $1 AND seizoen = $2", [t.voertuig_id, sz]); }
  if (t.voertuig_id) await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'taak',$4)", [t.voertuig_id, t.bestuurder_id, req.user.id, `Taak afgerond door ${req.user.name}: ${t.titel}`]);
  res.flash("Taak afgerond.");
  res.redirect(back(req));
});
router.post("/:id/vervallen", auth.requireRole("beheerder"), async (req, res, next) => {
  const t = await db.one("SELECT * FROM taken WHERE id = $1", [req.params.id]);
  if (!t) return next();
  await db.run("UPDATE taken SET status = 'vervallen', afgerond_door = $2, afgerond_op = local_now() WHERE id = $1 AND status = 'open'", [t.id, req.user.id]);
  if (t.voertuig_id) await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'taak',$4)", [t.voertuig_id, t.bestuurder_id, req.user.id, `Taak vervallen door ${req.user.name}: ${t.titel}`]);
  res.flash("Taak vervallen.");
  res.redirect(back(req));
});
router.post("/:id/heropenen", auth.requireRole("beheerder"), async (req, res, next) => {
  const t = await db.one("SELECT * FROM taken WHERE id = $1", [req.params.id]);
  if (!t) return next();
  await db.run("UPDATE taken SET status = 'open', afgerond_door = NULL, afgerond_op = NULL WHERE id = $1", [t.id]);
  res.flash("Taak weer open.");
  res.redirect(back(req));
});
// De takenronde met de hand draaien (admin): handig om te laten zien wat de app zelf doet
router.post("/ronde", auth.requireRole("admin"), async (req, res) => {
  const voor = await db.one("SELECT COUNT(*) AS n FROM taken WHERE status = 'open'");
  await taken.run();
  const na = await db.one("SELECT COUNT(*) AS n FROM taken WHERE status = 'open'");
  res.flash(`Takenronde gedraaid: ${na.n - voor.n} nieuwe taken.`);
  res.redirect("/taken");
});

module.exports = { router };
