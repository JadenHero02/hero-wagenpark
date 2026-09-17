// src/routes/voertuigen.js
// Het wagenpark: overzicht met zoeken en filters, voertuigdetail, nieuw en bewerken, kilometerstand, pincode tonen.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const pincode = require("../pincode");
const processen = require("../processen");
const taken = require("../taken");
const msauth = require("./msauth");
const rdw = require("../rdw");
const { clean, cleanNumber, cleanDate, yes, kenteken: fmtKenteken, formatDate, bouwjaarNorm, LABELS } = require("../helpers");

const router = express.Router();
// Alleen cijfers als id; anders valt het verzoek door naar de 404
router.param("id", (req, res, next, id) => (/^\d+$/.test(id) ? next() : next("route")));

async function lookups() {
  return { vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde"), LABELS };
}

// De lijst met zoekterm en filters, ook gebruikt door de Excel-export
async function zoekVoertuigen(query) {
  const q = clean(query.q);
  const f = { status: clean(query.status), vestiging: Number(query.vestiging) || null, milieu: clean(query.milieu), eigendom: clean(query.eigendom), km: clean(query.km), leen: clean(query.leen), sort: ["bouwjaar", "bouwjaar_desc", "apk", "km"].includes(query.sort) ? query.sort : null };
  const where = ["v.status <> 'archief'"]; const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };
  if (q) add("(v.kenteken ILIKE ? OR v.merk ILIKE ? OR v.model ILIKE ? OR b.naam ILIKE ? OR v.notitie ILIKE ?)".replace(/\?/g, `$${params.length + 1}`), `%${q}%`);
  if (f.status) add("v.status = ?", f.status);
  if (f.vestiging) add("v.vestiging_id = ?", f.vestiging);
  if (f.milieu) add("v.milieu = ?", f.milieu);
  if (f.eigendom) add("v.eigendom = ?", f.eigendom);
  if (f.leen) where.push("v.is_leenauto");
  if (f.km === "oud") where.push("v.status IN ('actief','uitgeleend') AND NOT EXISTS (SELECT 1 FROM kilometerstanden k WHERE k.voertuig_id = v.id AND k.datum > current_date - 60)");
  const rows = await db.all(`
    SELECT v.id, v.kenteken, v.merk, v.model, v.bouwjaar, v.status, v.milieu, v.eigendom, v.is_leenauto, v.apk_vervaldatum, v.notitie, v.banden,
           ve.naam AS vestiging, b.naam AS bestuurder, b.id AS bestuurder_id, t.soort AS toewijzing_soort, t.extern_naam,
           (SELECT stand FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_stand,
           (SELECT datum FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_datum
    FROM voertuigen v
    LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief'
    LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${f.sort === "bouwjaar" ? "v.bouwjaar NULLS LAST," : f.sort === "bouwjaar_desc" ? "v.bouwjaar DESC NULLS LAST," : f.sort === "apk" ? "v.apk_vervaldatum NULLS LAST," : f.sort === "km" ? "km_datum NULLS FIRST," : ""} CASE v.status WHEN 'actief' THEN 1 WHEN 'uitgeleend' THEN 2 WHEN 'op_voorraad' THEN 3 WHEN 'besteld' THEN 4 ELSE 5 END, ve.volgorde NULLS LAST, v.merk, v.kenteken`, params);
  return { rows, q, f };
}

