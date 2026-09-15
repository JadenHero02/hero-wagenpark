// src/routes/export.js
// Live data naar Excel, voor finance, directie en beheerders (tip van Vasco). Twee vormen:
//   /export.xlsx              het hele wagenpark: één werkboek met een tabblad per onderdeel
//   /voertuigen/export.xlsx   alleen de rijen van de wagenparklijst, met dezelfde zoekterm en filters als op het scherm
// Pincodes gaan nooit mee. Kolomkoppen in gewoon Nederlands, datums als echte Excel-datums.

const express = require("express");
const XLSX = require("xlsx");
const db = require("../db");
const auth = require("../auth");
const { zoekVoertuigen } = require("./voertuigen");
const { LABELS, label } = require("../helpers");

const router = express.Router();
const directie = auth.requireRole("directie");

const datum = (v) => (v ? new Date(String(v).slice(0, 10) + "T00:00:00") : null);
const jn = (v) => (v === null || v === undefined ? "" : v ? "ja" : "nee");

function blad(wb, naam, rijen, kolommen) {
  const data = rijen.map((r) => Object.fromEntries(kolommen.map(([kop, fn]) => [kop, fn(r) ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data, { header: kolommen.map(([kop]) => kop), cellDates: true });
  ws["!cols"] = kolommen.map(([kop]) => ({ wch: Math.max(kop.length + 2, ...data.slice(0, 200).map((d) => String(d[kop] instanceof Date ? "dd-mm-jjjj" : d[kop] ?? "").length + 2), 8) }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  for (const cell of Object.keys(ws)) if (cell[0] !== "!" && ws[cell].t === "d") ws[cell].z = "dd-mm-yyyy";
  XLSX.utils.book_append_sheet(wb, ws, naam.slice(0, 31));
}

const VOERTUIG_KOLOMMEN = [
  ["Kenteken", (r) => r.kenteken || ""], ["Merk", (r) => r.merk], ["Model", (r) => r.model], ["Status", (r) => label("status", r.status)], ["Vestiging", (r) => r.vestiging],
  ["Bestuurder", (r) => r.bestuurder || r.extern_naam || ""], ["Toewijzing", (r) => (r.toewijzing_soort === "uitleen" ? "Leenauto" : r.toewijzing_soort === "vast" ? "Vast" : "")],
  ["Soort eigendom", (r) => label("eigendom", r.eigendom)], ["Milieu", (r) => label("milieu", r.milieu)], ["Banden", (r) => label("banden", r.banden)], ["Leenauto", (r) => jn(r.is_leenauto)],
  ["APK vervalt", (r) => datum(r.apk_vervaldatum)], ["Km-stand", (r) => r.km_stand], ["Km-stand datum", (r) => datum(r.km_datum)], ["Notitie", (r) => r.notitie],
];

function stuur(res, wb, naam) {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${naam}-${stamp}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(buf);
}

router.get("/export", directie, async (req, res) => {
  const n = await db.one("SELECT (SELECT COUNT(*) FROM voertuigen WHERE status <> 'archief') AS voertuigen, (SELECT COUNT(*) FROM bestuurders WHERE actief) AS bestuurders, (SELECT COUNT(*) FROM toewijzingen) AS toewijzingen, (SELECT COUNT(*) FROM kilometerstanden) AS km, (SELECT COUNT(*) FROM boetes) AS boetes, (SELECT COUNT(*) FROM incidenten) AS incidenten, (SELECT COUNT(*) FROM taken WHERE status = 'open') AS taken, (SELECT COUNT(*) FROM voertuigen WHERE status = 'archief') AS archief");
  res.render("export/index", { title: "Export", n, vestigingen: await db.all("SELECT * FROM vestigingen ORDER BY volgorde") });
});

// De wagenparklijst zoals hij op het scherm staat
router.get("/voertuigen/export.xlsx", directie, async (req, res) => {
  const { rows } = await zoekVoertuigen(req.query);
  const wb = XLSX.utils.book_new();
  blad(wb, "Wagenpark", rows, VOERTUIG_KOLOMMEN);
  await db.run("INSERT INTO logboek (user_id, soort, omschrijving) VALUES ($1, 'export', $2)", [req.user.id, `Wagenparklijst (${rows.length} rijen) naar Excel geëxporteerd door ${req.user.name}`]);
  stuur(res, wb, "wagenpark");
});

// Alles, één tabblad per onderdeel
router.get("/export.xlsx", directie, async (req, res) => {
  const wb = XLSX.utils.book_new();
  const { rows: voertuigen } = await zoekVoertuigen({});
  const detail = await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id ORDER BY v.status, v.kenteken NULLS LAST");
  const perId = Object.fromEntries(detail.map((d) => [d.id, d]));
  blad(wb, "Wagenpark", voertuigen, [...VOERTUIG_KOLOMMEN,
    ["Bouwjaar", (r) => perId[r.id].bouwjaar], ["Bijtelling", (r) => jn(perId[r.id].bijtelling)], ["Leasemaatschappij", (r) => perId[r.id].leasemaatschappij], ["Contract eindigt", (r) => datum(perId[r.id].contract_einde)],
    ["Verwachte levering", (r) => perId[r.id].verwachte_levering], ["Tankpasnummer", (r) => perId[r.id].tankpas_nummer], ["APK-afspraak", (r) => datum(perId[r.id].apk_afspraak)],
    ["Onderhoud (tekst)", (r) => perId[r.id].onderhoud_notitie], ["Schade (tekst)", (r) => perId[r.id].schade_notitie], ["Opmerkingen", (r) => perId[r.id].opmerkingen]]);
  blad(wb, "Bestuurders", await db.all("SELECT b.*, ve.naam AS vestiging, v.kenteken, t.soort AS toewijzing_soort FROM bestuurders b LEFT JOIN vestigingen ve ON ve.id = b.vestiging_id LEFT JOIN toewijzingen t ON t.bestuurder_id = b.id AND t.status = 'actief' LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE b.actief ORDER BY b.naam"), [
    ["Naam", (r) => r.naam], ["E-mail", (r) => r.email], ["Telefoon", (r) => r.telefoon], ["Vestiging", (r) => r.vestiging], ["Auto", (r) => r.kenteken], ["Toewijzing", (r) => (r.toewijzing_soort === "uitleen" ? "Leenauto" : r.toewijzing_soort ? "Vast" : "")], ["Rijbewijs geldig tot", (r) => datum(r.rijbewijs_geldig_tot)], ["Extern", (r) => jn(r.is_extern)], ["Opmerking", (r) => r.opmerking]]);
  blad(wb, "Toewijzingen", await db.all("SELECT t.*, v.kenteken, v.merk, v.model, COALESCE(b.naam, t.extern_naam) AS wie, ve.naam AS vestiging FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id LEFT JOIN vestigingen ve ON ve.id = t.vestiging_id ORDER BY t.status = 'actief' DESC, t.van DESC NULLS LAST"), [
    ["Kenteken", (r) => r.kenteken], ["Auto", (r) => `${r.merk} ${r.model || ""}`.trim()], ["Wie", (r) => r.wie], ["Soort", (r) => (r.soort === "uitleen" ? "Leenauto" : "Vast")], ["Van", (r) => datum(r.van)], ["Tot", (r) => datum(r.tot)], ["Status", (r) => r.status], ["Vestiging", (r) => r.vestiging], ["Reden", (r) => r.reden], ["Opmerking", (r) => r.opmerking]]);
  blad(wb, "Kilometerstanden", await db.all("SELECT k.*, v.kenteken, u.name AS door FROM kilometerstanden k JOIN voertuigen v ON v.id = k.voertuig_id LEFT JOIN users u ON u.id = k.user_id ORDER BY v.kenteken, k.datum DESC"), [
    ["Kenteken", (r) => r.kenteken], ["Datum", (r) => datum(r.datum)], ["Stand", (r) => r.stand], ["Bron", (r) => r.bron], ["Door", (r) => r.door]]);
  blad(wb, "Boetes", await db.all("SELECT b.*, v.kenteken, bs.naam AS bestuurder, u.name AS bevestigd_door_naam FROM boetes b JOIN voertuigen v ON v.id = b.voertuig_id LEFT JOIN bestuurders bs ON bs.id = b.bestuurder_id LEFT JOIN users u ON u.id = b.bevestigd_door ORDER BY b.datum DESC"), [
    ["Datum", (r) => datum(r.datum)], ["Kenteken", (r) => r.kenteken], ["Bestuurder", (r) => r.bestuurder], ["Bedrag", (r) => r.bedrag], ["Omschrijving", (r) => r.omschrijving], ["Status", (r) => label("boete", r.status)], ["Besloten door", (r) => r.bevestigd_door_naam], ["Besloten op", (r) => datum(r.bevestigd_op)], ["Reden uitzondering", (r) => r.uitzondering_reden]]);
  blad(wb, "Incidenten", await db.all("SELECT i.*, v.kenteken, b.naam AS bestuurder FROM incidenten i JOIN voertuigen v ON v.id = i.voertuig_id LEFT JOIN bestuurders b ON b.id = i.bestuurder_id ORDER BY i.datum DESC"), [
    ["Datum", (r) => datum(r.datum)], ["Kenteken", (r) => r.kenteken], ["Bestuurder", (r) => r.bestuurder], ["Soort", (r) => label("incident_soort", r.soort)], ["Omschrijving", (r) => r.omschrijving], ["Tegenpartij", (r) => r.tegenpartij], ["Kosten", (r) => r.kosten], ["Status", (r) => label("incident_status", r.status)]]);
  blad(wb, "Open taken", await db.all("SELECT t.*, v.kenteken, b.naam AS bestuurder FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.status = 'open' ORDER BY t.deadline NULLS LAST"), [
    ["Deadline", (r) => datum(r.deadline)], ["Taak", (r) => r.titel], ["Soort", (r) => label("taak", r.soort)], ["Voor", (r) => r.voor], ["Kenteken", (r) => r.kenteken], ["Bestuurder", (r) => r.bestuurder], ["Toelichting", (r) => r.omschrijving]]);
  blad(wb, "Wachtlijst", await db.all("SELECT w.*, ve.naam AS vestiging FROM wachtlijst w LEFT JOIN vestigingen ve ON ve.id = w.vestiging_id ORDER BY w.status, w.datum_aanvraag"), [
    ["Naam", (r) => r.naam], ["Vestiging", (r) => r.vestiging], ["Sinds", (r) => datum(r.datum_aanvraag)], ["Gewenste auto", (r) => r.gewenste_auto], ["Status", (r) => label("wachtlijst", r.status)], ["Opmerking", (r) => r.opmerking]]);
  blad(wb, "Contacten", await db.all("SELECT c.*, ve.naam AS vestiging FROM contacten c LEFT JOIN vestigingen ve ON ve.id = c.vestiging_id ORDER BY c.soort, c.naam"), [
    ["Soort", (r) => label("contact", r.soort)], ["Naam", (r) => r.naam], ["Merk", (r) => r.merk], ["Vestiging", (r) => r.vestiging], ["Telefoon", (r) => r.telefoon], ["E-mail", (r) => r.email], ["Adres", (r) => r.adres], ["Website", (r) => r.website], ["Opmerking", (r) => r.opmerking]]);
  blad(wb, "Archief", detail.filter((d) => d.status === "archief"), [
    ["Kenteken", (r) => r.kenteken], ["Merk", (r) => r.merk], ["Model", (r) => r.model], ["Vestiging", (r) => r.vestiging], ["Soort eigendom", (r) => label("eigendom", r.eigendom)], ["Gearchiveerd op", (r) => datum(r.gearchiveerd_op)]]);
  await db.run("INSERT INTO logboek (user_id, soort, omschrijving) VALUES ($1, 'export', $2)", [req.user.id, `Volledige export naar Excel door ${req.user.name}`]);
  stuur(res, wb, "hero-wagenpark");
});

module.exports = { router, LABELS };
