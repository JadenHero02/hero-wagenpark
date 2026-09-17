// src/rdw.js
// Voertuiggegevens van de RDW, via de open data (opendata.rdw.nl, gratis, geen sleutel nodig).
// Op kenteken: merk, model, eerste toelating (bouwjaar en -maand), brandstof, APK-vervaldatum, kleur, catalogusprijs, WA-verzekerd,
// plus de uitgebreide gegevens (inrichting, tenaamstelling, massa, vermogen, verbruik, tellerstandoordeel, indicatoren) als JSON in rdw_extra.
// Bij het bijwerken komen daar ook de terugroepacties (met tekst en status) en de APK-keuringen met geconstateerde gebreken bij.
//
//   const g = await rdw.opvragen("TD-600-K");              // null als het kenteken onbekend is
//   const r = await rdw.bijwerken(voertuig, userId);        // vult lege velden, zet de APK-datum van de RDW, logt wat er veranderde
// De RDW is de bron voor de APK-datum: die staat daar direct na de keuring. De takenmotor haalt hem elke dag op.

const db = require("./db");
const { formatDate } = require("./helpers");

const BASIS = "https://opendata.rdw.nl/resource";
const strip = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const titel = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bBmw\b/, "BMW").replace(/\bVw\b/, "VW").replace(/\bMg\b/, "MG").replace(/\bByd\b/, "BYD");

