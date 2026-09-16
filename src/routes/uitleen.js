// src/routes/uitleen.js
// Toewijzen en innemen, en uitleen op verzoek: elke auto op voorraad is te leen. Een bestuurder (of beheerder) doet een verzoek,
// een beheerder keurt goed of wijst af. Goedkeuren maakt de uitleen-toewijzing. Verlengen gaat via hetzelfde verzoek ("vraag meer tijd aan").

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const mail = require("../mail");
const taken = require("../taken");
const processen = require("../processen");
const { clean, cleanDate, cleanNumber, yes, formatDate } = require("../helpers");

const router = express.Router();
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

const today = () => taken.nlNow().date;
const autoNaam = taken.autoNaam;
const log = (voertuigId, bestuurderId, userId, soort, tekst, t = db) => t.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,$4,$5)", [voertuigId, bestuurderId, userId, soort, tekst]);

async function lookups() {
  return {
    vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"),
    bestuurders: await db.all("SELECT b.*, v.kenteken AS huidige_auto FROM bestuurders b LEFT JOIN toewijzingen t ON t.bestuurder_id = b.id AND t.status = 'actief' AND t.soort = 'vast' LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE b.actief ORDER BY b.naam"),
    vrij: await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status = 'op_voorraad' ORDER BY ve.volgorde NULLS LAST, v.merk, v.kenteken"),
  };
}

// ---- Overzicht ----
router.get("/", auth.requireRole("directie"), async (req, res) => {
  const verzoeken = await db.all(`SELECT l.*, v.kenteken, v.merk, v.model, COALESCE(b.naam, l.extern_naam, u.name) AS wie, ve.naam AS vestiging
    FROM leenverzoeken l LEFT JOIN voertuigen v ON v.id = l.voertuig_id LEFT JOIN bestuurders b ON b.id = l.aanvrager_bestuurder_id LEFT JOIN users u ON u.id = l.aanvrager_user_id LEFT JOIN vestigingen ve ON ve.id = l.vestiging_id
    WHERE l.status = 'open' ORDER BY l.created_at`);
  const lopend = await db.all(`SELECT t.*, v.kenteken, v.merk, v.model, v.id AS voertuig_id, COALESCE(b.naam, t.extern_naam) AS wie, b.id AS bestuurder_id, ve.naam AS vestiging, (t.tot - current_date) AS dagen
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    WHERE t.status = 'actief' AND t.soort = 'uitleen' ORDER BY t.tot NULLS FIRST, t.van`);
  const historie = await db.all(`SELECT t.*, v.kenteken, v.merk, v.model, v.id AS voertuig_id, COALESCE(b.naam, t.extern_naam) AS wie
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE t.status = 'afgesloten' AND t.soort = 'uitleen' ORDER BY t.afgesloten_op DESC NULLS LAST, t.tot DESC NULLS LAST LIMIT 15`);
  const besloten = await db.all(`SELECT l.*, v.kenteken, COALESCE(b.naam, l.extern_naam, u.name) AS wie, d.name AS besloten_door_naam
    FROM leenverzoeken l LEFT JOIN voertuigen v ON v.id = l.voertuig_id LEFT JOIN bestuurders b ON b.id = l.aanvrager_bestuurder_id LEFT JOIN users u ON u.id = l.aanvrager_user_id LEFT JOIN users d ON d.id = l.besloten_door
    WHERE l.status <> 'open' ORDER BY l.besloten_op DESC LIMIT 10`);
  res.render("uitleen/index", { title: "Uitleen", verzoeken, lopend, historie, besloten, ...(await lookups()) });
});

