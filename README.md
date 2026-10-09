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
When Resend is not
configured for local development, invitation links print only in the API
terminal.

`npm run owner:create` works only before any account exists. Later users are
invited by a project owner through the app; public account sign-up is disabled.

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
