// src/processen.js
// De vier processen uit de Excel als checklist per auto: instroom, uitgifte, inname, uitstroom (hoofdstuk 5 van het plan).
// Elke stap is een vinkje met naam en datum. Stappen met "automatisch" doet de app zelf zodra alle stappen ervoor zijn afgevinkt:
// taken aanmaken, mails sturen, de toewijzing activeren of sluiten, de auto op voorraad of in het archief zetten.
//
//   const id = await processen.start({ voertuigId, soort: "uitgifte", userId, toewijzingId, klaar: ["toewijzen"] });
//   await processen.afvinken(procesId, stapId, user);      // vinkt af en voert de automatische vervolgstappen uit

const db = require("./db");
const mail = require("./mail");
const taken = require("./taken");
const { formatDate } = require("./helpers");

const STAPPEN = {
  instroom: [
    { key: "aanmaken", tekst: "Auto aanmaken met kenteken of bestelnummer, status \"besteld\"", wie: "Beheerder" },
    { key: "afleverdatum", tekst: "Afleverdatum bevestigen", wie: "Beheerder" },
    { key: "voorbereiding", tekst: "Voorbereidingstaken aanmaken: verzekering, tankpas, bestickering", wie: "De app", auto: true },
    { key: "verzekering", tekst: "Verzekering regelen via Hypotheekshop Hoorn", wie: "Beheerder" },
    { key: "tankpas", tekst: "Tank- of laadpas aanvragen via MKB Brandstof of E-Flux", wie: "Beheerder" },
    { key: "bestickering", tekst: "Bestickering regelen via Plakkie", wie: "Beheerder" },
    { key: "aflevering", tekst: "Aflevering: foto's en kilometerstand vastleggen, kentekenbewijs en verzekering uploaden", wie: "Beheerder" },
    { key: "gegevens", tekst: "Gegevens aanvullen, status \"op voorraad\"", wie: "Beheerder" },
    { key: "voorraad", tekst: "Auto staat in het overzicht en is te leen tot hij wordt toegewezen", wie: "De app", auto: true },
  ],
  uitgifte: [
    { key: "toewijzen", tekst: "Auto toewijzen aan de medewerker, met ingangsdatum", wie: "Beheerder" },
    { key: "hr_mail", tekst: "HR krijgt een mail over de toewijzing", wie: "De app", auto: true },
    { key: "verzamelen", tekst: "Tankpas, pincode, kentekenbewijs en sleutel verzamelen", wie: "Beheerder" },
    { key: "wassen", tekst: "Bubble Wash en volle tank", wie: "Beheerder" },
    { key: "schaderondgang", tekst: "Schaderondgang samen met de bestuurder", wie: "Beheerder en bestuurder" },
    { key: "fotos", tekst: "Foto's en kilometerstand vastleggen", wie: "Beheerder" },
    { key: "overhandigen", tekst: "Overhandigen", wie: "Beheerder" },
    { key: "actief", tekst: "Toewijzing wordt actief. De bestuurder krijgt een mail met de link naar Mijn auto", wie: "De app", auto: true },
  ],
  inname: [
    { key: "inleverdatum", tekst: "Inleverdatum bepalen", wie: "Beheerder" },
    { key: "bestuurder_mail", tekst: "De bestuurder krijgt een mail met de datum en het verzoek om netjes en met volle tank in te leveren", wie: "De app", auto: true },
    { key: "ronde", tekst: "Ronde om de auto en foto's maken", wie: "Beheerder en bestuurder" },
    { key: "km", tekst: "Kilometerstand noteren", wie: "Beheerder" },
    { key: "innemen", tekst: "Sleutels, tankpas en toebehoren innemen", wie: "Beheerder" },
    { key: "hr_mail", tekst: "HR krijgt een mail met de inname en eventuele schade", wie: "De app", auto: true },
    { key: "sluiten", tekst: "Toewijzing wordt gesloten. De auto staat weer \"op voorraad\" en is te leen", wie: "De app", auto: true },
  ],
  uitstroom: [
    { key: "einddatum", tekst: "Einddatum bepalen (verkoop, einde lease, inlevering)", wie: "Beheerder" },
    { key: "fotos", tekst: "Foto's en kilometerstand vastleggen", wie: "Beheerder" },
    { key: "innemen", tekst: "Sleutels, groene kaart en tankpas innemen", wie: "Beheerder" },
    { key: "toebehoren", tekst: "Laadkabel en toebehoren innemen", wie: "Beheerder" },
    { key: "vrijwaring", tekst: "Vrijwaringsbewijs van de RDW uploaden", wie: "Beheerder" },
    { key: "opzeggen", tekst: "Verzekering opzeggen, tankpas blokkeren", wie: "Beheerder" },
    { key: "archief", tekst: "Auto gaat naar het archief, met alle documenten en het logboek", wie: "De app", auto: true },
  ],
};
const NAMEN = { instroom: "Instroom van een nieuwe auto", uitgifte: "Uitgifte aan een medewerker", inname: "Inname van een medewerker", uitstroom: "Uitstroom van een auto" };

