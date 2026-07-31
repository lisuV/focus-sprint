# Focus Sprint

A minimalist Pomodoro-style focus timer with a task list, streaks, and optional
account sync — built as a single-page app with a small Node/Express backend.

- ⏱️ Focus / Short Break / Long Break timer with an animated progress ring
- ✅ Task list — click a task to make it the active focus, tracks completed
  pomodoros per task
- 🔥 Daily streak tracking and sprint counts
- 🎉 Chime + confetti celebration when a sprint completes (Web Audio API, no
  external assets)
- 👤 Optional sign up / sign in — synced tasks, streak, and sprint history
  across devices. Without an account, everything still works fully offline
  via `localStorage`.

## Tech stack

- **Frontend:** vanilla HTML / CSS / JavaScript, no build step
- **Backend:** [Express](https://expressjs.com/) + [PostgreSQL](https://www.postgresql.org/) (via [`pg`](https://node-postgres.com/))
- **Auth:** session cookies (`express-session`) + password hashing (`bcryptjs`)

## Getting started

Requires [Node.js](https://nodejs.org/) 18+ and a Postgres database. A free
[Neon](https://neon.tech) project works well and needs no local install —
sign up, create a project, and copy the connection string it gives you.

```bash
cd server
npm install
cp .env.example .env   # then fill in DATABASE_URL
npm start
```

Then open [http://localhost:8420](http://localhost:8420). The server creates
its tables automatically on first run and serves the static frontend and the
API from the same origin, so there's nothing else to configure.

## Project structure

```
focus-sprint/
├── index.html          # App shell + auth modal markup
├── style.css            # Styling (dark theme, responsive)
├── script.js            # Timer, tasks, streaks, auth/sync logic
└── server/
    ├── server.js         # Express app + API routes
    ├── db.js             # Postgres connection + schema
    ├── .env.example       # Required env vars (DATABASE_URL, SESSION_SECRET)
    └── package.json
```

## API

All endpoints are JSON over the same origin as the frontend.

| Method | Route          | Description                                   |
| ------ | -------------- | ---------------------------------------------- |
| POST   | `/api/signup`  | Create an account (optionally seeded with an `initialState` migrated from a guest session) |
| POST   | `/api/login`   | Start a session                                |
| POST   | `/api/logout`  | End the session                                |
| GET    | `/api/me`      | Current signed-in user, if any                 |
| GET    | `/api/state`   | Fetch the signed-in user's tasks/streak/sprint state |
| PUT    | `/api/state`   | Replace the signed-in user's saved state        |

## Deployment

A [`render.yaml`](render.yaml) Blueprint is included for one-click deploy to
[Render](https://render.com)'s free web service tier: connect this repo from
the Render dashboard (New + → Blueprint) and it auto-configures the build
(`rootDir: server`, `npm install`, `npm start`) and generates a random
`SESSION_SECRET`. You still need to set `DATABASE_URL` yourself in the
service's Environment tab — Blueprints don't provision the database — using a
free Neon (or any Postgres) connection string.

Because the database is a separate managed Postgres instance rather than a
file on Render's disk, accounts and tasks now survive redeploys and the free
tier's spin-down-on-idle behavior.

## Notes

- The database schema (`users`, `user_state` tables) is created automatically
  on first run if it doesn't already exist.
- The session secret is regenerated on every server restart if `SESSION_SECRET`
  isn't set, which logs everyone out. Render's Blueprint sets a persistent one
  automatically; for local dev, add your own to `.env` if you want sessions to
  survive restarts.

## License

[MIT](LICENSE)
