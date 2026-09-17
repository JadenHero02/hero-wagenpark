// src/bijtelling.js
// Bijtelling per auto: wat de bestuurder maandelijks bij zijn inkomen opgeteld krijgt voor het privégebruik.
// De app rekent het uit met de gegevens van de RDW (brandstof, eerste toelating, catalogusprijs) en de fiscale regels
// (bron: Belastingdienst, bijtelling privégebruik auto 2026). De beheerder kan percentage en grondslag per auto overschrijven.
//
// Regels in het kort:
// - Auto met uitstoot: 22% van de cataloguswaarde (eerste toelating vanaf 2017), 25% bij eerste toelating vóór 2017.
// - Nulemissie (elektrisch): verlaagd percentage over het eerste deel van de cataloguswaarde, 22% over de rest.
//   Het verlaagde tarief hangt af van het jaar van eerste toelating en geldt 60 maanden vanaf de eerste dag van de maand
//   na de eerste toelating. Daarna geldt elk jaar het tarief van dat jaar.
// - Waterstof en zonnecelauto's: het verlaagde tarief over de hele cataloguswaarde (geen drempel).
// - Plug-in hybrides tellen als auto met uitstoot: 22%.

// Verlaagd tarief voor nulemissie-auto's per jaar (eerste toelating, of het lopende jaar na de 60 maanden): [percentage, drempel]
const NULEMISSIE = {
  2014: [4, null], 2015: [4, null], 2016: [4, null], 2017: [4, null], 2018: [4, null],
  2019: [4, 50000], 2020: [8, 45000], 2021: [12, 40000], 2022: [16, 35000], 2023: [16, 30000], 2024: [16, 30000],
  2025: [17, 30000], 2026: [18, 30000], 2027: [20, 30000],
};
const ALGEMEEN = 22;
const OUD = 25; // eerste toelating vóór 2017
// Indicatie van wat het netto kost: de twee tarieven waar de meeste collega's in vallen (box 1, 2026)
const TARIEF_LAAG = 37.56;
const TARIEF_HOOG = 49.5;

function tariefNulemissie(jaar) {
  if (jaar < 2014) return NULEMISSIE[2014];
  return NULEMISSIE[jaar] || [ALGEMEEN, null];
}

function nulemissie(v) {
  const b = String(v.rdw_brandstof || "").toLowerCase();
  if (b) return b === "elektriciteit" || b === "waterstof";
  return v.milieu === "elektrisch";
}

function waterstofOfZon(v) {
  return String(v.rdw_brandstof || "").toLowerCase() === "waterstof";
}

// Einde van de 60 maanden: eerste dag van de maand na de eerste toelating, plus 60 maanden
function eindeKorting(toelating) {
  const d = new Date(toelating);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 1 + 60, 1);
}

const rond = (n) => Math.round(n * 100) / 100;
const euro0 = (n) => "€ " + Math.round(n).toLocaleString("nl-NL");
const maandJaar = (d) => d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

