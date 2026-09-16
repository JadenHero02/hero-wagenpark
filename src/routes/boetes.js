// src/routes/boetes.js
// Boetes: het register van de app. HR voert de boete in, de app zoekt de bestuurder van dat moment op, HR zet hem in AFAS
// (loonstrook) en bevestigt dat hier. De app stuurt geen mail naar HR; wel naar de bestuurder.
// De beheerder bevestigt; HR krijgt een mail en verwerkt de inhouding; bestuurder en celdirecteur in kopie.
// Eén keer niet doorbelasten kan alleen na een verzoek met reden, goedgekeurd door een andere beheerder of de admin. Alles gelogd.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const mail = require("../mail");
const taken = require("../taken");
const { clean, cleanDate, cleanNumber, formatDate, euro, LABELS } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));
const log = (b, userId, tekst, t = db) => t.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'boete',$4)", [b.voertuig_id, b.bestuurder_id, userId, tekst]);

async function laad(id) {
  return db.one(`SELECT b.*, v.kenteken, v.merk, v.model, v.vestiging_id, ve.naam AS vestiging, bs.naam AS bestuurder, bs.email AS bestuurder_email, u.name AS bevestigd_door_naam, g.name AS gevraagd_door_naam
    FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN bestuurders bs ON bs.id = b.bestuurder_id LEFT JOIN users u ON u.id = b.bevestigd_door LEFT JOIN users g ON g.id = b.uitzondering_gevraagd_door
    WHERE b.id = $1`, [id]);
}

router.get("/", auth.requireHr, async (req, res) => {
  const status = LABELS.boete[req.query.status] ? req.query.status : null;
  const rows = await db.all(`SELECT b.*, v.kenteken, v.merk, v.model, ve.naam AS vestiging, bs.naam AS bestuurder, u.name AS bevestigd_door_naam
    FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id LEFT JOIN bestuurders bs ON bs.id = b.bestuurder_id LEFT JOIN users u ON u.id = b.bevestigd_door
    ${status ? "WHERE b.status = $1" : ""} ORDER BY CASE b.status WHEN 'uitzondering_gevraagd' THEN 0 WHEN 'nieuw' THEN 1 ELSE 2 END, b.datum DESC LIMIT 200`, status ? [status] : []);
  const counts = await db.one("SELECT COUNT(*) FILTER (WHERE status = 'nieuw') AS nieuw, COUNT(*) FILTER (WHERE status = 'uitzondering_gevraagd') AS uitzondering, COALESCE(SUM(bedrag) FILTER (WHERE status = 'doorbelast' AND datum >= date_trunc('year', current_date)), 0) AS doorbelast_jaar FROM boetes");
  res.render("boetes/index", { title: "Boetes", rows, status, counts, LABELS });
});

router.get("/nieuw", auth.requireHr, async (req, res) => {
  const voertuigen = await db.all("SELECT v.id, v.kenteken, v.merk, v.model, b.naam AS bestuurder FROM voertuigen v LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief' LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE v.status <> 'besteld' ORDER BY v.kenteken NULLS LAST");
  res.render("boetes/form", { title: "Nieuwe boete", form: { voertuig_id: Number(req.query.voertuig) || null, datum: taken.nlNow().date }, voertuigen });
});
router.post("/", auth.requireHr, async (req, res) => {
  const f = { voertuig_id: Number(req.body.voertuig_id) || null, datum: cleanDate(req.body.datum), bedrag: cleanNumber(req.body.bedrag), omschrijving: clean(req.body.omschrijving) };
  const v = f.voertuig_id ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [f.voertuig_id]) : null;
  if (!v || !f.datum) { res.flash("Kies een auto en vul de datum van de overtreding in.", "error"); return res.redirect("/boetes/nieuw"); }
  // Wie reed er op die datum? Vaste toewijzing of uitleen die de datum dekt; anders de huidige bestuurder
  const wie = await db.one(`SELECT b.* FROM toewijzingen t JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.voertuig_id = $1 AND (t.van IS NULL OR t.van <= $2) AND (t.tot IS NULL OR t.tot >= $2 OR (t.status = 'actief' AND t.soort = 'vast'))
    ORDER BY t.soort = 'uitleen' DESC, t.van DESC NULLS LAST LIMIT 1`, [v.id, f.datum]);
  const id = await db.insert("INSERT INTO boetes (voertuig_id, bestuurder_id, datum, bedrag, omschrijving) VALUES ($1,$2,$3,$4,$5)", [v.id, wie ? wie.id : null, f.datum, f.bedrag, f.omschrijving]);
  await log({ voertuig_id: v.id, bestuurder_id: wie ? wie.id : null }, req.user.id, `Boete ingevoerd door ${req.user.name}: ${euro(f.bedrag) || "bedrag onbekend"} op ${formatDate(f.datum)}${wie ? ", bestuurder " + wie.naam : ", geen bestuurder bekend"}`);
  res.flash(wie ? `Boete ingevoerd. Bestuurder op ${formatDate(f.datum)}: ${wie.naam}. Zet hem in AFAS en bevestig dat hier.` : "Boete ingevoerd, maar er reed niemand bekend op die datum. Kies zelf de bestuurder.");
  res.redirect(`/boetes/${id}`);
});

