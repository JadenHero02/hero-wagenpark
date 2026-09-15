// scripts/import-excel.js
// Leest de Excel Wagenparkbeheer.xlsx in één keer in: voertuigen, bestuurders, toewijzingen, uitleen, wachtlijst,
// contacten, kilometerstanden, bandenwissel. Wat niet klopt komt op de foutlijst (data/import-foutlijst.txt).
//
//   npm run import -- --reset      wist eerst alle wagenparkdata (niet de gebruikers en instellingen) en leest opnieuw in
//   EXCEL_PATH=... npm run import   (of het pad als eerste argument)
//
// Bestuurders worden aan een Hero-e-mailadres gekoppeld via de medewerkerslijst (framework.users), op naam.

require("../src/env");
const path = require("node:path");
const fs = require("node:fs");
const XLSX = require("xlsx");
const db = require("../src/db");
const pincode = require("../src/pincode");
const employees = require("../src/employees");

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const FILE = args.find((a) => !a.startsWith("--")) || process.env.EXCEL_PATH;
if (!FILE || !fs.existsSync(FILE)) { console.error("Geen Excel gevonden. Geef het pad als argument of zet EXCEL_PATH."); process.exit(1); }

const fouten = [];
const fout = (waar, wat) => fouten.push(`${waar}: ${wat}`);
const s = (v) => (v === null || v === undefined ? null : String(v).trim() === "" || String(v).trim() === "-" ? null : String(v).trim());
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null; }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function toBouwjaar(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  const t = String(v).trim(); const d = toDate(t); if (d) return d.slice(0, 7);
  return t.match(/^\d{4}/) ? t.slice(0, 7).replace("/", "-") : t;
}
const kenteken = (v) => { const k = s(v); return k ? k.toUpperCase().replace(/\s+/g, "") : null; };
const eigendom = (v) => { const t = norm(v); if (!t) return "onbekend"; if (t.includes("financial")) return "financial_lease"; if (t.includes("operational")) return "operational_lease"; if (t.includes("huur")) return "huur"; if (t.includes("eigendom") || t.includes("koop") || t.includes("gekocht")) return "eigendom"; return "onbekend"; };
const milieu = (v) => { const t = norm(v); if (!t) return null; if (t.includes("elek")) return "elektrisch"; if (t.includes("hybr")) return "hybride"; if (t.includes("diesel")) return "diesel"; if (t.includes("benz")) return "benzine"; return null; };
const banden = (v) => { const t = norm(v); if (!t) return null; if (t.includes("winter")) return "winter_zomer"; if (t.includes("all")) return "all_season"; if (t.includes("zomer")) return "zomer"; return null; };
const jaNee = (v) => { const t = norm(v); if (!t) return null; if (t.startsWith("j") || t === "yes" || t === "true") return true; if (t.startsWith("n") || t === "false") return false; return null; };
const km = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

