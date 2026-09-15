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
