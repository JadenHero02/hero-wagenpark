// src/mail.js
// Alle mail van de app gaat via Microsoft 365 (Graph) vanaf MAIL_FROM (wagenparkbeheer@hero.eu zodra die mailbox bestaat).
// Elke mail komt in mail_log, ook als er niet echt verstuurd wordt:
//   - zonder MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET wordt alleen gelogd (status "gelogd"), te lezen onder Instellingen > Mail
//   - met MAIL_TEST_TO gaat alles naar dat ene adres, met de echte ontvanger in het onderwerp (voor testen zonder collega's te mailen)
//
// Gebruik:
//   await mail.send({ to: "iemand@hero.eu", cc: [...], subject: "...", html: mail.layout({...}), soort: "apk", ref: "apk:12:2026-10-01:30" });
//   await mail.sentBefore("apk", "apk:12:2026-10-01:30")   // is deze al eens verstuurd? (voor herinneringen die maar één keer mogen)

const db = require("./db");

function config() {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) return null;
  return { tenant: MS_TENANT_ID, clientId: MS_CLIENT_ID, secret: MS_CLIENT_SECRET };
}
const from = () => process.env.MAIL_FROM || "wagenparkbeheer@hero.eu";
const fromName = () => process.env.MAIL_FROM_NAME || "Hero Wagenpark";
const baseUrl = () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const mode = () => (config() ? "verstuurd" : "gelogd");

let cachedToken = null;
async function token() {
  const cfg = config();
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(`Geen token van Microsoft: ${j.error_description || j.error}`);
  cachedToken = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return cachedToken.value;
}

const list = (v) => (Array.isArray(v) ? v : [v]).map((x) => (x || "").toString().trim().toLowerCase()).filter((x) => x.includes("@"));
const uniq = (arr) => [...new Set(arr)];

async function send({ to, cc = [], subject, html, soort = null, ref = null }) {
  let toList = uniq(list(to));
  let ccList = uniq(list(cc)).filter((x) => !toList.includes(x));
  if (!toList.length) {
    if (!ccList.length) return null;
    toList = ccList; ccList = [];
  }
  let finalSubject = subject;
  const test = (process.env.MAIL_TEST_TO || "").trim();
  let sendTo = toList, sendCc = ccList;
  if (test) { finalSubject = `[test, voor ${[...toList, ...ccList].join(", ")}] ${subject}`; sendTo = [test]; sendCc = []; }

  let status = mode(), fout = null;
  if (status === "verstuurd") {
    try {
      const t = await token();
      const message = {
        subject: finalSubject,
        body: { contentType: "HTML", content: html },
        toRecipients: sendTo.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: sendCc.map((a) => ({ emailAddress: { address: a } })),
        from: { emailAddress: { address: from(), name: fromName() } },
      };
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from())}/sendMail`, {
        method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!r.ok) { const txt = await r.text(); throw new Error(`Graph ${r.status}: ${txt.slice(0, 300)}`); }
    } catch (err) {
      status = "fout"; fout = err.message;
      console.error(`Mail "${subject}" naar ${toList.join(", ")} mislukt:`, err.message);
    }
  } else {
    console.log(`Mail (niet verstuurd, geen MS_* ingesteld) naar ${toList.join(", ")}: ${subject}`);
  }
  const id = await db.insert("INSERT INTO mail_log (naar, cc, onderwerp, soort, ref, status, fout, inhoud) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [toList.join(", "), ccList.join(", ") || null, subject, soort, ref, status, fout, html]);
  return id;
}

async function sentBefore(soort, ref) {
  return Boolean(await db.one("SELECT 1 FROM mail_log WHERE soort = $1 AND ref = $2 AND status <> 'fout' LIMIT 1", [soort, ref]));
}

// Vaste opmaak in de huisstijl: blauwe kop, tekstregels, één oranje knop, en de voet.
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function layout({ titel, intro = null, regels = [], knop = null, slot = null }) {
  const rows = regels.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#9496a1;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#03153f">${esc(v)}</td></tr>`).join("");
  const button = knop ? `<p style="margin:22px 0 6px"><a href="${esc(knop.url)}" style="display:inline-block;background:#f46015;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px;font-size:14px">${esc(knop.tekst)}</a></p>` : "";
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f3f6f9;font-family:Exo,Arial,Helvetica,sans-serif;color:#03153f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #dfe4e6">
<tr><td style="background:#073889;color:#fff;padding:16px 24px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Hero Wagenpark</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:#073889">${esc(titel)}</h1>
${intro ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.5">${esc(intro)}</p>` : ""}
${rows ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0">${rows}</table>` : ""}
${button}
${slot ? `<p style="margin:14px 0 0;font-size:13px;color:#9496a1;line-height:1.5">${esc(slot)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #dfe4e6;font-size:12px;color:#9496a1">Automatisch bericht van het wagenparkbeheer van Hero. Vragen? Antwoord op deze mail of bel wagenparkbeheer.</td></tr>
</table></td></tr></table></body></html>`;
}

// Ontvangers: beheerders en admins, waar mogelijk van één vestiging; anders allemaal
async function beheerders(vestigingId = null) {
  const all = await db.all("SELECT email, role, vestiging_id FROM users WHERE is_active AND role IN ('admin','beheerder')");
  const admins = all.filter((u) => u.role === "admin").map((u) => u.email);
  const local = vestigingId ? all.filter((u) => u.role === "beheerder" && u.vestiging_id === vestigingId).map((u) => u.email) : [];
  const rest = all.filter((u) => u.role === "beheerder").map((u) => u.email);
  return uniq([...admins, ...(local.length ? local : rest)]);
}
// Celdirecteur van een vestiging (uit Contacten), voor de kopie bij een boete
async function celdirecteur(vestigingId) {
  if (!vestigingId) return [];
  return (await db.all("SELECT email FROM contacten WHERE soort = 'celdirecteur' AND vestiging_id = $1 AND email IS NOT NULL", [vestigingId])).map((c) => c.email);
}
async function hr() {
  const r = await db.one("SELECT waarde FROM instellingen WHERE sleutel = 'hr_email'");
  return list((r && r.waarde) || "");
}
const bestuurderEmail = (b) => (b && b.email ? [b.email] : []);

module.exports = { send, sentBefore, layout, baseUrl, beheerders, celdirecteur, hr, bestuurderEmail, mode, from, esc };