// RDW: gegevens op kenteken (voor het formulier), één auto bijwerken, of alle auto's (admin)
router.get("/rdw/:kenteken.json", auth.requireRole("beheerder"), async (req, res) => {
  try {
    const g = await rdw.opvragen(req.params.kenteken);
    if (!g) return res.status(404).json({ fout: "Kenteken niet gevonden bij de RDW." });
    const bestaat = await db.one("SELECT id, kenteken FROM voertuigen WHERE regexp_replace(upper(kenteken), '[^A-Z0-9]', '', 'g') = $1", [g.kenteken]);
    res.json({ ...g, bestaat: bestaat ? { id: bestaat.id, kenteken: bestaat.kenteken } : null });
  } catch (err) { res.status(502).json({ fout: `De RDW is niet bereikbaar: ${err.message}` }); }
});
router.post("/rdw-alles", auth.requireRole("admin"), async (req, res) => {
  const u = await rdw.alles(req.user.id);
  res.flash(`RDW: ${u.gevonden} van ${u.totaal} kentekens gevonden, ${u.gewijzigd} auto's bijgewerkt${u.fouten ? `, ${u.fouten} fouten` : ""}.${u.regels.length ? " " + u.regels.slice(0, 6).join(" · ") + (u.regels.length > 6 ? " · ..." : "") : ""}`);
  res.redirect("/voertuigen");
});
router.post("/:id/rdw", auth.requireRole("beheerder"), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  if (!v.kenteken) { res.flash("Deze auto heeft nog geen kenteken.", "error"); return res.redirect(`/voertuigen/${v.id}`); }
  try {
    const r = await rdw.bijwerken(v, req.user.id);
    if (!r.gevonden) res.flash(`Kenteken ${v.kenteken} is niet bekend bij de RDW. Klopt het kenteken?`, "error");
    else res.flash(r.gewijzigd.length ? `Bijgewerkt vanuit de RDW: ${r.gewijzigd.join(", ")}.` : "RDW-gegevens opgehaald, alles klopte al.");
  } catch (err) { res.flash(`De RDW is niet bereikbaar: ${err.message}`, "error"); }
  res.redirect(`/voertuigen/${v.id}`);
});

// Overzicht
router.get("/", auth.requireRole("directie"), async (req, res) => {
  const { rows, q, f } = await zoekVoertuigen(req.query);
  const counts = await db.one("SELECT COUNT(*) FILTER (WHERE status = 'actief') AS actief, COUNT(*) FILTER (WHERE status = 'uitgeleend') AS uitgeleend, COUNT(*) FILTER (WHERE status = 'op_voorraad') AS op_voorraad, COUNT(*) FILTER (WHERE status = 'besteld') AS besteld FROM voertuigen");
  res.render("voertuigen/index", { title: "Wagenpark", rows, q, f, counts, exportQuery: new URLSearchParams(Object.entries(req.query).filter(([, v]) => v)).toString(), ...(await lookups()) });
});

// Nieuw
router.get("/nieuw", auth.requireRole("beheerder"), async (req, res) => {
  res.render("voertuigen/form", { title: "Nieuw voertuig", v: { status: "besteld", eigendom: "eigendom" }, ...(await lookups()) });
});

function fromBody(b) {
  return {
    kenteken: fmtKenteken(b.kenteken), merk: clean(b.merk) || "Onbekend", model: clean(b.model), bouwjaar: bouwjaarNorm(b.bouwjaar),
    eigendom: LABELS.eigendom[b.eigendom] ? b.eigendom : "onbekend", bijtelling: b.bijtelling === "" || b.bijtelling === undefined ? null : yes(b.bijtelling),
    milieu: clean(b.milieu), banden: clean(b.banden), status: LABELS.status[b.status] ? b.status : "op_voorraad", is_leenauto: yes(b.is_leenauto),
    vestiging_id: Number(b.vestiging_id) || null, apk_vervaldatum: cleanDate(b.apk_vervaldatum), contract_einde: cleanDate(b.contract_einde),
    leasemaatschappij: clean(b.leasemaatschappij), verwachte_levering: clean(b.verwachte_levering), tankpas_nummer: clean(b.tankpas_nummer),
    onderhoud_notitie: clean(b.onderhoud_notitie), schade_notitie: clean(b.schade_notitie), opmerkingen: clean(b.opmerkingen), notitie: clean(b.notitie),
  };
}
const COLS = ["kenteken","merk","model","bouwjaar","eigendom","bijtelling","milieu","banden","status","is_leenauto","vestiging_id","apk_vervaldatum","contract_einde","leasemaatschappij","verwachte_levering","tankpas_nummer","onderhoud_notitie","schade_notitie","opmerkingen","notitie"];

