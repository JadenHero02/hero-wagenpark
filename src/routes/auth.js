// src/routes/auth.js
// Inlogpagina, uitloggen, en de lokale ontwikkel-login (alleen buiten productie, met DEV_LOGIN_EMAIL).

const express = require("express");
const auth = require("../auth");
const employees = require("../employees");
const msauth = require("./msauth");

const router = express.Router();
const safeNext = (v) => (v && String(v).startsWith("/") && !String(v).startsWith("//") ? String(v) : "/");

router.get("/login", (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render("auth/login", { title: "Inloggen", error: null, next: safeNext(req.query.next), msLoginEnabled: msauth.isEnabled(), devLogin: msauth.devLoginEmail() });
});

// Lokaal inloggen zonder Microsoft: alleen als NODE_ENV niet production is en DEV_LOGIN_EMAIL is gezet.
router.post("/login/dev", async (req, res) => {
  const email = msauth.devLoginEmail();
  if (!email) return res.status(404).send("Niet beschikbaar.");
  const employee = employees.enabled() ? await employees.findEmployee(email) : null;
  const user = await auth.upsertUser({ email, name: employee ? employee.name : email.split("@")[0], isAdmin: employee ? employee.isAdmin : false });
  auth.setSessionCookie(req, res, await auth.createSession(user.id));
  res.redirect(safeNext((req.body || {}).next));
});

router.post("/logout", async (req, res) => {
  await auth.destroySession(req.sessionId);
  auth.clearSessionCookie(res);
  res.redirect("/login");
});

module.exports = { router };