router.get("/:id", async (req, res, next) => {
  const b = await laad(req.params.id);
  if (!b) return next();
  const own = req.bestuurder && b.bestuurder_id === req.bestuurder.id;
  if (!own && !req.isHr) return res.status(403).render("error", { title: "Geen toegang", message: "Deze boete is niet van jou." });
  const bestuurders = req.isHr ? await db.all("SELECT id, naam FROM bestuurders WHERE actief ORDER BY naam") : [];
  const logboek = await db.all("SELECT l.*, u.name AS door FROM logboek l LEFT JOIN users u ON u.id = l.user_id WHERE l.soort = 'boete' AND l.voertuig_id = $1 AND l.created_at >= $2::date ORDER BY l.created_at DESC LIMIT 10", [b.voertuig_id, b.created_at.slice(0, 10)]);
  res.render("boetes/show", { title: `Boete · ${b.kenteken}`, b, bestuurders, logboek, LABELS });
});

router.post("/:id/bestuurder", auth.requireHr, async (req, res, next) => {
  const b = await laad(req.params.id);
  if (!b) return next();
  if (b.status !== "nieuw") { res.flash("De bestuurder kan alleen worden gewijzigd zolang de boete nog niet bevestigd is.", "error"); return res.redirect(`/boetes/${b.id}`); }
  const bid = Number(req.body.bestuurder_id) || null;
  await db.run("UPDATE boetes SET bestuurder_id = $2, bedrag = COALESCE($3, bedrag), omschrijving = COALESCE($4, omschrijving) WHERE id = $1", [b.id, bid, cleanNumber(req.body.bedrag), clean(req.body.omschrijving)]);
  const naam = bid ? ((await db.one("SELECT naam FROM bestuurders WHERE id = $1", [bid])) || {}).naam : "niemand";
  await log({ ...b, bestuurder_id: bid }, req.user.id, `Boete aangepast door ${req.user.name}: bestuurder ${naam}`);
  res.flash("Opgeslagen.");
  res.redirect(`/boetes/${b.id}`);
});

async function doorbelasten(b, user, tekst) {
  await db.run("UPDATE boetes SET status = 'doorbelast', bevestigd_door = $2, bevestigd_op = local_now(), hr_gemaild_op = local_now() WHERE id = $1", [b.id, user.id]);
  await log(b, user.id, tekst);
  // HR zet de boete zelf in AFAS; de app mailt alleen de bestuurder, met de celdirecteur in kopie
  const to = mail.bestuurderEmail({ email: b.bestuurder_email });
  const cc = await mail.celdirecteur(b.vestiging_id);
  await mail.send({ to, cc, subject: `Boete op je naam: ${euro(b.bedrag) || "bedrag onbekend"}, ${formatDate(b.datum)}`, soort: "boete", ref: `boete_doorbelast:${b.id}`, html: mail.layout({ titel: "Boete via je loonstrook", intro: "Er is een boete op jouw naam geregistreerd. Volgens het personeelsbeleid wordt die via AFAS ingehouden op je loonstrook. Vragen? Neem contact op met HR of je celdirecteur.", regels: [["Auto", taken.autoNaam(b)], ["Datum overtreding", formatDate(b.datum)], ["Bedrag", euro(b.bedrag) || "onbekend"], ["Omschrijving", b.omschrijving || "–"], ["Geregistreerd door", user.name]] }) });
  return to;
}

router.post("/:id/bevestigen", auth.requireHr, async (req, res, next) => {
  const b = await laad(req.params.id);
  if (!b) return next();
  if (b.status !== "nieuw") { res.flash("Deze boete is al afgehandeld.", "error"); return res.redirect(`/boetes/${b.id}`); }
  if (!b.bestuurder_id) { res.flash("Kies eerst de bestuurder.", "error"); return res.redirect(`/boetes/${b.id}`); }
  const to = await doorbelasten(b, req.user, `In AFAS gezet door ${req.user.name}: ${euro(b.bedrag)} op naam van ${b.bestuurder}`);
  res.flash(to.length ? "Geregistreerd als in AFAS. De bestuurder is gemaild, celdirecteur in kopie." : "Geregistreerd als in AFAS. De bestuurder heeft geen e-mailadres, dus geen mail.");
  res.redirect(`/boetes/${b.id}`);
});