router.post("/", auth.requireRole("beheerder"), async (req, res) => {
  const v = fromBody(req.body);
  if (v.kenteken && await db.one("SELECT id FROM voertuigen WHERE upper(kenteken) = $1", [v.kenteken])) { res.flash(`Kenteken ${v.kenteken} bestaat al.`, "error"); return res.redirect("/voertuigen/nieuw"); }
  const pin = clean(req.body.tankpas_pincode);
  const id = await db.insert(`INSERT INTO voertuigen (${COLS.join(",")}, tankpas_pincode_enc) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")}, $${COLS.length + 1})`, [...COLS.map((c) => v[c]), pin ? pincode.encrypt(pin) : null]);
  await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1, $2, 'aangemaakt', $3)", [id, req.user.id, `Voertuig aangemaakt door ${req.user.name}`]);
  // Een bestelde auto begint met de instroom-checklist; stap 1 (aanmaken) is dan al gedaan
  if (v.status === "besteld") {
    const pid = await processen.start({ voertuigId: id, soort: "instroom", userId: req.user.id, klaar: ["aanmaken"] });
    res.flash("Voertuig aangemaakt. Loop de instroom-checklist door.");
    return res.redirect(`/processen/${pid}`);
  }
  res.flash("Voertuig aangemaakt.");
  res.redirect(`/voertuigen/${id}`);
});

// Detail
router.get("/:id", auth.requireRole("bestuurder"), async (req, res, next) => {
  const v = await db.one("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.id = $1", [req.params.id]);
  if (!v) return next();
  const toewijzingen = await db.all("SELECT t.*, b.naam AS bestuurder, b.id AS bestuurder_id FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.voertuig_id = $1 ORDER BY t.status = 'actief' DESC, t.van DESC NULLS LAST, t.id DESC", [v.id]);
  const actief = toewijzingen.find((t) => t.status === "actief");
  // Een bestuurder ziet alleen zijn eigen auto
  const isOwn = req.bestuurder && actief && actief.bestuurder_id === req.bestuurder.id;
  if (!res.locals.can("directie") && !isOwn) return res.status(403).render("error", { title: "Geen toegang", message: "Je kunt alleen je eigen auto bekijken." });
  const km = await db.all("SELECT k.*, u.name AS door FROM kilometerstanden k LEFT JOIN users u ON u.id = k.user_id WHERE k.voertuig_id = $1 ORDER BY k.datum DESC, k.id DESC LIMIT 6", [v.id]);
  const incidenten = await db.all("SELECT * FROM incidenten WHERE voertuig_id = $1 ORDER BY datum DESC LIMIT 5", [v.id]);
  const boetes = await db.all("SELECT * FROM boetes WHERE voertuig_id = $1 ORDER BY datum DESC LIMIT 5", [v.id]);
  const documenten = await db.all("SELECT d.*, u.name AS geupload_door_naam FROM documenten d LEFT JOIN users u ON u.id = d.geupload_door WHERE d.voertuig_id = $1 ORDER BY d.created_at DESC", [v.id]);
  const openTaken = await db.all("SELECT * FROM taken WHERE voertuig_id = $1 AND status = 'open' ORDER BY deadline NULLS LAST", [v.id]);
  const logboek = await db.all("SELECT l.*, u.name AS door FROM logboek l LEFT JOIN users u ON u.id = l.user_id WHERE l.voertuig_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 10", [v.id]);
  const bandenwissels = await db.all("SELECT * FROM bandenwissels WHERE voertuig_id = $1 ORDER BY seizoen DESC", [v.id]);
  const garage = v.merk ? await db.one("SELECT * FROM contacten WHERE soort = 'garage' AND merk IS NOT NULL AND (lower(merk) LIKE '%' || lower($1) || '%') ORDER BY id LIMIT 1", [v.merk.split(/[s-]/)[0]]) : null;
  const lopend = await db.all("SELECT p.*, (SELECT COUNT(*) FROM processtappen s WHERE s.proces_id = p.id) AS totaal, (SELECT COUNT(*) FROM processtappen s WHERE s.proces_id = p.id AND s.afgevinkt_op IS NOT NULL) AS klaar FROM processen p WHERE p.voertuig_id = $1 AND p.afgerond_op IS NULL ORDER BY p.gestart_op DESC", [v.id]);
  const verzoeken = await db.all("SELECT l.*, COALESCE(b.naam, l.extern_naam, u.name) AS wie FROM leenverzoeken l LEFT JOIN bestuurders b ON b.id = l.aanvrager_bestuurder_id LEFT JOIN users u ON u.id = l.aanvrager_user_id WHERE l.voertuig_id = $1 AND l.status = 'open' ORDER BY l.created_at", [v.id]);
  res.render("voertuigen/show", { title: `${v.kenteken || "Besteld"} · ${v.merk} ${v.model || ""}`.trim(), v, toewijzingen, actief, km, incidenten, boetes, documenten, taken: openTaken, logboek, bandenwissels, garage, lopend, verzoeken, isOwn: Boolean(isOwn), NAMEN: processen.NAMEN, ...(await lookups()) });
});

