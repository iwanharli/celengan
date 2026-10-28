import Handlebars from 'handlebars';
import { readdir, readFile } from 'node:fs/promises';

// Halaman disusun dari file kecil di views/:
//   layout.hbs           kerangka halaman
//   partials/layout/     login, sidebar, topbar
//   partials/pages/      satu file per halaman (Beranda, Transaksi, ...)
//   partials/modals/     satu file per form/modal
//   partials/components/ potongan yang dipakai ulang (empty-state, amount-field, ...)
// Dipanggil dengan {{> pages/home}} atau {{> components/empty-state emoji="1f4dd" title="..."}}.
// Handlebars hanya dipakai di server untuk menyusun HTML; interaksi tetap memakai Alpine.js.

const VIEWS_DIR = new URL('../views/', import.meta.url);

async function registerPartials(hbs, dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await registerPartials(hbs, new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
    } else if (entry.name.endsWith('.hbs')) {
      hbs.registerPartial(`${prefix}${entry.name.slice(0, -4)}`, await readFile(new URL(entry.name, dir), 'utf8'));
    }
  }
}

export async function renderApp() {
  const hbs = Handlebars.create();
  await registerPartials(hbs, new URL('partials/', VIEWS_DIR));
  const layout = await readFile(new URL('layout.hbs', VIEWS_DIR), 'utf8');
  return hbs.compile(layout)({});
}

// Production: susun sekali lalu simpan. Development: susun ulang tiap request agar perubahan langsung terlihat.
let cached;
export async function appHtml() {
  if (process.env.NODE_ENV === 'production') return (cached ??= await renderApp());
  return renderApp();
}