// ---- Toewijzen (vast of uitleen) ----
router.get("/toewijzen", auth.requireRole("beheerder"), async (req, res) => {
  const l = await lookups();
  const voertuig = Number(req.query.voertuig) ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [Number(req.query.voertuig)]) : null;
  res.render("uitleen/toewijzen", { title: "Toewijzen", voertuig, form: { voertuig_id: voertuig ? voertuig.id : null, bestuurder_id: Number(req.query.bestuurder) || null, soort: req.query.soort === "uitleen" ? "uitleen" : "vast", van: today() }, ...l });
});
router.post("/toewijzen", auth.requireRole("beheerder"), async (req, res) => {
  const f = { voertuig_id: Number(req.body.voertuig_id) || null, bestuurder_id: Number(req.body.bestuurder_id) || null, extern_naam: clean(req.body.extern_naam), soort: req.body.soort === "uitleen" ? "uitleen" : "vast", van: cleanDate(req.body.van) || today(), tot: cleanDate(req.body.tot), reden: clean(req.body.reden), opmerking: clean(req.body.opmerking), km: cleanNumber(req.body.km) };
  const back = `/uitleen/toewijzen?voertuig=${f.voertuig_id || ""}&bestuurder=${f.bestuurder_id || ""}&soort=${f.soort}`;
  const v = f.voertuig_id ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [f.voertuig_id]) : null;
  if (!v) { res.flash("Kies een auto.", "error"); return res.redirect(back); }
  if (!f.bestuurder_id && !f.extern_naam) { res.flash("Kies een bestuurder of vul een externe naam in.", "error"); return res.redirect(back); }
  if (v.status === "besteld") { res.flash("Deze auto is nog niet geleverd. Rond eerst de instroom af.", "error"); return res.redirect(back); }
  if (v.status === "archief") { res.flash("Deze auto staat in het archief.", "error"); return res.redirect(back); }
  const actief = await db.one("SELECT t.*, b.naam FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.voertuig_id = $1 AND t.status = 'actief'", [v.id]);
  if (actief) { res.flash(`${v.kenteken} staat al op naam van ${actief.naam || actief.extern_naam}. Neem de auto eerst in.`, "error"); return res.redirect(back); }
  if (f.soort === "uitleen" && !f.tot) { res.flash("Een leenauto heeft een retourdatum nodig.", "error"); return res.redirect(back); }
  const b = f.bestuurder_id ? await db.one("SELECT * FROM bestuurders WHERE id = $1", [f.bestuurder_id]) : null;
  if (f.soort === "vast" && b) {
    const andere = await db.one("SELECT v.kenteken FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.bestuurder_id = $1 AND t.status = 'actief' AND t.soort = 'vast'", [b.id]);
    if (andere && !yes(req.body.forceer)) { res.flash(`${b.naam} heeft al een vaste auto (${andere.kenteken}). Neem die eerst in, of vink "toch toewijzen" aan.`, "error"); return res.redirect(back); }
  }
  const wie = b ? b.naam : f.extern_naam;
  const id = await db.tx(async (t) => {
    const tid = await t.insert("INSERT INTO toewijzingen (voertuig_id, bestuurder_id, extern_naam, soort, vestiging_id, van, tot, reden, opmerking) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [v.id, b ? b.id : null, b ? null : f.extern_naam, f.soort, b ? b.vestiging_id : v.vestiging_id, f.van, f.tot, f.reden, f.opmerking]);
    await t.run("UPDATE voertuigen SET status = $2, updated_at = local_now() WHERE id = $1", [v.id, f.soort === "vast" ? "actief" : "uitgeleend"]);
    if (f.km !== null) await t.run("INSERT INTO kilometerstanden (voertuig_id, stand, datum, bron, user_id) VALUES ($1,$2,$3,'beheerder',$4)", [v.id, Math.round(f.km), f.van, req.user.id]);
    if (b) await t.run("UPDATE wachtlijst SET status = 'gekoppeld', voertuig_id = $2 WHERE bestuurder_id = $1 AND status = 'open'", [b.id, v.id]);
    await log(v.id, b ? b.id : null, req.user.id, "toewijzing", `${f.soort === "vast" ? "Toegewezen" : "Uitgeleend"} aan ${wie} per ${formatDate(f.van)}${f.tot ? " tot " + formatDate(f.tot) : ""} door ${req.user.name}`, t);
    return tid;
  });
  if (f.soort === "vast") {
    await processen.start({ voertuigId: v.id, soort: "uitgifte", userId: req.user.id, toewijzingId: id, klaar: ["toewijzen"] });
    res.flash(`${v.kenteken} toegewezen aan ${wie}. Loop nu de uitgifte-checklist door.`);
    const p = await db.one("SELECT id FROM processen WHERE toewijzing_id = $1", [id]);
    return res.redirect(p ? `/processen/${p.id}` : `/voertuigen/${v.id}`);
  }
  if (b && b.email) await mail.send({ to: b.email, subject: `Leenauto ${v.kenteken} tot ${formatDate(f.tot)}`, soort: "uitleen", ref: `uitleen_start:${id}`, html: mail.layout({ titel: "Je hebt een leenauto", regels: [["Auto", autoNaam(v)], ["Van", formatDate(f.van)], ["Tot", formatDate(f.tot)], ...(f.opmerking ? [["Opmerking", f.opmerking]] : [])], knop: { tekst: "Naar Mijn auto", url: `${mail.baseUrl()}/mijn-auto` }, slot: "Lever de auto netjes en met volle tank in. Langer nodig? Vraag in Mijn auto meer tijd aan." }) });
  res.flash(`${v.kenteken} uitgeleend aan ${wie} tot ${formatDate(f.tot)}.`);
  res.redirect(`/voertuigen/${v.id}`);
});

