// src/taken.js
// De takenmotor. Maakt automatisch taken aan en stuurt de bijbehorende mails, op basis van de termijnen in instellingen:
//   APK (90/30/7 dagen vooraf en verstreken), APK-rapport na de afspraak, bandenwissel rond 1 oktober en 1 april,
//   contracteinde, rijbewijs, leenauto morgen inleveren en leenauto te laat, open terugroepactie van de RDW. En elke werkdag de dagmail voor de beheerders.
// Draait bij het opstarten en daarna elk half uur (zie server.js). Elke taak heeft een sleutel zodat hij maar één keer ontstaat;
// elke herinnering heeft een ref in mail_log zodat hij maar één keer wordt verstuurd.
//
//   await taken.maak({ voertuig_id, bestuurder_id, soort, titel, omschrijving, deadline, voor, sleutel })
//   await taken.sluit("apk:12:%")        // open taken met deze sleutel (LIKE) op afgerond zetten
//   await taken.run()                    // de hele ronde

const db = require("./db");
const mail = require("./mail");
const rdw = require("./rdw");
const { formatDate, relativeDate, num } = require("./helpers");

// Datum en uur in Nederland, ook als de server in UTC draait (Railway)
function nlNow() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }); // "2026-09-15 14:03:00"
  return { date: s.slice(0, 10), hour: Number(s.slice(11, 13)), weekday: new Date(s.slice(0, 10) + "T12:00:00").getDay() };
}
const addDays = (date, n) => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const between = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);

async function setting(key, fallback = "") {
  const r = await db.one("SELECT waarde FROM instellingen WHERE sleutel = $1", [key]);
  return r && r.waarde !== null && r.waarde !== "" ? r.waarde : fallback;
}
const termijnen = async (key, fallback) => (await setting(key, fallback)).split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);