// APK: afspraak vastleggen (beheerder of de bestuurder van deze auto). Daarna vraagt de app om het rapport.
async function magApk(req, res, v) {
  if (res.locals.can("beheerder")) return true;
  return Boolean(req.bestuurder && await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [v.id, req.bestuurder.id]));
}
router.get("/:id/apk", async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  if (!await magApk(req, res, v)) return res.status(403).render("error", { title: "Geen toegang", message: "Alleen de bestuurder van deze auto of een beheerder kan de APK-afspraak vastleggen." });
  const garage = await taken.garageVoor(v.merk);
  res.render("voertuigen/apk", { title: `APK · ${v.kenteken || v.merk}`, v, garage, mijn: !res.locals.can("directie") });
});
router.post("/:id/apk", async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  if (!await magApk(req, res, v)) return res.status(403).send("Geen toegang.");
  const back = res.locals.can("directie") ? `/voertuigen/${v.id}` : "/mijn-auto";
  if (yes(req.body.wissen) && res.locals.can("beheerder")) {
    await db.run("UPDATE voertuigen SET apk_afspraak = NULL, updated_at = local_now() WHERE id = $1", [v.id]);
    await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'apk',$3)", [v.id, req.user.id, `APK-afspraak gewist door ${req.user.name}`]);
    res.flash("APK-afspraak gewist.");
    return res.redirect(back);
  }
  const datum = cleanDate(req.body.apk_afspraak);
  if (!datum) { res.flash("Vul de datum van de afspraak in.", "error"); return res.redirect(`/voertuigen/${v.id}/apk`); }
  await db.run("UPDATE voertuigen SET apk_afspraak = $2, updated_at = local_now() WHERE id = $1", [v.id, datum]);
  await db.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE status = 'open' AND voertuig_id = $1 AND soort = 'apk'", [v.id, req.user.id]);
  await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1,$2,$3,'apk',$4)", [v.id, req.bestuurder ? req.bestuurder.id : null, req.user.id, `APK-afspraak op ${formatDate(datum)} vastgelegd door ${req.user.name}`]);
  res.flash(`APK-afspraak op ${formatDate(datum)} vastgelegd. Na die dag vraagt de app om het keuringsrapport.`);
  res.redirect(back);
});

