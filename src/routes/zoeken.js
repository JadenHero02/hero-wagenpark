// src/routes/zoeken.js
// Zoeken-terwijl-je-typt voor het zoekveld in de bovenbalk: auto's, bestuurders en contacten in één lijst.
// De browser vraagt /zoeken.json?q=... op vanaf twee tekens (zie de script in partials/footer.ejs).

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { clean, label } = require("../helpers");

const router = express.Router();

router.get("/zoeken.json", auth.requireRole("directie"), async (req, res) => {
  const q = clean(req.query.q);
  res.setHeader("Cache-Control", "no-store");
  if (!q || q.length < 2) return res.json({ groepen: [] });
  const like = `%${q}%`;
  const plaat = `%${q.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`;
  const voertuigen = await db.all(`
    SELECT v.id, v.kenteken, v.merk, v.model, v.status, ve.naam AS vestiging, COALESCE(b.naam, t.extern_naam) AS bestuurder
    FROM voertuigen v LEFT JOIN vestigingen ve ON ve.id = v.vestiging_id
    LEFT JOIN toewijzingen t ON t.voertuig_id = v.id AND t.status = 'actief' LEFT JOIN bestuurders b ON b.id = t.bestuurder_id
    WHERE regexp_replace(upper(coalesce(v.kenteken, '')), '[^A-Z0-9]', '', 'g') LIKE $2 OR v.merk ILIKE $1 OR v.model ILIKE $1 OR v.notitie ILIKE $1 OR b.naam ILIKE $1 OR t.extern_naam ILIKE $1 OR v.tankpas_nummer ILIKE $1
    ORDER BY CASE WHEN regexp_replace(upper(coalesce(v.kenteken, '')), '[^A-Z0-9]', '', 'g') LIKE $2 THEN 0 ELSE 1 END, v.status = 'archief', v.kenteken NULLS LAST LIMIT 6`, [like, plaat]);
  const bestuurders = await db.all(`
    SELECT b.id, b.naam, b.email, ve.naam AS vestiging, v.kenteken
    FROM bestuurders b LEFT JOIN vestigingen ve ON ve.id = b.vestiging_id
    LEFT JOIN toewijzingen t ON t.bestuurder_id = b.id AND t.status = 'actief' LEFT JOIN voertuigen v ON v.id = t.voertuig_id
    WHERE b.actief AND (b.naam ILIKE $1 OR b.email ILIKE $1) ORDER BY b.naam LIMIT 5`, [like]);
  const contacten = await db.all("SELECT c.id, c.naam, c.soort, c.merk, c.telefoon, ve.naam AS vestiging FROM contacten c LEFT JOIN vestigingen ve ON ve.id = c.vestiging_id WHERE c.naam ILIKE $1 OR c.merk ILIKE $1 ORDER BY c.naam LIMIT 4", [like]);
  const groepen = [];
  if (voertuigen.length) groepen.push({ titel: "Auto's", items: voertuigen.map((v) => ({ url: `/voertuigen/${v.id}`, plaat: v.kenteken || "besteld", titel: `${v.merk} ${v.model || ""}`.trim(), sub: [v.bestuurder, v.vestiging, label("status", v.status)].filter(Boolean).join(" · ") })) });
  if (bestuurders.length) groepen.push({ titel: "Bestuurders", items: bestuurders.map((b) => ({ url: `/bestuurders/${b.id}`, icoon: "person", titel: b.naam, sub: [b.kenteken ? "rijdt " + b.kenteken : "geen auto", b.vestiging].filter(Boolean).join(" · ") })) });
  if (contacten.length) groepen.push({ titel: "Contacten", items: contacten.map((c) => ({ url: `/contacten`, icoon: "contacts", titel: c.naam, sub: [label("contact", c.soort), c.merk, c.vestiging, c.telefoon].filter(Boolean).join(" · ") })) });
  res.json({ groepen, alles: `/voertuigen?q=${encodeURIComponent(q)}` });
});

module.exports = { router };