async function start({ voertuigId, soort, userId, toewijzingId = null, klaar = [] }) {
  if (!STAPPEN[soort]) throw new Error(`Onbekend proces: ${soort}`);
  const lopend = await db.one("SELECT id FROM processen WHERE voertuig_id = $1 AND soort = $2 AND afgerond_op IS NULL", [voertuigId, soort]);
  if (lopend) return lopend.id;
  const id = await db.tx(async (t) => {
    const pid = await t.insert("INSERT INTO processen (voertuig_id, soort, toewijzing_id, gestart_door) VALUES ($1,$2,$3,$4)", [voertuigId, soort, toewijzingId, userId]);
    let nr = 0;
    for (const s of STAPPEN[soort]) {
      nr++;
      const done = klaar.includes(s.key);
      await t.run("INSERT INTO processtappen (proces_id, nr, omschrijving, wie, automatisch, afgevinkt_door, afgevinkt_op) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7 THEN local_now() END)", [pid, nr, s.tekst, s.wie, Boolean(s.auto), done ? userId : null, done]);
    }
    await t.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'proces',$3)", [voertuigId, userId, `Proces ${NAMEN[soort].toLowerCase()} gestart`]);
    return pid;
  });
  await verwerk(id, userId);
  return id;
}

async function laad(id) {
  const p = await db.one("SELECT p.*, v.kenteken, v.merk, v.model, v.status AS voertuig_status, v.vestiging_id, u.name AS gestart_door_naam FROM processen p JOIN voertuigen v ON v.id = p.voertuig_id LEFT JOIN users u ON u.id = p.gestart_door WHERE p.id = $1", [id]);
  if (!p) return null;
  p.stappen = await db.all("SELECT s.*, u.name AS door FROM processtappen s LEFT JOIN users u ON u.id = s.afgevinkt_door WHERE s.proces_id = $1 ORDER BY s.nr", [id]);
  p.naam = NAMEN[p.soort];
  p.klaar = p.stappen.filter((s) => s.afgevinkt_op).length;
  return p;
}

async function afvinken(procesId, stapId, user, ongedaan = false) {
  const stap = await db.one("SELECT * FROM processtappen WHERE id = $1 AND proces_id = $2", [stapId, procesId]);
  if (!stap || stap.automatisch) return;
  if (ongedaan) await db.run("UPDATE processtappen SET afgevinkt_door = NULL, afgevinkt_op = NULL WHERE id = $1", [stapId]);
  else await db.run("UPDATE processtappen SET afgevinkt_door = $2, afgevinkt_op = local_now() WHERE id = $1", [stapId, user.id]);
  if (!ongedaan) await verwerk(procesId, user.id);
}

