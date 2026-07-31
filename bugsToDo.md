# Bugs / TODO

Findings from a code review of the whole project (frontend + server).

1. ~~**No brute-force protection** on `/api/login` or `/api/signup` — no rate
   limiting, no lockout, no delay. (`server/server.js`)~~ **Fixed**: added
   per-IP rate limiting via `express-rate-limit` (10 attempts/15min on
   login, 5/hour on signup) and `trust proxy` so it keys on the real client
   IP behind Render's reverse proxy. Account lockout/backoff delay wasn't
   added — rate limiting alone covers the brute-force risk; revisit if this
   ever needs to be stricter.

2. **Last-write-wins sync, no merge** — `PUT /api/state` replaces the entire
   state blob. Two tabs/devices open at once will silently clobber each
   other's tasks/streak/sprint count on save; no version check or diffing.
   (`server/server.js`, `script.js`)

3. **Weak password policy** — only a 6-character minimum, no complexity or
   breach checks. (`server/server.js:69-71`)

4. **Session secret is random per boot** — falls back to
   `crypto.randomBytes(32)` if `SESSION_SECRET` isn't set, so signed-in users
   get logged out on every restart. Documented in README, but worth
   double-checking `SESSION_SECRET` is actually set in any real deployment.
   (`server/server.js:23`)

5. **No tests** (frontend or backend). Streak/sprint logic has real edge
   cases that could regress silently:
   - Streak/long-break-every-4th-sprint math (`script.js:249-277`)
   - `todayStr()` uses `toISOString().slice(0,10)` — UTC date, not local date,
     so streaks can break or double-count near midnight depending on the
     user's timezone. (`script.js:92-94`)

6. **No payload validation/size cap on `PUT /api/state`** — server only
   checks that `state.tasks` is an array; a signed-in user could push an
   arbitrarily large or malformed blob. Low risk, but no guardrail.
   (`server/server.js:135`)