async function maak({ voertuig_id = null, bestuurder_id = null, soort = "handmatig", titel, omschrijving = null, deadline = null, voor = "beheerder", sleutel = null }, t = db) {
  if (sleutel && await t.one("SELECT 1 FROM taken WHERE sleutel = $1", [sleutel])) return null;
  return t.insert("INSERT INTO taken (voertuig_id, bestuurder_id, soort, titel, omschrijving, deadline, voor, sleutel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [voertuig_id, bestuurder_id, soort, titel, omschrijving, deadline, voor, sleutel]);
}
async function sluit(sleutelLike, userId = null, t = db) {
  const r = await t.run("UPDATE taken SET status = 'afgerond', afgerond_door = $2, afgerond_op = local_now() WHERE status = 'open' AND sleutel LIKE $1", [sleutelLike, userId]);
  return r.rowCount;
}
async function vervallen(sleutelLike, t = db) {
  const r = await t.run("UPDATE taken SET status = 'vervallen', afgerond_op = local_now() WHERE status = 'open' AND sleutel LIKE $1", [sleutelLike]);
  return r.rowCount;
}

const autoNaam = (v) => `${v.kenteken || "besteld"} · ${v.merk} ${v.model || ""}`.trim();
const base = () => mail.baseUrl();

// Bestuurder van dit moment (vaste toewijzing eerst, anders de lener)
async function bestuurderVan(voertuigId) {
  return db.one(`SELECT b.*, t.soort AS toewijzing_soort FROM toewijzingen t JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE t.voertuig_id = $1 AND t.status = 'actief' ORDER BY t.soort = 'vast' DESC, t.id DESC LIMIT 1`, [voertuigId]);
}
async function garageVoor(merk) {
  if (!merk) return null;
  return db.one("SELECT * FROM contacten WHERE soort = 'garage' AND merk IS NOT NULL AND lower(merk) LIKE '%' || lower($1) || '%' ORDER BY id LIMIT 1", [merk.split(/[\s-]/)[0]]);
}

// ---- APK ----
async function rondeApk(today) {
  const terms = await termijnen("apk_termijnen", "90,30,7");
  const rows = await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status IN ('actief','uitgeleend','op_voorraad') AND v.apk_vervaldatum IS NOT NULL AND v.apk_vervaldatum < $1::date + 91", [today]);
  for (const v of rows) {
    const dagen = between(today, v.apk_vervaldatum);
    const b = await bestuurderVan(v.id);
    const garage = await garageVoor(v.merk);
    const beheer = await mail.beheerders(v.vestiging_id);
    // Taak: APK inplannen, bij de bestuurder (of de beheerder als er niemand rijdt), tot er een afspraak staat
    if (!v.apk_afspraak) {
      await maak({ voertuig_id: v.id, bestuurder_id: b ? b.id : null, soort: "apk", titel: `APK inplannen · ${autoNaam(v)}`, omschrijving: `APK vervalt op ${formatDate(v.apk_vervaldatum)}. Leg de afspraak vast bij de auto.`, deadline: v.apk_vervaldatum, voor: b ? "bestuurder" : "beheerder", sleutel: `apk:${v.id}:${v.apk_vervaldatum}` });
      // Mail op de termijnen en als hij verstreken is, elk één keer
      const stage = dagen < 0 ? "verstreken" : terms.find((t) => dagen <= t);
      if (stage !== undefined) {
        const ref = `apk:${v.id}:${v.apk_vervaldatum}:${stage}`;
        if (!await mail.sentBefore("apk", ref)) {
          const titel = dagen < 0 ? `APK verstreken: ${v.kenteken}` : `APK vervalt ${relativeDate(v.apk_vervaldatum)}: ${v.kenteken}`;
          await mail.send({
            to: b ? mail.bestuurderEmail(b) : beheer, cc: b ? beheer : [], subject: titel, soort: "apk", ref,
            html: mail.layout({ titel, intro: dagen < 0 ? "De APK van deze auto is verlopen. Rijden zonder geldige APK mag niet; plan vandaag een afspraak." : "Plan de APK-keuring in en leg de afspraakdatum vast in de app. Daarna vraagt de app om het keuringsrapport.",
              regels: [["Auto", autoNaam(v)], ["APK vervalt", formatDate(v.apk_vervaldatum)], ["Bestuurder", b ? b.naam : "niemand (op voorraad)"], ...(garage ? [["Garage", `${garage.naam}${garage.telefoon ? " · " + garage.telefoon : ""}${garage.adres ? " · " + garage.adres : ""}`]] : [])],
              knop: { tekst: "Afspraak vastleggen", url: `${base()}/voertuigen/${v.id}/apk` } }),
          });
        }
      }
    } else if (v.apk_afspraak <= today) {
      // Na de afspraak: rapport uploaden, tot een beheerder het goedkeurt
      const id = await maak({ voertuig_id: v.id, bestuurder_id: b ? b.id : null, soort: "apk_rapport", titel: `APK-rapport uploaden · ${autoNaam(v)}`, omschrijving: `De keuring stond gepland op ${formatDate(v.apk_afspraak)}. Upload het keuringsrapport bij de auto; een beheerder keurt het goed en zet de nieuwe APK-datum.`, deadline: addDays(v.apk_afspraak, 7), voor: b ? "bestuurder" : "beheerder", sleutel: `apk_rapport:${v.id}:${v.apk_afspraak}` });
      if (id) await mail.send({
        to: b ? mail.bestuurderEmail(b) : beheer, subject: `APK-rapport uploaden: ${v.kenteken}`, soort: "apk_rapport", ref: `apk_rapport:${v.id}:${v.apk_afspraak}`,
        html: mail.layout({ titel: "Upload het APK-rapport", intro: "De APK-afspraak is geweest. Upload het keuringsrapport bij de auto, dan zet een beheerder de nieuwe APK-datum.", regels: [["Auto", autoNaam(v)], ["Afspraak", formatDate(v.apk_afspraak)]], knop: { tekst: "Rapport uploaden", url: `${base()}/voertuigen/${v.id}/documenten?soort=apk_rapport` } }),
      });
    }
  }
}

// ---- Contract eindigt (beheerder) ----
async function rondeContract(today) {
  const terms = await termijnen("contract_termijnen", "90,30,7");
  const rows = await db.all("SELECT * FROM voertuigen WHERE status IN ('actief','uitgeleend','op_voorraad','besteld') AND contract_einde IS NOT NULL AND contract_einde < $1::date + 91", [today]);
  for (const v of rows) {
    const dagen = between(today, v.contract_einde);
    await maak({ voertuig_id: v.id, soort: "contract", titel: `Contract eindigt · ${autoNaam(v)}`, omschrijving: `${v.leasemaatschappij ? v.leasemaatschappij + ", " : ""}einddatum ${formatDate(v.contract_einde)}. Verlengen, inleveren of vervangen?`, deadline: v.contract_einde, voor: "beheerder", sleutel: `contract:${v.id}:${v.contract_einde}` });
    const stage = dagen < 0 ? "verstreken" : terms.find((t) => dagen <= t);
    if (stage === undefined) continue;
    const ref = `contract:${v.id}:${v.contract_einde}:${stage}`;
    if (await mail.sentBefore("contract", ref)) continue;
    const titel = dagen < 0 ? `Contract verlopen: ${v.kenteken || v.merk}` : `Contract eindigt ${relativeDate(v.contract_einde)}: ${v.kenteken || v.merk}`;
    await mail.send({ to: await mail.beheerders(v.vestiging_id), subject: titel, soort: "contract", ref, html: mail.layout({ titel, regels: [["Auto", autoNaam(v)], ["Soort", v.eigendom], ["Maatschappij", v.leasemaatschappij || "onbekend"], ["Einddatum", formatDate(v.contract_einde)]], knop: { tekst: "Naar de auto", url: `${base()}/voertuigen/${v.id}` } }) });
  }
}

// ---- Rijbewijs verloopt (bestuurder, beheerder in kopie) ----
async function rondeRijbewijs(today) {
  const terms = await termijnen("rijbewijs_termijnen", "90,30");
  const rows = await db.all("SELECT * FROM bestuurders WHERE actief AND rijbewijs_geldig_tot IS NOT NULL AND rijbewijs_geldig_tot < $1::date + 91", [today]);
  for (const b of rows) {
    const dagen = between(today, b.rijbewijs_geldig_tot);
    await maak({ bestuurder_id: b.id, soort: "rijbewijs", titel: `Rijbewijs verloopt · ${b.naam}`, omschrijving: `Geldig tot ${formatDate(b.rijbewijs_geldig_tot)}. Vraag de nieuwe datum op.`, deadline: b.rijbewijs_geldig_tot, voor: "beheerder", sleutel: `rijbewijs:${b.id}:${b.rijbewijs_geldig_tot}` });
    const stage = dagen < 0 ? "verstreken" : terms.find((t) => dagen <= t);
    if (stage === undefined) continue;
    const ref = `rijbewijs:${b.id}:${b.rijbewijs_geldig_tot}:${stage}`;
    if (await mail.sentBefore("rijbewijs", ref)) continue;
    const titel = dagen < 0 ? "Je rijbewijs is verlopen" : `Je rijbewijs verloopt ${relativeDate(b.rijbewijs_geldig_tot)}`;
    await mail.send({ to: mail.bestuurderEmail(b), cc: await mail.beheerders(b.vestiging_id), subject: titel, soort: "rijbewijs", ref, html: mail.layout({ titel, intro: "Verleng je rijbewijs op tijd en geef de nieuwe geldigheidsdatum door aan wagenparkbeheer.", regels: [["Geldig tot", formatDate(b.rijbewijs_geldig_tot)]] }) });
  }
}

// ---- Bandenwissel: vanaf twee weken voor de wisseldatum tot zes weken erna; de wisseldatum is de deadline van de taak ----
async function rondeBanden(today) {
  const jaar = today.slice(0, 4);
  for (const [seizoen, key, fallback, tekst] of [["winter", "bandenwissel_winter", "10-01", "winterbanden"], ["zomer", "bandenwissel_zomer", "04-01", "zomerbanden"]]) {
    const md = await setting(key, fallback);
    const datum = `${jaar}-${md}`;
    const dagen = between(today, datum);
    if (dagen > 14 || dagen < -42) continue;
    const sz = `${jaar}-${seizoen}`;
    const rows = await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status IN ('actief','uitgeleend') AND v.banden = 'winter_zomer'");
    for (const v of rows) {
      await db.run("INSERT INTO bandenwissels (voertuig_id, seizoen) VALUES ($1, $2) ON CONFLICT DO NOTHING", [v.id, sz]);
      const done = await db.one("SELECT gewisseld FROM bandenwissels WHERE voertuig_id = $1 AND seizoen = $2", [v.id, sz]);
      if (done && done.gewisseld) continue;
      const b = await bestuurderVan(v.id);
      const garage = await garageVoor(v.merk);
      await maak({ voertuig_id: v.id, bestuurder_id: b ? b.id : null, soort: "banden", titel: `${tekst[0].toUpperCase() + tekst.slice(1)} laten monteren · ${autoNaam(v)}`, omschrijving: `Maak een afspraak bij de garage en vink af zodra de ${tekst} erop zitten.`, deadline: datum, voor: b ? "bestuurder" : "beheerder", sleutel: `banden:${v.id}:${sz}` });
      const ref = `banden:${v.id}:${sz}`;
      if (b && !await mail.sentBefore("banden", ref)) await mail.send({ to: mail.bestuurderEmail(b), subject: `Tijd voor ${tekst}: ${v.kenteken}`, soort: "banden", ref, html: mail.layout({ titel: `Laat de ${tekst} monteren`, intro: `Het seizoen wisselt rond ${formatDate(datum)}. Maak een afspraak bij de garage en meld in de app dat de banden gewisseld zijn.`, regels: [["Auto", autoNaam(v)], ...(garage ? [["Garage", `${garage.naam}${garage.telefoon ? " · " + garage.telefoon : ""}`]] : [])], knop: { tekst: "Naar Mijn auto", url: `${base()}/mijn-auto` } }) });
    }
  }
}

// ---- Leenauto's: morgen inleveren, en te laat ----
async function rondeUitleen(today) {
  const vooraf = Number(await setting("uitleen_herinnering_dagen", "1")) || 1;
  const rows = await db.all(`SELECT t.*, v.kenteken, v.merk, v.model, v.vestiging_id AS v_vestiging, b.naam AS lener, b.email AS lener_email
    FROM toewijzingen t JOIN voertuigen v ON v.id = t.voertuig_id LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE t.status = 'actief' AND t.soort = 'uitleen' AND t.tot IS NOT NULL AND t.tot <= $1::date + $2::int`, [today, vooraf]);
  for (const t of rows) {
    const v = { kenteken: t.kenteken, merk: t.merk, model: t.model };
    const dagen = between(today, t.tot);
    if (dagen >= 0 && dagen <= vooraf) {
      const ref = `uitleen_herinnering:${t.id}:${t.tot}`;
      if (t.lener_email && !await mail.sentBefore("uitleen", ref)) await mail.send({ to: t.lener_email, subject: `Leenauto ${t.kenteken} ${dagen === 0 ? "vandaag" : dagen === 1 ? "morgen" : "over " + dagen + " dagen"} inleveren`, soort: "uitleen", ref, html: mail.layout({ titel: `Leenauto ${dagen === 1 ? "morgen" : "binnenkort"} inleveren`, intro: "Lever de auto netjes en met volle tank in bij de vestiging. Heb je hem langer nodig? Vraag dan meer tijd aan; een beheerder keurt dat goed.", regels: [["Auto", autoNaam(v)], ["Retourdatum", formatDate(t.tot)]], knop: { tekst: "Vraag meer tijd aan", url: `${base()}/mijn-auto` } }) });
    } else if (dagen < 0) {
      const id = await maak({ voertuig_id: t.voertuig_id, bestuurder_id: t.bestuurder_id, soort: "uitleen", titel: `Leenauto te laat terug · ${autoNaam(v)}`, omschrijving: `${t.lener || t.extern_naam || "Onbekend"} zou de auto op ${formatDate(t.tot)} inleveren.`, deadline: t.tot, voor: "beheerder", sleutel: `uitleen_telaat:${t.id}:${t.tot}` });
      if (id) await mail.send({ to: await mail.beheerders(t.v_vestiging), cc: t.lener_email ? [t.lener_email] : [], subject: `Leenauto te laat: ${t.kenteken}`, soort: "uitleen", ref: `uitleen_telaat:${t.id}:${t.tot}`, html: mail.layout({ titel: "Leenauto is niet ingeleverd", regels: [["Auto", autoNaam(v)], ["Lener", t.lener || t.extern_naam || "onbekend"], ["Retourdatum", formatDate(t.tot)]], knop: { tekst: "Naar uitleen", url: `${base()}/uitleen` } }) });
    }
  }
}

// ---- Terugroepactie (RDW): taak voor de bestuurder zolang hij openstaat, met de tekst van de RDW; klaar zodra de producent herstel meldt ----
async function rondeTerugroep(today) {
  const rows = await db.all("SELECT v.*, ve.naam AS vestiging FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id WHERE v.status IN ('actief','uitgeleend','op_voorraad') AND jsonb_typeof(v.rdw_extra->'terugroepacties') = 'array' AND jsonb_array_length(v.rdw_extra->'terugroepacties') > 0");
  for (const v of rows) {
    for (const a of v.rdw_extra.terugroepacties) {
      const sleutel = `terugroep:${v.id}:${a.code}`;
      if (!a.open) { await sluit(sleutel); continue; }
      const b = await bestuurderVan(v.id);
      const garage = await garageVoor(v.merk);
      const omschrijving = [a.omschrijving, a.herstel ? "Oplossing: " + a.herstel : null, "Bel de dealer voor een afspraak; de reparatie is gratis. Zet de taak op Gedaan als de afspraak staat."].filter(Boolean).join(" ");
      const id = await maak({ voertuig_id: v.id, bestuurder_id: b ? b.id : null, soort: "terugroep", titel: `Terugroepactie · ${autoNaam(v)}`, omschrijving, deadline: addDays(today, 30), voor: b ? "bestuurder" : "beheerder", sleutel });
      if (!id || await mail.sentBefore("terugroep", sleutel)) continue;
      const beheer = await mail.beheerders(v.vestiging_id);
      await mail.send({
        to: b ? mail.bestuurderEmail(b) : beheer, cc: b ? beheer : [], subject: `Terugroepactie voor ${v.kenteken}: bel de dealer`, soort: "terugroep", ref: sleutel,
        html: mail.layout({ titel: "De fabrikant roept deze auto terug", intro: "De RDW meldt een openstaande terugroepactie voor jouw auto. Bel de dealer voor een afspraak; de reparatie is gratis. Zet daarna in de app de taak op Gedaan.",
          regels: [["Auto", autoNaam(v)], ["Wat is er", a.omschrijving || "zie de dealer"], ...(a.gevolg ? [["Gevolg", a.gevolg]] : []), ...(a.herstel ? [["Oplossing", a.herstel]] : []), ["RDW-code", a.code], ...(garage ? [["Dealer", `${garage.naam}${garage.telefoon ? " · " + garage.telefoon : ""}`]] : []), ...(a.telefoon ? [["Fabrikant", a.telefoon]] : [])],
          knop: { tekst: "Naar Mijn auto", url: `${base()}/mijn-auto` } }),
      });
    }
  }
}

// ---- Dagmail: elke werkdag om dagmail_uur, per beheerder ----
async function dagmail(now) {
  if (now.weekday === 0 || now.weekday === 6) return;
  const uur = Number(await setting("dagmail_uur", "7"));
  if (now.hour < uur) return;
  const ref = `dagmail:${now.date}`;
  if (await mail.sentBefore("dagmail", ref)) return;
  const users = await db.all("SELECT * FROM users WHERE is_active AND role IN ('admin','beheerder')");
  if (!users.length) return;
  const week = addDays(now.date, 7);
  const taken = await db.all("SELECT t.*, v.kenteken, v.merk, v.model FROM taken t LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE t.status = 'open' AND t.voor = 'beheerder' AND (t.deadline IS NULL OR t.deadline <= $1) ORDER BY t.deadline NULLS LAST LIMIT 25", [week]);
  const verzoeken = await db.one("SELECT COUNT(*) AS n FROM leenverzoeken WHERE status = 'open'");
  const rapporten = await db.one("SELECT COUNT(*) AS n FROM documenten WHERE soort = 'apk_rapport' AND goedgekeurd_op IS NULL");
  const teLaat = taken.filter((t) => t.deadline && t.deadline < now.date).length;
  const regels = [["Taken deze week", `${taken.length}${teLaat ? ` (${teLaat} te laat)` : ""}`], ["Open leenverzoeken", String(verzoeken.n)], ["APK-rapporten te beoordelen", String(rapporten.n)]];
  const lijst = taken.slice(0, 12).map((t) => `${t.deadline ? formatDate(t.deadline) + " · " : ""}${t.titel}`);
  const html = mail.layout({ titel: `Wagenpark vandaag, ${formatDate(now.date)}`, regels: [...regels, ...lijst.map((l, i) => [i === 0 ? "Taken" : "", l])], knop: { tekst: "Naar het dashboard", url: `${base()}/` } });
  await mail.send({ to: users.map((u) => u.email), subject: `Wagenpark vandaag: ${taken.length} taken, ${verzoeken.n} leenverzoeken`, soort: "dagmail", ref, html });
}

// Eén keer per dag alle kentekens langs de RDW: APK-data en lege velden bijwerken, vóór de APK-ronde
async function rondeRdw(today) {
  if ((await setting("rdw_laatste_ronde", "")) === today) return;
  const u = await rdw.alles(null);
  await db.run("INSERT INTO instellingen (sleutel, waarde) VALUES ('rdw_laatste_ronde', $1) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde", [today]);
  console.log(`RDW-ronde: ${u.gevonden}/${u.totaal} gevonden, ${u.gewijzigd} bijgewerkt, ${u.fouten} fouten`);
}

let running = false;
async function run() {
  if (running) return;
  running = true;
  const now = nlNow();
  try { await rondeRdw(now.date); } catch (err) { console.error("RDW-ronde mislukt:", err.message); }
  for (const [naam, fn] of [["apk", rondeApk], ["contract", rondeContract], ["rijbewijs", rondeRijbewijs], ["banden", rondeBanden], ["uitleen", rondeUitleen], ["terugroep", rondeTerugroep]]) {
    try { await fn(now.date); } catch (err) { console.error(`Takenronde ${naam} mislukt:`, err.message); }
  }
  try { await dagmail(now); } catch (err) { console.error("Dagmail mislukt:", err.message); }
  running = false;
}

function start() {
  setTimeout(() => run().catch(() => {}), 5000);
  setInterval(() => run().catch(() => {}), 30 * 60 * 1000);
}

module.exports = { maak, sluit, vervallen, run, start, bestuurderVan, garageVoor, autoNaam, nlNow, addDays, setting, num };
