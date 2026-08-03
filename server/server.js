const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { pool, initSchema } = require("./db");
const { COMMON_PASSWORDS } = require("./common-passwords");

const app = express();
const PORT = process.env.PORT || 8420;

// Render (and most PaaS hosts) sit behind a reverse proxy, so req.ip would
// otherwise always resolve to the proxy's address — trusting the first hop
// lets express-rate-limit key on the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

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

// Checks a password against the "Pwned Passwords" breach corpus using the
// k-anonymity API: only the first 5 hex chars of the SHA-1 hash are sent, so
// the real password (and even its full hash) never leaves this server. Fails
// open — a network hiccup or API outage shouldn't block someone signing up.
async function isPasswordPwned(password) {
  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;

    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0].trim() === suffix);
  } catch (e) {
    return false;
  }
}

async function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password.length > 128) {
    return "Password must be under 128 characters";
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common. Please choose a stronger one.";
  }
  if (await isPasswordPwned(password)) {
    return "That password has appeared in a known data breach. Please choose a different one.";
  }
  return null;
}

// Brute-force protection: cap auth attempts per IP. Login gets a tighter
// window since credential-stuffing/guessing targets it directly; signup is
// capped mainly to stop mass account creation.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this address. Please try again later." },
});

// ---------- Auth routes ----------

app.post(
  "/api/signup",
  signupLimiter,
  asyncRoute(async (req, res) => {
    const { email, password, initialState } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const passwordError = await validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
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
  loginLimiter,
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
    const result = await pool.query(
      "SELECT data, version FROM user_state WHERE user_id = $1",
      [req.session.userId]
    );
    const row = result.rows[0];
    res.json({ state: row ? row.data : DEFAULT_STATE, version: row ? row.version : 0 });
  })
);

// Optimistic concurrency: the client must send back the version it last
// read. If another tab/device has saved since then, the version won't
// match any row and we reject with 409 plus the current server state
// instead of silently overwriting the other write (last-write-wins).
app.put(
  "/api/state",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { state, version } = req.body || {};
    if (!state || typeof state !== "object" || !Array.isArray(state.tasks)) {
      return res.status(400).json({ error: "Malformed state payload" });
    }
    if (typeof version !== "number") {
      return res.status(400).json({ error: "Missing version" });
    }

    const result = await pool.query(
      `UPDATE user_state
       SET data = $1, version = version + 1, updated_at = now()
       WHERE user_id = $2 AND version = $3
       RETURNING version`,
      [state, req.session.userId, version]
    );

    if (result.rows.length === 0) {
      const current = await pool.query(
        "SELECT data, version FROM user_state WHERE user_id = $1",
        [req.session.userId]
      );
      const row = current.rows[0];
      return res.status(409).json({
        error: "State was updated elsewhere",
        state: row ? row.data : DEFAULT_STATE,
        version: row ? row.version : 0,
      });
    }

    res.json({ version: result.rows[0].version });
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