// Automatische stappen uitvoeren zodra alles ervoor is afgevinkt; daarna het proces afronden als alles klaar is
async function verwerk(procesId, userId) {
  const p = await laad(procesId);
  if (!p || p.afgerond_op) return;
  const defs = STAPPEN[p.soort];
  for (let i = 0; i < p.stappen.length; i++) {
    const s = p.stappen[i];
    if (s.afgevinkt_op) continue;
    if (!s.automatisch) break; // wachten op een mens
    const def = defs[i];
    try { await actie(p, def.key, userId); }
    catch (err) { console.error(`Automatische stap ${p.soort}/${def.key} mislukt:`, err.message); break; }
    await db.run("UPDATE processtappen SET afgevinkt_op = local_now() WHERE id = $1", [s.id]);
    s.afgevinkt_op = "nu";
  }
  if (p.stappen.every((s) => s.afgevinkt_op)) {
    await db.run("UPDATE processen SET afgerond_op = local_now() WHERE id = $1", [procesId]);
    await db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'proces',$3)", [p.voertuig_id, userId, `Proces ${p.naam.toLowerCase()} afgerond`]);
  }
}

const autoNaam = (p) => `${p.kenteken || "besteld"} · ${p.merk} ${p.model || ""}`.trim();
const base = () => mail.baseUrl();

