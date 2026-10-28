import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../server/views.js';

const html = await renderApp();

test('halaman tersusun lengkap dari partial', () => {
  for (const page of ['home', 'transactions', 'budget', 'bills', 'debts', 'assets', 'wishlist', 'accounts', 'settings']) {
    assert.ok(html.includes(`x-show="page === '${page}'"`), page);
  }
  assert.ok(html.includes('class="auth-screen"'));
  assert.ok(html.includes('class="sidebar"'));
});

test('setiap modal yang dibuka di JS punya tampilannya', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../public/js/features/', import.meta.url);
  let js = '';
  for (const file of await readdir(dir)) js += await readFile(new URL(file, dir), 'utf8');
  const opened = new Set([...js.matchAll(/this\.open\('(\w+)'/g)].map((match) => match[1]));
  for (const modal of opened) assert.ok(html.includes(`modal === '${modal}'`), modal);
});

test('tidak ada sisa sintaks template', () => {
  assert.equal(html.includes('{{'), false);
  assert.equal(html.includes('}}'), false);
});

test('tidak memakai dialog bawaan browser (confirm/alert/prompt)', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../public/js/features/', import.meta.url);
  for (const file of await readdir(dir)) {
    const code = await readFile(new URL(file, dir), 'utf8');
    assert.doesNotMatch(code, /(?<![\w.])(confirm|alert|prompt)\(/, file);
  }
  assert.doesNotMatch(html, /(?<![\w.])(confirm|alert|prompt)\(/);
});