// Bewerken
router.get("/:id/bewerken", auth.requireRole("beheerder"), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  res.render("voertuigen/form", { title: `Bewerken · ${v.kenteken || v.merk}`, v, ...(await lookups()) });
});
router.post("/:id", auth.requireRole("beheerder"), async (req, res, next) => {
  const cur = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!cur) return next();
  const v = fromBody(req.body);
  if (v.kenteken && await db.one("SELECT id FROM voertuigen WHERE upper(kenteken) = $1 AND id <> $2", [v.kenteken, cur.id])) { res.flash(`Kenteken ${v.kenteken} bestaat al bij een ander voertuig.`, "error"); return res.redirect(`/voertuigen/${cur.id}/bewerken`); }
  const sets = COLS.map((c, i) => `${c} = $${i + 2}`);
  const params = [cur.id, ...COLS.map((c) => v[c])];
  const pin = clean(req.body.tankpas_pincode);
  if (pin) { params.push(pincode.encrypt(pin)); sets.push(`tankpas_pincode_enc = $${params.length}`); }
  if (yes(req.body.tankpas_pincode_wissen)) sets.push("tankpas_pincode_enc = NULL");
  await db.run(`UPDATE voertuigen SET ${sets.join(", ")}, updated_at = local_now() WHERE id = $1`, params);
  const changed = COLS.filter((c) => String(cur[c] ?? "") !== String(v[c] ?? ""));
  if (changed.length || pin) await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1, $2, 'gewijzigd', $3)", [cur.id, req.user.id, `Gewijzigd door ${req.user.name}: ${[...changed, ...(pin ? ["pincode"] : [])].join(", ")}`]);
  res.flash("Opgeslagen.");
  res.redirect(`/voertuigen/${cur.id}`);
});

// Kilometerstand doorgeven (beheerder, of de bestuurder van deze auto)
router.post("/:id/kilometerstand", async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  const own = req.bestuurder && await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [v.id, req.bestuurder.id]);
  if (!res.locals.can("beheerder") && !own) return res.status(403).send("Geen toegang.");
  const stand = cleanNumber(req.body.stand);
  const datum = cleanDate(req.body.datum) || new Date().toISOString().slice(0, 10);
  const back = req.get("referer") && req.get("referer").includes("/mijn-auto") ? "/mijn-auto" : `/voertuigen/${v.id}`;
  if (stand === null || stand < 0) { res.flash("Vul een kilometerstand in.", "error"); return res.redirect(back); }
  const last = await db.one("SELECT stand FROM kilometerstanden WHERE voertuig_id = $1 ORDER BY datum DESC, id DESC LIMIT 1", [v.id]);
  if (last && stand < last.stand) { res.flash(`De stand (${stand}) is lager dan de vorige (${last.stand}). Klopt dat? Vraag de beheerder om te corrigeren.`, "error"); return res.redirect(back); }
  await db.run("INSERT INTO kilometerstanden (voertuig_id, stand, datum, bron, user_id) VALUES ($1, $2, $3, $4, $5)", [v.id, Math.round(stand), datum, own && !res.locals.can("beheerder") ? "bestuurder" : "beheerder", req.user.id]);
  await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1, $2, $3, 'kilometerstand', $4)", [v.id, req.bestuurder ? req.bestuurder.id : null, req.user.id, `Kilometerstand ${Math.round(stand).toLocaleString("nl-NL")} doorgegeven door ${req.user.name}`]);
  res.flash("Kilometerstand opgeslagen.");
  res.redirect(back);
});

