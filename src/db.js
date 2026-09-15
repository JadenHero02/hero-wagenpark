// src/db.js
// De databaselaag. Postgres op Supabase (project "Hero Database"), in een eigen schema: hero_wagenpark.
// De app verbindt als hero_wagenpark_app: eigenaar van dat schema en verder nergens toe bevoegd.
// Tabellen worden eenmalig aangemaakt door de beheerder (migratie hero_wagenpark_fundament); de app maakt ze niet zelf.
//
// Gebruik:
//   const rows = await db.all("SELECT * FROM voertuigen WHERE vestiging_id = $1", [id]);
//   const row  = await db.one("SELECT * FROM voertuigen WHERE id = $1", [id]);   // of null
//   const r    = await db.run("UPDATE ...", [...]);                                 // r.rowCount
//   const id   = await db.insert("INSERT INTO ... VALUES ($1, $2)", [a, b]);        // geeft het nieuwe id
//   await db.tx(async (t) => { await t.run(...); await t.run(...); });              // alles of niets

const { Pool, types } = require("pg");

const SCHEMA = (process.env.DB_SCHEMA || "hero_wagenpark").replace(/[^a-z0-9_]/gi, "");
if (!process.env.DATABASE_URL) {
  console.error("Geen DATABASE_URL ingesteld. Zet de Postgres-verbinding van Supabase als variabele (zie README).");
  process.exit(1);
}

// Uitkomsten in de vorm die de templates verwachten
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));        // bigint (COUNT) -> getal
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));      // numeric -> getal
types.setTypeParser(1114, (v) => (v === null ? null : v.slice(0, 19))); // timestamp -> "jjjj-mm-dd uu:mm:ss"
types.setTypeParser(1082, (v) => v);                                    // date -> "jjjj-mm-dd"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 6,
  min: 1,
  idleTimeoutMillis: 10 * 60_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  options: `-c search_path=${SCHEMA},public -c statement_timeout=20000`,
});
pool.on("error", (err) => console.error("Databasefout (pool):", err.message));

function api(client) {
  return {
    query: (sql, params = []) => client.query(sql, params),
    all: async (sql, params = []) => (await client.query(sql, params)).rows,
    one: async (sql, params = []) => (await client.query(sql, params)).rows[0] || null,
    run: (sql, params = []) => client.query(sql, params),
    insert: async (sql, params = []) => {
      const r = await client.query(/returning/i.test(sql) ? sql : `${sql} RETURNING id`, params);
      return r.rows[0] ? r.rows[0].id : null;
    },
  };
}

const db = {
  SCHEMA,
  ...api(pool),
  // Meerdere schrijfacties die bij elkaar horen
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(api(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
  // Bij het opstarten: staat het schema er en zijn de tabellen bereikbaar?
  async init() {
    const r = await pool.query("SELECT to_regclass($1) AS t", [`${SCHEMA}.voertuigen`]);
    if (!r.rows[0].t) throw new Error(`Schema ${SCHEMA} heeft geen tabel voertuigen. Draai eerst de migratie.`);
    const v = await pool.query("SELECT COUNT(*)::int AS n FROM voertuigen");
    console.log(`Database: schema ${SCHEMA}, ${v.rows[0].n} voertuigen`);
  },
  end: () => pool.end(),
};

module.exports = db;
