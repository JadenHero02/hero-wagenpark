// src/onderhoud.js
// Kleine en grote beurt. De tijd is leidend (maanden sinds de laatste beurt), de kilometerstand is een bonus:
// is er een recente stand en een gemiddelde per maand, dan kan die de beurt naar voren halen. Zonder beurten in de app
// schat de app vanaf de eerste toelating (RDW), en zegt dat er eerlijk bij.
//
//   const r = await onderhoud.voor(voertuig);   // { soort, datum, via, geschat, schema, laatste, combineerApk } of null
//   const lijst = await onderhoud.alles(vestigingId);  // hetzelfde voor alle rijdende auto's, met de auto erbij

const db = require("./db");
const { formatDate } = require("./helpers");

// Standaardschema als er per auto niets is ingevuld
function standaard(v) {
  const m = String(v.milieu || "").toLowerCase();
  if (m === "elektrisch") return { klein_maanden: 12, klein_km: 30000, groot_maanden: 24, groot_km: 60000, bron: "standaard voor elektrisch" };
  if (m === "diesel") return { klein_maanden: 12, klein_km: 20000, groot_maanden: 24, groot_km: 40000, bron: "standaard voor diesel" };
  return { klein_maanden: 12, klein_km: 15000, groot_maanden: 24, groot_km: 30000, bron: "standaard voor benzine en hybride" };
}
function schemaVan(v) {
  const s = standaard(v);
  const eigen = Boolean(v.onderhoud_klein_maanden || v.onderhoud_klein_km || v.onderhoud_groot_maanden || v.onderhoud_groot_km);
  return {
    klein_maanden: v.onderhoud_klein_maanden || s.klein_maanden, klein_km: v.onderhoud_klein_km || s.klein_km,
    groot_maanden: v.onderhoud_groot_maanden || s.groot_maanden, groot_km: v.onderhoud_groot_km || s.groot_km,
    eigen, bron: eigen ? "eigen schema van deze auto" : s.bron,
  };
}

