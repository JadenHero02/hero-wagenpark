// src/pincode.js
// Pincodes van tankpassen staan versleuteld in de database (AES-256-GCM) met de sleutel PINCODE_KEY uit de omgeving.
// Wie de database ziet, ziet dus geen pincodes. Tonen kan alleen via de app, na een extra bevestiging, en wordt gelogd.

const crypto = require("node:crypto");

function key() {
  const raw = process.env.PINCODE_KEY || "";
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}
const isConfigured = () => key() !== null;

function encrypt(plain) {
  if (plain === null || plain === undefined || String(plain).trim() === "") return null;
  const k = key();
  if (!k) throw new Error("PINCODE_KEY ontbreekt: pincodes kunnen niet worden opgeslagen.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(String(plain).trim(), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
function decrypt(stored) {
  if (!stored) return null;
  const k = key();
  if (!k) throw new Error("PINCODE_KEY ontbreekt: pincodes kunnen niet worden getoond.");
  const [v, iv, tag, data] = String(stored).split(".");
  if (v !== "v1") throw new Error("Onbekende versleuteling.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt, isConfigured };
