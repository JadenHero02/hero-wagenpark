// src/employees.js
// De medewerkerslijst van Hero staat al in Supabase: framework.users, bijgehouden vanuit Microsoft 365.
// De app leest die lijst via twee functies in het eigen schema die met beheerdersrechten draaien
// (hero_wagenpark.employee_by_email en employees_active). Verder heeft de app nergens rechten op.
// Sta je actief op de lijst, dan mag je inloggen.

const db = require("./db");

const enabled = () => (process.env.EMPLOYEE_LIST || "on").toLowerCase() !== "off";

async function findEmployee(email) {
  if (!enabled() || !email) return null;
  const r = await db.one("SELECT * FROM employee_by_email($1)", [email.toLowerCase()]);
  if (!r) return null;
  return { name: r.display_name || null, email: r.email, jobTitle: r.job_title || null, department: r.department || null, office: r.office_location || null, isAdmin: Boolean(r.is_admin), phone: r.mobile_phone || r.phone || null };
}

// Alle actieve collega's, voor het koppelen van namen uit de Excel aan e-mailadressen
async function allActive() {
  if (!enabled()) return [];
  return db.all("SELECT display_name AS name, email, job_title, department, office_location AS office, coalesce(mobile_phone, phone) AS phone FROM employees_active()");
}

module.exports = { findEmployee, allActive, enabled };