// ---- Innemen ----
router.get("/innemen", auth.requireRole("beheerder"), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [Number(req.query.voertuig) || 0]);
  if (!v) return next();
  const actief = await db.one("SELECT t.*, b.naam AS bestuurder FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.voertuig_id = $1 AND t.status = 'actief' ORDER BY t.soort = 'uitleen' DESC LIMIT 1", [v.id]);
  if (!actief) { res.flash("Deze auto staat op niemands naam.", "error"); return res.redirect(`/voertuigen/${v.id}`); }
  const km = await db.one("SELECT stand FROM kilometerstanden WHERE voertuig_id = $1 ORDER BY datum DESC, id DESC LIMIT 1", [v.id]);
  res.render("uitleen/innemen", { title: "Innemen", v, actief, km, vandaag: today() });
});
router.post("/innemen", auth.requireRole("beheerder"), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [Number(req.body.voertuig_id) || 0]);
  if (!v) return next();
  const actief = await db.one("SELECT t.*, b.naam AS bestuurder, b.email AS bestuurder_email FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.id = $1 AND t.voertuig_id = $2 AND t.status = 'actief'", [Number(req.body.toewijzing_id) || 0, v.id]);
  if (!actief) { res.flash("Deze toewijzing is al gesloten.", "error"); return res.redirect(`/voertuigen/${v.id}`); }
  const datum = cleanDate(req.body.datum) || today();
  const km = cleanNumber(req.body.km);
  const opmerking = clean(req.body.opmerking);
  const wie = actief.bestuurder || actief.extern_naam || "onbekend";
  if (km !== null) await db.run("INSERT INTO kilometerstanden (voertuig_id, stand, datum, bron, user_id) VALUES ($1,$2,$3,'beheerder',$4)", [v.id, Math.round(km), datum, req.user.id]);

  // Leenauto, of "direct afsluiten": nu sluiten, geen checklist
  if (actief.soort === "uitleen" || yes(req.body.direct)) {
    await db.tx(async (t) => {
      await t.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now(), tot = $2, opmerking = COALESCE($3, opmerking) WHERE id = $1", [actief.id, datum, opmerking]);
      const nog = await t.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND status = 'actief'", [v.id]);
      await t.run("UPDATE voertuigen SET status = $2, updated_at = local_now() WHERE id = $1", [v.id, nog ? "uitgeleend" : "op_voorraad"]);
      await t.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE status = 'open' AND sleutel LIKE $1", [`uitleen_telaat:${actief.id}:%`, req.user.id]);
      await log(v.id, actief.bestuurder_id, req.user.id, "inname", `Ingenomen van ${wie} op ${formatDate(datum)} door ${req.user.name}${opmerking ? ": " + opmerking : ""}`, t);
    });
    if (actief.soort === "vast") {
      const hr = await mail.hr();
      await mail.send({ to: hr, subject: `Inname: ${v.kenteken || v.merk} van ${wie}`, soort: "inname", ref: `inname_direct:${actief.id}`, html: mail.layout({ titel: "Bedrijfsauto ingenomen", intro: "Ter informatie voor de salarisadministratie.", regels: [["Bestuurder", wie], ["Auto", autoNaam(v)], ["Ingenomen op", formatDate(datum)], ...(opmerking ? [["Opmerking", opmerking]] : [])] }) });
    }
    res.flash(`${v.kenteken} ingenomen van ${wie}. De auto staat weer op voorraad.`);
    return res.redirect(`/voertuigen/${v.id}`);
  }
  // Vaste auto: inleverdatum vastleggen en de inname-checklist starten
  await db.run("UPDATE toewijzingen SET tot = $2, opmerking = COALESCE($3, opmerking) WHERE id = $1", [actief.id, datum, opmerking]);
  await log(v.id, actief.bestuurder_id, req.user.id, "inname", `Inleverdatum ${formatDate(datum)} vastgelegd voor ${wie} door ${req.user.name}`);
  const pid = await processen.start({ voertuigId: v.id, soort: "inname", userId: req.user.id, toewijzingId: actief.id, klaar: ["inleverdatum"] });
  res.flash(`Inleverdatum ${formatDate(datum)} vastgelegd. Loop de inname-checklist door; bij de laatste stap gaat de auto terug op voorraad.`);
  res.redirect(`/processen/${pid}`);
});

