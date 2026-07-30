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
- **Backend:** [Express](https://expressjs.com/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Auth:** session cookies (`express-session`) + password hashing (`bcryptjs`)

## Getting started

Requires [Node.js](https://nodejs.org/) 18+.

```bash
cd server
npm install
npm start
```

Then open [http://localhost:8420](http://localhost:8420).

The server serves the static frontend and the API from the same origin, so
there's nothing else to configure.

## Project structure

```
focus-sprint/
├── index.html          # App shell + auth modal markup
├── style.css            # Styling (dark theme, responsive)
├── script.js            # Timer, tasks, streaks, auth/sync logic
└── server/
    ├── server.js         # Express app + API routes
    ├── db.js             # SQLite connection + schema
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

## Notes

- The SQLite database file (`server/focus-sprint.db`) is created automatically
  on first run and is git-ignored — it holds real user data, not source code.
- The session secret is regenerated on every server restart, so signed-in
  users are logged out when the server restarts. Fine for local/demo use; set
  a persistent `SESSION_SECRET` env var before deploying anywhere long-lived.

## License

[MIT](LICENSE)
