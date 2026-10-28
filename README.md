# Celengan

*Aplikasi pencatat keuangan pribadi (sebelumnya "Catat Keuangan").*

Aplikasi web pencatat keuangan pribadi: transaksi, anggaran, tagihan berulang, utang/pinjol dengan jadwal cicilan,
invoice klien (freelance), aset & kekayaan bersih, wishlist, backup lengkap.

**Stack:** PostgreSQL · Node.js + Express · Handlebars (menyusun HTML di server) · Alpine.js · Chart.js ·
Phosphor Icons · Fluent Emoji 3D. Tanpa build step.

## Menjalankan

PostgreSQL harus sudah berjalan.

```bash
./run.sh          # mode pengembangan (otomatis: .env, npm install, migrasi database)
./run.sh prod     # mode production
```

Atau manual:

```bash
cp .env.example .env      # sesuaikan DATABASE_URL
npm install
npm run db:setup          # buat/migrasi database + kategori bawaan (aman diulang, data tidak diubah)
npm run dev               # http://localhost:3000
```

| Perintah | Fungsi |
|---|---|
| `npm run db:sample` | Isi **data contoh** untuk mencoba (hanya ke database kosong) |
| `npm test` | Jalankan semua test otomatis |
| `npm run reset-password -- "passwordBaru"` | Lupa password |
| `npm run restore -- <file>` | Pulihkan data dari file backup |

Data contoh bisa dihapus kapan saja: **Pengaturan → Mulai dari nol** (ketik `HAPUS`).

## Struktur

```
db/
  schema.sql           tabel, view, fungsi (aman dijalankan ulang = migrasi)
  defaults.sql         kategori bawaan
  sample.sql           data contoh (opsional)
  migrate.js           dipakai oleh setup.js & test
server/
  app.js               Express app (routes, error handler) — tanpa listen
  index.js             menjalankan server + backup otomatis harian
  views.js             menyusun halaman dari views/ dengan Handlebars
  backup.js            export / restore / mulai dari nol / backup otomatis
  savings.js           perkiraan tabungan per bulan
  routes/              satu file per resource API
views/
  layout.hbs           kerangka halaman
  partials/layout/     login, menu samping, header
  partials/pages/      satu file per halaman (home, transactions, ...)
  partials/modals/     satu file per form
  partials/components/ empty-state, amount-field, account-select, form-actions
public/
  js/app.js            menggabungkan semua fitur jadi satu komponen Alpine
  js/features/         logika per halaman (core, transactions, debts, wishlist, ...)
  js/constants.js      label, ikon, pilihan
  js/format.js         format Rupiah, "25rb"/"1,5jt", tanggal
  css/style.css
test/                  test otomatis (node:test) memakai database terpisah
backups/               backup otomatis harian (tidak masuk git)
uploads/               foto struk/bukti transaksi (tidak masuk git)
```

### Menambah halaman atau form baru
1. Tampilan: buat `views/partials/pages/nama.hbs` (atau `modals/nama.hbs`), lalu daftarkan di `views/layout.hbs`.
2. Logika: buat `public/js/features/nama.js` dan tambahkan ke `combine(...)` di `public/js/app.js`.
3. Pakai komponen yang ada, misalnya:
   `{{> components/empty-state emoji="1f4dd" title="Belum ada data" text="..." action="openX()" actionLabel="Tambah"}}`

## Aturan pencatatan

| Jenis | Contoh | Masuk laporan pemasukan/pengeluaran? |
|---|---|---|
| `income` / `expense` | gaji, makan, bayar invoice klien | Ya |
| `transfer` | top up GoPay dari BCA | Tidak |
| `adjustment` | koreksi saldo | Tidak |
| `debt_in` / `debt_out` | pinjol cair, bayar cicilan | Tidak — mengubah sisa utang |
| `asset_in` / `asset_out` | jual / beli emas, reksa dana | Tidak — uang berpindah ke aset |

- Uang disimpan sebagai `BIGINT` rupiah, bukan float.
- Status lunas tiap cicilan **dihitung** dari total pembayaran (dialokasikan ke cicilan paling awal), tidak disimpan.
- Tagihan mengingat tanggal aslinya: 31 Jan → 28 Feb → 31 Mar (`next_due_date()` di schema).
- Wishlist punya status `wanted` / `bought` / `cancelled`; setiap perubahan tercatat di `wishlist_events`.

## Backup

Backup berjalan **otomatis** di server — tidak ada tombol backup/pulihkan di aplikasi:
- harian ke folder `backups/` (14 hari terakhir), selama server berjalan;
- sebelum aksi besar: gabung/pindah kategori, mulai dari nol, memulihkan backup.

Status backup terakhir terlihat di **Pengaturan → Data**. Isinya semua data keuangan + pengaturan, **tanpa** password/sesi login.

**Pulihkan (keadaan darurat / pindah laptop):**

```bash
npm run restore -- backups/auto-2026-10-28.json
```

Semua data diganti isi file (dalam satu transaksi database), dan data sebelumnya otomatis dicadangkan dulu.

**Supaya aman walau laptop rusak:** arahkan folder backup ke folder yang tersinkron cloud, di `.env`:

```
BACKUP_DIR=/Users/kamu/Library/Mobile Documents/com~apple~CloudDocs/Celengan-backup
```

(atau folder Google Drive / Dropbox). Foto struk/bukti ada di `uploads/` — ikut sinkronkan bila perlu (`UPLOAD_DIR`).

## Test

```bash
npm test
```

Test menjalankan aplikasi asli terhadap database terpisah `catat_keuangan_test`
(ubah lewat `TEST_DATABASE_URL`). Database utama tidak disentuh.

## Login & keamanan

Aplikasi ini untuk **satu pemilik**. Saat pertama dibuka, kamu diminta membuat password.

- Password di-hash dengan `scrypt`; sesi di cookie `HttpOnly; SameSite=Lax` berlaku 30 hari (database hanya menyimpan hash token).
- 5 kali salah password → login dikunci 15 menit.
- Saat di-online-kan: jalankan dengan `NODE_ENV=production` di belakang HTTPS.
