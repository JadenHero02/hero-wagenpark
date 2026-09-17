// src/routes/dashboard.js
// Het dashboard van de beheerder: bovenaan wat er vandaag moet gebeuren (elke regel één knop), dan wat er de komende weken
// aankomt, dan vier stuurgetallen en de snelle acties. Opent op de eigen vestiging, met een schakelaar naar alle vestigingen.
// Een bestuurder zonder beheerdersrol komt op Mijn auto.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const taken = require("../taken");
const h = require("../helpers");

const router = express.Router();

router.get("/", async (req, res) => {
  if (!res.locals.can("directie")) return res.redirect("/mijn-auto");
  const vestigingen = await db.all("SELECT * FROM vestigingen ORDER BY volgorde");
  // Opent op de eigen vestiging (plan, hoofdstuk 4); ?vestiging=alle of een ander id via de schakelaar
  const q = req.query.vestiging;
  const vId = q === "alle" ? null : Number(q) || (q === undefined ? req.user.vestiging_id || null : null);
  const where = vId ? "AND v.vestiging_id = $1" : "";
  const params = vId ? [vId] : [];
  const today = taken.nlNow().date;

  // ---- Stuurgetallen ----
  const counts = await db.one(`
    SELECT COUNT(*) FILTER (WHERE v.status = 'actief') AS actief, COUNT(*) FILTER (WHERE v.status = 'uitgeleend') AS uitgeleend,
           COUNT(*) FILTER (WHERE v.status = 'op_voorraad') AS op_voorraad, COUNT(*) FILTER (WHERE v.status = 'besteld') AS besteld,
           COUNT(*) FILTER (WHERE v.status <> 'archief') AS totaal,
           COUNT(*) FILTER (WHERE v.kenteken IS NOT NULL AND v.status IN ('actief','uitgeleend','op_voorraad')) AS met_kenteken,
           COUNT(*) FILTER (WHERE v.kenteken IS NOT NULL AND v.status IN ('actief','uitgeleend','op_voorraad') AND v.apk_vervaldatum >= current_date) AS apk_ok,
           COUNT(*) FILTER (WHERE v.status IN ('actief','uitgeleend')) AS rijdend,
           COUNT(*) FILTER (WHERE v.kenteken IS NOT NULL AND v.status IN ('actief','uitgeleend','op_voorraad') AND EXISTS (SELECT 1 FROM documenten d WHERE d.voertuig_id = v.id AND d.soort = 'kentekenbewijs')) AS doc_ok
    FROM voertuigen v WHERE v.status <> 'archief' ${where}`, params);
  const perVestiging = await db.all("SELECT ve.naam, COUNT(v.id) AS n FROM vestigingen ve LEFT JOIN voertuigen v ON v.vestiging_id = ve.id AND v.status IN ('actief','uitgeleend','op_voorraad') GROUP BY ve.id, ve.naam, ve.volgorde ORDER BY ve.volgorde");
  // Open taken voor de beheerder (zelfde telling als de badge in het menu), en hoeveel daarvan over de deadline zijn
  const openTaken = await db.one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE t.deadline < current_date) AS te_laat FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'open' AND t.voor = 'beheerder' ${vId ? "AND COALESCE(v.vestiging_id, b.vestiging_id) = $1" : ""}`, params);
  const leensnelheid = await db.one("SELECT COUNT(*) AS n, ROUND(AVG(EXTRACT(EPOCH FROM (besloten_op - created_at)) / 86400)::numeric, 1) AS dagen FROM leenverzoeken WHERE besloten_op IS NOT NULL AND created_at > current_date - 90");

  // ---- Vandaag voor jou: elke regel één knop ----
  const vandaag = [];
  const auto = (v) => `${v.merk} ${v.model || ""}`.trim();
  const rijd = (v) => (v.bestuurder ? " · " + v.bestuurder : "");
  const apk = await db.all(`
    SELECT v.id, v.kenteken, v.merk, v.model, v.apk_vervaldatum, v.apk_afspraak, b.naam AS bestuurder, (v.apk_vervaldatum - current_date) AS dagen
    FROM voertuigen v LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief' LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE v.status IN ('actief','uitgeleend','op_voorraad') AND v.apk_vervaldatum IS NOT NULL AND v.apk_vervaldatum < current_date + 30 ${where} ORDER BY v.apk_vervaldatum`, params);
  for (const a of apk) {
    if (a.apk_afspraak && a.apk_afspraak >= today) continue; // afspraak staat: geen actie vandaag
    const laat = a.dagen < 0;
    if (!laat && a.dagen > 7) continue; // tussen 7 en 30 dagen: komende periode
    vandaag.push({ icoon: laat ? "error" : "event", kleur: laat ? "rood" : "oranje", plaat: a.kenteken, tekst: `APK ${laat ? "verstreken" : "vervalt " + h.relativeDate(a.apk_vervaldatum)} · ${auto(a)}${rijd(a)}`, pill: laat ? { tekst: h.relativeDate(a.apk_vervaldatum).replace("geleden", "te laat"), klasse: "bad" } : null, knop: { url: `/voertuigen/${a.id}/apk`, tekst: a.apk_afspraak ? "Rapport?" : "Afspraak" }, voertuigId: a.id });
  }
  const verzoeken = await db.all(`SELECT l.*, v.kenteken, COALESCE(b.naam, l.extern_naam, u.name) AS wie FROM leenverzoeken l LEFT JOIN voertuigen v ON v.id = l.voertuig_id LEFT JOIN bestuurders b ON b.id = l.aanvrager_bestuurder_id LEFT JOIN users u ON u.id = l.aanvrager_user_id WHERE l.status = 'open' ${vId ? "AND (l.vestiging_id = $1 OR v.vestiging_id = $1)" : ""} ORDER BY l.created_at`, params);
  for (const l of verzoeken) vandaag.push({ icoon: "key", kleur: "oranje", plaat: l.kenteken, tekst: `${l.soort === "verlenging" ? "Verlenging gevraagd" : "Leenverzoek"} van ${l.wie} · ${h.formatDate(l.van)} – ${h.formatDate(l.tot)}${l.reden ? " · " + l.reden : ""}`, pill: { tekst: h.relativeDate(l.created_at), klasse: "warn" }, knop: { url: `/uitleen/verzoeken/${l.id}`, tekst: "Beoordelen" } });
  const rapporten = await db.all(`SELECT d.id, d.voertuig_id, v.kenteken, v.merk, v.model, d.created_at, u.name AS door FROM documenten d JOIN voertuigen v ON v.id = d.voertuig_id LEFT JOIN users u ON u.id = d.geupload_door WHERE d.soort = 'apk_rapport' AND d.goedgekeurd_op IS NULL ${where} ORDER BY d.created_at`, params);
  for (const r of rapporten) vandaag.push({ icoon: "verified", kleur: "oranje", plaat: r.kenteken, tekst: `APK-rapport te beoordelen · ${auto(r)}${r.door ? " · geüpload door " + r.door : ""}`, pill: { tekst: h.relativeDate(r.created_at), klasse: "warn" }, knop: { url: `/voertuigen/${r.voertuig_id}/documenten`, tekst: "Beoordelen" } });
  const teLaat = await db.all(`SELECT t.id AS toewijzing_id, v.id, v.kenteken, v.merk, v.model, t.tot, COALESCE(b.naam, t.extern_naam) AS wie, (current_date - t.tot) AS dagen FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'actief' AND t.soort = 'uitleen' AND t.tot < current_date ${where} ORDER BY t.tot`, params);
  for (const u of teLaat) vandaag.push({ icoon: "key_off", kleur: "rood", plaat: u.kenteken, tekst: `Leenauto niet terug · ${u.wie || "onbekend"} · zou ${h.formatDate(u.tot)} inleveren`, pill: { tekst: `${u.dagen} dagen`, klasse: "bad" }, knop: { url: `/uitleen/innemen?voertuig=${u.id}`, tekst: "Innemen" } });
  const boetes = await db.all(`SELECT b.id, b.status, b.bedrag, b.datum, v.kenteken, bs.naam AS bestuurder FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id LEFT JOIN bestuurders bs ON bs.id = b.bestuurder_id WHERE b.status IN ('nieuw','uitzondering_gevraagd') ${where} ORDER BY b.created_at`, params);
  if (req.isHr) for (const b of boetes) vandaag.push({ icoon: "receipt_long", kleur: "oranje", plaat: b.kenteken, tekst: `${b.status === "nieuw" ? "Boete nog niet in AFAS" : "Uitzondering op inhouden gevraagd"} · ${h.euro(b.bedrag) || "bedrag onbekend"} · ${b.bestuurder || "bestuurder onbekend"} · ${h.formatDate(b.datum)}`, pill: null, knop: { url: `/boetes/${b.id}`, tekst: b.status === "nieuw" ? "Afhandelen" : "Beoordelen" } });
  const incidenten = await db.all(`SELECT i.id, i.soort, i.datum, v.kenteken, b.naam AS bestuurder FROM incidenten i JOIN voertuigen v ON v.id = i.voertuig_id LEFT JOIN bestuurders b ON b.id = i.bestuurder_id WHERE i.status = 'gemeld' ${where} ORDER BY i.created_at`, params);
  for (const i of incidenten) vandaag.push({ icoon: "car_crash", kleur: "rood", plaat: i.kenteken, tekst: `${h.label("incident_soort", i.soort)} gemeld · ${i.bestuurder || ""} · ${h.formatDate(i.datum)}`, pill: null, knop: { url: `/incidenten/${i.id}`, tekst: "Oppakken" } });
  const nietVerzekerd = await db.all(`SELECT v.id, v.kenteken, v.merk, v.model FROM voertuigen v WHERE v.rdw_wam_verzekerd = false AND v.status <> 'archief' ${where} ORDER BY v.kenteken`, params);
  for (const n of nietVerzekerd) vandaag.push({ icoon: "gpp_bad", kleur: "rood", plaat: n.kenteken, tekst: `Volgens de RDW niet WA-verzekerd · ${auto(n)}`, pill: { tekst: "controleren", klasse: "bad" }, knop: { url: `/voertuigen/${n.id}`, tekst: "Bekijken" } });
  const takenNu = await db.all(`SELECT t.*, v.kenteken, (t.deadline - current_date) AS dagen FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'open' AND t.voor = 'beheerder' AND t.deadline <= current_date AND t.soort NOT IN ('apk','uitleen','incident') ${vId ? "AND COALESCE(v.vestiging_id, b.vestiging_id) = $1" : ""} ORDER BY t.deadline`, params);
  for (const t of takenNu) vandaag.push({ icoon: "task_alt", kleur: t.dagen < 0 ? "rood" : "oranje", plaat: t.kenteken, tekst: t.titel, pill: { tekst: t.dagen < 0 ? h.relativeDate(t.deadline).replace("geleden", "te laat") : "vandaag", klasse: t.dagen < 0 ? "bad" : "warn" }, knop: { url: `/taken`, tekst: "Afronden" } });
  // Bandenwissel: alleen in het seizoen (twee weken vóór tot zes weken na de wisseldatum), als voortgang
  let banden = null;
  for (const [seizoen, key, fallback] of [["winter", "bandenwissel_winter", "10-01"], ["zomer", "bandenwissel_zomer", "04-01"]]) {
    const datum = `${today.slice(0, 4)}-${await taken.setting(key, fallback)}`;
    const dagen = h.daysUntil(datum);
    if (dagen > 14 || dagen < -42) continue;
    const sz = `${today.slice(0, 4)}-${seizoen}`;
    const r = await db.one(`SELECT COUNT(*) AS totaal, COUNT(*) FILTER (WHERE bw.gewisseld) AS klaar FROM voertuigen v LEFT JOIN bandenwissels bw ON bw.voertuig_id = v.id AND bw.seizoen = $${params.length + 1} WHERE v.status IN ('actief','uitgeleend') AND v.banden = 'winter_zomer' ${where}`, [...params, sz]);
    banden = { seizoen, datum, totaal: r.totaal, klaar: r.klaar };
  }
  if (banden) vandaag.push({ icoon: "ac_unit", kleur: "blauw", plaat: null, tekst: `${banden.seizoen === "winter" ? "Winterbanden" : "Zomerbanden"} laten monteren · ${banden.klaar} van ${banden.totaal} auto's gedaan`, pill: { tekst: `rond ${h.formatDate(banden.datum)}`, klasse: "" }, knop: { url: `/taken?soort=banden`, tekst: "Wie nog" } });

  // ---- Komende weken ----
  const komend = [];
  for (const a of apk) {
    if (a.dagen <= 7 || a.dagen < 0) continue;
    komend.push({ icoon: "event", plaat: a.kenteken, tekst: `APK vervalt ${h.formatDate(a.apk_vervaldatum)} · ${auto(a)}${rijd(a)}${a.apk_afspraak ? " · afspraak " + h.formatDate(a.apk_afspraak) : ""}`, wanneer: h.relativeDate(a.apk_vervaldatum), url: `/voertuigen/${a.id}/apk`, sort: a.apk_vervaldatum });
  }
  const retour = await db.all(`SELECT v.id, v.kenteken, v.merk, v.model, t.tot, COALESCE(b.naam, t.extern_naam) AS wie FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'actief' AND t.soort = 'uitleen' AND t.tot >= current_date AND t.tot <= current_date + 7 ${where} ORDER BY t.tot`, params);
  for (const r of retour) komend.push({ icoon: "key", plaat: r.kenteken, tekst: `Leenauto terug van ${r.wie || "onbekend"} · ${auto(r)}`, wanneer: h.relativeDate(r.tot), url: `/uitleen`, sort: r.tot });
  const takenWeek = await db.all(`SELECT t.*, v.kenteken FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'open' AND t.voor = 'beheerder' AND t.deadline > current_date AND t.deadline <= current_date + 14 AND t.soort NOT IN ('apk','uitleen','incident') ${vId ? "AND COALESCE(v.vestiging_id, b.vestiging_id) = $1" : ""} ORDER BY t.deadline`, params);
  for (const t of takenWeek) komend.push({ icoon: "task_alt", plaat: t.kenteken, tekst: t.titel, wanneer: h.relativeDate(t.deadline), url: "/taken", sort: t.deadline });
  const contracten = await db.all(`SELECT v.id, v.kenteken, v.merk, v.model, v.contract_einde, v.leasemaatschappij FROM voertuigen v WHERE v.status <> 'archief' AND v.contract_einde IS NOT NULL AND v.contract_einde BETWEEN current_date AND current_date + 90 ${where} ORDER BY v.contract_einde`, params);
  for (const c of contracten) komend.push({ icoon: "description", plaat: c.kenteken, tekst: `Contract eindigt · ${auto(c)}${c.leasemaatschappij ? " · " + c.leasemaatschappij : ""}`, wanneer: h.relativeDate(c.contract_einde), url: `/voertuigen/${c.id}`, sort: c.contract_einde });
  const rijbewijzen = await db.all(`SELECT b.id, b.naam, b.rijbewijs_geldig_tot FROM bestuurders b WHERE b.actief AND b.rijbewijs_geldig_tot IS NOT NULL AND b.rijbewijs_geldig_tot BETWEEN current_date - 30 AND current_date + 90 ${vId ? "AND b.vestiging_id = $1" : ""} ORDER BY b.rijbewijs_geldig_tot`, params);
  for (const r of rijbewijzen) komend.push({ icoon: "badge", plaat: null, tekst: `Rijbewijs van ${r.naam} ${h.daysUntil(r.rijbewijs_geldig_tot) < 0 ? "is verlopen" : "verloopt"}`, wanneer: h.relativeDate(r.rijbewijs_geldig_tot), url: `/bestuurders/${r.id}`, sort: r.rijbewijs_geldig_tot });
  const wachtlijst = await db.all(`SELECT w.id, w.naam, w.datum_aanvraag, w.gewenste_auto, (current_date - w.datum_aanvraag) AS dagen FROM wachtlijst w WHERE w.status = 'open' ${vId ? "AND w.vestiging_id = $1" : ""} ORDER BY w.datum_aanvraag`, params);
  for (const w of wachtlijst) komend.push({ icoon: "hourglass_top", plaat: null, tekst: `${w.naam} wacht op een auto${w.gewenste_auto ? " · " + w.gewenste_auto : ""}`, wanneer: w.dagen !== null ? `al ${w.dagen} dagen` : "", url: "/wachtlijst", sort: "0000" });
  const besteld = await db.all(`SELECT v.id, v.merk, v.model, v.verwachte_levering, v.notitie FROM voertuigen v WHERE v.status = 'besteld' ${where} ORDER BY v.verwachte_levering NULLS LAST, v.id`, params);
  komend.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));

  const milieu = await db.all(`SELECT COALESCE(v.milieu, 'onbekend') AS milieu, COUNT(*) AS n FROM voertuigen v WHERE v.status IN ('actief','uitgeleend','op_voorraad') ${where} GROUP BY 1 ORDER BY n DESC`, params);
  const vestigingNaam = vId ? (vestigingen.find((v) => v.id === vId) || {}).naam : null;
  res.render("dashboard/index", { title: "Dashboard", vestigingen, vId, vestigingNaam, counts, perVestiging, openTaken, leensnelheid, vandaag, komend, besteld });
});

