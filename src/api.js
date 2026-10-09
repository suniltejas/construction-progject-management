// All project data goes through the same-origin server. The browser never caches a writable copy.
const API_ROOT = `${import.meta.env.BASE_URL}api`;

async function request(path, { method = 'GET', body, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
};
