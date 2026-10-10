# Fieldline construction project tracker

Fieldline tracks projects, milestones, and tasks in a shared web app. The UI is
vanilla JavaScript built with Vite. A Node/Express server handles requests,
Better Auth handles usernames, passwords, and sessions, and Drizzle manages a
single SQLite database. Data access is online only.

## Access rules

- A project owner creates the project, invites people by username and email,
  and sets each invitee's role for that project. An invitee sets a password
  through the emailed invitation link, then signs in with their username.
- Editors can view and change every task in their project.
- Owners and editors can assign tasks to a pending invitee by username. The
  invitee sees those tasks immediately after accepting the invitation and
  signing in.
- Viewers can view only tasks explicitly assigned to them. They cannot edit.
  Milestones shown to viewers are limited to those containing their tasks.
- Tasks can have subtasks with their own names, project-user owners, deadlines,
  and statuses. A subtask belongs to its parent task's milestone. The task's
  deadline is the latest subtask deadline; the milestone's deadline is the
  latest task deadline. When the last child is removed, the parent's previously
  entered date returns. An invited user can own a subtask before signing up;
  they see it and its parent task after accepting the invitation. Owners and
  editors can add or edit subtasks; only owners can delete them.
- A person can have a different role in each project. The old free-text task
  owner/crew label remains available but never grants access.

## Project structure

The repo is a two-part app: a vanilla-JS frontend (Vite) and a Node/Express
backend. The browser only talks to the same-origin server under `/projects/api/`.

```
.
├─ index.html              # Entry markup; dialogs for projects, tasks, members
├─ package.json            # Scripts and dependencies (Node >= 22)
├─ vite.config.js          # Vite config; base "/projects/", proxies /projects/api to Node
├─ tsconfig.server.json    # Type-check config for the server
├─ drizzle.config.ts       # Drizzle / SQLite configuration
├─ .env.example            # Environment variables with inline comments
├─ data/                   # SQLite database file (git-ignored; not committed)
├─ drizzle/                # Migration SQL files and the Drizzle snapshot
├─ dist/                   # Production frontend build output (from `npm run build`)
├─ scripts/
│  ├─ create-owner.ts      # One-time command to create the first owner account
│  └─ send-test-mail.ts    # Send a sample invitation email to test mail setup
├─ server/
│  ├─ index.ts             # Express app: Better Auth routes, API, and static serving
│  ├─ api/
│  │  ├─ routes.ts         # Core routes (projects, milestones, tasks, subtasks, members)
│  │  ├─ invitations.ts    # Create, accept, and revoke invitations
│  │  ├─ access.ts         # Role checks and member listing helpers
│  │  ├─ validation.ts     # Zod input validation
│  │  └─ errors.ts         # ApiError helper
│  ├─ auth/
│  │  ├─ auth.ts           # Better Auth setup and app origin
│  │  ├─ auth-schema.ts    # Better Auth user / account tables
│  │  ├─ invited-user.ts   # Creates invited username accounts
│  │  └─ session.ts        # Session lookups
│  ├─ db/
│  │  ├─ client.ts         # Drizzle SQLite connection
│  │  ├─ schema.ts         # Table definitions
│  │  ├─ deadlines.ts      # Deadline aggregation across tasks/milestones
│  │  ├─ migrate.ts        # Migration runner
│  │  └─ README.md         # Schema-change / migration workflow
│  └─ mail/
│     ├─ send-mail.ts      # Email composition and the delivery API
│     └─ mail-provider.ts  # Chooses the Resend provider or a local dev fallback
└─ src/
   ├─ app.js               # Frontend application logic (vanilla JS, no framework)
   ├─ api.js               # API client — fetch wrappers used by the UI
   ├─ auth-ui.js           # Auth screens and Better Auth client
   ├─ styles.css           # Main application styles
   ├─ subtasks.css         # Subtask-specific styles
   └─ auth.css             # Login/signup screen styles
```

## Local development

Use Node.js **22 or newer**. Install dependencies with `npm ci` (or `npm install`
if there is no lockfile), copy `.env.example` to `.env`, and run:

```sh
npm run db:migrate
npm run owner:create -- your.username you@example.com
npm run dev:api
```

Enter the first owner's password at the terminal prompt. In another terminal,
run `npm run dev:web` and open `http://localhost:5173/projects/`. The Vite dev
server uses port 5173 because Better Auth trusts that local origin. Close any
earlier Vite instance before starting another; the new process will stop if
port 5173 is occupied. It proxies `/projects/api/` to the local Node server.

