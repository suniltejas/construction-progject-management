/* Fieldline: a local-first construction project tracker. */
(() => {
  'use strict';

  const STORAGE_KEY = 'fieldline.v1';
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const localDate = (offset = 0) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const formatDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options) : '—';
  const daysUntil = (value) => Math.round((new Date(`${value}T12:00:00`) - new Date(`${localDate()}T12:00:00`)) / 86400000);

  function starterData() {
    const p1 = uid(), p2 = uid(), p3 = uid();
    const m1 = uid(), m2 = uid(), m3 = uid(), m4 = uid();
    return {
      projects: [
        { id: p1, name: 'Riverside Medical Centre', location: 'North district', lead: 'Maya Patel', start: localDate(-42), end: localDate(126), stage: 'In progress' },
        { id: p2, name: 'Eastbridge Apartments', location: 'Eastbridge', lead: 'Daniel Brooks', start: localDate(-18), end: localDate(194), stage: 'In progress' },
        { id: p3, name: 'Harbour Road Extension', location: 'Harbour precinct', lead: 'Aisha Khan', start: localDate(12), end: localDate(248), stage: 'Planning' }
      ],
      tasks: [
        { id: uid(), projectId: p1, milestoneId: m1, name: 'Complete ground floor framing', owner: 'Structural crew', due: localDate(4), status: 'In progress', priority: 'High' },
        { id: uid(), projectId: p1, milestoneId: m2, name: 'Approve electrical rough-in drawings', owner: 'Maya Patel', due: localDate(2), status: 'Blocked', priority: 'Critical' },
        { id: uid(), projectId: p1, milestoneId: m1, name: 'Inspect foundation waterproofing', owner: 'Site engineer', due: localDate(-5), status: 'Done', priority: 'Normal' },
        { id: uid(), projectId: p2, milestoneId: m3, name: 'Confirm steel delivery window', owner: 'Daniel Brooks', due: localDate(7), status: 'In progress', priority: 'High' },
        { id: uid(), projectId: p2, milestoneId: m3, name: 'Set out level two formwork', owner: 'Concrete crew', due: localDate(13), status: 'Not started', priority: 'Normal' },
        { id: uid(), projectId: p3, milestoneId: m4, name: 'Submit traffic management plan', owner: 'Aisha Khan', due: localDate(20), status: 'Not started', priority: 'High' }
      ],
      milestones: [
        { id: m1, projectId: p1, name: 'Ground floor structure complete', due: localDate(18), status: 'Upcoming' },
        { id: m2, projectId: p1, name: 'Building services rough-in', due: localDate(52), status: 'At risk' },
        { id: m3, projectId: p2, name: 'Level two concrete pour', due: localDate(28), status: 'Upcoming' },
        { id: m4, projectId: p3, name: 'Permits approved', due: localDate(32), status: 'Upcoming' }
      ]
    };
  }

  // Preserve tasks from earlier app versions and imported backups without guessing their schedule.
  function ensureTaskMilestones(source) {
    let changed = false;
    for (const project of source.projects) {
      const milestones = source.milestones.filter((milestone) => milestone.projectId === project.id);
      const unlinked = source.tasks.filter((task) => task.projectId === project.id && !milestones.some((milestone) => milestone.id === task.milestoneId));
      if (!unlinked.length) continue;
      let reviewMilestone = milestones.find((milestone) => milestone.migrationBucket === true);
      if (!reviewMilestone) {
        reviewMilestone = { id: uid(), projectId: project.id, name: 'Existing tasks — review milestone', due: project.end || localDate(30), status: 'Upcoming', migrationBucket: true };
        source.milestones.push(reviewMilestone);
      }
      for (const task of unlinked) task.milestoneId = reviewMilestone.id;
      changed = true;
    }
    return changed;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return starterData();
      const parsed = JSON.parse(raw);
      if (['projects', 'tasks', 'milestones'].every((key) => Array.isArray(parsed[key]))) {
        if (ensureTaskMilestones(parsed)) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); }
          catch (error) { console.warn('Could not persist migrated tasks:', error); }
        }
        return parsed;
      }
    } catch (error) { console.warn('Could not load saved data:', error); }
    return starterData();
  }

  let data = load();
  let selectedProjectId = null;
  let taskFilter = 'All tasks';
  let taskOwnerFilter = 'all';
  let taskMilestoneFilter = 'all';
  let taskSearch = '';
  let toastTimer;

  function save(message) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (error) { toast('Browser storage is full or unavailable. Export your data.'); console.error(error); return; }
    render();
    if (message) toast(message);
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
  }

  const projectTasks = (id) => data.tasks.filter((task) => task.projectId === id);
  const projectMilestones = (id) => data.milestones.filter((milestone) => milestone.projectId === id);
  const progress = (id) => {
    const tasks = projectTasks(id);
    return tasks.length ? Math.round(tasks.filter((task) => task.status === 'Done').length / tasks.length * 100) : 0;
  };
  const badge = (status) => {
    const tone = ({ 'In progress': 'blue', 'Not started': 'gray', 'Planning': 'gray', 'On hold': 'amber', 'Blocked': 'red', 'At risk': 'amber', 'Upcoming': 'blue', 'Done': 'green', 'Complete': 'green', 'Completed': 'green' })[status] || 'gray';
    return `<span class="badge ${tone}">${escapeHtml(status)}</span>`;
  };
  const progressBar = (value) => `<div class="progress" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"><i style="width:${value}%"></i></div><div class="progress-label">${value}% complete</div>`;

  function renderNavigation() {
    $('#projectCount').textContent = data.projects.length;
    $('#projectNav').innerHTML = data.projects.map((project) => `<button type="button" class="nav-link ${selectedProjectId === project.id ? 'active' : ''}" data-open-project="${escapeHtml(project.id)}"><span class="project-initial">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span><span class="truncate">${escapeHtml(project.name)}</span></button>`).join('');
    $('#overviewNav').classList.toggle('active', !selectedProjectId);
    $('#breadcrumbCurrent').textContent = data.projects.find((project) => project.id === selectedProjectId)?.name ?? 'Overview';
  }

  function renderOverview() {
    const active = data.projects.filter((project) => project.stage === 'In progress').length;
    const open = data.tasks.filter((task) => task.status !== 'Done');
    const dueSoon = open.filter((task) => daysUntil(task.due) >= 0 && daysUntil(task.due) <= 7).length;
    const overdue = open.filter((task) => daysUntil(task.due) < 0).length;
    const nextMilestones = data.milestones.filter((milestone) => milestone.status !== 'Complete').sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
    $('#view').innerHTML = `<div class="content">
      <div class="page-title-row"><div><p class="eyebrow">Site overview</p><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}.</h1><p class="subhead">A clear view of your active work and upcoming dates.</p></div></div>
      <section class="overview-intro"><div class="intro-copy"><p class="eyebrow">Current workload</p><h2>${active} active ${active === 1 ? 'project' : 'projects'} across your sites</h2><p>Keep deadlines visible, resolve blocked work, and track each project from planning through completion.</p></div><div class="intro-right"><div><strong>${open.length}</strong><span>open tasks to move forward</span></div></div></section>
      <section class="stats" aria-label="Summary"><div class="stat"><span>Total projects</span><strong>${data.projects.length}</strong><small>Across all stages</small></div><div class="stat"><span>Active projects</span><strong>${active}</strong><small>In progress now</small></div><div class="stat"><span>Due in 7 days</span><strong>${dueSoon}</strong><small>Open tasks</small></div><div class="stat"><span>Overdue tasks</span><strong>${overdue}</strong><small>Needs attention</small></div></section>
      <div class="section-heading"><h2>Projects</h2><span>${data.projects.length} total</span></div><div class="panel table-wrap">${data.projects.length ? `<table><thead><tr><th>Project</th><th>Stage</th><th>Lead</th><th>Target finish</th><th>Progress</th></tr></thead><tbody>${data.projects.map((project) => `<tr><td><button type="button" class="text-button" data-open-project="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button><span class="secondary">${escapeHtml(project.location || 'Location not set')}</span></td><td>${badge(project.stage)}</td><td>${escapeHtml(project.lead || 'Unassigned')}</td><td>${formatDate(project.end)}</td><td>${progressBar(progress(project.id))}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>No projects yet</strong>Create your first project to start tracking work.<br><button type="button" class="button primary" data-add="project">New project</button></div>`}</div>
      <div class="section-heading"><h2>Upcoming milestones</h2><span>Across all projects</span></div><div class="panel">${nextMilestones.length ? `<div class="mini-list">${nextMilestones.map((milestone) => milestoneRow(milestone, true)).join('')}</div>` : `<div class="empty"><strong>No upcoming milestones</strong>Add a milestone within a project to see it here.</div>`}</div>
    </div>`;
  }

  function milestoneRow(milestone, showProject = false) {
    const date = new Date(`${milestone.due}T12:00:00`);
    const project = data.projects.find((item) => item.id === milestone.projectId);
    const taskCount = data.tasks.filter((task) => task.milestoneId === milestone.id).length;
    const selected = selectedProjectId === milestone.projectId && taskMilestoneFilter === milestone.id;
    return `<div class="milestone ${selected ? 'selected' : ''}"><div class="date-tile"><b>${date.toLocaleDateString(undefined, { month: 'short' })}</b><strong>${date.getDate()}</strong></div><div class="milestone-info"><button class="milestone-select" type="button" data-select-milestone="${escapeHtml(milestone.id)}" aria-pressed="${selected}" title="Show tasks for ${escapeHtml(milestone.name)}">${escapeHtml(milestone.name)}</button><span>${showProject ? escapeHtml(project?.name || 'Unknown project') : formatDate(milestone.due)} · ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}</span></div>${badge(milestone.status)}${!showProject ? `<div class="row-actions"><button class="icon-button" type="button" data-edit-milestone="${escapeHtml(milestone.id)}" aria-label="Edit ${escapeHtml(milestone.name)}">⋯</button></div>` : ''}</div>`;
  }

  function renderProject(project) {
    const tasks = projectTasks(project.id);
    const milestones = projectMilestones(project.id).sort((a, b) => a.due.localeCompare(b.due));
    if (taskMilestoneFilter !== 'all' && !milestones.some((milestone) => milestone.id === taskMilestoneFilter)) taskMilestoneFilter = 'all';
    const selectedMilestone = milestones.find((milestone) => milestone.id === taskMilestoneFilter);
    const milestoneFilterHtml = `<select id="taskMilestoneFilter" aria-label="Filter by milestone"><option value="all">All milestones</option>${milestones.map((milestone) => `<option value="${escapeHtml(milestone.id)}" ${taskMilestoneFilter === milestone.id ? 'selected' : ''}>${escapeHtml(milestone.name)}</option>`).join('')}</select>`;
    const owners = [...new Set(tasks.map((task) => String(task.owner || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (taskOwnerFilter.startsWith('owner:') && !owners.includes(taskOwnerFilter.slice(6))) taskOwnerFilter = 'all';
    if (taskOwnerFilter === 'unassigned' && !tasks.some((task) => !String(task.owner || '').trim())) taskOwnerFilter = 'all';
    const ownerFilterHtml = `<select id="taskOwnerFilter" aria-label="Filter by task owner"><option value="all">All owners</option>${owners.map((owner) => `<option value="owner:${escapeHtml(owner)}" ${taskOwnerFilter === `owner:${owner}` ? 'selected' : ''}>${escapeHtml(owner)}</option>`).join('')}${tasks.some((task) => !String(task.owner || '').trim()) ? `<option value="unassigned" ${taskOwnerFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>` : ''}</select>`;
    const filtered = tasks.filter((task) => {
      const owner = String(task.owner || '').trim();
      return (taskFilter === 'All tasks' || task.status === taskFilter)
        && (taskMilestoneFilter === 'all' || task.milestoneId === taskMilestoneFilter)
        && (taskOwnerFilter === 'all' || (taskOwnerFilter === 'unassigned' ? !owner : taskOwnerFilter === `owner:${owner}`))
        && task.name.toLowerCase().includes(taskSearch.toLowerCase());
    }).sort((a, b) => a.due.localeCompare(b.due));
    const filtersActive = taskMilestoneFilter !== 'all' || taskFilter !== 'All tasks' || taskOwnerFilter !== 'all' || taskSearch;
    const emptyTaskTitle = !tasks.length ? 'No tasks yet' : selectedMilestone && !tasks.some((task) => task.milestoneId === selectedMilestone.id) ? 'No tasks under this milestone' : 'No tasks match this view';
    const emptyTaskDetail = !tasks.length ? milestones.length ? 'Add the first task for this project.' : 'Create a milestone before adding tasks.' : selectedMilestone && !tasks.some((task) => task.milestoneId === selectedMilestone.id) ? 'Add a task to this milestone or show all tasks.' : 'Change the search or filters.';
    const milestoneContextHtml = selectedMilestone ? `<div class="milestone-context">Showing tasks for <strong>${escapeHtml(selectedMilestone.name)}</strong><button type="button" data-clear-milestone="true">Show all tasks</button></div>` : '';
    $('#view').innerHTML = `<div class="content"><div class="page-title-row"><div><p class="eyebrow">Project workspace</p><h1>${escapeHtml(project.name)}</h1><p class="subhead">${escapeHtml(project.location || 'Location not set')} &nbsp;•&nbsp; ${badge(project.stage)}</p></div><div class="title-actions"><button class="button subtle" type="button" data-edit-project="${escapeHtml(project.id)}">Edit project</button><button class="button danger" type="button" data-delete-project="${escapeHtml(project.id)}">Delete</button></div></div>
      <section class="project-hero"><div class="hero-meta"><div><p>Project lead</p><strong>${escapeHtml(project.lead || 'Unassigned')}</strong></div><div><p>Start date</p><strong>${formatDate(project.start)}</strong></div><div><p>Target finish</p><strong>${formatDate(project.end)}</strong></div></div><div class="hero-progress"><p>Task progress</p><strong>${progress(project.id)}%</strong>${progressBar(progress(project.id)).split('<div class="progress-label">')[0]}</div></section>
      <div class="two-columns"><section id="tasksSection"><div class="section-heading"><h2>Tasks <span class="muted">(${filtersActive ? filtered.length + " of " + tasks.length : tasks.length})</span></h2><button class="button primary" type="button" data-add="task">＋ Add task</button></div><div class="panel"><div class="panel-footer filter-row"><input class="search-input" id="taskSearch" type="search" placeholder="Search tasks" aria-label="Search tasks" value="${escapeHtml(taskSearch)}">${milestoneFilterHtml}<select id="taskFilter" aria-label="Filter tasks">${['All tasks', 'Not started', 'In progress', 'Blocked', 'Done'].map((option) => `<option ${option === taskFilter ? 'selected' : ''}>${option}</option>`).join('')}</select>${ownerFilterHtml}</div>${milestoneContextHtml}<div class="table-wrap">${filtered.length ? `<table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map((task) => `<tr><td><strong>${escapeHtml(task.name)}</strong><span class="secondary">Milestone: ${escapeHtml(milestones.find((milestone) => milestone.id === task.milestoneId)?.name || "Unknown milestone")}</span><span class="secondary priority ${task.priority.toLowerCase()}">${escapeHtml(task.priority)} priority</span></td><td>${escapeHtml(task.owner || 'Unassigned')}</td><td>${formatDate(task.due)}${task.status !== 'Done' && daysUntil(task.due) < 0 ? '<span class="secondary" style="color:#b54a43">Overdue</span>' : ''}</td><td>${badge(task.status)}</td><td><div class="row-actions"><input class="task-check" type="checkbox" data-toggle-task="${escapeHtml(task.id)}" ${task.status === 'Done' ? 'checked' : ''} aria-label="Mark ${escapeHtml(task.name)} done"><button class="icon-button" type="button" data-edit-task="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.name)}">⋯</button></div></td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>${emptyTaskTitle}</strong>${emptyTaskDetail}</div>`}</div></div></section>
      <section><div class="section-heading"><h2>Milestones <span class="muted">(${milestones.length})</span></h2><button class="button" type="button" data-add="milestone">＋ Add</button></div><div class="panel">${milestones.length ? `<div class="mini-list">${milestones.map((milestone) => milestoneRow(milestone)).join('')}</div>` : `<div class="empty"><strong>No milestones yet</strong>Add a target date to map the schedule.</div>`}</div></section></div></div>`;
  }

  function render() {
    if (selectedProjectId && !data.projects.some((project) => project.id === selectedProjectId)) selectedProjectId = null;
    renderNavigation();
    const project = data.projects.find((item) => item.id === selectedProjectId);
    if (project) renderProject(project); else renderOverview();
  }

  function showFormError(form, message) {
    let error = form.querySelector('.form-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'form-error';
      error.setAttribute('role', 'alert');
      form.querySelector('.dialog-actions').before(error);
    }
    error.textContent = message;
    error.hidden = false;
  }

  function resetTaskRefinements() {
    taskFilter = 'All tasks';
    taskOwnerFilter = 'all';
    taskSearch = '';
  }

  function openDialog(type, item = null) {
    const dialog = $(`#${type}Dialog`);
    const form = $(`#${type}Form`);
    form.reset();
    const error = form.querySelector('.form-error');
    if (error) error.hidden = true;
    form.elements.id.value = item?.id || '';
    if (type !== 'project') form.elements.projectId.value = item?.projectId || selectedProjectId;
    if (type === 'task') {
      const milestones = projectMilestones(form.elements.projectId.value).sort((a, b) => a.due.localeCompare(b.due));
      form.elements.milestoneId.innerHTML = `<option value="">Select milestone</option>${milestones.map((milestone) => `<option value="${escapeHtml(milestone.id)}">${escapeHtml(milestone.name)}</option>`).join('')}`;
    }
    if (item) Object.keys(item).forEach((key) => { if (form.elements[key]) form.elements[key].value = item[key]; });
    else if (type === 'project') { form.elements.start.value = localDate(); form.elements.end.value = localDate(90); }
    else form.elements.due.value = localDate(7);
    if (type === 'task' && !item && taskMilestoneFilter !== 'all') form.elements.milestoneId.value = taskMilestoneFilter;
    if (type !== 'project') $(`#delete${type[0].toUpperCase() + type.slice(1)}Button`).hidden = !item;
    $(`#${type}DialogTitle`).textContent = `${item ? 'Edit' : 'New'} ${type}`;
    dialog.showModal();
    form.querySelector('input[name="name"]').focus();
  }

  function upsert(type, values) {
    const collection = type === 'project' ? data.projects : type === 'task' ? data.tasks : data.milestones;
    const index = collection.findIndex((item) => item.id === values.id);
    if (index >= 0) collection[index] = { ...collection[index], ...values };
    else collection.push({ ...values, id: uid() });
    if (type === 'project' && index < 0) selectedProjectId = collection.at(-1).id;
    save(`${type[0].toUpperCase() + type.slice(1)} saved`);
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.close) return $(`#${target.dataset.close}`).close();
    if (target.dataset.openProject) { selectedProjectId = target.dataset.openProject; taskMilestoneFilter = 'all'; resetTaskRefinements(); render(); return; }
    if (target.dataset.selectMilestone) {
      const milestone = data.milestones.find((item) => item.id === target.dataset.selectMilestone);
      if (!milestone) return;
      const alreadySelected = selectedProjectId === milestone.projectId && taskMilestoneFilter === milestone.id;
      selectedProjectId = milestone.projectId;
      taskMilestoneFilter = alreadySelected ? 'all' : milestone.id;
      resetTaskRefinements();
      render();
      if (window.innerWidth <= 760) $('#tasksSection')?.scrollIntoView({ block: 'start' });
      return;
    }
    if (target.dataset.clearMilestone) { taskMilestoneFilter = 'all'; resetTaskRefinements(); render(); return; }
    if (target.dataset.add) {
      if (target.dataset.add === 'task' && !projectMilestones(selectedProjectId).length) {
        toast('Create a milestone before adding tasks');
        return openDialog('milestone');
      }
      return openDialog(target.dataset.add);
    }
    if (target.dataset.editProject) return openDialog('project', data.projects.find((item) => item.id === target.dataset.editProject));
    if (target.dataset.editTask) return openDialog('task', data.tasks.find((item) => item.id === target.dataset.editTask));
    if (target.dataset.editMilestone) return openDialog('milestone', data.milestones.find((item) => item.id === target.dataset.editMilestone));
    if (target.dataset.deleteProject) {
      const project = data.projects.find((item) => item.id === target.dataset.deleteProject);
      if (project && confirm(`Delete “${project.name}” and all its tasks and milestones? This cannot be undone.`)) {
        data.projects = data.projects.filter((item) => item.id !== project.id);
        data.tasks = data.tasks.filter((item) => item.projectId !== project.id);
        data.milestones = data.milestones.filter((item) => item.projectId !== project.id);
        selectedProjectId = null;
        save('Project deleted');
      }
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'taskFilter') { taskFilter = event.target.value; render(); }
    if (event.target.id === 'taskOwnerFilter') { taskOwnerFilter = event.target.value; render(); }
    if (event.target.id === 'taskMilestoneFilter') { taskMilestoneFilter = event.target.value; resetTaskRefinements(); render(); }
    if (event.target.dataset.toggleTask) {
      const task = data.tasks.find((item) => item.id === event.target.dataset.toggleTask);
      if (task) { task.status = event.target.checked ? 'Done' : 'Not started'; save('Task updated'); }
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'taskSearch') {
      const position = event.target.selectionStart;
      taskSearch = event.target.value;
      render();
      $('#taskSearch').focus();
      $('#taskSearch').setSelectionRange(position, position);
    }
  });

  ['project', 'task', 'milestone'].forEach((type) => {
    $(`#${type}Form`).addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      if (type === 'project' && values.end < values.start) { showFormError(event.target, 'Target finish must be after start date'); return; }
      if (type === 'task' && !data.milestones.some((milestone) => milestone.id === values.milestoneId && milestone.projectId === values.projectId)) {
        showFormError(event.target, 'Select a milestone from this project');
        return;
      }
      upsert(type, values);
      $(`#${type}Dialog`).close();
    });
  });

  ['task', 'milestone'].forEach((type) => {
    $(`#delete${type[0].toUpperCase() + type.slice(1)}Button`).addEventListener('click', () => {
      const form = $(`#${type}Form`);
      const collection = type === 'task' ? data.tasks : data.milestones;
      const item = collection.find((entry) => entry.id === form.elements.id.value);
      if (type === 'milestone' && item) {
        const taskCount = data.tasks.filter((task) => task.milestoneId === item.id).length;
        if (taskCount) { showFormError(form, `Reassign ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} before deleting this milestone`); return; }
      }
      if (!item || !confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
      data[type === 'task' ? 'tasks' : 'milestones'] = collection.filter((entry) => entry.id !== item.id);
      $(`#${type}Dialog`).close();
      save(`${type[0].toUpperCase() + type.slice(1)} deleted`);
    });
  });

  $('#overviewNav').addEventListener('click', () => { selectedProjectId = null; render(); });
  $('.brand').addEventListener('click', (event) => { event.preventDefault(); selectedProjectId = null; render(); });
  $('#newProjectButton').addEventListener('click', () => openDialog('project'));
  $('#addProjectNav').addEventListener('click', () => openDialog('project'));
  $('#exportButton').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fieldline-backup-${localDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('Data exported');
  });
  $('#importInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!['projects', 'tasks', 'milestones'].every((key) => Array.isArray(imported[key]))) throw new Error('Missing project data');
      const projectIds = new Set(imported.projects.map((project) => project?.id));
      if (imported.tasks.some((task) => !task || !projectIds.has(task.projectId)) || imported.milestones.some((milestone) => !milestone || !projectIds.has(milestone.projectId))) {
        throw new Error('A task or milestone references a missing project');
      }
      if (!confirm('Replace all current projects, tasks, and milestones with this backup?')) return;
      data = { projects: imported.projects, tasks: imported.tasks, milestones: imported.milestones };
      ensureTaskMilestones(data);
      selectedProjectId = null;
      taskMilestoneFilter = 'all';
      resetTaskRefinements();
      save('Data imported');
    } catch (error) { toast(`Import failed: ${error.message}`); }
    finally { event.target.value = ''; }
  });

  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  render();
})();
