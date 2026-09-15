// src/routes/rollen.js
// Wie heeft welke rol: één tabel voor de admin, gegroepeerd op admin, directie, beheerder, bestuurder.
// Combineert de accounts (wie al is ingelogd), de rollijsten uit instellingen (wie welke rol krijgt bij de eerste login)
// en de bestuurders uit de Excel (wie nog nooit is ingelogd). Rol wijzigen werkt voor beide: account én lijst.

const express = require("express");
const db = require("../db");
const auth = require("../auth");
const employees = require("../employees");
const { clean, LABELS } = require("../helpers");

const router = express.Router();
const ROL_SLEUTEL = { admin: "admin_emails", beheerder: "beheerder_emails", directie: "directie_emails" };
const lijst = (s) => String(s || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

async function lijsten() {
  const rows = await db.all("SELECT sleutel, waarde FROM instellingen WHERE sleutel IN ('admin_emails','beheerder_emails','directie_emails')");
  const out = { admin: [], beheerder: [], directie: [] };
  for (const r of rows) for (const [rol, key] of Object.entries(ROL_SLEUTEL)) if (r.sleutel === key) out[rol] = lijst(r.waarde);
  return out;
}
async function bewaarLijsten(l) {
  for (const [rol, key] of Object.entries(ROL_SLEUTEL)) await db.run("INSERT INTO instellingen (sleutel, waarde) VALUES ($1, $2) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde", [key, [...new Set(l[rol])].join(", ")]);
}

router.get("/", auth.requireRole("admin"), async (req, res) => {
  const vestigingen = await db.all("SELECT * FROM vestigingen ORDER BY volgorde");
  const users = await db.all("SELECT u.*, ve.naam AS vestiging FROM users u LEFT JOIN vestigingen ve ON ve.id = u.vestiging_id");
  const bestuurders = await db.all(`SELECT b.id, b.naam, b.email, b.telefoon, b.user_id, ve.naam AS vestiging, v.kenteken, t.soort AS toewijzing_soort
    FROM bestuurders b LEFT JOIN vestigingen ve ON ve.id = b.vestiging_id LEFT JOIN toewijzingen t ON t.bestuurder_id = b.id AND t.status = 'actief' LEFT JOIN voertuigen v ON v.id = t.voertuig_id WHERE b.actief`);
  const contacten = await db.all("SELECT c.naam, c.email, c.soort, ve.naam AS vestiging FROM contacten c LEFT JOIN vestigingen ve ON ve.id = c.vestiging_id WHERE c.soort IN ('celdirecteur','wagenparkbeheer') AND c.email IS NOT NULL");
  const l = await lijsten();
  const emp = employees.enabled() ? await employees.allActive() : [];
  const empByMail = Object.fromEntries(emp.map((e) => [String(e.email || "").toLowerCase(), e]));

  const rijen = new Map(); // e-mail -> rij
  const rij = (email) => { const k = email.toLowerCase(); if (!rijen.has(k)) rijen.set(k, { email: k, naam: null, rol: "bestuurder", bron: null, vestiging: null, functie: [], auto: null, ingelogd: null, user_id: null, actief: true, telefoon: null }); return rijen.get(k); };
  for (const u of users) { const r = rij(u.email); Object.assign(r, { naam: u.name, rol: u.role, bron: "account", vestiging: u.vestiging, ingelogd: u.last_login_at, user_id: u.id, actief: u.is_active }); }
  for (const [rol, mails] of Object.entries(l)) for (const m of mails) { const r = rij(m); if (!r.user_id) { r.rol = rol; r.bron = "lijst"; } }
  for (const b of bestuurders) { if (!b.email) continue; const r = rij(b.email); r.naam = r.naam || b.naam; r.vestiging = r.vestiging || b.vestiging; r.telefoon = b.telefoon; if (b.kenteken) r.auto = `${b.kenteken}${b.toewijzing_soort === "uitleen" ? " (leen)" : ""}`; if (!r.bron) r.bron = "excel"; }
  for (const c of contacten) { const r = rij(c.email); r.functie.push(c.soort === "celdirecteur" ? `celdirecteur ${c.vestiging || ""}`.trim() : "wagenparkbeheer"); r.naam = r.naam || c.naam; }
  for (const r of rijen.values()) { const e = empByMail[r.email]; if (e) { r.naam = r.naam || e.name; r.jobTitle = e.job_title || null; if (!r.vestiging && e.office) r.vestiging = e.office; } r.naam = r.naam || r.email; }

  const volgorde = ["admin", "directie", "beheerder", "bestuurder"];
  const groepen = volgorde.map((rol) => ({ rol, label: LABELS.role[rol], rijen: [...rijen.values()].filter((r) => r.rol === rol).sort((a, b) => a.naam.localeCompare(b.naam)) }));
  res.render("instellingen/rollen", { title: "Rollen", groepen, vestigingen, LABELS, totaal: rijen.size });
});

// Rol toekennen of wijzigen: op het account als dat bestaat, en altijd in de lijst voor de eerste login
router.post("/", auth.requireRole("admin"), async (req, res) => {
  const email = clean(req.body.email) ? clean(req.body.email).toLowerCase() : null;
  const rol = auth.ROLES.includes(req.body.rol) ? req.body.rol : null;
  if (!email || !email.includes("@") || !rol) { res.flash("Vul een e-mailadres en een rol in.", "error"); return res.redirect("/instellingen/rollen"); }
  const l = await lijsten();
  for (const k of Object.keys(l)) l[k] = l[k].filter((m) => m !== email);
  if (l[rol]) l[rol].push(email);
  await bewaarLijsten(l);
  const u = await db.one("SELECT * FROM users WHERE lower(email) = $1", [email]);
  if (u) {
    if (u.id === req.user.id && rol !== "admin") { res.flash("Je kunt je eigen adminrol niet weghalen.", "error"); return res.redirect("/instellingen/rollen"); }
    await db.run("UPDATE users SET role = $2, vestiging_id = COALESCE($3, vestiging_id) WHERE id = $1", [u.id, rol, Number(req.body.vestiging_id) || null]);
  }
  await db.run("INSERT INTO logboek (user_id, soort, omschrijving) VALUES ($1, 'rol', $2)", [req.user.id, `${email} krijgt rol ${LABELS.role[rol]}${u ? "" : " (bij eerste login)"} door ${req.user.name}`]);
  res.flash(`${email}: ${LABELS.role[rol]}${u ? "." : ", geldt zodra deze persoon voor het eerst inlogt."}`);
  res.redirect("/instellingen/rollen");
});

router.post("/uitzetten", auth.requireRole("admin"), async (req, res) => {
  const u = await db.one("SELECT * FROM users WHERE id = $1", [Number(req.body.user_id) || 0]);
  if (!u) return res.redirect("/instellingen/rollen");
  if (u.id === req.user.id) { res.flash("Je kunt jezelf niet uitzetten.", "error"); return res.redirect("/instellingen/rollen"); }
  const aan = req.body.aan === "1";
  await db.run("UPDATE users SET is_active = $2 WHERE id = $1", [u.id, aan]);
  if (!aan) await db.run("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  res.flash(`${u.name} ${aan ? "kan weer inloggen" : "is uitgezet"}.`);
  res.redirect("/instellingen/rollen");
});

module.exports = { router };