// ---- Leenverzoek doen (iedereen die is ingelogd) ----
router.get("/aanvragen", async (req, res) => {
  const l = await lookups();
  const voertuig = Number(req.query.voertuig) ? l.vrij.find((v) => v.id === Number(req.query.voertuig)) : null;
  res.render("uitleen/aanvragen", { title: "Leenauto aanvragen", voertuig, vrij: l.vrij, vestigingen: l.vestigingen, bestuurders: res.locals.can("beheerder") ? l.bestuurders : [], form: { van: today(), tot: taken.addDays(today(), 1) } });
});
router.post("/aanvragen", async (req, res) => {
  const f = { voertuig_id: Number(req.body.voertuig_id) || null, van: cleanDate(req.body.van), tot: cleanDate(req.body.tot), reden: clean(req.body.reden), vestiging_id: Number(req.body.vestiging_id) || null, extern_naam: clean(req.body.extern_naam), bestuurder_id: Number(req.body.bestuurder_id) || null };
  if (!f.van || !f.tot || f.tot < f.van) { res.flash("Vul een geldige periode in.", "error"); return res.redirect("/uitleen/aanvragen"); }
  if (!f.reden) { res.flash("Geef kort aan waarvoor je de auto nodig hebt.", "error"); return res.redirect("/uitleen/aanvragen"); }
  // Voor wie: de ingelogde bestuurder, of (beheerder) een collega of externe
  let aanvragerB = req.bestuurder ? req.bestuurder.id : null;
  if (res.locals.can("beheerder") && f.bestuurder_id) aanvragerB = f.bestuurder_id;
  if (res.locals.can("beheerder") && f.extern_naam) aanvragerB = null;
  const v = f.voertuig_id ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [f.voertuig_id]) : null;
  const vestiging = f.vestiging_id || (v && v.vestiging_id) || (req.bestuurder && req.bestuurder.vestiging_id) || null;
  const id = await db.insert("INSERT INTO leenverzoeken (voertuig_id, aanvrager_bestuurder_id, aanvrager_user_id, extern_naam, vestiging_id, van, tot, reden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [v ? v.id : null, aanvragerB, req.user.id, res.locals.can("beheerder") ? f.extern_naam : null, vestiging, f.van, f.tot, f.reden]);
  const wie = f.extern_naam && res.locals.can("beheerder") ? `${f.extern_naam} (extern)` : aanvragerB && aanvragerB !== (req.bestuurder || {}).id ? ((await db.one("SELECT naam FROM bestuurders WHERE id = $1", [aanvragerB])) || {}).naam : req.user.name;
  await log(v ? v.id : null, aanvragerB, req.user.id, "leenverzoek", `Leenverzoek van ${wie}: ${formatDate(f.van)} tot ${formatDate(f.tot)}, ${f.reden}`);
  await mail.send({ to: await mail.goedkeurders(vestiging), subject: `Leenverzoek van ${wie}${v ? ": " + v.kenteken : ""}`, soort: "leenverzoek", ref: `leenverzoek:${id}`, html: mail.layout({ titel: "Nieuw leenverzoek", regels: [["Wie", wie], ["Auto", v ? autoNaam(v) : "geen voorkeur"], ["Van", formatDate(f.van)], ["Tot", formatDate(f.tot)], ["Reden", f.reden]], knop: { tekst: "Goedkeuren of afwijzen", url: `${mail.baseUrl()}/uitleen/verzoeken/${id}` } }) });
  res.flash("Je verzoek is verstuurd. De celdirecteur keurt het goed of wijst het af; je krijgt een mail.");
  res.redirect(res.locals.can("directie") ? "/uitleen" : "/mijn-auto");
});