// Pincode tonen: alleen admin, beheerder of de bestuurder van deze auto, na een extra bevestiging (opnieuw inloggen,
// geldig een paar minuten: instelling pincode_bevestiging_minuten). Elke keer gelogd.
async function pincodeTonen(req, res, next) {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  const own = req.bestuurder && await db.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND bestuurder_id = $2 AND status = 'actief'", [v.id, req.bestuurder.id]);
  if (!res.locals.can("beheerder") && !own) return res.status(403).render("error", { title: "Geen toegang", message: "De pincode is alleen zichtbaar voor de beheerder en de bestuurder van deze auto." });
  const back = own && !res.locals.can("directie") ? "/mijn-auto" : `/voertuigen/${v.id}`;
  if (!v.tankpas_pincode_enc) { res.flash("Er is geen pincode opgeslagen.", "error"); return res.redirect(back); }
  const minuten = Number(await taken.setting("pincode_bevestiging_minuten", "10")) || 10;
  const vers = await db.one("SELECT 1 FROM users WHERE id = $1 AND last_reauth_at > local_now() - ($2 || ' minutes')::interval", [req.user.id, String(minuten)]);
  if (!vers) {
    const next = `/voertuigen/${v.id}/pincode/tonen`;
    return res.render("voertuigen/pincode-bevestigen", { title: "Bevestig wie je bent", v, back, next, msLoginEnabled: msauth.isEnabled(), devLogin: msauth.devLoginEmail() });
  }
  const code = pincode.decrypt(v.tankpas_pincode_enc);
  await db.run("INSERT INTO logboek (voertuig_id, bestuurder_id, user_id, soort, omschrijving) VALUES ($1, $2, $3, 'pincode', $4)", [v.id, req.bestuurder ? req.bestuurder.id : null, req.user.id, `Pincode getoond aan ${req.user.name} na bevestiging`]);
  res.render("voertuigen/pincode", { title: "Pincode", v, code, back });
}
router.post("/:id/pincode", pincodeTonen);
router.get("/:id/pincode/tonen", pincodeTonen);

// Archiveren
router.post("/:id/archiveren", auth.requireRole("beheerder"), async (req, res, next) => {
  const v = await db.one("SELECT * FROM voertuigen WHERE id = $1", [req.params.id]);
  if (!v) return next();
  await db.tx(async (t) => {
    await t.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now() WHERE voertuig_id = $1 AND status = 'actief'", [v.id]);
    await t.run("UPDATE voertuigen SET status = 'archief', gearchiveerd_op = local_now(), updated_at = local_now() WHERE id = $1", [v.id]);
    await t.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1, $2, 'archief', $3)", [v.id, req.user.id, `Naar het archief gezet door ${req.user.name}`]);
  });
  res.flash("Voertuig gearchiveerd.");
  res.redirect("/voertuigen");
});

// Archief: ingeleverde en verkochte auto's, met alles erop en eraan (het detail blijft bereikbaar)
const archief = express.Router();
archief.get("/", auth.requireRole("directie"), async (req, res) => {
  const rows = await db.all(`SELECT v.*, ve.naam AS vestiging, (SELECT COALESCE(b.naam, t.extern_naam) FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.voertuig_id = v.id ORDER BY t.van DESC NULLS LAST, t.id DESC LIMIT 1) AS laatste_bestuurder,
      (SELECT stand FROM kilometerstanden k WHERE k.voertuig_id = v.id ORDER BY datum DESC, id DESC LIMIT 1) AS km_stand, (SELECT COUNT(*) FROM documenten d WHERE d.voertuig_id = v.id) AS documenten
    FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status = 'archief' ORDER BY v.gearchiveerd_op DESC NULLS LAST`);
  res.render("voertuigen/archief", { title: "Archief", rows });
});
archief.post("/:id/terug", auth.requireRole("admin"), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  await db.run("UPDATE voertuigen SET status = 'op_voorraad', gearchiveerd_op = NULL, updated_at = local_now() WHERE id = $1 AND status = 'archief'", [req.params.id]);
  await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'archief',$3)", [req.params.id, req.user.id, `Uit het archief gehaald door ${req.user.name}`]);
  res.flash("Voertuig staat weer op voorraad.");
  res.redirect(`/voertuigen/${req.params.id}`);
});

module.exports = { router, archief, zoekVoertuigen };
