// src/env.js
// Leest .env in de projectmap (lokaal). Op Railway staan de variabelen in het dashboard en is er geen .env.
// Bestaande omgevingsvariabelen winnen altijd van het bestand.
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", ".env");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