// ---- Verlengen: "vraag meer tijd aan" ----
router.post("/verlengen", async (req, res) => {
  const t = await db.one("SELECT t.*, v.kenteken, v.merk, v.model, v.vestiging_id AS v_vestiging FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.id = $1 AND t.status = 'actief' AND t.soort = 'uitleen'", [Number(req.body.toewijzing_id) || 0]);
  if (!t) { res.flash("Deze uitleen is niet (meer) actief.", "error"); return res.redirect("/mijn-auto"); }
  const own = req.bestuurder && t.bestuurder_id === req.bestuurder.id;
  if (!own && !res.locals.can("beheerder")) return res.status(403).send("Geen toegang.");
  const tot = cleanDate(req.body.tot); const reden = clean(req.body.reden);
  if (!tot || (t.tot && tot <= t.tot)) { res.flash("Kies een datum na de huidige retourdatum.", "error"); return res.redirect(own ? "/mijn-auto" : `/voertuigen/${t.voertuig_id}`); }
  const id = await db.insert("INSERT INTO leenverzoeken (voertuig_id, aanvrager_bestuurder_id, aanvrager_user_id, vestiging_id, van, tot, reden, soort, toewijzing_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'verlenging',$8)", [t.voertuig_id, t.bestuurder_id, req.user.id, t.v_vestiging, t.tot, tot, reden, t.id]);
  await log(t.voertuig_id, t.bestuurder_id, req.user.id, "leenverzoek", `Verlenging gevraagd tot ${formatDate(tot)}${reden ? ": " + reden : ""}`);
  await mail.send({ to: await mail.goedkeurders(t.v_vestiging), subject: `Verlenging leenauto ${t.kenteken} tot ${formatDate(tot)}`, soort: "leenverzoek", ref: `leenverzoek:${id}`, html: mail.layout({ titel: "Verzoek om meer tijd", regels: [["Wie", req.user.name], ["Auto", autoNaam(t)], ["Nu tot", formatDate(t.tot)], ["Gevraagd tot", formatDate(tot)], ["Reden", reden || "–"]], knop: { tekst: "Goedkeuren of afwijzen", url: `${mail.baseUrl()}/uitleen/verzoeken/${id}` } }) });
  res.flash("Verzoek om meer tijd verstuurd. Je krijgt een mail zodra een beheerder heeft besloten.");
  res.redirect(own && !res.locals.can("directie") ? "/mijn-auto" : `/voertuigen/${t.voertuig_id}`);
});