router.post("/:id/uitzondering", auth.requireHr, async (req, res, next) => {
  const b = await laad(req.params.id);
  if (!b) return next();
  const reden = clean(req.body.reden);
  if (b.status !== "nieuw") { res.flash("Deze boete is al afgehandeld.", "error"); return res.redirect(`/boetes/${b.id}`); }
  if (!reden) { res.flash("Een uitzondering vraagt een reden.", "error"); return res.redirect(`/boetes/${b.id}`); }
  await db.run("UPDATE boetes SET status = 'uitzondering_gevraagd', uitzondering_reden = $2, uitzondering_gevraagd_door = $3, uitzondering_gevraagd_op = local_now() WHERE id = $1", [b.id, reden, req.user.id]);
  await log(b, req.user.id, `Uitzondering gevraagd door ${req.user.name}: ${reden}`);
  const beheer = (await mail.beheerders(b.vestiging_id)).filter((e) => e !== req.user.email);
  await mail.send({ to: beheer, subject: `Verzoek: boete niet doorbelasten (${b.bestuurder || "onbekend"}, ${euro(b.bedrag)})`, soort: "boete", ref: `boete_uitzondering:${b.id}`, html: mail.layout({ titel: "Verzoek om een boete niet door te belasten", intro: `${req.user.name} vraagt een uitzondering op het personeelsbeleid. Een andere beheerder of de admin beslist.`, regels: [["Bestuurder", b.bestuurder || "onbekend"], ["Auto", taken.autoNaam(b)], ["Datum", formatDate(b.datum)], ["Bedrag", euro(b.bedrag) || "onbekend"], ["Reden", reden]], knop: { tekst: "Goedkeuren of afwijzen", url: `${mail.baseUrl()}/boetes/${b.id}` } }) });
  res.flash("Uitzondering gevraagd. Een andere beheerder of de admin beslist; het besluit wordt gelogd.");
  res.redirect(`/boetes/${b.id}`);
});

router.post("/:id/uitzondering/:besluit", auth.requireHr, async (req, res, next) => {
  const b = await laad(req.params.id);
  if (!b || !["goedkeuren", "afwijzen"].includes(req.params.besluit)) return next();
  if (b.status !== "uitzondering_gevraagd") { res.flash("Er ligt geen verzoek om een uitzondering.", "error"); return res.redirect(`/boetes/${b.id}`); }
  if (b.uitzondering_gevraagd_door === req.user.id && !res.locals.can("admin")) { res.flash("Je kunt je eigen verzoek niet beoordelen. Een andere beheerder of de admin beslist.", "error"); return res.redirect(`/boetes/${b.id}`); }
  const toelichting = clean(req.body.toelichting);
  if (req.params.besluit === "goedkeuren") {
    await db.run("UPDATE boetes SET status = 'niet_doorbelast', bevestigd_door = $2, bevestigd_op = local_now(), hr_gemaild_op = local_now() WHERE id = $1", [b.id, req.user.id]);
    await log(b, req.user.id, `Uitzondering goedgekeurd door ${req.user.name}: boete van ${euro(b.bedrag)} wordt niet doorbelast${toelichting ? " (" + toelichting + ")" : ""}`);
    await mail.send({ to: mail.bestuurderEmail({ email: b.bestuurder_email }), subject: `Boete niet ingehouden: ${b.bestuurder || "onbekend"}, ${euro(b.bedrag)}`, soort: "boete", ref: `boete_besluit:${b.id}`, html: mail.layout({ titel: "Boete wordt niet doorbelast", intro: "Bij uitzondering, goedgekeurd en gelogd.", regels: [["Bestuurder", b.bestuurder || "onbekend"], ["Auto", taken.autoNaam(b)], ["Datum", formatDate(b.datum)], ["Bedrag", euro(b.bedrag) || "onbekend"], ["Reden", b.uitzondering_reden || "–"], ["Goedgekeurd door", req.user.name]] }) });
    res.flash("Uitzondering goedgekeurd: de boete wordt niet ingehouden. De bestuurder is geïnformeerd; zet hem niet in AFAS.");
  } else {
    await doorbelasten(b, req.user, `Uitzondering afgewezen door ${req.user.name}${toelichting ? " (" + toelichting + ")" : ""}; boete wordt doorbelast`);
    res.flash("Uitzondering afgewezen: de boete gaat via AFAS. De bestuurder is gemaild.");
  }
  res.redirect(`/boetes/${b.id}`);
});

module.exports = { router };
