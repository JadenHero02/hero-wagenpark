// src/versies.js
// Het versienummer van de app en wat er per versie veranderde. Elke commit die iets voor gebruikers verandert
// krijgt hier een regel; de bovenste versie is de huidige. Nummering 0.<stap>.<volgnummer> tot de app bij Hero staat.
// Soorten: nieuw, verbeterd, opgelost. Het commitnummer is het korte hash (git log --oneline).

const VERSIES = [
  { versie: "0.3.1", datum: "2026-09-17", punten: [
    { soort: "verbeterd", tekst: "de donkere weergave is opnieuw ontworpen. Geen blauwzwarte soep meer, maar lagen: een bijna zwarte achtergrond, kaarten die er iets bovenop liggen met een dunne rand, witte koppen, Hero-blauw alleen als accent voor links en het actieve menu, de balk en het menu als één kader in diep Hero-blauw, pillen met een donkere tint en heldere tekst, rustige knoppen met de oranje actieknop, invoervelden die in de kaart liggen met een blauwe focusring, en het kenteken als echt geel bordje. Ook de inlogpagina en de kleur van de browserbalk volgen het thema", commit: "" },
  ] },
  { versie: "0.3.0", datum: "2026-09-17", punten: [
    { soort: "nieuw", tekst: "onderhoud: de app weet per auto wanneer de kleine en de grote beurt zijn. De tijd is leidend (bijvoorbeeld elke 12 maanden klein, elke 24 groot); is er een kilometerstand bekend, dan kan die de beurt naar voren halen. Zonder beurt in de app schat hij vanaf de eerste toelating en zegt dat erbij. Een maand vooraf krijgt de bestuurder dezelfde kaart als bij de APK: garage bellen, datum vastleggen; daarna \"beurt gedaan\" met de kilometerstand van de bon, waarmee het schema doorloopt. Valt de APK binnen zes weken, dan stelt de app voor die te combineren", commit: "" },
    { soort: "nieuw", tekst: "op de voertuigpagina staat Volgende beurt bij Deadlines, met de pagina Onderhoud voor afspraak, beurt gedaan, het schema per auto (beheerder) en de historie. Op het dashboard staan beurten in Komende weken en over tijd in Vandaag voor jou. Standaardschema per brandstof; per auto aan te passen, bij lease uit het contract", commit: "" },
  ] },
  { versie: "0.2.38", datum: "2026-09-17", punten: [
    { soort: "opgelost", tekst: "in de donkere weergave was een open terugroepactie op de voertuigpagina onleesbaar: wit vlak met lichte tekst. Nu een donkerrood vlak", commit: "" },
    { soort: "verbeterd", tekst: "op de telefoon toont Taken de kolommen Soort en Voor niet meer, zodat de tabel minder breed is; lange opmerkingen bij Contacten klappen in met \"meer\"; de regel over kentekenbewijzen staat niet meer op Verduurzaming", commit: "" },
  ] },
  { versie: "0.2.37", datum: "2026-09-17", punten: [
    { soort: "verbeterd", tekst: "de paginatitel is overal gelijk aan de naam in het menu: Wagenpark, Processen, Uitleen, Rollen, Taken, Wachtlijst, Incidenten en Boetes. De oude omschrijving staat er klein boven", commit: "" },
    { soort: "verbeterd", tekst: "Taken is korter: de tientallen bandenwisseltaken staan als één regel met voortgang en de knop Wie nog; lange omschrijvingen zoals een terugroepactie klap je uit met \"meer\". De knoppen heten nu Afronden en Vervallen, met uitleg", commit: "" },
    { soort: "verbeterd", tekst: "bandenwissel heeft overal dezelfde datum, de wisseldatum uit Instellingen: op het dashboard, als deadline van de taak en op de voertuigpagina", commit: "" },
    { soort: "verbeterd", tekst: "rollen: de rol wijzigen vraagt eerst om bevestiging (met extra waarschuwing bij Admin), de herhaalde tekst per persoon is weg, en Rollen is de enige plek; de e-maillijsten in Instellingen zijn verdwenen", commit: "" },
    { soort: "verbeterd", tekst: "knoppen met alleen een icoon hebben nu tekst of een tooltip: Bewerken, Vervallen, Uitzetten. Lijsten zijn met het toetsenbord te doorlopen (Tab en Enter) en een regel opent met Ctrl-klik in een nieuw tabblad", commit: "" },
    { soort: "verbeterd", tekst: "minder ruis: geen rood \"onbekend\" meer bij rijbewijs en km-stand maar een streepje, geen \"sinds onbekend\" of \"0 eerdere toewijzingen\", eigendomsvorm alleen als hij bekend is, de zoekknop staat naast het zoekveld en de tegel Leenverzoeken toont wat er open staat", commit: "" },
    { soort: "verbeterd", tekst: "processen: de knop Starten staat alleen bij instroom en uitstroom; uitgifte en inname start de app zelf bij toewijzen en innemen. Wachtlijst telt alleen personenauto's als op voorraad en toont de bestelde auto's eronder", commit: "" },
    { soort: "opgelost", tekst: "de garage per merk werd sinds vanochtend verkeerd gezocht (Tesla als \"Te\"), waardoor bij sommige auto's een verkeerde of geen garage stond", commit: "" },
    { soort: "opgelost", tekst: "in Mijn auto is de kop even breed als de kaarten, zodat de knoppen niet meer rechts loshangen", commit: "" },
  ] },
  { versie: "0.2.36", datum: "2026-09-17", punten: [
    { soort: "verbeterd", tekst: "de bandenwisseltaak heeft de wisseldatum zelf als deadline (1 oktober en 1 april) in plaats van dertig dagen later, zodat er één datum bij de taak staat en hij rood wordt zodra de datum voorbij is", commit: "" },
    { soort: "opgelost", tekst: "taaktitels tonen de auto zoals hij nu heet: bestaande open taken zijn bijgewerkt na het gelijktrekken van de modelnamen", commit: "" },
  ] },
  { versie: "0.2.35", datum: "2026-09-17", punten: [
    { soort: "verbeterd", tekst: "modelnamen zoals de fabrikant ze schrijft: de RDW levert alles in hoofdletters (\"530E XDRIVE\"), de app maakt er nu \"530e xDrive\", \"i5 eDrive40\", \"Q4 45 e-tron\" en \"V-Klasse\" van. Twaalf bestaande auto's zijn gelijkgetrokken, met een regel in het logboek", commit: "" },
    { soort: "opgelost", tekst: "de garage voor Mercedes-Benz werd niet gevonden zodra het merk met een streepje geschreven stond; de app zoekt nu op het eerste woord vóór een spatie of streepje", commit: "" },
  ] },
  { versie: "0.2.34", datum: "2026-09-17", punten: [
    { soort: "nieuw", tekst: "terugroepacties met tekst: de app haalt bij de RDW op wát er mis is, wat het gevolg is en wat de dealer eraan doet. Staat er een actie open, dan krijgt de bestuurder een taak en een mail met die tekst en de knop om de dealer te bellen; in Over deze auto staat een rood blok met de uitleg. Zodra de fabrikant herstel meldt, gaat de taak vanzelf dicht. Op de voertuigpagina staan alle acties, open en afgehandeld, in de kaart Kentekenregister", commit: "" },
    { soort: "nieuw", tekst: "APK-keuringen van de RDW op de voertuigpagina: per keuring de datum, tot wanneer hij geldig was en welke gebreken de keurmeester vond, bijvoorbeeld \"achterlicht werkt niet\". Goedgekeurd zonder gebreken staat er ook. Alleen wat de keurmeester meldt; schade zit niet in de RDW-gegevens", commit: "" },
  ] },
  { versie: "0.2.33", datum: "2026-09-16", punten: [
    { soort: "verbeterd", tekst: "boetes lopen via AFAS: HR voert de boete in de app in, de app zoekt op wie er reed, HR zet hem in AFAS en bevestigt dat met \"Staat in AFAS\". De app mailt HR niet meer, wel de bestuurder met de celdirecteur in kopie. Statussen heten nu \"Nog niet in AFAS\" en \"In AFAS, via de loonstrook\"", commit: "0114add" },
  ] },
  { versie: "0.2.32", datum: "2026-09-16", punten: [
    { soort: "nieuw", tekst: "de app is op het beginscherm van je telefoon te zetten: met een Hero-icoon Wagenpark, en hij opent dan schermvullend zonder adresbalk. In Mijn auto legt een blauwe kaart in drie stappen uit hoe (iPhone en Android); met Later verdwijnt hij een week. Dit is ook de basis voor de iOS-app", commit: "" },
  ] },
  { versie: "0.2.31", datum: "2026-09-16", punten: [
    { soort: "verbeterd", tekst: "feedback van Annemiek verwerkt. Verduurzaming staat niet meer op het dashboard maar op een eigen pagina in het menu, met de verdeling per vestiging", commit: "" },
    { soort: "verbeterd", tekst: "leenverzoeken keurt alleen nog de celdirecteur van de vestiging goed of af (uit Contacten), met de admin als reserve; de mail met het verzoek gaat naar de celdirecteur. Beheerders zien de verzoeken wel", commit: "" },
    { soort: "verbeterd", tekst: "boetes zijn afgeschermd: alleen HR en de admin zien en voeren boetes in. De admin zet HR-medewerkers bij Instellingen. Een bestuurder ziet zijn eigen boetes nog in Mijn auto", commit: "" },
    { soort: "nieuw", tekst: "bij een incident kun je vastleggen bij wie de schade is gemeld en wanneer het autobedrijf is ingeschakeld; beide staan als kolom in de lijst", commit: "" },
    { soort: "nieuw", tekst: "de zeventien auto's uit het archieftabblad van de Excel staan in het archief, waar mogelijk met merk, model en bouwjaar van de RDW", commit: "" },
  ] },
  { versie: "0.2.30", datum: "2026-09-16", punten: [
    { soort: "verbeterd", tekst: "elke rol heeft nu overal dezelfde kleur: admin oranje, directie donkerblauw, beheerder lichtblauw, bestuurder groen. Wie nog niet is ingelogd krijgt dezelfde kleur als rand in plaats van als vlak. Op Bestuurders, de bestuurderspagina en Rollen", commit: "" },
  ] },
  { versie: "0.2.29", datum: "2026-09-16", punten: [
    { soort: "verbeterd", tekst: "kolom Rol op de pagina Bestuurders laat nu voor iedereen zien wat hij is of gaat krijgen: gekleurd met de datum van de laatste login als het account bestaat, grijs met \"nog niet ingelogd\" als iemand nog nooit heeft ingelogd, en een melding als er geen e-mailadres is. Zelfde op de bestuurderspagina", commit: "" },
  ] },
  { versie: "0.2.28", datum: "2026-09-16", punten: [
    { soort: "verbeterd", tekst: "APK-pagina in twee stappen: eerst de garage voor dit merk met drie grote knoppen (bellen, website, route naar het adres), daarna de datum van de afspraak in de app zetten. Een bestaande afspraak staat bovenaan, met na de keuring de knop om het rapport te uploaden", commit: "" },
  ] },
  { versie: "0.2.27", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "zoeken in Wagenpark en Bestuurders filtert nu terwijl je typt: na een paar letters zie je alleen de regels die erbij horen, met een teller. Kentekens vind je ook zonder streepjes. Enter of Zoeken doet nog steeds de volledige zoekopdracht, bijvoorbeeld op tankpasnummer", commit: "" },
  ] },
  { versie: "0.2.26", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "in Mijn auto de knop \"Over deze auto\": een eigen pagina met wat de bestuurder over zijn auto wil weten, uit het kentekenregister van de RDW en de app. Bovenaan WA-verzekerd, APK en een eventuele terugroepactie; daaronder voertuig (soort, bouwjaar, kleur, zitplaatsen, afmetingen), motor en verbruik (brandstof, pk, verbruik, CO₂, energielabel), praktisch (trekgewicht, gewicht, banden, tankpas) en onderhoud (garage met belknop, APK, eigendom). Beheerdersgegevens zoals BPM en catalogusprijs staan er bewust niet op", commit: "" },
    { soort: "opgelost", tekst: "APK stond twee keer in Mijn auto: als \"Actie nodig\" én als losse taak. Nu alleen als Actie nodig", commit: "" },
  ] },
  { versie: "0.2.25", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "admin kan meekijken: op de pagina van een bestuurder de knop \"Bekijk als bestuurder\" opent Mijn auto precies zoals die persoon het ziet, met een oranje balk bovenaan als herinnering", commit: "" },
  ] },
  { versie: "0.2.24", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "eigen kaart \"Kentekenregister (RDW)\" op de voertuigpagina: bovenaan in één oogopslag WA-verzekerd, APK, tellerstandoordeel en eventuele terugroepactie of export; daaronder in drie kolommen voertuig (soort, kleur, eerste toelating, op naam sinds, zitplaatsen), motor en verbruik (brandstof, vermogen in pk, CO₂, verbruik, energielabel) en waarde en gewicht (catalogusprijs, BPM, massa, trekgewicht). Vernieuwen haalt het direct op; de nachtelijke ronde houdt het bij", commit: "" },
  ] },
  { versie: "0.2.23", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "pagina Processen als kaarten in plaats van lange lijsten: per proces een kaart met icoon, korte uitleg, hoeveel er lopen, een uitklapbare stappenreeks (genummerd, de app-stappen grijs) en een startknop. Lopende processen zijn kaarten met voortgangsbalk en de volgende stap. Vier naast elkaar op de computer, twee op de tablet, één op de telefoon", commit: "" },
  ] },
  { versie: "0.2.22", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "stuurgetal \"Km-stand actueel\" vervangen door \"Open taken\" (zoals in het ontwerpplan): het aantal open taken voor de beheerder, oranje als er taken over de deadline zijn; klik opent de takenlijst. Kilometerstanden blijven op de voertuigpagina, in Mijn auto en als filter in de wagenparklijst; de maandelijkse kilometerronde komt in stap 3", commit: "" },
  ] },
  { versie: "0.2.21", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "dashboard bewust rustig gehouden (ATS-feedback, en met het oog op de iOS-app): de blokken \"Laatste activiteit\" en \"Per vestiging\" zijn weer weg. Wat overblijft: vier stuurgetallen, Vandaag voor jou, Komende weken, Snel en Verduurzaming", commit: "" },
  ] },
  { versie: "0.2.20", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "het zijmenu op de computer is nu ook in het Hero-blauw, met witte tekst en een oranje streep bij het actieve en aangewezen onderdeel, net als het menupaneel op de telefoon", commit: "" },
  ] },
  { versie: "0.2.19", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "menu op telefoon en tablet: een menuknop links in de blauwe balk opent het volledige menu als paneel, met alle onderdelen onder elkaar (ook de veertien van de admin). Sluit met het kruisje, een tik naast het paneel of een keuze. De zijwaarts scrollende menurij is weg", commit: "25e6e96" },
    { soort: "verbeterd", tekst: "dat menupaneel in het Hero-blauw van de balk, met witte tekst en een oranje streep bij het actieve onderdeel", commit: "" },
  ] },
  { versie: "0.2.18", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "dashboard opnieuw ingedeeld: de vier stuurgetallen op één rij bovenaan, daaronder \"Vandaag voor jou\" en \"Komende weken\" breed links en de snelle acties en verduurzaming (als één balk) rechts. De pagina rekt op een breed scherm niet meer eindeloos uit en de kolommen lopen niet meer scheef", commit: "" },
  ] },
  { versie: "0.2.17", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "licht en donker thema: kies in het menu rechtsboven voor licht, donker of het systeem volgen. De keuze wordt per apparaat onthouden; de blauwe balk en de kentekens blijven zoals ze zijn", commit: "" },
  ] },
  { versie: "0.2.16", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "op de pagina Rollen een inklapbare rechtenmatrix: per rol (admin, directie, beheerder, bestuurder) wat je mag zien, doen en beheren", commit: "b2e0282" },
  ] },
  { versie: "0.2.15", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "pagina Rollen voor de admin: één tabel met iedereen per rol (admin, directie, beheerder, bestuurder), met functie, vestiging, auto en of iemand al is ingelogd; rol toekennen of wijzigen per regel, ook voor wie nog nooit heeft ingelogd", commit: "dbaf8e6" },
  ] },
  { versie: "0.2.14", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "dashboard opnieuw ingedeeld na de ATS-feedback: bovenaan \"Vandaag voor jou\" met per regel één knop (afspraak, beoordelen, innemen, bevestigen), daaronder wat er de komende weken aankomt (APK, leenauto's terug, contracten, rijbewijzen, wachtlijst, bestelde auto's), rechts vier stuurgetallen (rijdend, APK op orde, km-stand actueel, snelheid leenverzoeken) en de snelle acties. Opent op je eigen vestiging", commit: "5111b70" },
    { soort: "verbeterd", tekst: "bandenwissel staat alleen in het seizoen op het dashboard, als voortgang; APK's met een afspraak vragen geen actie meer", commit: "5111b70" },
  ] },
  { versie: "0.2.13", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "\"wie bel je waarvoor\" in Mijn auto: dezelfde persoon met meer rollen staat op één regel (Niels: wagenparkbeheer en celdirecteur Wognum), zonder dubbele tekst", commit: "7fd7e45" },
  ] },
  { versie: "0.2.12", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "past nu op telefoon, tablet en computer: op de telefoon een scrollend menu in één rij, het zoekveld in de balk, alles in één kolom en tabellen die zijwaarts schuiven; op de tablet twee kolommen en een smaller menu", commit: "70ab035" },
  ] },
  { versie: "0.2.11", datum: "2026-09-15", punten: [
    { soort: "opgelost", tekst: "bouwjaar en brandstof komen nu altijd van de RDW (datum eerste toelating), ook als de Excel iets anders zei: vijf bouwjaren en drie brandstoffen gecorrigeerd. Model blijft de leesbare naam uit de Excel; vier modellen met de hand rechtgezet (o.a. de Verhuisbus is een Sprinter, GLB-29-K een i4 M50)", commit: "32c0466" },
  ] },
  { versie: "0.2.10", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "het zoekveld bovenin toont direct resultaten terwijl je typt: auto's (ook op kenteken zonder streepjes en op tankpasnummer), bestuurders en contacten. Pijltjes en Enter om te kiezen, Escape sluit; Enter zonder keuze opent de gefilterde lijst", commit: "a9bd54c" },
  ] },
  { versie: "0.2.9", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "de app herkent aan het pasnummer of het een tankpas van MKB Brandstof of een laadpas van E-Flux is; Mijn auto en de voertuigpagina laten dat zien en \"wie bel je waarvoor\" toont alleen de leverancier van jouw pas. Wagenparkbeheer (Niels) en de twee pasleveranciers staan in de contacten", commit: "7d0bc6d" },
  ] },
  { versie: "0.2.8", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "wie inlogt krijgt de vestiging van zijn bestuurdersrecord, zodat beheerders meteen de mails van hun eigen vestiging krijgen. Celdirecteuren van alle vier de vestigingen staan in de contacten; beheerders en directie zijn ingesteld (namen van Niels)", commit: "19b5be3" },
  ] },
  { versie: "0.2.7", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "RDW-koppeling: bij het invoeren van een kenteken vult de app merk, model, bouwjaar, brandstof en APK-datum in vanuit de open data van de RDW. Elke dag worden alle kentekens bijgewerkt; de APK-datum komt voortaan van de RDW en de knop RDW op de voertuigpagina doet het direct", commit: "84194d5" },
    { soort: "opgelost", tekst: "APK-data uit de Excel die al verlopen leken maar volgens de RDW al vernieuwd waren, staan nu goed", commit: "84194d5" },
  ] },
  { versie: "0.2.6", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "bouwjaar en -maand in de wagenparklijst, met sorteren op bouwjaar, APK en kilometerstand; ook in de Excel-export. De schrijfwijzen uit de Excel (\"Aug 2024\", \"Mei 2021\", \"2025-07\") zijn gelijkgetrokken", commit: "bf4e6d6" },
  ] },
  { versie: "0.2.5", datum: "2026-09-15", punten: [
    { soort: "nieuw", tekst: "exporteren naar Excel (tip van Vasco, voor finance): menu Export geeft één werkboek met een tabblad per onderdeel; in het wagenpark exporteer je precies de rijen die je gefilterd hebt. Zonder pincodes, elke export in het logboek", commit: "5246107" },
  ] },
  { versie: "0.2.4", datum: "2026-09-15", punten: [
    { soort: "verbeterd", tekst: "een bestuurder ziet in het menu alleen nog Mijn auto; Dashboard en Mijn auto waren voor hem dezelfde pagina (feedback Vasco). Het zoekveld bovenin is er alleen voor wie het wagenpark mag zien", commit: "49946f9" },
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
