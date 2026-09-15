# Hero wagenpark

Wagenparkbeheer in de Hero-app. Vervangt de Excel met negen tabbladen door een eigen app in het Hero-platform: voertuigen, bestuurders, uitleen op verzoek, taken en mails, documenten per auto, boetes en incidenten, en "Mijn auto" voor de bestuurder op de telefoon.

## Documenten

| Bestand | Wat het is |
|---|---|
| `docs/Ontwerpplan wagenparkbeheer Hero v1.0 definitief.docx` | Het plan dat gebouwd wordt. Feedback van Niels (14 september 2026) en Annemiek (15 september 2026) verwerkt. |
| `docs/Ontwerpplan wagenparkbeheer Hero v0.7 kort.docx` | De feedbackversie met wijzigingenoverzicht en feedbackvakken. |
| `docs/Ontwerpplan wagenparkbeheer Hero v0.3.docx` | De volledige uitwerking met datamodel en processtappen, nog niet bijgewerkt op v1.0. |
| `docs/schetsen/` | De drie schetsen (dashboard, voertuigdetail, Mijn auto) als PNG en als bronbestanden van het ontwerpcanvas. |

## Planning

- Dinsdag 15 september: fundament. Repository, database, inloggen via het platform, voertuigoverzicht en detail, import van de Excel.
- Woensdag 16 september: beheer. Toewijzen, innemen, uitleen op verzoek, checklists, taken en mails, documenten, boetes, tankpas.
- Donderdag 17 september: Mijn auto, dashboard, archief, logboek, rechten. Demo.
- Vrijdag 18 september: samenvoegen met de versie van Sem.

## Besluiten

- Eigen app Wagenpark in de linkerbalk van heroapp.nl, gestart vanuit de kickstart van het framework.
- Rollen: admin (Annemiek), beheerder (celdirecteuren en office managers), bestuurder, HR per mail, directie leest mee.
- Boetes en eigen risico altijd doorbelasten: de beheerder bevestigt, HR verwerkt de inhouding.
- Pincodes van tankpassen alleen zichtbaar na een extra bevestiging, elke keer gelogd.
- Elke auto op voorraad is te leen, op verzoek, met goedkeuring van een beheerder.
- Documenten per auto in de app, meldingen per mail vanaf wagenparkbeheer@hero.eu.

Geen persoonsgegevens, echte kentekens of pincodes in deze repository. Alle gegevens in de schetsen zijn verzonnen.

## De app

Node.js 24, Express, EJS en Postgres op Supabase (project "Hero Database", eigen schema `hero_wagenpark`, eigen databaserol `hero_wagenpark_app`). Inloggen met het Hero Microsoft-account via Supabase Auth, getoetst aan de medewerkerslijst `framework.users`. Dezelfde opzet als het ATS.

```bash
npm install                 # één keer
npm start                   # http://localhost:3000 (leest .env, zie .env.example)
npm run dev                 # herstart bij elke wijziging
npm run import -- --reset   # leest de Excel (EXCEL_PATH) in en wist eerst alle wagenparkdata; foutlijst in data/import-foutlijst.txt
```

Variabelen (lokaal in `.env`, op Railway als Variables): `DATABASE_URL`, `DB_SCHEMA`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUBLIC_BASE_URL`, `PINCODE_KEY` (sleutel voor de versleutelde pincodes; nooit wijzigen zonder de pincodes opnieuw in te voeren), en voor mail `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_FROM` (Microsoft Graph, client credentials met `Mail.Send` op de mailbox van de afzender). Zolang de drie MS-variabelen ontbreken, verstuurt de app niets: elke mail komt wel in het maillog (Instellingen > Mail), zodat je ziet wat er verstuurd zou zijn. Met `MAIL_TEST_TO` gaat alle mail naar dat ene adres, met de echte ontvanger in het onderwerp; gebruik dat bij het testen, want de bestuurders uit de Excel zijn echte collega's. `TAKEN_RONDE=off` zet de automatische takenronde uit (bijvoorbeeld op een tweede omgeving). Lokaal inloggen zonder Microsoft kan met `DEV_LOGIN_EMAIL` (niet in productie).

Rollen: admin (Annemiek), beheerder (celdirecteuren en office managers), bestuurder, directie. Wie welke rol krijgt bij de eerste login staat in de tabel `instellingen` (`admin_emails`, `beheerder_emails`, `directie_emails`); iedereen anders wordt bestuurder.

Mapstructuur: `server.js` (start en routes), `src/db.js` (database), `src/auth.js` (sessies en rollen), `src/mail.js` (mail via Graph, maillog), `src/taken.js` (de takenmotor: automatische taken en herinneringen, dagmail), `src/processen.js` (de vier checklists en wat de app daarin zelf doet), `src/versies.js` (versienummer en wat er per versie veranderde; vul dit aan bij elke commit die iets voor gebruikers verandert), `src/routes/` (per onderdeel), `views/` (EJS-templates), `public/` (stijl, lettertypen, logo), `scripts/import-excel.js` (de import).

De takenmotor draait bij het opstarten en daarna elk half uur. Elke automatische taak heeft een sleutel en elke herinnering een ref in het maillog, zodat niets twee keer ontstaat. Termijnen staan in de tabel `instellingen` en zijn door de admin te wijzigen. Documenten staan in de database (`document_inhoud`, tot 10 MB per bestand), niet op schijf: Railway heeft geen blijvende schijf.

De pincode van een tankpas is pas zichtbaar na een extra bevestiging: opnieuw inloggen via Microsoft (lokaal: de dev-login). Een login telt daarna `pincode_bevestiging_minuten` (standaard 10) als bevestiging. Elke keer tonen staat in het logboek van de auto.

## Stappen

1. Fundament (15 september): repository, schema en rol in Supabase, login, dashboard, wagenpark met detail, bestuurders, contacten, Mijn auto (kern), pincodes versleuteld, Excel-import met foutlijst.
2. Beheer (15 en 16 september): toewijzen en innemen met de uitgifte- en inname-checklist, uitleen op verzoek met goedkeuring en verlenging, de vier processen als checklist met automatische stappen, takenmotor (APK met afspraak en rapport, bandenwissel, contract, rijbewijs, leenauto te laat, dagmail), mail via Graph met maillog, documenten per auto in de app, boetes met doorbelasten en uitzondering, incidenten met foto's, wachtlijst, archief, instellingen en rollen, pincode na extra bevestiging. Migratie `hero_wagenpark_stap2_beheer`. Versiebeheer: versienummer onderin het menu, pagina Over deze versie, bugs melden en wensen indienen (tabel `meldingen`, migratie `hero_wagenpark_meldingen`); de browser kijkt elke minuut naar `/version.json` en vernieuwt bij rust.
