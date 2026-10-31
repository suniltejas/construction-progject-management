# Fieldline construction project tracker

Fieldline tracks construction projects, milestones, and tasks in a shared web
app. Beyond the schedule it records timestamped notes, file attachments,
subtask checklists, task completion dates, and predecessor ("blocked by")
links. The UI is vanilla JavaScript built with Vite. A Node/Express server
handles requests, Better Auth handles usernames, passwords, and sessions, and
Drizzle manages a single SQLite database; uploaded files live on disk. Data
access is online only.

## Access rules

- A project owner creates the project, invites people by username and email,
  and sets each invitee's role for that project. An invitee sets a password
  through the emailed invitation link, then signs in with their username or
  email address.
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
- **Notes:** tasks and subtasks can carry timestamped notes (append-only).
  Anyone who can see the item sees its notes; owners and editors add and delete
  them.
- **Files:** tasks and milestones can store images and PDFs (other types always
  download). Bytes live on the server disk in `FILES_DIR`; the database only
  indexes them. Viewers see files only for items they can already see, and only
  owners/editors upload or delete.
- **Predecessors ("blocked by"):** a task can list one or more predecessor
  tasks in the same project that should be completed first. Rows show a
  "Blocked by" line of chips plus a *Blocked* badge; marking a blocked task
  Done is still allowed (the block is display-only). Self, cross-project, and
  cyclic links are rejected by the server.
- **Completion and sorting:** marking a task Done stamps a completion date
  (cleared if reopened). The project task list sorts client-side by due
  soonest/latest, recently finished, or priority.

## Project structure

The repo is a two-part app: a vanilla-JS frontend (Vite) and a Node/Express
backend. The browser only talks to the same-origin server under `/projects/api/`.

```
.
├─ index.html              # Entry markup; dialogs for projects, tasks, subtasks, milestones, members, notes, files
├─ package.json            # Scripts and dependencies (Node >= 22; pnpm)
├─ vite.config.js          # Vite config; base "/projects/", proxies /projects/api to Node
├─ tsconfig.server.json    # Type-check config for the server
├─ drizzle.config.ts       # Drizzle / SQLite configuration
├─ .env.example            # Environment variables with inline comments
├─ data/                   # Local SQLite DB + uploaded files (git-ignored)
│  ├─ fieldline.sqlite     # SQLite database (WAL: -wal/-shm siblings)
│  └─ files/               # Uploaded attachments (FILES_DIR)
├─ drizzle/                # Migration SQL (0000–0007) and snapshots
├─ dist/                   # Production frontend build output (pnpm run build)
├─ scripts/
│  ├─ create-owner.ts      # One-time command to create the first owner account
│  ├─ reset-password.ts    # Manually reset an existing account's password
│  ├─ seed-demo.ts         # Fill the local DB with demo projects/tasks/notes/files
│  └─ send-test-mail.ts    # Send a sample invitation email to test mail setup
├─ server/
│  ├─ index.ts             # Express app: Better Auth routes, API, and static serving
│  ├─ api/
│  │  ├─ routes.ts         # Projects, milestones, tasks, subtasks, members, notes, files, dependencies
│  │  ├─ invitations.ts    # Create, accept, and revoke invitations
│  │  ├─ access.ts         # Role checks, workspace loading, member listing
│  │  ├─ validation.ts     # Zod input validation
│  │  └─ errors.ts         # ApiError helper
│  ├─ auth/
│  │  ├─ auth.ts           # Better Auth setup and app origin
│  │  ├─ auth-schema.ts    # Better Auth user / account tables
│  │  ├─ invited-user.ts   # Creates invited username accounts
│  │  └─ session.ts        # Session lookups
│  ├─ db/
│  │  ├─ client.ts         # Drizzle SQLite connection
│  │  ├─ schema.ts         # Table definitions (incl. notes, attachments, task_dependencies)
│  │  ├─ deadlines.ts      # Deadline aggregation across tasks/milestones
│  │  ├─ migrate.ts        # Migration runner
│  │  └─ README.md         # Schema-change / migration workflow
│  ├─ files/
│  │  └─ storage.ts        # Upload handling (multer), type/size limits, disk paths
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

This project uses **pnpm** (`node_modules/.pnpm` and `pnpm-lock.yaml` are
present; ignore the stray `package-lock.json`). Use Node.js **22 or newer**,
copy `.env.example` to `.env`, then:

```sh
pnpm install
pnpm run db:migrate
pnpm run owner:create -- your.username you@example.com
pnpm run dev:api
```

Enter the first owner's password at the terminal prompt. In another terminal,
run `pnpm run dev:web` and open `http://localhost:5173/projects/`. The Vite dev
server uses port 5173 because Better Auth trusts that local origin. Close any
earlier Vite instance before starting another; the new process will stop if
port 5173 is occupied. It proxies `/projects/api/` to the local Node server.

