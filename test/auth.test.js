import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('semua data wajib login', async () => {
  for (const path of ['/summary', '/accounts', '/transactions', '/backup/auto', '/wishlist']) {
    const { status } = await app.call('GET', path, null, { loggedIn: false });
    assert.equal(status, 401, path);
  }
});

test('status login & akun pemilik', async () => {
  const { data } = await app.call('GET', '/auth/status');
  assert.deepEqual(data, { hasOwner: true, loggedIn: true, name: 'Tes' });
});

test('pemilik kedua tidak bisa dibuat', async () => {
  const { status } = await app.call('POST', '/auth/setup', { name: 'Penyusup', password: 'rahasia123' }, { loggedIn: false });
  assert.equal(status, 403);
});

test('password salah ditolak', async () => {
  const { status } = await app.call('POST', '/auth/login', { password: 'salah-banget' }, { loggedIn: false });
  assert.equal(status, 401);
});
