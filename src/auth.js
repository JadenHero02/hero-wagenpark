// src/auth.js
// Sessies en toegang. Inloggen gaat via Microsoft (src/routes/msauth.js); lokaal kan het met DEV_LOGIN_EMAIL.
// Na inloggen krijgt de browser een cookie met een willekeurige code; in de tabel sessions staat bij wie die hoort.

const crypto = require("node:crypto");
const db = require("./db");

const SESSION_COOKIE = "wp_session";
const SESSION_DAYS = 14;

// Rollen van laag naar hoog. Een hogere rol mag alles wat een lagere mag.
const ROLES = ["bestuurder", "directie", "beheerder", "admin"];
const rank = (role) => ROLES.indexOf(role);

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  await db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, local_now() + ($3 || ' days')::interval)", [id, userId, String(SESSION_DAYS)]);
  return id;
}
async function destroySession(id) { if (id) await db.run("DELETE FROM sessions WHERE id = $1", [id]); }

async function getUserBySession(id) {
  if (!id) return null;
  const user = await db.one(`
    SELECT u.*, v.naam AS vestiging_naam FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN vestigingen v ON v.id = u.vestiging_id
    WHERE s.id = $1 AND s.expires_at > local_now() AND u.is_active`, [id]);
  if (user) await db.run("UPDATE sessions SET expires_at = local_now() + ($2 || ' days')::interval WHERE id = $1", [id, String(SESSION_DAYS)]);
  return user;
}
async function cleanupSessions() {
  try { await db.run("DELETE FROM sessions WHERE expires_at <= local_now()"); } catch (err) { console.error("Sessies opruimen mislukt:", err.message); }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) { try { out[key] = decodeURIComponent(rest.join("=")); } catch { out[key] = rest.join("="); } }
  }
  return out;
}
function setSessionCookie(req, res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_DAYS * 86400000, path: "/" });
}
function clearSessionCookie(res) { res.clearCookie(SESSION_COOKIE, { path: "/" }); }

// Bij elk verzoek: wie is dit? Zet req.user (of null) en, als de gebruiker ook bestuurder is, req.bestuurder.
async function loadUser(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    req.sessionId = cookies[SESSION_COOKIE] || null;
    req.user = await getUserBySession(req.sessionId);
    req.bestuurder = req.user ? await db.one("SELECT * FROM bestuurders WHERE user_id = $1 OR (email IS NOT NULL AND lower(email) = lower($2)) ORDER BY user_id NULLS LAST LIMIT 1", [req.user.id, req.user.email]) : null;
    res.locals.currentUser = req.user;
    res.locals.currentBestuurder = req.bestuurder;
    res.locals.can = (role) => Boolean(req.user) && rank(req.user.role) >= rank(role);
    next();
  } catch (err) { next(err); }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  const wanted = req.method === "GET" ? encodeURIComponent(req.originalUrl) : "";
  res.redirect(`/login${wanted ? `?next=${wanted}` : ""}`);
}
// Minimaal deze rol (admin mag alles, beheerder mag wat beheerder en lager mag, enz.)
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (rank(req.user.role) >= rank(role)) return next();
    res.status(403).render("error", { title: "Geen toegang", message: "Deze pagina is alleen voor beheerders." });
  };
}

// Gebruiker aanmaken of bijwerken na een geslaagde login (Microsoft of lokaal)
async function upsertUser({ email, name, supabaseUserId = null, isAdmin = false }) {
  let user = await db.one("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (!user) {
    // Eerste keer: rol volgt uit de instelling admin_emails (Annemiek) of beheerder_emails; anders bestuurder
    const role = await roleFor(email, isAdmin);
    const id = await db.insert("INSERT INTO users (name, email, role, supabase_user_id) VALUES ($1, $2, $3, $4)", [name || email, email.toLowerCase(), role, supabaseUserId]);
    user = await db.one("SELECT * FROM users WHERE id = $1", [id]);
    console.log(`Nieuwe gebruiker: ${email} (${role})`);
  } else {
    await db.run("UPDATE users SET name = COALESCE($2, name), supabase_user_id = COALESCE(supabase_user_id, $3), last_login_at = local_now() WHERE id = $1", [user.id, name, supabaseUserId]);
  }
  // Bestuurder uit de Excel met hetzelfde e-mailadres koppelen aan dit account
  await db.run("UPDATE bestuurders SET user_id = $1 WHERE user_id IS NULL AND email IS NOT NULL AND lower(email) = lower($2)", [user.id, email]);
  return user;
}
async function roleFor(email, isAdmin) {
  const lower = email.toLowerCase();
  const setting = async (key) => ((await db.one("SELECT waarde FROM instellingen WHERE sleutel = $1", [key])) || {}).waarde || "";
  const list = (s) => s.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list(await setting("admin_emails")).includes(lower)) return "admin";
  if (list(await setting("beheerder_emails")).includes(lower)) return "beheerder";
  if (list(await setting("directie_emails")).includes(lower)) return "directie";
  return "bestuurder";
}

module.exports = { ROLES, rank, createSession, destroySession, getUserBySession, cleanupSessions, parseCookies, setSessionCookie, clearSessionCookie, loadUser, requireLogin, requireRole, upsertUser, SESSION_COOKIE };