To explore the app with realistic data, run `pnpm run seed:demo`. It creates
several demo projects (milestones, tasks, subtasks, notes, files, and task
dependencies) owned by an existing account (prefers `admin`, otherwise the first
user). It is re-runnable and only deletes projects whose names are in the demo
list, so your real projects are left untouched.

Forgot a password? `pnpm run reset-password -- <username>` prompts for a new
password, re-hashes it with Better Auth's hasher, and ends that user's sessions.

After an owner invites someone, the app opens a "Share the creation link" dialog
with the invitee's one-time link. Email sending is currently disabled, so the
owner copies this link and sends it to the invitee themselves (for example by
chat or email). When the full email delivery is wired up later, the same
invitation flow will send the link automatically.

`pnpm run owner:create` works only before any account exists. Later users are
invited by a project owner through the app; public account sign-up is disabled.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run dev:api` | Backend with watch (`tsx watch server/index.ts`, port 3000). |
| `pnpm run dev:web` | Vite dev server on port 5173 (`strictPort`); proxies `/projects/api`. |
| `pnpm run build` | Build the frontend into `dist/`. |
| `pnpm run start` | Production server (`tsx server/index.ts`). |
| `pnpm run typecheck` | Type-check server + scripts (`tsconfig.server.json`). The vanilla-JS frontend is not type-checked. |
| `pnpm run test:db` | Schema/constraint tests (`node:test`). |
| `pnpm run test:api` | Integration + mail tests; spawns the real server against a throwaway temp DB (~15 s). |
| `pnpm run db:generate` | Generate a Drizzle migration from schema changes. |
| `pnpm run db:migrate` | Apply pending migrations. |
| `pnpm run db:check` | Check migration history. |
| `pnpm run owner:create -- <username> <email>` | Create the first owner (only when no account exists). |
| `pnpm run reset-password -- <username>` | Reset an existing account's password and end its sessions. |
| `pnpm run seed:demo` | Fill the local DB with demo projects/tasks/notes/files (dev only). |
| `pnpm run mail:test` | Send a sample invitation email to verify mail setup. |

## Hosting requirements

Before deploying, make sure the host meets the following. These are the values
the deploy section below configures in detail.

**Runtime**
- Node.js **22 or newer** (`engines.node` in `package.json`).
- A process manager (systemd, PM2, Docker, etc.) that keeps `pnpm run start`
  running and restarts it on crash. This app is single-process; there is no
  background worker.
- Enough disk for the SQLite file (WAL mode keeps `-wal`/`-shm` siblings) plus
  the uploaded attachments directory (`FILES_DIR`).

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
- `FILES_DIR` pointing at an absolute path for uploaded attachments, also
  **outside any publicly served / web directory**. `FILES_MAX_BYTES` caps the
  upload size (default 25 MB). Back up both the database and this directory.
- `pnpm run db:migrate` run against the database before the first start. Back up
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
- `FILES_DIR`: an absolute path for uploaded files, **outside any public web
  directory**; `FILES_MAX_BYTES` caps uploads (default 25 MB)
- `HOST=127.0.0.1`, `PORT=3000` (or an unused local port)
- `RESEND_API_KEY`: a private Resend API key with sending access
- `RESEND_FROM`: a sender address on your domain verified in Resend

For local delivery tests, Resend's `onboarding@resend.dev` sender can send to
your Resend account email. Verify a domain and use its address in `RESEND_FROM`
before sending invitations to other people. Keep the API key in `.env` on the
server, never in the Vite frontend or Git.

Then, on the server:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run db:migrate
pnpm run owner:create -- your.username you@example.com
pnpm run start
```