// Geeft een object voor de view. pct is null als er niets te rekenen valt (geen eerste toelating bekend).
function bereken(v, op = new Date()) {
  const grondslag = v.bijtelling_grondslag ? Number(v.bijtelling_grondslag) : v.rdw_catalogusprijs ? Number(v.rdw_catalogusprijs) : null;
  const handmatigPct = v.bijtelling_pct !== null && v.bijtelling_pct !== undefined && v.bijtelling_pct !== "" ? Number(v.bijtelling_pct) : null;
  const uit = {
    vanToepassing: v.bijtelling !== false, grondslag, grondslagBron: v.bijtelling_grondslag ? "handmatig" : "rdw",
    pct: null, pctBron: null, drempel: null, laagDeel: null, kortingTot: null, toelichting: "",
    brutoJaar: null, brutoMaand: null, nettoMaandLaag: null, nettoMaandHoog: null, tariefLaag: TARIEF_LAAG, tariefHoog: TARIEF_HOOG,
  };
  if (!uit.vanToepassing) {
    uit.toelichting = "Voor deze auto wordt geen bijtelling gerekend, bijvoorbeeld door een verklaring geen privégebruik of omdat het een bestelauto voor het werk is.";
    return uit;
  }

  const toelating = v.rdw_eerste_toelating ? new Date(v.rdw_eerste_toelating) : null;
  const jaarToelating = toelating && !Number.isNaN(toelating.getTime()) ? toelating.getFullYear() : null;
  let brutoJaar = null;

  if (handmatigPct !== null) {
    uit.pct = handmatigPct; uit.pctBron = "handmatig";
    uit.toelichting = "Percentage ingevuld door wagenparkbeheer.";
    if (grondslag) brutoJaar = grondslag * handmatigPct / 100;
  } else if (!jaarToelating) {
    uit.toelichting = "De datum van eerste toelating is nog niet bekend. Zodra de RDW-gegevens binnen zijn rekent de app het uit.";
    return uit;
  } else if (nulemissie(v)) {
    const einde = eindeKorting(toelating);
    const binnen60 = Boolean(einde && op < einde);
    const jaarTarief = binnen60 ? jaarToelating : op.getFullYear();
    const [pct, drempel] = tariefNulemissie(jaarTarief);
    uit.pct = pct; uit.pctBron = "berekend"; uit.kortingTot = binnen60 ? einde : null;
    uit.drempel = waterstofOfZon(v) ? null : drempel;
    if (pct >= ALGEMEEN) {
      uit.pct = ALGEMEEN; uit.drempel = null;
      uit.toelichting = binnen60 ? "Elektrisch, maar zonder verlaagd tarief: het gewone tarief van 22% geldt." : "Elektrisch; de 60 maanden met verlaagd tarief zijn voorbij, het gewone tarief van 22% geldt.";
    } else if (uit.drempel === null) {
      uit.toelichting = `${pct}% over de hele cataloguswaarde (${waterstofOfZon(v) ? "waterstof" : "eerste toelating " + jaarToelating}).`;
    } else if (binnen60) {
      uit.toelichting = `Elektrisch met eerste toelating in ${jaarToelating}: ${pct}% over de eerste ${euro0(drempel)} en 22% over de rest. Dit tarief staat vast tot ${maandJaar(einde)}.`;
    } else {
      uit.toelichting = `Elektrisch; de 60 maanden vanaf de eerste toelating zijn voorbij, dus geldt het tarief van ${jaarTarief}: ${pct}% over de eerste ${euro0(drempel)} en 22% over de rest. Volgend jaar kan dit veranderen.`;
    }
    if (grondslag) {
      if (uit.drempel === null) brutoJaar = grondslag * uit.pct / 100;
      else {
        uit.laagDeel = Math.min(grondslag, uit.drempel);
        brutoJaar = uit.laagDeel * uit.pct / 100 + Math.max(0, grondslag - uit.drempel) * ALGEMEEN / 100;
      }
    }
  } else {
    uit.pct = jaarToelating < 2017 ? OUD : ALGEMEEN; uit.pctBron = "berekend";
    uit.toelichting = jaarToelating < 2017
      ? `Eerste toelating vóór 2017: ${OUD}% van de cataloguswaarde.`
      : `Auto met uitstoot${/hybride/.test(v.milieu || "") ? " (een hybride telt als gewone auto)" : ""}: ${ALGEMEEN}% van de cataloguswaarde.`;
    if (grondslag) brutoJaar = grondslag * uit.pct / 100;
  }

  if (brutoJaar !== null) {
    uit.brutoJaar = rond(brutoJaar); uit.brutoMaand = rond(brutoJaar / 12);
    uit.nettoMaandLaag = Math.round(brutoJaar / 12 * TARIEF_LAAG / 100);
    uit.nettoMaandHoog = Math.round(brutoJaar / 12 * TARIEF_HOOG / 100);
  }
  return uit;
}

// Kort label voor lijsten en de kop van de voertuigpagina, bijvoorbeeld "18% bijtelling" of "geen bijtelling"
function kort(v, op) {
  const b = bereken(v, op);
  if (!b.vanToepassing) return "geen bijtelling";
  if (b.pct === null) return null;
  return b.drempel !== null && b.grondslag && b.grondslag > b.drempel ? `${b.pct}% / 22% bijtelling` : `${b.pct}% bijtelling`;
}

module.exports = { bereken, kort, NULEMISSIE, ALGEMEEN };
