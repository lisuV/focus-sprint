const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { pool, initSchema } = require("./db");

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

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// ---------- Auth routes ----------

app.post(
  "/api/signup",
  asyncRoute(async (req, res) => {
    const { email, password, initialState } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const seedState =
      initialState && typeof initialState === "object" ? initialState : DEFAULT_STATE;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [normalizedEmail, passwordHash]
      );
      const userId = userResult.rows[0].id;
      await client.query("INSERT INTO user_state (user_id, data) VALUES ($1, $2)", [
        userId,
        seedState,
      ]);
      await client.query("COMMIT");

      req.session.userId = userId;
      res.status(201).json({ user: { id: userId, email: normalizedEmail } });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

app.post(
  "/api/login",
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== "string") {
      return res.status(400).json({ error: "Enter a valid email and password" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  })
);

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("focus_sprint_sid");
    res.status(204).end();
  });
});

app.get(
  "/api/me",
  asyncRoute(async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not signed in" });
    }
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [
      req.session.userId,
    ]);
    const user = result.rows[0];
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not signed in" });
    }
    res.json({ user: publicUser(user) });
  })
);

// ---------- State sync routes ----------

app.get(
  "/api/state",
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await pool.query("SELECT data FROM user_state WHERE user_id = $1", [
      req.session.userId,
    ]);
    const data = result.rows[0] ? result.rows[0].data : DEFAULT_STATE;
    res.json({ state: data });
  })
);

app.put(
  "/api/state",
  requireAuth,
  asyncRoute(async (req, res) => {
    const state = req.body;
    if (!state || typeof state !== "object" || !Array.isArray(state.tasks)) {
      return res.status(400).json({ error: "Malformed state payload" });
    }
    await pool.query(
      `INSERT INTO user_state (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [req.session.userId, state]
    );
    res.status(204).end();
  })
);

// ---------- Static frontend ----------

app.use(express.static(path.join(__dirname, "..")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Focus Sprint server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