Run `owner:create` once only, on a new database. Keep the Node process running
under the server's service manager. Before applying later migrations, back up
the live database using SQLite's online backup API or the `sqlite3` CLI
`.backup` command; WAL mode means copying only the main `.sqlite` file while
the service is running may miss recent writes. Also back up `FILES_DIR`
(uploaded attachments). Run the reviewed `pnpm run db:migrate` step before
restarting a newer app version.

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

This deployment starts with an empty SQLite database. `pnpm run db:migrate`
creates the tables, and the first owner creates projects, milestones, and tasks
in the app. No browser records are imported. Later Drizzle migrations change
the schema while preserving the data entered in this new database.

For local development only, `pnpm run seed:demo` adds sample projects, tasks,
notes, and files. Do not run it against a production database.

## Schema changes

Database code and the migration workflow are documented in
[`server/db/README.md`](server/db/README.md). After changing app or Better Auth
schema, run `pnpm run db:generate`, review and commit the generated SQL and
snapshot, then run `pnpm run db:migrate` against a copy of the database before
production. `pnpm run db:check` checks migration history. Avoid `db:push` in
production.

## Upgrading an existing database

A database created by v1 (migrations `0000`–`0003`) upgrades without data loss.
Every later migration only adds; nothing existing is renamed, removed, or
rewritten:

| Migration | Change | Effect on existing rows |
|---|---|---|
| `0004` | `subtasks.crew_label` column, default `''` | Old subtasks get a blank crew label |
| `0005` | New `notes` and `attachments` tables | Start empty |
| `0006` | `tasks.completed_at` column, nullable | Old tasks have no finish date |
| `0007` | New `task_dependencies` table | Starts empty |

Tasks that were already Done before `0006` show "Done" without a date and sort
last under "Recently finished". Only tasks finished after the upgrade are
stamped.

**Check first:** migrations only apply cleanly if the old database was created
with `pnpm run db:migrate` (it has a `__drizzle_migrations` table). A database
created with `db:push` fails with "table already exists" and needs its
migration history recorded by hand before upgrading.

**Steps**

1. **Back up.** Stop the old app, then copy the `.sqlite` file together with its
   `-wal` and `-shm` files (or use the `sqlite3` CLI `.backup` command while it
   runs). Also back up `FILES_DIR` if it exists.
2. **Test on a copy.** Migrate a copy, start the app against it, sign in, and
   check projects and tasks look right:
   ```powershell
   $env:DATABASE_PATH = "C:\path\to\copy\fieldline.sqlite"; pnpm run db:migrate
   ```
3. **Upgrade for real.** On the machine with the live data:
   ```sh
   pnpm install --frozen-lockfile
   pnpm run build
   pnpm run db:migrate
   pnpm run start
   ```
4. **Optional:** give old Done tasks an approximate finish date (their last edit
   time) so "Recently finished" includes them:
   ```sql
   UPDATE tasks SET completed_at = updated_at
   WHERE status = 'Done' AND completed_at IS NULL;
   ```

## Roadmap & ideas

A scratch list of ideas lives in [`tasks.md`](tasks.md). Directions that fit the
current data model and UI:

- **Dependency graph** — render `task_dependencies` as a visual DAG (the UI
  currently shows "Blocked by" chips and a Blocked badge only).
- **Critical path / topological sort** — order predecessors before dependents,
  or highlight the longest chain of blocking tasks.
- **Richer files** — drag-and-drop upload, thumbnails, in-app PDF page previews,
  per-file captions, and more allow-listed types (CAD/DWG, DOCX, XLSX).
- **Notes** — edit/soft-delete, @mentions, and an activity/audit feed.
- **Subtasks** — predecessor links between subtasks and per-subtask priority.
- **Notifications** — overdue/at-risk digests and "task unblocked" alerts once
  email delivery is enabled.
- **Views** — Gantt/timeline and calendar views over the same due dates.
- **Export** — include notes and file metadata in the workspace export (file
  bytes stay on the server).