// De RDW schrijft de handelsbenaming in hoofdletters ("I5 EDRIVE40", "Q4 45 E-TRON"). Dit maakt er de schrijfwijze van de fabrikant van.
const VAST = { "e-tron": "e-tron", etron: "e-tron", "e-tech": "E-Tech", ehybrid: "eHybrid", phev: "PHEV", dsg: "DSG", tdi: "TDI", tsi: "TSI", tfsi: "TFSI", awd: "AWD", rwd: "RWD", suv: "SUV", gti: "GTI", gte: "GTE", amg: "AMG", av: "Avant", sb: "Sportback", "v-klasse": "V-Klasse", "e-klasse": "E-Klasse", "c-klasse": "C-Klasse", "a-klasse": "A-Klasse", "b-klasse": "B-Klasse" };
function modelNaam(s, merk = "") {
  const woorden = String(s || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const m = String(merk || "").toLowerCase();
  if (woorden.length > 1 && woorden[0] === m && woorden.slice(1).some((w) => /[a-z]/.test(w))) woorden.shift(); // "BYD SEALION 7" -> "Sealion 7", maar "POLESTAR 2" blijft "Polestar 2"
  return woorden.map((w) => {
    if (VAST[w]) return VAST[w];
    let r = w.match(/^([ex])drive(\d*)([a-z]?)$/); if (r) return `${r[1]}Drive${r[2]}${r[3]}`;                 // eDrive40, xDrive45e
    if (/^ix?\d+[a-z]*$/.test(w)) return w.replace(/^i(x)?/, (a, x) => "i" + (x ? "X" : ""));                  // i4, i5, iX3
    if (/^\d+[a-z]{1,2}$/.test(w)) return w;                                                                    // 530e, 218i, 40
    if (/^[a-z]{1,3}\d+[a-z+]*$/.test(w)) return w.toUpperCase().replace(/([A-Z]+)(\d+)([A-Z]*)$/, (a, b, c, d) => b + c + d.toLowerCase()); // XC40, EQA, M50, GLC, X5
    if (/^[a-z]{1,3}$/.test(w) && !["one", "van", "de"].includes(w)) return w.toUpperCase();                    // EQA, GLC, RS
    return w.replace(/(^|-)([a-z])/g, (a, b, c) => b + c.toUpperCase());                                         // Clio, Range Rover, Model 3
  }).join(" ");
}
const datum = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

async function get(dataset, params) {
  const qs = typeof params === "string" ? `kenteken=${encodeURIComponent(params)}` : Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${BASIS}/${dataset}.json?${qs}`, { signal: ctl.signal, headers: { accept: "application/json" } });
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

// De uitgebreide gegevens voor de kaart "Kentekenregister" op de voertuigpagina. Alleen wat een beheerder iets zegt.
const getal = (x) => (x !== undefined && x !== null && x !== "" && !isNaN(Number(x)) ? Number(x) : null);
const jaNee = (x) => (x === "Ja" ? true : x === "Nee" ? false : null);
function extraVan(v, brandstof) {
  const b = brandstof[0] || {};
  const tekst = (x) => (x && x !== "Niet geregistreerd" && x !== "Geen verstrekking in Open Data" ? String(x) : null);
  return {
    inrichting: tekst(v.inrichting), categorie: tekst(v.europese_voertuigcategorie), tweede_kleur: tekst(v.tweede_kleur),
    deuren: getal(v.aantal_deuren), zitplaatsen: getal(v.aantal_zitplaatsen),
    tenaamstelling: datum(v.datum_tenaamstelling), eerste_tenaamstelling_nl: datum(v.datum_eerste_tenaamstelling_in_nederland),
    bruto_bpm: getal(v.bruto_bpm), massa_rijklaar: getal(v.massa_rijklaar), massa_ledig: getal(v.massa_ledig_voertuig), max_massa: getal(v.toegestane_maximum_massa_voertuig),
    trekken_geremd: getal(v.maximum_trekken_massa_geremd), trekken_ongeremd: getal(v.maximum_massa_trekken_ongeremd),
    cilinders: getal(v.aantal_cilinders), cilinderinhoud: getal(v.cilinderinhoud), vermogen_kw: getal(b.nettomaximumvermogen),
    verbruik: getal(b.brandstofverbruik_gecombineerd), co2: getal(b.co2_uitstoot_gecombineerd), energielabel: tekst(v.zuinigheidsclassificatie), emissie: tekst(b.uitlaatemissieniveau),
    tellerstand_oordeel: tekst(v.tellerstandoordeel), tellerstand_jaar: getal(v.jaar_laatste_registratie_tellerstand),
    terugroepactie: jaNee(v.openstaande_terugroepactie_indicator), export: jaNee(v.export_indicator), taxi: jaNee(v.taxi_indicator), tenaamstellen_mogelijk: jaNee(v.tenaamstellen_mogelijk),
    lengte: getal(v.lengte), breedte: getal(v.breedte), hoogte: getal(v.hoogte_voertuig), wielbasis: getal(v.wielbasis),
  };
}

// Terugroepacties: per kenteken de referentiecodes met status (t49b-isb7), de tekst per code (j9yg-7rg9).
// De tekst verandert niet meer en dezelfde code komt bij meer auto's voor, dus die blijft in het geheugen.
const actieTekst = new Map();
async function terugroepacties(k) {
  const statussen = await get("t49b-isb7", k);
  const uit = [];
  for (const st of statussen) {
    const code = st.referentiecode_rdw;
    if (!code) continue;
    if (!actieTekst.has(code)) {
      const [a] = await get("j9yg-7rg9", { referentiecode_rdw: code });
      actieTekst.set(code, a ? { omschrijving: a.omschrijving_defect || null, gevolg: a.materi_le_gevolgen || null, herstel: a.beschrijving_van_het_herstel || null, risico: a.risicobeoordeling_rdw || null, datum: datum(a.publicatiedatum_rdw), telefoon: a.meer_informatie_via_telefoonnummer || null } : {});
    }
    uit.push({ code, status: st.status || null, open: st.code_status === "O", ...actieTekst.get(code) });
  }
  return uit.sort((a, b) => (b.open - a.open) || String(b.datum || "").localeCompare(String(a.datum || "")));
}

// APK-keuringen (sgfe-77wx) met de geconstateerde gebreken (a34c-vvps); de omschrijving per gebrek (hx2c-gt7k) blijft in het geheugen.
const gebrekTekst = new Map();
async function apkKeuringen(k) {
  const [meldingen, gebreken] = await Promise.all([get("sgfe-77wx", k), get("a34c-vvps", k)]);
  const ids = [...new Set(gebreken.map((g) => g.gebrek_identificatie).filter((id) => id && !gebrekTekst.has(id)))];
  if (ids.length) {
    const rows = await get("hx2c-gt7k", { $where: `gebrek_identificatie in(${ids.map((id) => `'${id.replace(/'/g, "")}'`).join(",")})`, $limit: 500 });
    for (const r of rows) gebrekTekst.set(r.gebrek_identificatie, r.gebrek_omschrijving || r.gebrek_identificatie);
  }
  const perDatum = new Map();
  const slot = (m) => { const key = `${m.meld_datum_door_keuringsinstantie}${m.meld_tijd_door_keuringsinstantie || ""}`; if (!perDatum.has(key)) perDatum.set(key, { datum: datum(m.meld_datum_door_keuringsinstantie), soort: m.soort_melding_ki_omschrijving || null, vervaldatum: null, gebreken: [] }); return perDatum.get(key); };
  for (const m of meldingen) { const e = slot(m); e.vervaldatum = datum(m.vervaldatum_keuring) || e.vervaldatum; }
  for (const g of gebreken) { const e = slot(g); const id = g.gebrek_identificatie; if (id && !e.gebreken.some((x) => x.id === id)) e.gebreken.push({ id, omschrijving: gebrekTekst.get(id) || id }); }
  return [...perDatum.values()].sort((a, b) => String(b.datum).localeCompare(String(a.datum))).slice(0, 10);
}

async function opvragen(kenteken) {
  const k = strip(kenteken);
  if (k.length < 6) return null;
  const [basis, brandstof] = await Promise.all([get("m9d7-ebf2", k), get("8ys7-d773", k)]);
  const v = basis[0];
  if (!v) return null;
  const toelating = datum(v.datum_eerste_toelating);
  return {
    kenteken: k, merk: titel(v.merk), model: modelNaam(v.handelsbenaming, v.merk), voertuigsoort: v.voertuigsoort || null,
    bouwjaar: toelating ? toelating.slice(0, 7) : null, eerste_toelating: toelating,
    apk_vervaldatum: datum(v.vervaldatum_apk), milieu: milieuVan(brandstof), brandstof: brandstof.map((b) => b.brandstof_omschrijving).filter(Boolean).join(" + ") || null,
    kleur: v.eerste_kleur && v.eerste_kleur !== "Niet geregistreerd" ? titel(v.eerste_kleur) : null,
    catalogusprijs: v.catalogusprijs ? Number(v.catalogusprijs) : null, wam_verzekerd: v.wam_verzekerd ? v.wam_verzekerd === "Ja" : null,
    zitplaatsen: v.aantal_zitplaatsen ? Number(v.aantal_zitplaatsen) : null, co2: brandstof[0] && brandstof[0].co2_uitstoot_gecombineerd ? Number(brandstof[0].co2_uitstoot_gecombineerd) : null,
    extra: extraVan(v, brandstof),
  };
}

// Lege velden invullen, de APK-datum overnemen, RDW-velden opslaan. Geeft terug wat er veranderde.
async function bijwerken(v, userId = null, t = db) {
  const g = await opvragen(v.kenteken);
  if (!g) return { gevonden: false, gewijzigd: [] };
  const oud = v.rdw_extra || {};
  try { g.extra.terugroepacties = await terugroepacties(g.kenteken); } catch (err) { g.extra.terugroepacties = oud.terugroepacties || null; console.error(`RDW terugroepacties ${g.kenteken}:`, err.message); }
  try { g.extra.apk_keuringen = await apkKeuringen(g.kenteken); } catch (err) { g.extra.apk_keuringen = oud.apk_keuringen || null; console.error(`RDW keuringen ${g.kenteken}:`, err.message); }
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
  const openNu = (g.extra.terugroepacties || []).filter((a) => a.open).map((a) => a.code), openWas = (oud.terugroepacties || []).filter((a) => a.open).map((a) => a.code);
  for (const code of openNu.filter((c) => !openWas.includes(c))) gewijzigd.push(`terugroepactie ${code} open`);
  for (const code of openWas.filter((c) => !openNu.includes(c))) gewijzigd.push(`terugroepactie ${code} afgehandeld`);
  zet("rdw_kleur", g.kleur); zet("rdw_voertuigsoort", g.voertuigsoort); zet("rdw_catalogusprijs", g.catalogusprijs); zet("rdw_wam_verzekerd", g.wam_verzekerd);
  zet("rdw_eerste_toelating", g.eerste_toelating); zet("rdw_brandstof", g.brandstof); zet("rdw_extra", JSON.stringify(g.extra));
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

module.exports = { opvragen, bijwerken, alles, strip, terugroepacties, apkKeuringen, modelNaam };
