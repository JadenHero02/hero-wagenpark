// src/versies.js
// Het versienummer van de app en wat er per versie veranderde. Elke commit die iets voor gebruikers verandert
// krijgt hier een regel; de bovenste versie is de huidige. Nummering 0.<stap>.<volgnummer> tot de app bij Hero staat.
// Soorten: nieuw, verbeterd, opgelost. Het commitnummer is het korte hash (git log --oneline).

const VERSIES = [
  { versie: "0.2.4", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "een bestuurder ziet in het menu alleen nog Mijn auto; Dashboard en Mijn auto waren voor hem dezelfde pagina (feedback Vasco). Het zoekveld bovenin is er alleen voor wie het wagenpark mag zien", commit: "" },
  ] },
  { versie: "0.2.3", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "de naam Wagenpark staat in de blauwe balk naast het logo en niet meer boven het menu; dat leek te veel op de menuregel Wagenpark (feedback Huub)", commit: "1f4b6c7" },
    { soort: "verbeterd", tekst: "op de telefoon geen tekstballon meer bij het versienummer", commit: "1f4b6c7" },
  ] },
  { versie: "0.2.2", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "versiebeheer: versienummer onderin het menu, pagina Over deze versie met wat er nieuw is, bugs melden en wensen indienen met automatisch versie, scherm en apparaat erbij", commit: "ad93172" },
    { soort: "nieuw", tekst: "de app vernieuwt vanzelf zodra er een nieuwe versie staat en het scherm even niet gebruikt wordt", commit: "ad93172" },
  ] },
  { versie: "0.2.1", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "bovenbalk in Hero-blauw met het witte logo; zoekveld wordt wit zodra je erin klikt", commit: "24ff3e6" },
    { soort: "verbeterd", tekst: "kentekens zien eruit als een Nederlands kenteken: geel, zwarte rand, blauwe EU-band met NL", commit: "24ff3e6" },
  ] },
  { versie: "0.2.0", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "toewijzen start de uitgifte-checklist; innemen van een vaste auto legt de inleverdatum vast en start de inname-checklist, een leenauto neem je direct in", commit: "2bc9184" },
    { soort: "nieuw", tekst: "uitleen op verzoek: iedereen kan een leenauto aanvragen, een beheerder keurt goed of wijst af, met verlenging via \"vraag meer tijd aan\"", commit: "2bc9184" },
    { soort: "nieuw", tekst: "de vier processen als checklist per auto (instroom, uitgifte, inname, uitstroom); de grijze stappen doet de app zelf", commit: "2bc9184" },
    { soort: "nieuw", tekst: "takenmotor: APK op 90, 30 en 7 dagen en bij verstrijken, APK-rapport na de afspraak, bandenwissel, contract, rijbewijs, leenauto te laat, dagmail om 7 uur", commit: "2bc9184" },
    { soort: "nieuw", tekst: "mail via Microsoft 365 vanaf wagenparkbeheer@hero.eu, met een maillog onder Instellingen; zolang mail uit staat wordt alles alleen gelogd", commit: "2bc9184" },
    { soort: "nieuw", tekst: "documenten per auto in de app: uploaden, bekijken, downloaden; een beheerder keurt het APK-rapport goed en zet de nieuwe APK-datum", commit: "2bc9184" },
    { soort: "nieuw", tekst: "boetes: bestuurder van die datum komt er automatisch bij, de beheerder bevestigt het doorbelasten, HR krijgt mail; uitzondering alleen met reden en goedkeuring", commit: "2bc9184" },
    { soort: "nieuw", tekst: "incidenten melden met foto's, wachtlijst, archief, instellingen met termijnen en rollen", commit: "2bc9184" },
    { soort: "nieuw", tekst: "pincode van de tankpas pas zichtbaar na opnieuw inloggen, elke keer gelogd", commit: "2bc9184" },
  ] },
  { versie: "0.1.1", datum: "2026-09-15", punten: [
    { soort: "opgelost", tekst: "ontbrekende iconen in het menu en op de kaarten: de iconen komen nu van Google Fonts", commit: "623bbc8" },
  ] },
  { versie: "0.1.0", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "fundament: inloggen met het Hero-account, dashboard, wagenpark met zoeken en filters, voertuigdetail, bestuurders, contacten, Mijn auto, kilometerstand doorgeven, pincodes versleuteld", commit: "43e797e" },
    { soort: "nieuw", tekst: "de Excel Wagenparkbeheer ingelezen: 68 voertuigen, 70 bestuurders, toewijzingen, uitleen, wachtlijst, bandenwissel, met een foutlijst", commit: "43e797e" },
  ] },
];

const huidige = () => VERSIES[0].versie;
const commit = () => (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || null;
const omgeving = () => process.env.RAILWAY_ENVIRONMENT_NAME || (process.env.RAILWAY_PROJECT_ID ? "production" : "lokaal");

module.exports = { VERSIES, huidige, commit, omgeving };