// ---- Verzoek bekijken en beslissen ----
async function laadVerzoek(id) {
  return db.one(`SELECT l.*, v.kenteken, v.merk, v.model, v.status AS voertuig_status, COALESCE(b.naam, l.extern_naam, u.name) AS wie, b.email AS wie_email, u.email AS aanvrager_email, ve.naam AS vestiging, d.name AS besloten_door_naam, t.tot AS huidige_tot
    FROM leenverzoeken l LEFT JOIN voertuigen v ON v.id = l.voertuig_id LEFT JOIN bestuurders b ON b.id = l.aanvrager_bestuurder_id LEFT JOIN users u ON u.id = l.aanvrager_user_id LEFT JOIN vestigingen ve ON ve.id = l.vestiging_id LEFT JOIN users d ON d.id = l.besloten_door LEFT JOIN toewijzingen t ON t.id = l.toewijzing_id
    WHERE l.id = $1`, [id]);
}
router.get("/verzoeken/:id", async (req, res, next) => {
  const l = await laadVerzoek(req.params.id);
  if (!l) return next();
  const own = l.aanvrager_user_id === req.user.id || (req.bestuurder && l.aanvrager_bestuurder_id === req.bestuurder.id);
  if (!own && !res.locals.can("directie")) return res.status(403).render("error", { title: "Geen toegang", message: "Dit verzoek is niet van jou." });
  const vrij = await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status = 'op_voorraad' ORDER BY ve.volgorde NULLS LAST, v.merk");
  res.render("uitleen/verzoek", { title: "Leenverzoek", l, vrij });
});
router.post("/verzoeken/:id/goedkeuren", auth.requireCeldirecteur, async (req, res, next) => {
  const l = await laadVerzoek(req.params.id);
  if (!l) return next();
  if (l.status !== "open") { res.flash("Dit verzoek is al beantwoord.", "error"); return res.redirect(`/uitleen/verzoeken/${l.id}`); }
  const antwoord = clean(req.body.antwoord);
  const mailTo = [l.wie_email, l.aanvrager_email];
  if (l.soort === "verlenging") {
    await db.tx(async (t) => {
      await t.run("UPDATE toewijzingen SET tot = $2 WHERE id = $1 AND status = 'actief'", [l.toewijzing_id, l.tot]);
      await t.run("UPDATE leenverzoeken SET status = 'goedgekeurd', besloten_door = $2, besloten_op = local_now(), antwoord = $3 WHERE id = $1", [l.id, req.user.id, antwoord]);
      await t.run("UPDATE taken SET status = 'vervallen', afgerond_op = local_now() WHERE status = 'open' AND sleutel LIKE $1", [`uitleen_telaat:${l.toewijzing_id}:%`]);
      await log(l.voertuig_id, l.aanvrager_bestuurder_id, req.user.id, "leenverzoek", `Verlenging tot ${formatDate(l.tot)} goedgekeurd door ${req.user.name}`, t);
    });
    await mail.send({ to: mailTo, subject: `Verlenging goedgekeurd: ${l.kenteken} tot ${formatDate(l.tot)}`, soort: "leenverzoek", ref: `leenverzoek_besluit:${l.id}`, html: mail.layout({ titel: "Je mag de auto langer houden", regels: [["Auto", autoNaam(l)], ["Nieuwe retourdatum", formatDate(l.tot)], ["Besloten door", req.user.name], ...(antwoord ? [["Opmerking", antwoord]] : [])] }) });
    res.flash("Verlenging goedgekeurd.");
    return res.redirect("/uitleen");
  }
  const voertuigId = Number(req.body.voertuig_id) || l.voertuig_id;
  const v = voertuigId ? await db.one("SELECT * FROM voertuigen WHERE id = $1", [voertuigId]) : null;
  if (!v) { res.flash("Kies een auto die op voorraad staat.", "error"); return res.redirect(`/uitleen/verzoeken/${l.id}`); }
  if (v.status !== "op_voorraad") { res.flash(`${v.kenteken} is niet (meer) op voorraad.`, "error"); return res.redirect(`/uitleen/verzoeken/${l.id}`); }
  const tid = await db.tx(async (t) => {
    const id = await t.insert("INSERT INTO toewijzingen (voertuig_id, bestuurder_id, extern_naam, soort, vestiging_id, van, tot, reden) VALUES ($1,$2,$3,'uitleen',$4,$5,$6,$7)", [v.id, l.aanvrager_bestuurder_id, l.aanvrager_bestuurder_id ? null : l.wie, l.vestiging_id || v.vestiging_id, l.van, l.tot, l.reden]);
    await t.run("UPDATE voertuigen SET status = 'uitgeleend', updated_at = local_now() WHERE id = $1", [v.id]);
    await t.run("UPDATE leenverzoeken SET status = 'goedgekeurd', besloten_door = $2, besloten_op = local_now(), toewijzing_id = $3, voertuig_id = $4, antwoord = $5 WHERE id = $1", [l.id, req.user.id, id, v.id, antwoord]);
    await log(v.id, l.aanvrager_bestuurder_id, req.user.id, "toewijzing", `Leenverzoek van ${l.wie} goedgekeurd door ${req.user.name}: ${formatDate(l.van)} tot ${formatDate(l.tot)}`, t);
    return id;
  });
  await mail.send({ to: mailTo, subject: `Leenauto goedgekeurd: ${v.kenteken} van ${formatDate(l.van)} tot ${formatDate(l.tot)}`, soort: "leenverzoek", ref: `leenverzoek_besluit:${l.id}`, html: mail.layout({ titel: "Je leenverzoek is goedgekeurd", regels: [["Auto", autoNaam(v)], ["Van", formatDate(l.van)], ["Tot", formatDate(l.tot)], ["Besloten door", req.user.name], ["Sleutel", antwoord || "Haal de sleutel op bij de vestiging."]], knop: { tekst: "Naar Mijn auto", url: `${mail.baseUrl()}/mijn-auto` }, slot: "Lever de auto netjes en met volle tank in. Langer nodig? Vraag in Mijn auto meer tijd aan." }) });
  res.flash(`Goedgekeurd: ${v.kenteken} is uitgeleend aan ${l.wie} tot ${formatDate(l.tot)}.`);
  res.redirect("/uitleen");
});
router.post("/verzoeken/:id/afwijzen", auth.requireCeldirecteur, async (req, res, next) => {
  const l = await laadVerzoek(req.params.id);
  if (!l) return next();
  if (l.status !== "open") { res.flash("Dit verzoek is al beantwoord.", "error"); return res.redirect(`/uitleen/verzoeken/${l.id}`); }
  const antwoord = clean(req.body.antwoord);
  await db.run("UPDATE leenverzoeken SET status = 'afgewezen', besloten_door = $2, besloten_op = local_now(), antwoord = $3 WHERE id = $1", [l.id, req.user.id, antwoord]);
  await log(l.voertuig_id, l.aanvrager_bestuurder_id, req.user.id, "leenverzoek", `${l.soort === "verlenging" ? "Verlenging" : "Leenverzoek"} van ${l.wie} afgewezen door ${req.user.name}${antwoord ? ": " + antwoord : ""}`);
  await mail.send({ to: [l.wie_email, l.aanvrager_email], subject: `${l.soort === "verlenging" ? "Verlenging" : "Leenverzoek"} afgewezen${l.kenteken ? ": " + l.kenteken : ""}`, soort: "leenverzoek", ref: `leenverzoek_besluit:${l.id}`, html: mail.layout({ titel: `Je ${l.soort === "verlenging" ? "verzoek om meer tijd" : "leenverzoek"} is afgewezen`, regels: [["Periode", `${formatDate(l.van)} tot ${formatDate(l.tot)}`], ["Besloten door", req.user.name], ["Reden", antwoord || "–"]], slot: "Vragen? Neem contact op met wagenparkbeheer van je vestiging." }) });
  res.flash("Verzoek afgewezen.");
  res.redirect("/uitleen");
});

module.exports = { router };
