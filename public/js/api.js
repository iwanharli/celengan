// Pembungkus fetch sederhana: otomatis JSON dan melempar pesan error dari server.
async function handle(response, path) {
  // Sesi habis atau belum login: beri tahu aplikasi supaya menampilkan layar login.
  if (response.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('auth:required'));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `Permintaan gagal (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

async function request(method, path, body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle(response, path);
}

// Unggah satu file mentah (foto transaksi).
async function upload(path, file) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'foto') },
    body: file,
  });
  return handle(response, path);
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
  upload,
};