// Mijn auto: de bestuurder op de telefoon. Voorlopig de kern; de rest volgt donderdag.
router.get("/mijn-auto", async (req, res) => {
  // Meekijken: de admin ziet Mijn auto zoals een bestuurder het ziet (?als=<bestuurder-id>), om te controleren wat iemand te zien krijgt
  const als = res.locals.can("admin") && Number(req.query.als) ? await db.one("SELECT * FROM bestuurders WHERE id = $1", [Number(req.query.als)]) : null;
  const b = als || req.bestuurder;
  const autos = b ? await db.all(`
    SELECT v.*, t.id AS toewijzing_id, t.soort AS toewijzing_soort, t.van, t.tot, ve.naam AS vestiging,
      (SELECT stand FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_stand,
      (SELECT datum FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_datum
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    WHERE t.bestuurder_id = $1 AND t.status = 'actief' ORDER BY t.soort, t.van DESC`, [b.id]) : [];
  const garages = await db.all("SELECT * FROM contacten WHERE soort = 'garage' ORDER BY naam");
  const ids = autos.map((v) => v.id);
  const taken = b ? await db.all("SELECT t.*, v.kenteken FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.status = 'open' AND t.voor = 'bestuurder' AND (t.bestuurder_id = $1 OR t.voertuig_id = ANY($2::int[])) ORDER BY t.deadline NULLS LAST", [b.id, ids]) : [];
  const boetes = b ? await db.all("SELECT b.*, v.kenteken FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id WHERE b.bestuurder_id = $1 ORDER BY b.datum DESC LIMIT 10", [b.id]) : [];
  const verzoeken = await db.all("SELECT l.*, v.kenteken FROM leenverzoeken l LEFT JOIN voertuigen v ON v.id = l.voertuig_id WHERE (l.aanvrager_user_id = $1 OR l.aanvrager_bestuurder_id = $2) AND (l.status = 'open' OR l.besloten_op > local_now() - interval '14 days') ORDER BY l.created_at DESC LIMIT 5", [req.user.id, b ? b.id : 0]);
  const incidenten = b ? await db.all("SELECT i.*, v.kenteken FROM incidenten i JOIN voertuigen v ON v.id = i.voertuig_id WHERE i.bestuurder_id = $1 AND i.status <> 'afgerond' ORDER BY i.datum DESC LIMIT 5", [b.id]) : [];
  const documenten = ids.length ? await db.all("SELECT d.* FROM documenten d WHERE d.voertuig_id = ANY($1::int[]) ORDER BY d.created_at DESC LIMIT 5", [ids]) : [];
  // Wie bel je waarvoor: celdirecteur en wagenparkbeheer van de vestiging, verzekeraar, en de garage per merk (bij de auto)
  const vestigingId = (autos[0] && autos[0].vestiging_id) || (b && b.vestiging_id) || null;
  const contacten = await db.all("SELECT c.*, ve.naam AS vestiging FROM contacten c LEFT JOIN vestigingen ve ON ve.id = c.vestiging_id WHERE c.soort IN ('celdirecteur','wagenparkbeheer','verzekeraar','tankpas') AND (c.vestiging_id IS NULL OR c.vestiging_id = $1) ORDER BY CASE c.soort WHEN 'wagenparkbeheer' THEN 1 WHEN 'celdirecteur' THEN 2 WHEN 'verzekeraar' THEN 3 ELSE 4 END, c.naam", [vestigingId]);
  const vrij = await db.one("SELECT COUNT(*) AS n FROM voertuigen WHERE status = 'op_voorraad'");
  res.render("mijn-auto", { title: "Mijn auto", autos, garages, taken, boetes, verzoeken, incidenten, documenten, contacten, vrij: vrij.n, meekijken: als });
});

// Over deze auto: de gegevens van de auto voor de bestuurder, uit de RDW en de app. Alleen de eigen auto, of als beheerder/admin.
router.get("/mijn-auto/auto/:id", async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const als = res.locals.can("admin") && Number(req.query.als) ? await db.one("SELECT * FROM bestuurders WHERE id = $1", [Number(req.query.als)]) : null;
  const b = als || req.bestuurder;
  const v = await db.one("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.id = $1", [Number(req.params.id)]);
  if (!v) return next();
  const eigen = b ? await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [v.id, b.id]) : null;
  if (!eigen && !res.locals.can("directie")) return res.status(403).render("error", { title: "Geen toegang", message: "Je kunt alleen je eigen auto bekijken." });
  const garages = await db.all("SELECT * FROM contacten WHERE soort = 'garage' ORDER BY naam");
  const garage = garages.find((g) => g.merk && v.merk && g.merk.toLowerCase().includes(v.merk.toLowerCase().split(/[s-]/)[0])) || garages.find((g) => (g.merk || "").toLowerCase() === "alle") || null;
  res.render("mijn-auto-info", { title: `Over ${v.kenteken || v.merk}`, v, garage, meekijken: als });
});

module.exports = { router };
