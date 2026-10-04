# Fieldline construction project tracker

A small, dependency-free web app for managing construction projects, tasks, and milestones.

## Run

Open `index.html` in a browser. For a local server, run `python -m http.server 8765` in this folder and visit `http://localhost:8765`.

## What it does

- Create, edit, and delete projects with stage, lead, location, and schedule.
- Create, edit, complete, filter, and delete tasks with owner, priority, due date, and a required project milestone. Filter by owner, status, and task name together.
- Create, edit, and delete milestones with target date and status.
- Select a milestone in a project or the overview to show only its tasks. Use **Show all tasks** or **All milestones** to clear the selection.
- See project progress, upcoming milestones, due tasks, and overdue work.
- Export and import JSON backups.

Data is saved in this browser's local storage. The first visit shows sample projects so you can explore the app; replace or delete them when ready. There is no account, server, or synchronization between devices yet. Export backups regularly if you use it for live work.

Tasks saved by earlier versions are kept and linked to an **Existing tasks — review milestone** entry in their project. Reassign those tasks to the right milestones, then delete the review milestone. A milestone with linked tasks cannot be deleted until those tasks are reassigned or removed.