const vandaag = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 10);
const addMonths = (date, n) => { const d = new Date(date + "T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const addDays = (date, n) => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const between = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const SOORT = { klein: "Kleine beurt", groot: "Grote beurt" };

// Rekent de volgende beurt uit. beurten nieuwste eerst; km = laatste stand { stand, datum }; kmPerMaand = gemiddelde of null
function volgende(v, beurten = [], km = null, kmPerMaand = null) {
  const schema = schemaVan(v);
  const start = v.rdw_eerste_toelating ? String(v.rdw_eerste_toelating).slice(0, 10) : v.bouwjaar ? `${String(v.bouwjaar).slice(0, 7)}-01` : null;
  const laatste = beurten[0] || null;
  const laatsteGroot = beurten.find((b) => b.soort === "groot") || null;
  if (!laatste && !start) return null;
  const nu = vandaag();
  // Basis: klein rekent vanaf de laatste beurt (klein of groot), groot vanaf de laatste grote beurt. Zonder beurt: de eerste toelating, geschat.
  const basisKlein = laatste ? { datum: laatste.datum, km: laatste.km, geschat: false } : { datum: start, km: null, geschat: true };
  const basisGroot = laatsteGroot ? { datum: laatsteGroot.datum, km: laatsteGroot.km, geschat: false } : { datum: start, km: null, geschat: true };
  const opTijd = (basis, maanden) => { let d = addMonths(basis.datum, maanden); if (basis.geschat) while (d < nu) d = addMonths(d, maanden); return d; };
  const opKm = (basis, stap) => {
    if (!km || km.stand === null || km.stand === undefined || basis.km === null || basis.km === undefined) return null;
    const doel = basis.km + stap;
    if (km.stand >= doel) return { datum: nu, doel };
    if (!kmPerMaand || kmPerMaand <= 0) return null;
    return { datum: addDays(km.datum, Math.round((doel - km.stand) / kmPerMaand * 30.4)), doel };
  };
  const kandidaten = [
    { soort: "klein", basis: basisKlein, tijd: opTijd(basisKlein, schema.klein_maanden), km: opKm(basisKlein, schema.klein_km) },
    { soort: "groot", basis: basisGroot, tijd: opTijd(basisGroot, schema.groot_maanden), km: opKm(basisGroot, schema.groot_km) },
  ].map((k) => ({ ...k, datum: k.km && k.km.datum < k.tijd ? k.km.datum : k.tijd, via: k.km && k.km.datum < k.tijd ? "km" : "tijd" }));
  // Groot wint bij gelijke datum: dan is de kleine beurt onderdeel van de grote
  const keuze = kandidaten[1].datum <= kandidaten[0].datum ? kandidaten[1] : kandidaten[0];
  const dagen = between(nu, keuze.datum);
  const combineerApk = v.apk_vervaldatum && Math.abs(between(keuze.datum, String(v.apk_vervaldatum).slice(0, 10))) <= 42 ? String(v.apk_vervaldatum).slice(0, 10) : null;
  return {
    soort: keuze.soort, naam: SOORT[keuze.soort], datum: keuze.datum, dagen, via: keuze.via, kmDoel: keuze.km ? keuze.km.doel : null,
    geschat: keuze.basis.geschat, basisDatum: keuze.basis.datum, schema, laatste, km, kmPerMaand, combineerApk,
    uitleg: keuze.basis.geschat
      ? `Geschat vanaf de eerste toelating (${formatDate(keuze.basis.datum)}), want er is nog geen beurt in de app vastgelegd.`
      : `Sinds de laatste ${SOORT[laatste.soort].toLowerCase()} van ${formatDate(laatste.datum)}${laatste.km ? " bij " + laatste.km.toLocaleString("nl-NL") + " km" : ""}.`,
  };
}

async function kmVan(voertuigId) {
  const rows = await db.all("SELECT stand, datum FROM kilometerstanden WHERE voertuig_id = $1 ORDER BY datum DESC, id DESC LIMIT 12", [voertuigId]);
  if (!rows.length) return { km: null, kmPerMaand: null };
  const a = rows[0], b = rows[rows.length - 1];
  const dagen = rows.length >= 2 ? between(String(b.datum).slice(0, 10), String(a.datum).slice(0, 10)) : 0;
  const kmPerMaand = dagen >= 14 && a.stand > b.stand ? Math.round((a.stand - b.stand) / dagen * 30.4) : null;
  return { km: { stand: a.stand, datum: String(a.datum).slice(0, 10) }, kmPerMaand };
}

async function beurtenVan(voertuigId) {
  return db.all("SELECT b.*, u.name AS door FROM beurten b LEFT JOIN users u ON u.id = b.user_id WHERE b.voertuig_id = $1 ORDER BY b.datum DESC, b.id DESC", [voertuigId]);
}

// Voor één auto: volgende beurt plus de historie
async function voor(v) {
  const beurten = await beurtenVan(v.id);
  const { km, kmPerMaand } = await kmVan(v.id);
  const r = volgende(v, beurten.map((b) => ({ ...b, datum: String(b.datum).slice(0, 10) })), km, kmPerMaand);
  return r ? { ...r, beurten } : null;
}

// Voor alle rijdende auto's (en op voorraad), optioneel per vestiging
async function alles(vestigingId = null) {
  const rows = await db.all(`SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    WHERE v.status IN ('actief','uitgeleend','op_voorraad') ${vestigingId ? "AND v.vestiging_id = $1" : ""} ORDER BY v.id`, vestigingId ? [vestigingId] : []);
  const uit = [];
  for (const v of rows) { const r = await voor(v); if (r) uit.push({ v, r }); }
  return uit;
}

module.exports = { standaard, schemaVan, volgende, voor, alles, SOORT, addMonths, between };
