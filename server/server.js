const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 8420;

const DEFAULT_STATE = {
  tasks: [],
  sprintsToday: 0,
  lastSprintDate: null,
  streak: 0,
  activeTaskId: null,
};

app.use(express.json());
app.use(
  session({
    name: "focus_sprint_sid",
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  next();
}

const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const getUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const insertUser = db.prepare(
  "INSERT INTO users (email, password_hash) VALUES (?, ?)"
);
const getState = db.prepare("SELECT data FROM user_state WHERE user_id = ?");
const upsertState = db.prepare(`
  INSERT INTO user_state (user_id, data, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
`);

// ---------- Auth routes ----------

app.post("/api/signup", (req, res) => {
  const { email, password, initialState } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (getUserByEmail.get(normalizedEmail)) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = insertUser.run(normalizedEmail, passwordHash);
  const userId = info.lastInsertRowid;

  const seedState =
    initialState && typeof initialState === "object" ? initialState : DEFAULT_STATE;
  upsertState.run(userId, JSON.stringify(seedState));

  req.session.userId = userId;
  res.status(201).json({ user: { id: userId, email: normalizedEmail } });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== "string") {
    return res.status(400).json({ error: "Enter a valid email and password" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = getUserByEmail.get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("focus_sprint_sid");
    res.status(204).end();
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const user = getUserById.get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Not signed in" });
  }
  res.json({ user: publicUser(user) });
});

// ---------- State sync routes ----------

app.get("/api/state", requireAuth, (req, res) => {
  const row = getState.get(req.session.userId);
  const data = row ? JSON.parse(row.data) : DEFAULT_STATE;
  res.json({ state: data });
});

app.put("/api/state", requireAuth, (req, res) => {
  const state = req.body;
  if (!state || typeof state !== "object" || !Array.isArray(state.tasks)) {
    return res.status(400).json({ error: "Malformed state payload" });
  }
  upsertState.run(req.session.userId, JSON.stringify(state));
  res.status(204).end();
});

// ---------- Static frontend ----------

app.use(express.static(path.join(__dirname, "..")));

app.listen(PORT, () => {
  console.log(`Focus Sprint server running at http://localhost:${PORT}`);
});
