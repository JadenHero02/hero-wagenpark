// src/herken.js
// Herkent wat een geüpload bestand is (idee van Huub, 17-09-2026): een foto van een deuk is "Foto's" met "schade linker portier",
// een keuringsrapport is "APK-rapport" met de nieuwe vervaldatum, een polisblad is "Verzekering", een kentekencard "Kentekenbewijs",
// een CJIB-brief "Boete" met bedrag en datum. Met ANTHROPIC_API_KEY kijkt Claude naar de inhoud (foto's en pdf's);
// zonder sleutel, of als de API niet antwoordt, valt hij terug op de bestandsnaam en het bestandstype. De gebruiker bevestigt altijd.
//
//   const voorstellen = await herken(files, { kenteken, merk, model });   // één voorstel per bestand, in dezelfde volgorde

const { LABELS } = require("./helpers");

const MODEL = process.env.HERKEN_MODEL || "claude-opus-5";
const SOORTEN = Object.keys(LABELS.document);

// Terugval: bestandsnaam en type
function opNaam(f) {
  const n = String(f.originalname || "").toLowerCase();
  const beeld = /^image\//.test(f.mimetype || "");
  const kies = (soort, omschrijving, zekerheid) => ({ soort, omschrijving, zekerheid, velden: {}, via: "naam" });
  if (/apk|keuring|rdw/.test(n)) return kies("apk_rapport", "Keuringsrapport", 0.6);
  if (/kenteken|kentekencard|kentekenbewijs|tenaamstelling/.test(n)) return kies("kentekenbewijs", "", 0.6);
  if (/verzeker|polis|wa-|groene kaart|groenekaart/.test(n)) return kies("verzekering", "", 0.6);
  if (/vrijwaring|vrijwaringsbewijs/.test(n)) return kies("vrijwaring", "", 0.6);
  if (/boete|cjib|bekeuring|beschikking|naheffing/.test(n)) return kies("boete", "", 0.6);
  if (/schade|deuk|kras|bumper|foto|img_|dsc|whatsapp/.test(n) || beeld) return kies("fotos", beeld ? "Foto van de auto" : "", beeld ? 0.5 : 0.4);
  return kies("overig", "", 0.2);
}

// Wat Claude terug moet geven, per bestand
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bestanden"],
  properties: {
    bestanden: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "soort", "omschrijving", "zekerheid", "apk_vervaldatum", "bedrag", "datum", "kenteken_klopt"],
        properties: {
          index: { type: "integer", description: "Volgnummer van het bestand, vanaf 0, in de volgorde van aanlevering" },
          soort: { type: "string", enum: SOORTEN, description: "apk_rapport = APK-keuringsrapport of keuringsbewijs; kentekenbewijs = kentekencard of tenaamstellingsbewijs; verzekering = polisblad, groene kaart of verzekeringsbewijs; fotos = foto van de auto, ook schade; vrijwaring = vrijwaringsbewijs bij verkoop of inlevering; boete = CJIB-beschikking, parkeerboete, naheffing; overig = al het andere" },
          omschrijving: { type: "string", description: "Korte Nederlandse omschrijving voor bij het document, maximaal 12 woorden. Bij schade: wat en waar, bijvoorbeeld 'deuk in linker achterportier'. Bij een boete: overtreding en plaats. Leeg als er niets nuttigs te zeggen is." },
          zekerheid: { type: "number", description: "Hoe zeker je bent van de soort, 0 tot 1" },
          apk_vervaldatum: { type: ["string", "null"], description: "Alleen bij een APK-rapport: de nieuwe vervaldatum als JJJJ-MM-DD, anders null" },
          bedrag: { type: ["number", "null"], description: "Alleen bij een boete: het bedrag in euro's, anders null" },
          datum: { type: ["string", "null"], description: "Datum op het document als JJJJ-MM-DD (keuringsdatum, overtredingsdatum, ingangsdatum), anders null" },
          kenteken_klopt: { type: ["boolean", "null"], description: "Als er een kenteken op het document staat: is het hetzelfde als het kenteken van deze auto? Anders null" },
        },
      },
    },
  },
};

const BEELD = /^image\/(jpeg|png|webp|gif)$/i;

async function metClaude(files, auto) {
  const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const content = [];
  const aangeleverd = [];
  files.forEach((f, i) => {
    const naam = String(f.originalname || "bestand");
    if (BEELD.test(f.mimetype)) {
      content.push({ type: "text", text: `Bestand ${i}: ${naam}` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mimetype.toLowerCase(), data: f.buffer.toString("base64") } });
      aangeleverd.push(i);
    } else if (/^application\/pdf$/i.test(f.mimetype) && f.size <= 8 * 1024 * 1024) {
      content.push({ type: "text", text: `Bestand ${i}: ${naam}` });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.buffer.toString("base64") } });
      aangeleverd.push(i);
    } else {
      content.push({ type: "text", text: `Bestand ${i}: ${naam} (${f.mimetype}, inhoud niet meegestuurd; oordeel op de naam)` });
      aangeleverd.push(i);
    }
  });
  content.push({ type: "text", text: `Dit zijn ${files.length} bestand(en) die iemand bij een auto in de wagenpark-app van Hero wil opslaan. Auto: ${auto.kenteken || "kenteken onbekend"}, ${auto.merk || ""} ${auto.model || ""}. Bepaal per bestand de soort en vul de velden. Geef voor elk bestand precies één regel terug, index 0 tot ${files.length - 1}.` });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: "Je sorteert documenten en foto's voor een wagenparkbeheerder in Nederland. Je antwoordt uitsluitend met het gevraagde JSON. Wees eerlijk over onzekerheid: bij twijfel een lagere zekerheid en soort 'overig'.",
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    thinking: { type: "adaptive" },
  });
  if (response.stop_reason === "refusal") throw new Error("Het model wilde deze bestanden niet beoordelen.");
  const tekst = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const j = JSON.parse(tekst);
  const per = new Map((j.bestanden || []).map((b) => [b.index, b]));
  return files.map((f, i) => {
    const b = per.get(i);
    if (!b || !SOORTEN.includes(b.soort)) return { ...opNaam(f), via: "naam" };
    const velden = {};
    if (b.apk_vervaldatum && /^\d{4}-\d{2}-\d{2}$/.test(b.apk_vervaldatum)) velden.apk_vervaldatum = b.apk_vervaldatum;
    if (typeof b.bedrag === "number" && b.bedrag > 0) velden.bedrag = Math.round(b.bedrag * 100) / 100;
    if (b.datum && /^\d{4}-\d{2}-\d{2}$/.test(b.datum)) velden.datum = b.datum;
    if (b.kenteken_klopt === false) velden.kenteken_anders = true;
    return { soort: b.soort, omschrijving: String(b.omschrijving || "").slice(0, 120), zekerheid: Math.max(0, Math.min(1, Number(b.zekerheid) || 0)), velden, via: "ai" };
  });
}

async function herken(files, auto = {}) {
  const lijst = (files || []).filter((f) => f && f.size);
  if (!lijst.length) return [];
  if (!process.env.ANTHROPIC_API_KEY) return lijst.map((f) => opNaam(f));
  try {
    return await metClaude(lijst, auto);
  } catch (err) {
    console.error("Herkennen via Claude mislukt, terug naar bestandsnaam:", err.message);
    return lijst.map((f) => ({ ...opNaam(f), fout: "AI niet beschikbaar" }));
  }
}

module.exports = { herken, opNaam, beschikbaar: () => Boolean(process.env.ANTHROPIC_API_KEY) };
