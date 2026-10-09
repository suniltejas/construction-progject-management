# Database and migrations

`schema.ts` owns app tables. `../auth/auth-schema.ts` owns Better Auth tables. Both
feed one Drizzle migration history in `drizzle/`.

1. Change the relevant schema file.
2. Run `npm run db:generate` and review the generated SQL and snapshot.
3. Run `npm run db:migrate` against a disposable database first.
4. Commit schema changes and the generated `drizzle/` files together.
5. Back up the production SQLite database with SQLite's online backup API, then
   run `npm run db:migrate` against the production `DATABASE_PATH` before
   restarting the Node service.

Never use `drizzle-kit push` on production. The migration runner records applied
files, so a repeated deployment only applies new migrations. `DATABASE_PATH`
defaults to `./data/fieldline.sqlite` for local development. Use an absolute
path outside nginx's public directory on the server.

The runtime connection enables foreign keys, WAL, and a five-second busy timeout.
The `version` columns support optimistic updates: write with
`WHERE id = ? AND version = ?`, incrementing `version`; report a conflict when
no row matched. API routes must verify project ownership or membership on every
request, since SQLite is shared by the whole Node process.

`subtasks.due` drives `tasks.due` by latest date, and `tasks.due` drives
`milestones.due` the same way. `planned_due` on tasks and milestones preserves
the manually entered date to restore when the last child is removed. Mutations
recalculate deadlines inside one transaction using `deadlines.ts`.

`pending_task_assignments` holds tasks assigned to an invited email before
that person has an account. Invitation acceptance moves those rows into
`task_assignments` in the same transaction as project membership. Reissuing
an expired invitation to the same email keeps its pending work; explicitly
revoking an invitation clears that work.

The first deployment starts with no project records. Run the initial migration,
create the first owner account, then enter projects in the app. Subsequent
migrations preserve those records.
