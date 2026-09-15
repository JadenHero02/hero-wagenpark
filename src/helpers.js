// src/helpers.js
// Kleine hulpfuncties voor routes en templates.

// Lege formuliervelden komen binnen als ""; in de database willen we dan NULL.
function clean(value) {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}
function cleanNumber(value) {
  const c = clean(value);
  if (c === null) return null;
  const n = Number(String(c).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
// "01-10-2026" of "2026-10-01" -> "2026-10-01"; anders null
function cleanDate(value) {
  const c = clean(value);
  if (!c) return null;
  let m = c.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = c.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
const yes = (v) => v === true || v === "1" || v === "on" || v === "ja" || v === "true";

// "2026-10-01" -> "01-10-2026"; met withTime: "2026-09-07 10:44:42" -> "07-09-2026 10:44"
function formatDate(value, withTime = false) {
  if (!value) return "";
  const s = String(value);
  const d = s.slice(0, 10).split("-");
  if (d.length !== 3) return s;
  const date = `${d[2]}-${d[1]}-${d[0]}`;
  return withTime && s.length >= 16 ? `${date} ${s.slice(11, 16)}` : date;
}
// Dagen tussen vandaag en een datum (positief = in de toekomst)
function daysUntil(value) {
  if (!value) return null;
  const then = new Date(String(value).slice(0, 10) + "T12:00:00");
  const now = new Date(); now.setHours(12, 0, 0, 0);
  return Math.round((then - now) / 86400000);
}
// "vandaag", "gisteren", "3 dagen geleden", "over 5 dagen"
function relativeDate(value) {
  const d = daysUntil(value);
  if (d === null) return "";
  if (d === 0) return "vandaag";
  if (d === -1) return "gisteren";
  if (d === 1) return "morgen";
  if (d < 0) return d > -7 ? `${-d} dagen geleden` : d > -60 ? `${Math.round(-d / 7)} weken geleden` : `${Math.round(-d / 30)} maanden geleden`;
  return d < 7 ? `over ${d} dagen` : d < 60 ? `over ${Math.round(d / 7)} weken` : `over ${Math.round(d / 30)} maanden`;
}
// 38412 -> "38.412"
const num = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("nl-NL"));
const euro = (n) => (n === null || n === undefined || n === "" ? "" : "€ " + Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Kenteken netjes: hoofdletters, streepjes
function kenteken(value) {
  const c = clean(value);
  return c ? c.toUpperCase().replace(/\s+/g, "") : null;
}
// "Jaden Bakker" -> "JB"
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const cap = parts.filter((p) => p[0] === p[0].toUpperCase());
  const use = cap.length >= 2 ? [cap[0], cap[cap.length - 1]] : [parts[0], parts[parts.length - 1]];
  return use.map((p) => p[0].toUpperCase()).join("");
}

const LABELS = {
  status: { besteld: "Besteld", op_voorraad: "Op voorraad", actief: "Actief", uitgeleend: "Uitgeleend", archief: "Archief" },
  eigendom: { eigendom: "Eigendom", financial_lease: "Financial lease", operational_lease: "Operational lease", huur: "Huur", onbekend: "Onbekend" },
  milieu: { benzine: "Benzine", elektrisch: "Elektrisch", hybride: "Hybride", diesel: "Diesel" },
  banden: { zomer: "Zomerbanden", winter_zomer: "Winter- en zomerbanden", all_season: "All-season" },
  role: { admin: "Admin", beheerder: "Beheerder", bestuurder: "Bestuurder", directie: "Directie" },
  contact: { garage: "Garage", verzekeraar: "Verzekeraar", tankpas: "Tankpas", bestickering: "Bestickering", wasstraat: "Wasstraat", celdirecteur: "Celdirecteur", wagenparkbeheer: "Wagenparkbeheer", overig: "Overig" },
  taak: { apk: "APK", apk_rapport: "APK-rapport", banden: "Bandenwissel", contract: "Contract", rijbewijs: "Rijbewijs", uitleen: "Leenauto", leenverzoek: "Leenverzoek", incident: "Incident", instroom: "Instroom", handmatig: "Taak" },
  document: { apk_rapport: "APK-rapport", kentekenbewijs: "Kentekenbewijs", verzekering: "Verzekering", fotos: "Foto's", vrijwaring: "Vrijwaringsbewijs", boete: "Boete", overig: "Overig" },
  boete: { nieuw: "Te bevestigen", doorbelast: "Doorbelast", uitzondering_gevraagd: "Uitzondering gevraagd", niet_doorbelast: "Niet doorbelast" },
  incident_soort: { schade: "Schade", ongeval: "Ongeval", diefstal: "Diefstal of inbraak", pech: "Pech", overig: "Overig" },
  incident_status: { gemeld: "Gemeld", in_behandeling: "In behandeling", afgerond: "Afgerond" },
  leenverzoek: { open: "Wacht op beheerder", goedgekeurd: "Goedgekeurd", afgewezen: "Afgewezen" },
  proces: { instroom: "Instroom", uitgifte: "Uitgifte", inname: "Inname", uitstroom: "Uitstroom" },
  wachtlijst: { open: "Wacht", gekoppeld: "Gekoppeld", vervallen: "Vervallen" },
};
const label = (group, key) => (LABELS[group] && LABELS[group][key]) || key || "";
// Voor tekst die een template met <%- %> invoegt
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { clean, cleanNumber, cleanDate, yes, formatDate, daysUntil, relativeDate, num, euro, kenteken, initials, LABELS, label, esc };