After an owner invites someone, the app opens a "Share the creation link" dialog
with the invitee's one-time link. Email sending is currently disabled, so the
owner copies this link and sends it to the invitee themselves (for example by
chat or email). When the full email delivery is wired up later, the same
invitation flow will send the link automatically.

`npm run owner:create` works only before any account exists. Later users are
invited by a project owner through the app; public account sign-up is disabled.

## Hosting requirements

Before deploying, make sure the host meets the following. These are the values
the deploy section below configures in detail.

**Runtime**
- Node.js **22 or newer** (`engines.node` in `package.json`).
- A process manager (systemd, PM2, Docker, etc.) that keeps `npm run start`
  running and restarts it on crash. This app is single-process; there is no
  background worker.
- Enough disk for the SQLite file; WAL mode keeps a `-wal` and `-shm` file
  alongside the main database.

**Network / reverse proxy**
- A reverse proxy (nginx shown below) terminating HTTPS and proxying
  `/projects/` to the Node server on a loopback port.
- HTTPS enabled — session cookies and invitation links carry sensitive data and
  must be sent over TLS.
- `APP_ORIGIN` set to the public HTTPS origin of the site (for the iquad
  deployment that is `https://iot.iquad.in`; do not include `/projects/`).

**Secrets**
- `BETTER_AUTH_SECRET`: a unique random secret of at least 32 bytes. Keep it
  private and stable across restarts — rotating it logs every user out.
- `RESEND_API_KEY`: private API key with sending access. Never place it in the
  frontend bundle or in Git.

**Database**
- `DATABASE_PATH` pointing at an absolute path to the SQLite file that lives
  **outside any publicly served / web directory**.
- `npm run db:migrate` run against the database before the first start. Back up
  the live database before applying later migrations.

**Email (Resend)**
- A Resend account with a **verified domain**, and `RESEND_FROM` set to a sender
  address on that domain. Without a verified domain you cannot send invitations
  to other people. See the deploy section for the onboarding workaround.

**Data guardrails**
- Treat the database as authoritative and back it up regularly (SQLite online
  backup API or the `sqlite3` CLI `.backup` command). WAL mode means a cold copy
  of only the main `.sqlite` file while the service runs can miss recent writes.

## Deploy at `/projects/`

This app can run alongside the existing `iot.iquad.in` site. Set production
environment values in a private `.env` file:

- `NODE_ENV=production`
- `APP_ORIGIN=https://iot.iquad.in` (the origin, without `/projects/`)
- `BETTER_AUTH_SECRET`: a unique random secret of at least 32 bytes; keep it
  stable across restarts and private
- `DATABASE_PATH`: an absolute path to the SQLite file **outside any public
  web directory**
- `HOST=127.0.0.1`, `PORT=3000` (or an unused local port)
- `RESEND_API_KEY`: a private Resend API key with sending access
- `RESEND_FROM`: a sender address on your domain verified in Resend

For local delivery tests, Resend's `onboarding@resend.dev` sender can send to
your Resend account email. Verify a domain and use its address in `RESEND_FROM`
before sending invitations to other people. Keep the API key in `.env` on the
server, never in the Vite frontend or Git.

Then, on the server:

```sh
npm ci
npm run build
npm run db:migrate
npm run owner:create -- your.username you@example.com
npm run start
```

Run `owner:create` once only, on a new database. Keep the Node process running
under the server's service manager. Before applying later migrations, back up
the live database using SQLite's online backup API or the `sqlite3` CLI
`.backup` command; WAL mode means copying only the main `.sqlite` file while
the service is running may miss recent writes. Run the reviewed
`npm run db:migrate` step before restarting a newer app version.

In the existing nginx HTTPS server block, add a `/projects/` location that
proxies to Node **without replacing the existing `/` location**. For example:

```nginx
location = /projects { return 301 /projects/; }
location /projects/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

The `proxy_pass` line has no URI suffix, so `/projects/` and
`/projects/api/` reach Node with their paths intact. Confirm the actual nginx
site configuration and port before applying this snippet. Serve this app over
HTTPS so session cookies and invitation links stay protected.

## Fresh database

This deployment starts with an empty SQLite database. `npm run db:migrate`
creates the tables, and the first owner creates projects, milestones, and tasks
in the app. No browser records are imported. Later Drizzle migrations change
the schema while preserving the data entered in this new database.

## Schema changes

Database code and the migration workflow are documented in
[`server/db/README.md`](server/db/README.md). After changing app or Better Auth
schema, run `npm run db:generate`, review and commit the generated SQL and
snapshot, then run `npm run db:migrate` against a copy of the database before
production. `npm run db:check` checks migration history. Avoid `db:push` in
production.
