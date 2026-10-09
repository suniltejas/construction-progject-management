/* Fieldline project workspace. Data and permissions are supplied by the server. */
import './styles.css';
import './subtasks.css';
import './auth.css';
import { api } from './api.js';
import { authClient, hideAuthScreen, showAuthScreen } from './auth-ui.js';

(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const localDate = (offset = 0) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const formatDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options) : '—';
  const daysUntil = (value) => Math.round((new Date(`${value}T12:00:00`) - new Date(`${localDate()}T12:00:00`)) / 86400000);

  let data = { projects: [], tasks: [], subtasks: [], milestones: [], memberships: [] };
  let currentUser = null;
  const membersByProject = new Map();
  let selectedProjectId = null;
  let taskFilter = 'All tasks';
  let taskOwnerFilter = 'all';
  let taskMilestoneFilter = 'all';
  let taskSearch = '';
  let toastTimer;
  let connectionGeneration = 0;

  async function refreshWorkspace(message) {
    const generation = connectionGeneration;
    try {
      const response = await api.workspace();
      if (generation !== connectionGeneration || navigator.onLine === false) throw new Error('Connection lost. Reconnect to view your workspace.');
      if (!['projects', 'tasks', 'subtasks', 'milestones'].every((key) => Array.isArray(response[key]))) throw new Error('Invalid workspace response');
      data = { ...response, memberships: response.memberships || [] };
      membersByProject.clear();
      if (selectedProjectId && ['owner', 'editor'].includes(roleFor(selectedProjectId))) {
        await ensureMembers(selectedProjectId);
      }
      if (generation !== connectionGeneration) throw new Error('Connection lost. Reconnect to view your workspace.');
      render();
      if (message) toast(message);
    } catch (error) {
      if (generation === connectionGeneration && error.status === 401) {
        connectionGeneration += 1;
        clearWorkspaceState();
        await showAuthScreen(start);
      } else if (generation === connectionGeneration) showOffline();
      throw error;
    }
  }

  async function runMutation(operation, message) {
    try { await operation(); await refreshWorkspace(message); }
    catch (error) { toast(error.message || 'Could not save changes'); throw error; }
  }

  function roleFor(projectId) {
    const project = data.projects.find((item) => item.id === projectId);
    return project?.role || data.memberships.find((member) => member.projectId === projectId)?.role || null;
  }
  const canEditTasks = (projectId) => ['owner', 'editor'].includes(roleFor(projectId));
  const isOwner = (projectId) => roleFor(projectId) === 'owner';

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
  }

  function clearWorkspaceState() {
    currentUser = null;
    data = { projects: [], tasks: [], subtasks: [], milestones: [], memberships: [] };
    membersByProject.clear();
    selectedProjectId = null;
    document.querySelectorAll('dialog').forEach((dialog) => {
      if (dialog.open) dialog.close();
      dialog.querySelectorAll('form').forEach((form) => form.reset());
    });
    $('#taskForm').elements.milestoneId.replaceChildren();
    $('#subtaskForm').reset();
    $('#assigneeOptions').replaceChildren();
    $('#membersList').replaceChildren();
    $('#view').replaceChildren();
    $('#projectNav').replaceChildren();
    $('#breadcrumbCurrent').textContent = 'Overview';
    $('#accountName').textContent = '';
    $('#toast').textContent = '';
    $('#toast').classList.remove('show');
  }

  function showOffline() {
    connectionGeneration += 1;
    clearWorkspaceState();
    $('#appShell').hidden = true;
    $('#authScreen').hidden = false;
    $('#authScreen').innerHTML = '<div class="auth-card"><h1>Workspace unavailable</h1><p class="auth-intro">Connect to the server to load your workspace.</p><button id="retryLoad" class="button primary" type="button">Retry connection</button></div>';
    $('#retryLoad').addEventListener('click', start);
  }
  window.addEventListener('fieldline:connection-lost', showOffline);

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
  const memberList = (projectId) => membersByProject.get(projectId) || [];
  const memberName = (member) => member.username || member.user?.username || member.email || 'Member';
  const assignableMembers = (response) => [
    ...(response.members || []),
    ...(response.invitations || []).map((invite) => ({
      userId: invite.assigneeId, username: invite.username, role: invite.role, pending: true,
    })),
  ];
  function taskOwnerLabel(task) {
    const assigned = (task.assigneeUserIds || []).map((id) => {
      if (id === currentUser?.id && roleFor(task.projectId) === 'viewer') return 'You';
      const member = memberList(task.projectId).find((entry) => (entry.userId || entry.id || entry.user?.id) === id);
      return member ? `${memberName(member)}${member.pending ? ' (invited)' : ''}`
        : id.startsWith('pending:') ? 'Pending invitation' : '';
    }).filter(Boolean);
    return [task.owner, ...assigned].filter(Boolean).join(' · ') || 'Unassigned';
  }

  function subtaskOwnerLabel(subtask) {
    if (!subtask.ownerAssigneeId) return 'Unassigned';
    if (subtask.ownerAssigneeId === currentUser?.id) return 'You';
    const member = memberList(subtask.projectId).find((entry) =>
      (entry.userId || entry.id || entry.user?.id) === subtask.ownerAssigneeId);
    return member ? `${memberName(member)}${member.pending ? ' (invited)' : ''}`
      : subtask.ownerAssigneeId.startsWith('pending:') ? 'Pending invitation' : 'Project member';
  }

  function renderNavigation() {
    $('#projectCount').textContent = data.projects.length;
    $('#projectNav').innerHTML = data.projects.map((project) => `<button type="button" class="nav-link ${selectedProjectId === project.id ? 'active' : ''}" data-open-project="${escapeHtml(project.id)}"><span class="project-initial">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span><span class="truncate">${escapeHtml(project.name)}</span></button>`).join('');
    $('#overviewNav').classList.toggle('active', !selectedProjectId);
    $('#breadcrumbCurrent').textContent = data.projects.find((project) => project.id === selectedProjectId)?.name ?? 'Overview';
  }

  function renderOverview() {
    const hasViewerProjects = data.projects.some((project) => roleFor(project.id) === 'viewer');
    const allViewerProjects = data.projects.length > 0 && data.projects.every((project) => roleFor(project.id) === 'viewer');
    const active = data.projects.filter((project) => project.stage === 'In progress').length;
    const open = data.tasks.filter((task) => task.status !== 'Done');
    const dueSoon = open.filter((task) => daysUntil(task.due) >= 0 && daysUntil(task.due) <= 7).length;
    const overdue = open.filter((task) => daysUntil(task.due) < 0).length;
    const nextMilestones = data.milestones.filter((milestone) => milestone.status !== 'Complete').sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
    const projectRows = data.projects.map((project) => {
      const nameCell = `<td><button type="button" class="text-button" data-open-project="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button>${roleFor(project.id) === 'viewer' ? '' : `<span class="secondary">${escapeHtml(project.location || 'Location not set')}</span>`}</td>`;
      if (allViewerProjects) return `<tr>${nameCell}<td>${progressBar(progress(project.id))}</td></tr>`;
      if (roleFor(project.id) === 'viewer') return `<tr>${nameCell}<td colspan="3" class="muted">Assigned tasks only</td><td>${progressBar(progress(project.id))}</td></tr>`;
      return `<tr>${nameCell}<td>${badge(project.stage)}</td><td>${escapeHtml(project.lead || 'Unassigned')}</td><td>${formatDate(project.end)}</td><td>${progressBar(progress(project.id))}</td></tr>`;
    }).join('');
    $('#view').innerHTML = `<div class="content">
      <div class="page-title-row"><div><p class="eyebrow">Site overview</p><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}.</h1><p class="subhead">A clear view of your active work and upcoming dates.</p></div></div>
      <section class="overview-intro"><div class="intro-copy"><p class="eyebrow">Current workload</p><h2>${hasViewerProjects ? `${data.projects.length} projects in your workspace` : `${active} active ${active === 1 ? 'project' : 'projects'} across your sites`}</h2><p>${hasViewerProjects ? 'Track the work available to you and keep upcoming dates in view.' : 'Keep deadlines visible, resolve blocked work, and track each project from planning through completion.'}</p></div><div class="intro-right"><div><strong>${open.length}</strong><span>open tasks to move forward</span></div></div></section>
      <section class="stats" aria-label="Summary"><div class="stat"><span>Total projects</span><strong>${data.projects.length}</strong><small>Available to you</small></div><div class="stat"><span>${hasViewerProjects ? 'Visible tasks' : 'Active projects'}</span><strong>${hasViewerProjects ? data.tasks.length : active}</strong><small>${hasViewerProjects ? 'In your workspace' : 'In progress now'}</small></div><div class="stat"><span>Due in 7 days</span><strong>${dueSoon}</strong><small>Open tasks</small></div><div class="stat"><span>Overdue tasks</span><strong>${overdue}</strong><small>Needs attention</small></div></section>
      <div class="section-heading"><h2>Projects</h2><span>${data.projects.length} total</span></div><div class="panel table-wrap ${allViewerProjects ? 'viewer-table' : ''}">${data.projects.length ? `<table><thead><tr><th>Project</th>${allViewerProjects ? '' : '<th>Stage</th><th>Lead</th><th>Target finish</th>'}<th>${allViewerProjects ? 'My progress' : 'Progress'}</th></tr></thead><tbody>${projectRows}</tbody></table>` : `<div class="empty"><strong>No projects yet</strong>Create your first project to start tracking work.<br><button type="button" class="button primary" data-add="project">New project</button></div>`}</div>
      <div class="section-heading"><h2>Upcoming milestones</h2><span>Across all projects</span></div><div class="panel">${nextMilestones.length ? `<div class="mini-list">${nextMilestones.map((milestone) => milestoneRow(milestone, true)).join('')}</div>` : `<div class="empty"><strong>No upcoming milestones</strong>Add a milestone within a project to see it here.</div>`}</div>
    </div>`;
  }

  function milestoneRow(milestone, showProject = false) {
    const date = new Date(`${milestone.due}T12:00:00`);
    const project = data.projects.find((item) => item.id === milestone.projectId);
    const taskCount = data.tasks.filter((task) => task.milestoneId === milestone.id).length;
    const selected = selectedProjectId === milestone.projectId && taskMilestoneFilter === milestone.id;
    return `<div class="milestone ${selected ? 'selected' : ''}"><div class="date-tile"><b>${date.toLocaleDateString(undefined, { month: 'short' })}</b><strong>${date.getDate()}</strong></div><div class="milestone-info"><button class="milestone-select" type="button" data-select-milestone="${escapeHtml(milestone.id)}" aria-pressed="${selected}" title="Show tasks for ${escapeHtml(milestone.name)}">${escapeHtml(milestone.name)}</button><span>${showProject ? escapeHtml(project?.name || 'Unknown project') : formatDate(milestone.due)} · ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}</span></div>${badge(milestone.status)}${!showProject && isOwner(milestone.projectId) ? `<div class="row-actions"><button class="icon-button" type="button" data-edit-milestone="${escapeHtml(milestone.id)}" aria-label="Edit ${escapeHtml(milestone.name)}">⋯</button></div>` : ''}</div>`;
  }

  function taskRow(task, milestones) {
    const editable = canEditTasks(task.projectId);
    const controls = editable ? `<div class="row-actions"><input class="task-check" type="checkbox" data-toggle-task="${escapeHtml(task.id)}" ${task.status === 'Done' ? 'checked' : ''} aria-label="Mark ${escapeHtml(task.name)} done"><button class="icon-button" type="button" data-edit-task="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.name)}">⋯</button></div>` : '';
    const children = data.subtasks.filter((subtask) => subtask.taskId === task.id);
    const doneCount = children.filter((subtask) => subtask.status === 'Done').length;
    const childRows = children.map((subtask) => `<div class="subtask-item" role="listitem"><span class="subtask-state">${editable ? `<input class="task-check" type="checkbox" data-toggle-subtask="${escapeHtml(subtask.id)}" ${subtask.status === 'Done' ? 'checked' : ''} aria-label="Mark ${escapeHtml(subtask.name)} done">` : subtask.status === 'Done' ? '✓' : '○'}</span><span class="subtask-body"><span class="subtask-name ${subtask.status === 'Done' ? 'done' : ''}">${escapeHtml(subtask.name)}</span><small>Owner: ${escapeHtml(subtaskOwnerLabel(subtask))} · Due ${formatDate(subtask.due || task.due)}</small></span>${badge(subtask.status)}${editable ? `<button class="icon-button" type="button" data-edit-subtask="${escapeHtml(subtask.id)}" aria-label="Edit subtask ${escapeHtml(subtask.name)}">⋯</button>` : ''}</div>`).join('');
    const childList = children.length ? `<div class="subtask-list"><span class="subtask-summary">Subtasks · ${doneCount}/${children.length} done</span><div role="list">${childRows}</div></div>` : '';
    const addSubtask = editable ? `<button class="text-button add-subtask" type="button" data-add-subtask="${escapeHtml(task.id)}">＋ Add subtask</button>` : '';
    return `<tr><td><strong>${escapeHtml(task.name)}</strong><span class="secondary">Milestone: ${escapeHtml(milestones.find((milestone) => milestone.id === task.milestoneId)?.name || 'Unknown milestone')}</span><span class="secondary priority ${escapeHtml((task.priority || 'Normal').toLowerCase())}">${escapeHtml(task.priority || 'Normal')} priority</span>${childList}${addSubtask}</td><td>${escapeHtml(taskOwnerLabel(task))}</td><td>${formatDate(task.due)}${children.length ? '<span class="secondary">From subtasks</span>' : ''}${task.status !== 'Done' && daysUntil(task.due) < 0 ? '<span class="secondary" style="color:#b54a43">Overdue</span>' : ''}</td><td>${badge(task.status)}</td><td>${controls}</td></tr>`;
  }

  function renderProject(project) {
    const tasks = projectTasks(project.id);
    const milestones = projectMilestones(project.id).sort((a, b) => a.due.localeCompare(b.due));
    if (taskMilestoneFilter !== 'all' && !milestones.some((milestone) => milestone.id === taskMilestoneFilter)) taskMilestoneFilter = 'all';
    const selectedMilestone = milestones.find((milestone) => milestone.id === taskMilestoneFilter);
    const milestoneFilterHtml = `<select id="taskMilestoneFilter" aria-label="Filter by milestone"><option value="all">All milestones</option>${milestones.map((milestone) => `<option value="${escapeHtml(milestone.id)}" ${taskMilestoneFilter === milestone.id ? 'selected' : ''}>${escapeHtml(milestone.name)}</option>`).join('')}</select>`;
    const owners = [...new Set(tasks.map((task) => String(task.owner || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const assignees = [...new Set([
      ...tasks.flatMap((task) => task.assigneeUserIds || []),
      ...data.subtasks.filter((subtask) => subtask.projectId === project.id)
        .map((subtask) => subtask.ownerAssigneeId).filter(Boolean),
    ])].map((id) => ({
      id,
      name: id === currentUser?.id && roleFor(project.id) === 'viewer'
        ? 'You'
        : memberList(project.id).find((member) => member.userId === id)?.username
          || (id.startsWith('pending:') ? 'Pending invitation' : 'Member'),
    })).sort((a, b) => a.name.localeCompare(b.name));
    const hasUnassigned = tasks.some((task) => !String(task.owner || '').trim()
      && !(task.assigneeUserIds || []).length
      && !data.subtasks.some((subtask) => subtask.taskId === task.id && subtask.ownerAssigneeId));
    if (taskOwnerFilter.startsWith('owner:') && !owners.includes(taskOwnerFilter.slice(6))) taskOwnerFilter = 'all';
    if (taskOwnerFilter.startsWith('assignee:') && !assignees.some((assignee) => assignee.id === taskOwnerFilter.slice(9))) taskOwnerFilter = 'all';
    if (taskOwnerFilter === 'unassigned' && !hasUnassigned) taskOwnerFilter = 'all';
    const ownerFilterHtml = `<select id="taskOwnerFilter" aria-label="Filter by task owner or assignee"><option value="all">All owners / assignees</option>${owners.map((owner) => `<option value="owner:${escapeHtml(owner)}" ${taskOwnerFilter === `owner:${owner}` ? 'selected' : ''}>Owner label: ${escapeHtml(owner)}</option>`).join('')}${assignees.map((assignee) => `<option value="assignee:${escapeHtml(assignee.id)}" ${taskOwnerFilter === `assignee:${assignee.id}` ? 'selected' : ''}>Assigned: ${escapeHtml(assignee.name)}</option>`).join('')}${hasUnassigned ? `<option value="unassigned" ${taskOwnerFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>` : ''}</select>`;
    const filtered = tasks.filter((task) => {
      const owner = String(task.owner || '').trim();
      return (taskFilter === 'All tasks' || task.status === taskFilter)
        && (taskMilestoneFilter === 'all' || task.milestoneId === taskMilestoneFilter)
        && (taskOwnerFilter === 'all' || (taskOwnerFilter === 'unassigned'
          ? !owner && !(task.assigneeUserIds || []).length
            && !data.subtasks.some((subtask) => subtask.taskId === task.id && subtask.ownerAssigneeId)
          : taskOwnerFilter.startsWith('assignee:')
            ? (task.assigneeUserIds || []).includes(taskOwnerFilter.slice(9))
              || data.subtasks.some((subtask) => subtask.taskId === task.id
                && subtask.ownerAssigneeId === taskOwnerFilter.slice(9))
            : taskOwnerFilter === `owner:${owner}`))
        && (task.name.toLowerCase().includes(taskSearch.toLowerCase())
          || data.subtasks.some((subtask) => subtask.taskId === task.id
            && subtask.name.toLowerCase().includes(taskSearch.toLowerCase())));
    }).sort((a, b) => a.due.localeCompare(b.due));
    const filtersActive = taskMilestoneFilter !== 'all' || taskFilter !== 'All tasks' || taskOwnerFilter !== 'all' || taskSearch;
    const emptyTaskTitle = !tasks.length ? roleFor(project.id) === 'viewer' ? 'No tasks assigned to you yet' : 'No tasks yet' : selectedMilestone && !tasks.some((task) => task.milestoneId === selectedMilestone.id) ? 'No tasks under this milestone' : 'No tasks match this view';
    const emptyTaskDetail = !tasks.length ? roleFor(project.id) === 'viewer' ? 'Your project editor can assign a task to you.' : milestones.length ? 'Add the first task for this project.' : 'Create a milestone before adding tasks.' : selectedMilestone && !tasks.some((task) => task.milestoneId === selectedMilestone.id) ? canEditTasks(project.id) ? 'Add a task to this milestone or show all tasks.' : 'Show all tasks or ask an editor for an assignment.' : 'Change the search or filters.';
    const milestoneContextHtml = selectedMilestone ? `<div class="milestone-context">Showing tasks for <strong>${escapeHtml(selectedMilestone.name)}</strong><button type="button" data-clear-milestone="true">Show all tasks</button></div>` : '';
    $('#view').innerHTML = `<div class="content"><div class="page-title-row"><div><p class="eyebrow">Project workspace</p><h1>${escapeHtml(project.name)}</h1><p class="subhead">${roleFor(project.id) === 'viewer' ? 'Assigned tasks only' : `${escapeHtml(project.location || 'Location not set')} &nbsp;•&nbsp; ${badge(project.stage)}`} <span class="role-label">${escapeHtml(roleFor(project.id) || '')}</span></p></div><div class="title-actions">${isOwner(project.id) ? `<button class="button subtle" type="button" data-manage-members="${escapeHtml(project.id)}">People & access</button><button class="button subtle" type="button" data-edit-project="${escapeHtml(project.id)}">Edit project</button><button class="button danger" type="button" data-delete-project="${escapeHtml(project.id)}">Delete</button>` : ''}</div></div>
      <section class="project-hero ${roleFor(project.id) === 'viewer' ? 'viewer-project-hero' : ''}">${roleFor(project.id) === 'viewer' ? '' : `<div class="hero-meta"><div><p>Project lead</p><strong>${escapeHtml(project.lead || 'Unassigned')}</strong></div><div><p>Start date</p><strong>${formatDate(project.start)}</strong></div><div><p>Target finish</p><strong>${formatDate(project.end)}</strong></div></div>`}<div class="hero-progress"><p>${roleFor(project.id) === 'viewer' ? 'My task progress' : 'Task progress'}</p><strong>${progress(project.id)}%</strong>${progressBar(progress(project.id)).split('<div class="progress-label">')[0]}</div></section>
      <div class="two-columns"><section id="tasksSection"><div class="section-heading"><h2>Tasks <span class="muted">(${filtersActive ? filtered.length + " of " + tasks.length : tasks.length})</span></h2>${canEditTasks(project.id) ? '<button class="button primary" type="button" data-add="task">＋ Add task</button>' : ''}</div><div class="panel"><div class="panel-footer filter-row"><input class="search-input" id="taskSearch" type="search" placeholder="Search tasks" aria-label="Search tasks" value="${escapeHtml(taskSearch)}">${milestoneFilterHtml}<select id="taskFilter" aria-label="Filter tasks">${['All tasks', 'Not started', 'In progress', 'Blocked', 'Done'].map((option) => `<option ${option === taskFilter ? 'selected' : ''}>${option}</option>`).join('')}</select>${ownerFilterHtml}</div>${milestoneContextHtml}<div class="table-wrap">${filtered.length ? `<table><thead><tr><th>Task</th><th>Owner / assignees</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map((task) => taskRow(task, milestones)).join('')}</tbody></table>` : `<div class="empty"><strong>${emptyTaskTitle}</strong>${emptyTaskDetail}</div>`}</div></div></section>
      <section><div class="section-heading"><h2>Milestones <span class="muted">(${milestones.length})</span></h2>${isOwner(project.id) ? '<button class="button" type="button" data-add="milestone">＋ Add</button>' : ''}</div><div class="panel">${milestones.length ? `<div class="mini-list">${milestones.map((milestone) => milestoneRow(milestone)).join('')}</div>` : `<div class="empty"><strong>No milestones yet</strong>${isOwner(project.id) ? 'Add a target date to map the schedule.' : ''}</div>`}</div></section></div></div>`;
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

  async function ensureMembers(projectId, force = false) {
    if (!force && membersByProject.has(projectId)) return membersByProject.get(projectId);
    const response = await api.members(projectId);
    const members = assignableMembers(response);
    membersByProject.set(projectId, members);
    return members;
  }

  async function openDialog(type, item = null) {
    const projectId = item?.projectId || selectedProjectId;
    if (type === 'project' && item && !isOwner(item.id)) return;
    if (type === 'milestone' && !isOwner(projectId)) return;
    if (type === 'task' && !canEditTasks(projectId)) return;
    const dialog = $(`#${type}Dialog`);
    const form = $(`#${type}Form`);
    form.reset();
    const error = form.querySelector('.form-error');
    if (error) error.hidden = true;
    if (type !== 'project') form.elements.due.disabled = false;
    form.elements.id.value = item?.id || '';
    if (type !== 'project') form.elements.projectId.value = item?.projectId || selectedProjectId;
    if (type === 'task') {
      const milestones = projectMilestones(form.elements.projectId.value).sort((a, b) => a.due.localeCompare(b.due));
      form.elements.milestoneId.innerHTML = `<option value="">Select milestone</option>${milestones.map((milestone) => `<option value="${escapeHtml(milestone.id)}">${escapeHtml(milestone.name)}</option>`).join('')}`;
      try {
        const members = await ensureMembers(form.elements.projectId.value);
        const assigned = new Set(item?.assigneeUserIds || []);
        $('#assigneeOptions').innerHTML = members.length
          ? members.map((member) => {
            const id = member.userId || member.id || member.user?.id;
            return `<label class="assignee-option"><input type="checkbox" name="assigneeUserIds" value="${escapeHtml(id)}" ${assigned.has(id) ? 'checked' : ''}><span>${escapeHtml(memberName(member))}<small>${member.pending ? 'Invited · ' : ''}${escapeHtml(member.role || '')}</small></span></label>`;
          }).join('')
          : '<p class="muted">Invite someone to assign them tasks.</p>';
      } catch (error) { toast(error.message); return; }
    }
    if (item) Object.keys(item).forEach((key) => { if (key !== 'assigneeUserIds' && form.elements[key]) form.elements[key].value = item[key]; });
    else if (type === 'project') { form.elements.start.value = localDate(); form.elements.end.value = localDate(90); }
    else form.elements.due.value = localDate(7);
    if (type === 'task' && !item && taskMilestoneFilter !== 'all') form.elements.milestoneId.value = taskMilestoneFilter;
    if (item && type !== 'project') {
      const derived = type === 'task'
        ? data.subtasks.some((subtask) => subtask.taskId === item.id)
        : data.tasks.some((task) => task.milestoneId === item.id);
      form.elements.due.disabled = derived;
      let note = form.querySelector('.derived-deadline-note');
      if (!note) {
        note = document.createElement('small');
        note.className = 'derived-deadline-note';
        form.elements.due.after(note);
      }
      note.textContent = type === 'task' ? 'Set by the latest subtask deadline.' : 'Set by the latest task deadline.';
      note.hidden = !derived;
    } else {
      const note = form.querySelector('.derived-deadline-note');
      if (note) note.hidden = true;
    }
    if (type !== 'project') $(`#delete${type[0].toUpperCase() + type.slice(1)}Button`).hidden = !item || !isOwner(projectId);
    $(`#${type}DialogTitle`).textContent = `${item ? 'Edit' : 'New'} ${type}`;
    dialog.showModal();
    form.querySelector('input[name="name"]').focus();
  }

  async function openSubtaskDialog(task, item = null) {
    if (!task || !canEditTasks(task.projectId) || (item && item.taskId !== task.id)) return;
    const form = $('#subtaskForm');
    form.reset();
    const error = form.querySelector('.form-error');
    if (error) error.hidden = true;
    form.elements.id.value = item?.id || '';
    form.elements.taskId.value = task.id;
    form.elements.name.value = item?.name || '';
    form.elements.due.value = item?.due || task.due;
    try {
      const members = await ensureMembers(task.projectId);
      form.elements.ownerAssigneeId.innerHTML = `<option value="">Select owner</option>${members.map((member) => {
        const id = member.userId || member.id || member.user?.id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(memberName(member))}${member.pending ? ' (invited)' : ''}</option>`;
      }).join('')}`;
      form.elements.ownerAssigneeId.value = item?.ownerAssigneeId || '';
    } catch (error) { toast(error.message); return; }
    form.elements.status.value = item?.status || 'Not started';
    $('#subtaskParent').textContent = `Under ${task.name}`;
    $('#subtaskDialogTitle').textContent = item ? 'Edit subtask' : 'New subtask';
    $('#deleteSubtaskButton').hidden = !item || !isOwner(task.projectId);
    $('#subtaskDialog').showModal();
    form.elements.name.focus();
  }

  async function upsert(type, values) {
    const id = values.id;
    delete values.id;
    if (id) {
      if (type !== 'project') delete values.projectId;
      const collection = data[`${type}s`];
      const current = collection.find((item) => item.id === id);
      if (current?.version !== undefined) values.version = current.version;
      await api.update(type, id, values);
    } else {
      const created = await api.create(type, values);
      if (type === 'project') selectedProjectId = created.id;
    }
    await refreshWorkspace(`${type[0].toUpperCase() + type.slice(1)} saved`);
  }

  function renderMembers(projectId, response) {
    const members = response.members || [];
    membersByProject.set(projectId, assignableMembers(response));
    const rows = members.map((member) => {
      const id = member.userId || member.id || member.user?.id;
      const role = member.role || (id === currentUser?.id ? 'owner' : 'viewer');
      const controls = role === 'owner' ? '<span class="badge blue">Owner</span>' : `<select data-member-role="${escapeHtml(id)}" aria-label="Role for ${escapeHtml(memberName(member))}"><option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option><option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option></select><button class="icon-button" type="button" data-remove-member="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(memberName(member))}">×</button>`;
      return `<div class="member-row"><div><strong>${escapeHtml(memberName(member))}</strong><span>${escapeHtml(member.email || member.user?.email || '')}</span></div><div class="member-controls">${controls}</div></div>`;
    });
    const invitations = (response.invitations || []).map((invite) => `<div class="member-row"><div><strong>${escapeHtml(invite.username)}</strong><span>${escapeHtml(invite.email)} · Invitation pending</span></div><span class="badge amber">${escapeHtml(invite.role)}</span></div>`);
    $('#membersList').innerHTML = `<h3>Project members</h3>${rows.length ? rows.join('') : '<p class="muted">No members yet.</p>'}${invitations.length ? `<h3>Invitations</h3>${invitations.join('')}` : ''}`;
    $('#membersDialog').dataset.projectId = projectId;
  }

  async function openMembersDialog(projectId) {
    if (!isOwner(projectId)) return;
    try {
      const response = await api.members(projectId);
      renderMembers(projectId, response);
      $('#membersDialogTitle').textContent = `People · ${data.projects.find((project) => project.id === projectId)?.name || 'Project'}`;
      $('#membersDialog').showModal();
    } catch (error) { toast(error.message); }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.close) return $(`#${target.dataset.close}`).close();
    if (target.dataset.openProject) {
      selectedProjectId = target.dataset.openProject;
      taskMilestoneFilter = 'all'; resetTaskRefinements(); render();
      if (canEditTasks(selectedProjectId)) ensureMembers(selectedProjectId).then(render).catch(() => {});
      return;
    }
    if (target.dataset.selectMilestone) {
      const milestone = data.milestones.find((item) => item.id === target.dataset.selectMilestone);
      if (!milestone) return;
      const alreadySelected = selectedProjectId === milestone.projectId && taskMilestoneFilter === milestone.id;
      selectedProjectId = milestone.projectId;
      taskMilestoneFilter = alreadySelected ? 'all' : milestone.id;
      resetTaskRefinements();
      render();
      if (canEditTasks(selectedProjectId)) ensureMembers(selectedProjectId).then(render).catch(() => {});
      if (window.innerWidth <= 760) $('#tasksSection')?.scrollIntoView({ block: 'start' });
      return;
    }
    if (target.dataset.clearMilestone) { taskMilestoneFilter = 'all'; resetTaskRefinements(); render(); return; }
    if (target.dataset.add) {
      if (target.dataset.add === 'task' && !canEditTasks(selectedProjectId)) return;
      if (target.dataset.add === 'milestone' && !isOwner(selectedProjectId)) return;
      if (target.dataset.add === 'task' && !projectMilestones(selectedProjectId).length) {
        toast(isOwner(selectedProjectId) ? 'Create a milestone before adding tasks' : 'Ask the project owner to create a milestone first');
        return isOwner(selectedProjectId) ? openDialog('milestone') : undefined;
      }
      return openDialog(target.dataset.add);
    }
    if (target.dataset.manageMembers) return openMembersDialog(target.dataset.manageMembers);
    if (target.dataset.editProject) return openDialog('project', data.projects.find((item) => item.id === target.dataset.editProject));
    if (target.dataset.editTask) return openDialog('task', data.tasks.find((item) => item.id === target.dataset.editTask));
    if (target.dataset.addSubtask) return openSubtaskDialog(data.tasks.find((item) => item.id === target.dataset.addSubtask));
    if (target.dataset.editSubtask) {
      const subtask = data.subtasks.find((item) => item.id === target.dataset.editSubtask);
      return openSubtaskDialog(data.tasks.find((item) => item.id === subtask?.taskId), subtask);
    }
    if (target.dataset.editMilestone) return openDialog('milestone', data.milestones.find((item) => item.id === target.dataset.editMilestone));
    if (target.dataset.deleteProject) {
      const project = data.projects.find((item) => item.id === target.dataset.deleteProject);
      if (project && isOwner(project.id) && confirm(`Delete “${project.name}” and all its tasks and milestones? This cannot be undone.`)) {
        try { await api.remove('project', project.id); selectedProjectId = null; await refreshWorkspace('Project deleted'); }
        catch (error) { toast(error.message); }
      }
    }
    if (target.dataset.removeMember) {
      const projectId = $('#membersDialog').dataset.projectId;
      if (!isOwner(projectId) || !confirm('Remove this person from the project? Their task assignments will be removed.')) return;
      try { await api.removeMember(projectId, target.dataset.removeMember); renderMembers(projectId, await api.members(projectId)); await refreshWorkspace('Member removed'); }
      catch (error) { toast(error.message); }
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'taskFilter') { taskFilter = event.target.value; render(); }
    if (event.target.id === 'taskOwnerFilter') { taskOwnerFilter = event.target.value; render(); }
    if (event.target.id === 'taskMilestoneFilter') { taskMilestoneFilter = event.target.value; resetTaskRefinements(); render(); }
    if (event.target.dataset.toggleTask) {
      const task = data.tasks.find((item) => item.id === event.target.dataset.toggleTask);
      if (task && canEditTasks(task.projectId)) {
        try { await runMutation(() => api.update('task', task.id, { status: event.target.checked ? 'Done' : 'Not started', version: task.version }), 'Task updated'); }
        catch { render(); }
      }
    }
    if (event.target.dataset.toggleSubtask) {
      const subtask = data.subtasks.find((item) => item.id === event.target.dataset.toggleSubtask);
      if (subtask && canEditTasks(subtask.projectId)) {
        try { await runMutation(() => api.update('subtask', subtask.id, {
          status: event.target.checked ? 'Done' : 'Not started', version: subtask.version,
        }), 'Subtask updated'); }
        catch { render(); }
      }
    }
    if (event.target.dataset.memberRole) {
      const projectId = $('#membersDialog').dataset.projectId;
      if (!isOwner(projectId)) return;
      try { await api.updateMember(projectId, event.target.dataset.memberRole, event.target.value); renderMembers(projectId, await api.members(projectId)); toast('Role updated'); }
      catch (error) {
        toast(error.message);
        try { renderMembers(projectId, await api.members(projectId)); } catch { $('#membersDialog').close(); }
      }
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
    $(`#${type}Form`).addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      if (type === 'task') values.assigneeUserIds = new FormData(event.target).getAll('assigneeUserIds');
      if (type === 'project' && values.end < values.start) { showFormError(event.target, 'Target finish must be after start date'); return; }
      if (type === 'task' && !data.milestones.some((milestone) => milestone.id === values.milestoneId && milestone.projectId === values.projectId)) {
        showFormError(event.target, 'Select a milestone from this project');
        return;
      }
      const button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      try { await upsert(type, values); $(`#${type}Dialog`).close(); }
      catch (error) { showFormError(event.target, error.message); }
      finally { button.disabled = false; }
    });
  });

  ['task', 'milestone'].forEach((type) => {
    $(`#delete${type[0].toUpperCase() + type.slice(1)}Button`).addEventListener('click', async () => {
      const form = $(`#${type}Form`);
      const collection = type === 'task' ? data.tasks : data.milestones;
      const item = collection.find((entry) => entry.id === form.elements.id.value);
      if (!item || !isOwner(item.projectId)) return;
      if (type === 'milestone' && item) {
        const taskCount = data.tasks.filter((task) => task.milestoneId === item.id).length;
        if (taskCount) { showFormError(form, `Reassign ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} before deleting this milestone`); return; }
      }
      if (!confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
      try { await runMutation(() => api.remove(type, item.id), `${type[0].toUpperCase() + type.slice(1)} deleted`); $(`#${type}Dialog`).close(); }
      catch (error) { showFormError(form, error.message); }
    });
  });

  $('#subtaskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const { id, taskId, name, due, ownerAssigneeId, status } = Object.fromEntries(new FormData(form));
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task || !canEditTasks(task.projectId)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (id) {
        const subtask = data.subtasks.find((item) => item.id === id && item.taskId === taskId);
        if (!subtask) throw new Error('Subtask changed elsewhere. Refresh and try again');
        await runMutation(() => api.update('subtask', id, {
          name, due, ownerAssigneeId, status, version: subtask.version,
        }), 'Subtask saved');
      } else {
        await runMutation(() => api.create('subtask', { taskId, name, due, ownerAssigneeId, status }), 'Subtask added');
      }
      $('#subtaskDialog').close();
    } catch (error) { showFormError(form, error.message); }
    finally { button.disabled = false; }
  });

  $('#deleteSubtaskButton').addEventListener('click', async () => {
    const form = $('#subtaskForm');
    const subtask = data.subtasks.find((item) => item.id === form.elements.id.value);
    if (!subtask || !isOwner(subtask.projectId)) return;
    if (!confirm(`Delete “${subtask.name}”? This cannot be undone.`)) return;
    try { await runMutation(() => api.remove('subtask', subtask.id), 'Subtask deleted'); $('#subtaskDialog').close(); }
    catch (error) { showFormError(form, error.message); }
  });

  $('#inviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const projectId = $('#membersDialog').dataset.projectId;
    if (!isOwner(projectId)) return;
    const values = Object.fromEntries(new FormData(event.target));
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api.invite(projectId, values);
      renderMembers(projectId, await api.members(projectId));
      event.target.reset();
      toast(`Invitation sent to ${values.email}`);
    } catch (error) { showFormError(event.target, error.message); }
    finally { button.disabled = false; }
  });

  $('#overviewNav').addEventListener('click', () => { selectedProjectId = null; render(); });
  $('.brand').addEventListener('click', (event) => { event.preventDefault(); selectedProjectId = null; render(); });
  $('#newProjectButton').addEventListener('click', () => openDialog('project'));
  $('#addProjectNav').addEventListener('click', () => openDialog('project'));
  $('#refreshButton').addEventListener('click', async () => {
    try { membersByProject.clear(); await refreshWorkspace('Workspace refreshed'); }
    catch (error) { toast(error.message); }
  });
  function downloadJson(contents, filename) {
    const blob = new Blob([contents], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  $('#exportButton').addEventListener('click', () => {
    downloadJson(JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), projects: data.projects, milestones: data.milestones, tasks: data.tasks, subtasks: data.subtasks }, null, 2), `fieldline-visible-${localDate()}.json`);
    toast('Visible data exported');
  });

  $('#signOutButton').addEventListener('click', async () => {
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message);
      currentUser = null;
      data = { projects: [], tasks: [], subtasks: [], milestones: [], memberships: [] };
      membersByProject.clear();
      selectedProjectId = null;
      await showAuthScreen(start);
    } catch (error) { toast(error.message); }
  });

  async function start() {
    const generation = ++connectionGeneration;
    if (navigator.onLine === false) { showOffline(); return; }
    try {
      const session = await api.session();
      if (generation !== connectionGeneration) return;
      if (!session?.user) { await showAuthScreen(start); return; }
      currentUser = session.user;
      const inviteToken = new URLSearchParams(location.search).get('invite');
      let inviteError;
      if (inviteToken) {
        try { await api.acceptInvitation(inviteToken); history.replaceState({}, '', location.pathname); }
        catch (error) { inviteError = error.message; }
      }
      if (generation !== connectionGeneration) return;
      await refreshWorkspace();
      if (generation !== connectionGeneration) return;
      $('#accountName').textContent = currentUser.username || currentUser.email;
      hideAuthScreen();
      if (inviteError) toast(inviteError);
    } catch (error) {
      if (generation !== connectionGeneration) return;
      if (navigator.onLine === false) { showOffline(); return; }
      clearWorkspaceState();
      if (error.status === 401) { await showAuthScreen(start); return; }
      $('#authScreen').hidden = false;
      $('#appShell').hidden = true;
      $('#authScreen').innerHTML = '<div class="auth-card"><h1>Workspace unavailable</h1><p class="auth-intro" id="loadError"></p><button class="button primary" id="retryLoad" type="button">Retry</button></div>';
      $('#loadError').textContent = error.message || 'Check your connection and try again.';
      $('#retryLoad').addEventListener('click', start);
    }
  }

  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', start);
  start();
})();
