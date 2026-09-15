// src/rdw.js
// Voertuiggegevens van de RDW, via de open data (opendata.rdw.nl, gratis, geen sleutel nodig).
// Op kenteken: merk, model, eerste toelating (bouwjaar en -maand), brandstof, APK-vervaldatum, kleur, catalogusprijs, WA-verzekerd.
//
//   const g = await rdw.opvragen("TD-600-K");              // null als het kenteken onbekend is
//   const r = await rdw.bijwerken(voertuig, userId);        // vult lege velden, zet de APK-datum van de RDW, logt wat er veranderde
// De RDW is de bron voor de APK-datum: die staat daar direct na de keuring. De takenmotor haalt hem elke dag op.

const db = require("./db");
const { formatDate } = require("./helpers");

const BASIS = "https://opendata.rdw.nl/resource";
const strip = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const titel = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bBmw\b/, "BMW").replace(/\bVw\b/, "VW").replace(/\bMg\b/, "MG");
const datum = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

async function get(dataset, kenteken) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${BASIS}/${dataset}.json?kenteken=${encodeURIComponent(kenteken)}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`RDW antwoordde ${r.status}`);
    return r.json();
  } finally { clearTimeout(timer); }
}

function milieuVan(brandstoffen) {
  const set = new Set(brandstoffen.map((b) => String(b.brandstof_omschrijving || "").toLowerCase()));
  const elek = set.has("elektriciteit"), fossiel = set.has("benzine") || set.has("diesel") || set.has("lpg") || set.has("cng");
  if (elek && fossiel) return "hybride";
  if (elek) return "elektrisch";
  if (set.has("diesel")) return "diesel";
  if (set.has("benzine") || set.has("lpg") || set.has("cng")) return "benzine";
  return null;
}

async function opvragen(kenteken) {
  const k = strip(kenteken);
  if (k.length < 6) return null;
  const [basis, brandstof] = await Promise.all([get("m9d7-ebf2", k), get("8ys7-d773", k)]);
  const v = basis[0];
  if (!v) return null;
  const toelating = datum(v.datum_eerste_toelating);
  return {
    kenteken: k, merk: titel(v.merk), model: titel(v.handelsbenaming), voertuigsoort: v.voertuigsoort || null,
    bouwjaar: toelating ? toelating.slice(0, 7) : null, eerste_toelating: toelating,
    apk_vervaldatum: datum(v.vervaldatum_apk), milieu: milieuVan(brandstof), brandstof: brandstof.map((b) => b.brandstof_omschrijving).filter(Boolean).join(" + ") || null,
    kleur: v.eerste_kleur && v.eerste_kleur !== "Niet geregistreerd" ? titel(v.eerste_kleur) : null,
    catalogusprijs: v.catalogusprijs ? Number(v.catalogusprijs) : null, wam_verzekerd: v.wam_verzekerd ? v.wam_verzekerd === "Ja" : null,
    zitplaatsen: v.aantal_zitplaatsen ? Number(v.aantal_zitplaatsen) : null, co2: brandstof[0] && brandstof[0].co2_uitstoot_gecombineerd ? Number(brandstof[0].co2_uitstoot_gecombineerd) : null,
  };
}

// Lege velden invullen, de APK-datum overnemen, RDW-velden opslaan. Geeft terug wat er veranderde.
async function bijwerken(v, userId = null, t = db) {
  const g = await opvragen(v.kenteken);
  if (!g) return { gevonden: false, gewijzigd: [] };
  const sets = [], params = [v.id], gewijzigd = [];
  const zet = (kolom, waarde, tekst) => { params.push(waarde); sets.push(`${kolom} = $${params.length}`); if (tekst) gewijzigd.push(tekst); };
  // Merk komt van de RDW. Stond er een bijnaam uit de Excel ("Lavendelbus"), dan gaat die naar de notitie
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (g.merk && norm(v.merk) !== norm(g.merk) && !norm(v.merk).startsWith(norm(g.merk)) && !norm(g.merk).startsWith(norm(v.merk))) {
    zet("merk", g.merk, `merk ${v.merk || "leeg"} naar ${g.merk}`);
    if (v.merk && v.merk !== "Onbekend") zet("notitie", v.notitie ? `${v.merk} · ${v.notitie}` : v.merk, `"${v.merk}" als notitie bewaard`);
  }
  // Model alleen invullen als het leeg is: de RDW-naam is vaak cryptisch ("Q6 Sb E-Tron"), de naam uit de Excel leesbaarder
  if (!v.model && g.model) zet("model", g.model, `model ${g.model}`);
  // Bouwjaar (eerste toelating) en brandstof komen altijd van de RDW; de Excel had daar de leverdatum of een gok
  if (g.bouwjaar && v.bouwjaar !== g.bouwjaar) zet("bouwjaar", g.bouwjaar, `bouwjaar ${v.bouwjaar || "leeg"} naar ${g.bouwjaar}`);
  if (g.milieu && v.milieu !== g.milieu) zet("milieu", g.milieu, `milieu ${v.milieu || "leeg"} naar ${g.milieu}`);
  if (g.apk_vervaldatum && g.apk_vervaldatum !== v.apk_vervaldatum) zet("apk_vervaldatum", g.apk_vervaldatum, `APK ${formatDate(v.apk_vervaldatum) || "onbekend"} naar ${formatDate(g.apk_vervaldatum)}`);
  zet("rdw_kleur", g.kleur); zet("rdw_voertuigsoort", g.voertuigsoort); zet("rdw_catalogusprijs", g.catalogusprijs); zet("rdw_wam_verzekerd", g.wam_verzekerd);
  zet("rdw_eerste_toelating", g.eerste_toelating); zet("rdw_brandstof", g.brandstof);
  sets.push("rdw_opgehaald_op = local_now()");
  await t.run(`UPDATE voertuigen SET ${sets.join(", ")} WHERE id = $1`, params);
  if (gewijzigd.length) {
    await t.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'rdw',$3)", [v.id, userId, `Bijgewerkt vanuit de RDW: ${gewijzigd.join(", ")}`]);
    // Nieuwe APK-datum van de RDW: de taak "APK inplannen" voor de oude datum is niet meer nodig
    if (g.apk_vervaldatum && g.apk_vervaldatum !== v.apk_vervaldatum && v.apk_vervaldatum) await t.run("UPDATE taken SET status = 'vervallen', afgerond_op = local_now() WHERE status = 'open' AND soort = 'apk' AND sleutel = $1", [`apk:${v.id}:${v.apk_vervaldatum}`]);
  }
  return { gevonden: true, gewijzigd, gegevens: g };
}

// Alle auto's met kenteken langs de RDW, rustig aan (de open data wil niet meer dan een paar per seconde)
async function alles(userId = null) {
  const rows = await db.all("SELECT * FROM voertuigen WHERE kenteken IS NOT NULL AND status <> 'archief' ORDER BY id");
  const uitkomst = { totaal: rows.length, gevonden: 0, gewijzigd: 0, fouten: 0, regels: [] };
  for (const v of rows) {
    try {
      const r = await bijwerken(v, userId);
      if (r.gevonden) uitkomst.gevonden++;
      if (r.gewijzigd.length) { uitkomst.gewijzigd++; uitkomst.regels.push(`${v.kenteken}: ${r.gewijzigd.join(", ")}`); }
    } catch (err) { uitkomst.fouten++; console.error(`RDW ${v.kenteken}:`, err.message); }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return uitkomst;
}

module.exports = { opvragen, bijwerken, alles, strip };
