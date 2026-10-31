// All project data goes through the same-origin server. The browser never caches a writable copy.
const API_ROOT = `${import.meta.env.BASE_URL}api`;

async function request(path, { method = 'GET', body, ...options } = {}) {
  const rawBody = body instanceof FormData || body instanceof Blob;
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || rawBody ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined || rawBody ? body : JSON.stringify(body),
      ...options,
    });
  } catch (error) {
    window.dispatchEvent(new Event('fieldline:connection-lost'));
    throw error;
  }
  if (response.status >= 500) window.dispatchEvent(new Event('fieldline:connection-lost'));
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null
      ? result.message || result.error || result.detail
      : result;
    const error = new Error(message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result;
}

const segment = (value) => encodeURIComponent(value);

function uploadForm(file) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const api = {
  session: () => request('/session'),
  workspace: () => request('/workspace'),
  create: (type, values) => request(`/${type}s`, { method: 'POST', body: values }),
  update: (type, id, values) => request(`/${type}s/${segment(id)}`, { method: 'PATCH', body: values }),
  remove: (type, id) => request(`/${type}s/${segment(id)}`, { method: 'DELETE' }),
  members: (projectId) => request(`/projects/${segment(projectId)}/members`),
  invite: (projectId, values) => request(`/projects/${segment(projectId)}/invitations`, { method: 'POST', body: values }),
  updateMember: (projectId, userId, role) => request(`/projects/${segment(projectId)}/members/${segment(userId)}`, { method: 'PATCH', body: { role } }),
  removeMember: (projectId, userId) => request(`/projects/${segment(projectId)}/members/${segment(userId)}`, { method: 'DELETE' }),
  invitation: (token) => request(`/invitations/${segment(token)}`),
  acceptInvitation: (token, password) => request('/invitations/accept', { method: 'POST', body: { token, password } }),
  addTaskNote: (taskId, body) => request(`/tasks/${segment(taskId)}/notes`, { method: 'POST', body: { body } }),
  addSubtaskNote: (subtaskId, body) => request(`/subtasks/${segment(subtaskId)}/notes`, { method: 'POST', body: { body } }),
  deleteNote: (noteId) => request(`/notes/${segment(noteId)}`, { method: 'DELETE' }),
  addTaskFile: (taskId, file) => request(`/tasks/${segment(taskId)}/files`, { method: 'POST', body: uploadForm(file) }),
  addMilestoneFile: (milestoneId, file) => request(`/milestones/${segment(milestoneId)}/files`, { method: 'POST', body: uploadForm(file) }),
  deleteFile: (fileId) => request(`/files/${segment(fileId)}`, { method: 'DELETE' }),
  fileUrl: (fileId, download = false) => `${API_ROOT}/files/${segment(fileId)}${download ? '?download=1' : ''}`,
};