async function actie(p, key, userId) {
  const vid = p.voertuig_id;
  const tw = p.toewijzing_id ? await db.one("SELECT t.*, b.naam AS bestuurder, b.email AS bestuurder_email FROM toewijzingen t LEFT JOIN bestuurders b ON b.id = t.bestuurder_id WHERE t.id = $1", [p.toewijzing_id]) : null;
  const log = (tekst) => db.run("INSERT INTO logboek (voertuig_id, user_id, soort, omschrijving) VALUES ($1,$2,'proces',$3)", [vid, userId, tekst]);

  if (p.soort === "instroom" && key === "voorbereiding") {
    const deadline = taken.addDays(taken.nlNow().date, 14);
    for (const [k, titel] of [["verzekering", "Verzekering regelen via Hypotheekshop Hoorn"], ["tankpas", "Tank- of laadpas aanvragen via MKB Brandstof of E-Flux"], ["bestickering", "Bestickering regelen via Plakkie"]]) {
      await taken.maak({ voertuig_id: vid, soort: "instroom", titel: `${titel} · ${autoNaam(p)}`, deadline, voor: "beheerder", sleutel: `instroom:${p.id}:${k}` });
    }
    return log("Voorbereidingstaken aangemaakt: verzekering, tankpas, bestickering");
  }
  if (p.soort === "instroom" && key === "voorraad") {
    await db.run("UPDATE voertuigen SET status = 'op_voorraad', updated_at = local_now() WHERE id = $1 AND status = 'besteld'", [vid]);
    await taken.sluit(`instroom:${p.id}:%`, userId);
    return log("Instroom afgerond: auto staat op voorraad en is te leen");
  }
  if (p.soort === "uitgifte" && key === "hr_mail") {
    if (!tw) return;
    const hr = await mail.hr();
    await mail.send({ to: hr, subject: `Nieuwe toewijzing: ${p.kenteken || p.merk} aan ${tw.bestuurder || tw.extern_naam}`, soort: "toewijzing", ref: `toewijzing:${tw.id}`, html: mail.layout({ titel: "Nieuwe toewijzing van een bedrijfsauto", intro: "Ter informatie voor de salarisadministratie (bijtelling, reiskostenvergoeding).", regels: [["Bestuurder", tw.bestuurder || tw.extern_naam || "onbekend"], ["Auto", autoNaam(p)], ["Per", formatDate(tw.van) || "onbekend"], ["Soort", tw.soort === "vast" ? "Vast" : "Leenauto"]] }) });
    return log(hr.length ? `HR gemaild over de toewijzing (${hr.join(", ")})` : "HR-mail overgeslagen: geen HR-adres ingesteld");
  }
  if (p.soort === "uitgifte" && key === "actief") {
    if (tw && tw.bestuurder_email) await mail.send({ to: tw.bestuurder_email, subject: `Je auto ${p.kenteken}: alles op één plek in Mijn auto`, soort: "toewijzing", ref: `toewijzing_bestuurder:${tw.id}`, html: mail.layout({ titel: "Welkom in Mijn auto", intro: "Je auto staat op jouw naam. In Mijn auto geef je de kilometerstand door, zie je de tankpas, meld je een incident en zie je wat er van je verwacht wordt.", regels: [["Auto", autoNaam(p)], ["Per", formatDate(tw.van) || "vandaag"]], knop: { tekst: "Naar Mijn auto", url: `${base()}/mijn-auto` } }) });
    return log("Uitgifte afgerond, bestuurder geïnformeerd");
  }
  if (p.soort === "inname" && key === "bestuurder_mail") {
    if (tw && tw.bestuurder_email && tw.tot) await mail.send({ to: tw.bestuurder_email, subject: `Inleveren van ${p.kenteken} op ${formatDate(tw.tot)}`, soort: "inname", ref: `inname:${tw.id}:${tw.tot}`, html: mail.layout({ titel: "Je auto inleveren", intro: "Lever de auto op de afgesproken datum netjes en met volle tank (of volle accu) in bij de vestiging, met sleutels, tankpas, kentekenbewijs en toebehoren. Samen lopen we een ronde om de auto.", regels: [["Auto", autoNaam(p)], ["Inleverdatum", formatDate(tw.tot)]] }) });
    return log(tw && tw.tot ? `Bestuurder gemaild over de inleverdatum ${formatDate(tw.tot)}` : "Geen inleverdatum bekend, geen mail gestuurd");
  }
  if (p.soort === "inname" && key === "hr_mail") {
    const hr = await mail.hr();
    const incidenten = await db.all("SELECT * FROM incidenten WHERE voertuig_id = $1 AND created_at > current_date - 90 ORDER BY datum DESC", [vid]);
    await mail.send({ to: hr, subject: `Inname: ${p.kenteken || p.merk} van ${tw ? tw.bestuurder || tw.extern_naam : "onbekend"}`, soort: "inname", ref: `inname_hr:${p.id}`, html: mail.layout({ titel: "Bedrijfsauto ingenomen", intro: "Ter informatie voor de salarisadministratie.", regels: [["Bestuurder", tw ? tw.bestuurder || tw.extern_naam || "onbekend" : "onbekend"], ["Auto", autoNaam(p)], ["Ingenomen op", formatDate(taken.nlNow().date)], ["Schade of incidenten", incidenten.length ? incidenten.map((i) => `${formatDate(i.datum)} ${i.soort}${i.omschrijving ? ": " + i.omschrijving : ""}`).join("; ") : "geen"]] }) });
    return log(hr.length ? "HR gemaild over de inname" : "HR-mail overgeslagen: geen HR-adres ingesteld");
  }
  if (p.soort === "inname" && key === "sluiten") {
    await db.tx(async (t) => {
      if (tw) await t.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now(), tot = COALESCE(tot, current_date) WHERE id = $1", [tw.id]);
      await t.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now() WHERE voertuig_id = $1 AND status = 'actief' AND soort = 'vast'", [vid]);
      const nog = await t.one("SELECT 1 FROM toewijzingen WHERE voertuig_id = $1 AND status = 'actief'", [vid]);
      await t.run("UPDATE voertuigen SET status = $2, updated_at = local_now() WHERE id = $1 AND status <> 'archief'", [vid, nog ? "uitgeleend" : "op_voorraad"]);
    });
    return log(`Ingenomen van ${tw ? tw.bestuurder || tw.extern_naam || "onbekend" : "onbekend"}; auto staat op voorraad`);
  }
  if (p.soort === "uitstroom" && key === "archief") {
    await db.tx(async (t) => {
      await t.run("UPDATE toewijzingen SET status = 'afgesloten', afgesloten_op = local_now() WHERE voertuig_id = $1 AND status = 'actief'", [vid]);
      await t.run("UPDATE taken SET status = 'vervallen', afgerond_op = local_now() WHERE voertuig_id = $1 AND status = 'open'", [vid]);
      await t.run("UPDATE voertuigen SET status = 'archief', gearchiveerd_op = local_now(), updated_at = local_now() WHERE id = $1", [vid]);
    });
    return log("Uitstroom afgerond: auto naar het archief");
  }
}

module.exports = { STAPPEN, NAMEN, start, laad, afvinken, verwerk };