async function main() {
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const sheet = (name) => { const ws = wb.Sheets[name]; if (!ws) { fout(name, "tabblad ontbreekt"); return []; } return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }); };

  const vest = {}; for (const v of await db.all("SELECT * FROM vestigingen")) vest[norm(v.naam)] = v.id;
  const vestId = (v) => { const t = norm(v); if (!t) return null; for (const [k, id] of Object.entries(vest)) if (t.includes(k)) return id; return null; };

  // Medewerkerslijst voor het koppelen van namen aan e-mailadressen
  const medewerkers = await employees.allActive().catch((e) => { fout("medewerkerslijst", e.message); return []; });
  const byName = new Map(); for (const m of medewerkers) byName.set(norm(m.name), m);
  function findEmployee(naam) {
    const n = norm(naam); if (!n) return null;
    if (byName.has(n)) return byName.get(n);
    const parts = n.split(" "); const first = parts[0], last = parts[parts.length - 1];
    const cands = medewerkers.filter((m) => { const mn = norm(m.name).split(" "); return mn[0] === first && mn[mn.length - 1] === last; });
    return cands.length === 1 ? cands[0] : null;
  }

  if (RESET) {
    await db.run("TRUNCATE logboek, mail_log, leenverzoeken, documenten, boetes, incidenten, processtappen, processen, taken, wachtlijst, kilometerstanden, bandenwissels, toewijzingen, voertuigen, bestuurders, contacten RESTART IDENTITY CASCADE");
    console.log("Alle wagenparkdata gewist.");
  }

  const stats = { voertuigen: 0, besteld: 0, bestuurders: 0, gekoppeld: 0, toewijzingen: 0, uitleen: 0, historie: 0, km: 0, pincodes: 0, contacten: 0, wachtlijst: 0, banden: 0, leenautos: 0 };
  // Namen in de kolom Bestuurder die geen persoon zijn: de auto is dan vrij (op voorraad) en de tekst wordt een notitie
  const GEEN_PERSOON = /^(vrij|verhuisbus|personenbus|lege band.*|hero (hoorn|alkmaar|wognum|schiphol)|leenauto|pool|n\.?v\.?t\.?|geen|onbekend|\?+)$/i;
  const geenPersoon = (naam) => !s(naam) || GEEN_PERSOON.test(s(naam));
  // "Verhuurd: Shirley Vorster" -> externe uitleen; "Wesley Bevers (huur auto)" -> naam zonder haakjes, de rest als opmerking
  function splitsNaam(naam) {
    let n = s(naam) || ""; let extern = false; let soort = "vast"; let opmerking = null;
    let m = n.match(/^(extern|verhuurd|uitgeleend)\s*(aan)?:?\s*(.+)$/i); if (m) { n = m[3].trim(); extern = /verhuurd/i.test(m[1]) || /extern/i.test(m[1]); soort = "uitleen"; }
    m = n.match(/^(.+?)\s*\((.+)\)\s*$/); if (m) { n = m[1].trim(); opmerking = m[2].trim(); }
    return { naam: n, extern, soort, opmerking };
  }
  const bestuurderCache = new Map(); // norm(naam) -> id
  async function bestuurder(naam, { telefoon = null, vestiging_id = null, extern = false } = {}) {
    const sp = splitsNaam(naam); let n = sp.naam; if (!n) return null;
    const isExtern = extern || sp.extern;
    const key = norm(n);
    if (bestuurderCache.has(key)) return bestuurderCache.get(key);
    let row = await db.one("SELECT id FROM bestuurders WHERE lower(naam) = lower($1)", [n]);
    if (!row) {
      let emp = isExtern ? null : findEmployee(n);
      let aanname = null;
      if (!emp && !isExtern && !n.includes(" ")) {
        // Alleen een voornaam: koppelen als er precies één collega met die voornaam is
        const cands = medewerkers.filter((m) => norm(m.name).split(" ")[0] === norm(n));
        if (cands.length === 1) { emp = cands[0]; aanname = `${n} aangenomen als ${emp.name}`; }
      }
      if (emp) row = await db.one("SELECT id FROM bestuurders WHERE lower(email) = lower($1)", [emp.email]);
      if (!row) {
        const id = await db.insert("INSERT INTO bestuurders (naam, email, telefoon, vestiging_id, is_extern, opmerking) VALUES ($1,$2,$3,$4,$5,$6)", [emp ? emp.name : n, emp ? emp.email.toLowerCase() : null, telefoon || (emp ? emp.phone : null), vestiging_id, isExtern, sp.opmerking]);
        row = { id }; stats.bestuurders++; if (emp) stats.gekoppeld++;
      }
      if (aanname) fout("bestuurder", `${aanname} (controleren)`);
      else if (!emp && !isExtern) fout("bestuurder", `${n}: niet gevonden op de medewerkerslijst, geen e-mailadres`);
    } else if (telefoon || vestiging_id) {
      await db.run("UPDATE bestuurders SET telefoon = COALESCE(telefoon, $2), vestiging_id = COALESCE(vestiging_id, $3) WHERE id = $1", [row.id, telefoon, vestiging_id]);
    }
    bestuurderCache.set(key, row.id);
    return row.id;
  }
  const voertuigCache = new Map();
  async function voertuigByKenteken(k) {
    if (!k) return null;
    if (voertuigCache.has(k)) return voertuigCache.get(k);
    const row = await db.one("SELECT id FROM voertuigen WHERE upper(kenteken) = $1", [k]);
    if (row) voertuigCache.set(k, row.id);
    return row ? row.id : null;
  }

  // ---- Wagenpark overzicht ----
  const wp = sheet("Wagenpark overzicht");
  const head = (wp[0] || []).map((h) => norm(h));
  const col = (row, name) => { const i = head.findIndex((h) => h.includes(norm(name))); return i >= 0 ? row[i] : null; };
  for (let r = 1; r < wp.length; r++) {
    const row = wp[r]; if (!row || row.every((c) => c === null || c === "")) continue;
    const k = kenteken(col(row, "kenteken"));
    const merk = s(col(row, "merk")) || "Onbekend";
    const model = s(col(row, "type auto"));
    const notitie = s(col(row, "notitie"));
    const bestNaamRuw = s(col(row, "bestuurder"));
    const bestNaam = geenPersoon(bestNaamRuw) ? null : bestNaamRuw;
    const vId = vestId(col(row, "vestiging"));
    const besteld = !k;
    if (bestNaamRuw && !bestNaam && !notitie) row[head.findIndex((h) => h.includes("notitie"))] = bestNaamRuw;
    if (k && await voertuigByKenteken(k)) { fout(`wagenpark rij ${r + 1}`, `kenteken ${k} staat dubbel in de Excel; tweede overgeslagen`); continue; }
    const pin = s(col(row, "pincode"));
    const id = await db.insert(`INSERT INTO voertuigen (kenteken, merk, model, bouwjaar, eigendom, bijtelling, milieu, banden, status, vestiging_id, apk_vervaldatum, tankpas_nummer, tankpas_pincode_enc, onderhoud_notitie, schade_notitie, opmerkingen, notitie, verwachte_levering)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [
      k, merk, model, toBouwjaar(col(row, "bouwjaar")), eigendom(col(row, "soort")), jaNee(col(row, "bijtelling")), milieu(col(row, "milieu")), banden(col(row, "type banden")),
      besteld ? "besteld" : (bestNaam ? "actief" : "op_voorraad"), vId, toDate(col(row, "vervaldatum apk")), s(col(row, "tank")), pin ? pincode.encrypt(pin) : null,
      s(col(row, "onderhoud")), s(col(row, "schade")), s(col(row, "opmerkingen")), notitie, besteld && notitie ? (notitie.match(/verwacht\s+(.+?)\)?$/i) || [])[1] || null : null]);
    if (k) voertuigCache.set(k, id);
    stats.voertuigen++; if (besteld) stats.besteld++; if (pin) stats.pincodes++;
    if (!besteld && !toDate(col(row, "vervaldatum apk"))) fout(`voertuig ${k}`, "geen APK-vervaldatum");
    if (bestNaam && !besteld) {
      const sp = splitsNaam(bestNaam);
      const bId = await bestuurder(bestNaam, { telefoon: s(col(row, "telefoon")), vestiging_id: vId });
      await db.run("INSERT INTO toewijzingen (voertuig_id, bestuurder_id, soort, vestiging_id, status, opmerking) VALUES ($1,$2,$3,$4,'actief',$5)", [id, bId, sp.soort, vId, sp.opmerking]);
      if (sp.soort === "uitleen") await db.run("UPDATE voertuigen SET status = 'uitgeleend' WHERE id = $1", [id]);
      stats.toewijzingen++;
    }
    const stand = km(col(row, "km stand")); const datum = toDate(col(row, "datum km"));
    if (stand) { await db.run("INSERT INTO kilometerstanden (voertuig_id, stand, datum, bron) VALUES ($1,$2,$3,'import')", [id, stand, datum || new Date().toISOString().slice(0, 10)]); stats.km++; if (!datum) fout(`voertuig ${k}`, "kilometerstand zonder datum, vandaag genomen"); }
    await db.run("INSERT INTO logboek (voertuig_id, soort, omschrijving) VALUES ($1,'import','Ingelezen uit de Excel Wagenparkbeheer')", [id]);
  }

  // ---- Uitleen overzicht: rechts de leenauto's, links de historie ----
  const uo = sheet("Uitleen overzicht");
  for (let r = 2; r < uo.length; r++) {
    const row = uo[r]; if (!row) continue;
    const soort = s(row[8]), k = kenteken(row[9]), wie = s(row[11]);
    if (!soort || !k) continue;
    let id = await voertuigByKenteken(k);
    if (!id) { id = await db.insert("INSERT INTO voertuigen (kenteken, merk, model, status, is_leenauto, notitie) VALUES ($1,$2,$3,'op_voorraad',true,$4)", [k, soort, null, wie]); voertuigCache.set(k, id); stats.voertuigen++; fout(`leenauto ${k}`, `${soort}: stond niet in het wagenpark overzicht, aangemaakt zonder merk en APK`); }
    else await db.run("UPDATE voertuigen SET is_leenauto = true, notitie = COALESCE(notitie, $2) WHERE id = $1", [id, `${soort}${wie ? " · " + wie : ""}`]);
    stats.leenautos++;
  }
  for (let r = 1; r < uo.length; r++) {
    const row = uo[r]; if (!row) continue;
    const naam = s(row[0]), k = kenteken(row[1]), van = toDate(row[2]), tot = toDate(row[3]);
    if (!naam || !k || geenPersoon(naam)) continue;
    const id = await voertuigByKenteken(k);
    if (!id) { fout(`uitleenhistorie rij ${r + 1}`, `kenteken ${k} onbekend (${naam})`); continue; }
    const bId = await bestuurder(naam);
    await db.run("INSERT INTO toewijzingen (voertuig_id, bestuurder_id, soort, van, tot, status, afgesloten_op) VALUES ($1,$2,'uitleen',$3,$4,'afgesloten', local_now())", [id, bId, van, tot]);
    stats.historie++;
  }

  // ---- Tijdelijke uitleen (lopend) ----
  const tu = sheet("Tijdelijke uitleen");
  for (let r = 1; r < tu.length; r++) {
    const row = tu[r]; if (!row) continue;
    const k = kenteken(row[0]), naam = s(row[1]); if (!k || !naam) continue;
    let id = await voertuigByKenteken(k);
    if (!id) { id = await db.insert("INSERT INTO voertuigen (kenteken, merk, status, is_leenauto) VALUES ($1,'Onbekend','op_voorraad',true)", [k]); voertuigCache.set(k, id); stats.voertuigen++; fout(`uitleen ${k}`, "stond niet in het wagenpark overzicht, aangemaakt zonder merk"); }
    const vId = vestId(row[2]);
    const bId = await bestuurder(naam, { vestiging_id: vId });
    await db.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now() WHERE voertuig_id = $1 AND status = 'actief' AND soort = 'uitleen'", [id]);
    await db.run("INSERT INTO toewijzingen (voertuig_id, bestuurder_id, soort, vestiging_id, van, tot, reden, opmerking, status) VALUES ($1,$2,'uitleen',$3,$4,$5,$6,$7,'actief')", [id, bId, vId, toDate(row[3]), toDate(row[4]), s(row[5]), s(row[6])]);
    await db.run("UPDATE voertuigen SET status = 'uitgeleend' WHERE id = $1 AND status <> 'actief'", [id]);
    stats.uitleen++;
    if (!toDate(row[4])) fout(`uitleen ${k}`, `${naam}: geen retourdatum`);
  }

  // ---- Wachtlijst ----
  for (const row of sheet("Wachtlijst").slice(1)) {
    if (!row || !s(row[0])) continue;
    const vId = vestId(row[1]);
    const bId = await bestuurder(row[0], { vestiging_id: vId });
    await db.run("INSERT INTO wachtlijst (naam, bestuurder_id, vestiging_id, datum_aanvraag, gewenste_auto, opmerking) VALUES ($1,$2,$3,$4,$5,$6)", [s(row[0]), bId, vId, toDate(row[2]), s(row[3]), s(row[4])]);
    stats.wachtlijst++;
  }

  // ---- Contacten ----
  for (const row of sheet("Contacten").slice(1)) {
    if (!row || !s(row[0])) continue;
    const naam = s(row[0]), n = norm(naam + " " + (row[5] || ""));
    const soort = n.includes("wash") || n.includes("was") ? "wasstraat" : n.includes("hypotheek") || n.includes("verzeker") ? "verzekeraar" : n.includes("brandstof") || n.includes("flux") || n.includes("tankpas") ? "tankpas" : n.includes("plakkie") || n.includes("sticker") ? "bestickering" : (s(row[4]) || n.includes("auto") || n.includes("garage") || n.includes("dealer")) ? "garage" : "overig";
    await db.run("INSERT INTO contacten (naam, soort, merk, adres, website, telefoon, opmerking) VALUES ($1,$2,$3,$4,$5,$6,$7)", [naam, soort, s(row[4]), s(row[1]), s(row[2]), s(row[3]), s(row[5])]);
    stats.contacten++;
  }

  // ---- Bandenwissel 2026 ----
  const bw = sheet("2026 - Zomerbandenwissel");
  for (let r = 1; r < bw.length; r++) {
    const row = bw[r]; if (!row) continue;
    const k = kenteken(row[0]); if (!k) continue;
    const id = await voertuigByKenteken(k);
    if (!id) { fout(`bandenwissel rij ${r + 1}`, `kenteken ${k} onbekend`); continue; }
    const gewisseld = row[6] === true || norm(row[6]) === "true" || norm(row[6]) === "ja" || norm(row[6]) === "x";
    await db.run("INSERT INTO bandenwissels (voertuig_id, seizoen, gewisseld, opmerking) VALUES ($1,'2026-zomer',$2,$3) ON CONFLICT (voertuig_id, seizoen) DO UPDATE SET gewisseld = EXCLUDED.gewisseld", [id, gewisseld, s(row[5])]);
    await db.run("UPDATE voertuigen SET banden = COALESCE(banden, 'winter_zomer') WHERE id = $1", [id]);
    stats.banden++;
  }

  // Foutlijst wegschrijven
  fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true });
  const out = path.join(__dirname, "..", "data", "import-foutlijst.txt");
  fs.writeFileSync(out, [`Import ${new Date().toISOString()} uit ${FILE}`, "", ...fouten].join("\n"));
  console.log("Klaar:", JSON.stringify(stats));
  console.log(`${fouten.length} punten op de foutlijst (${out})`);
  for (const f of fouten.slice(0, 40)) console.log("  - " + f.replace(/\+?31[\d ]{9,}|0[\d ]{9,}/g, "[tel]"));
  await db.end();
}

main().catch(async (err) => { console.error("Import mislukt:", err); await db.end().catch(() => {}); process.exit(1); });
