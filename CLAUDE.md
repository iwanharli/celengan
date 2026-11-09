# celengan

Celengan: aplikasi pencatat keuangan pribadi.

## Cara kerja

- Pakai skill `ponytail` (kode) dan `caveman` (gaya jawaban) dari `.claude/skills/`.
  Sumber: `DietrichGebert/ponytail@96608e0`, `JuliusBrussee/caveman@2e068f7`.
- Ikuti struktur, konvensi, dan bahasa penamaan yang sudah ada di repo ini.
- Jalankan formatter/linter dan test sebelum menyatakan selesai. Test: `npm test`.

## Git

- JANGAN tambahkan baris `Co-Authored-By`, `Claude-Session`, atau
  "Generated with Claude Code" di pesan commit maupun deskripsi PR.
- Format commit: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Jangan commit `.env`, rahasia, data pribadi, atau file build.
- Jangan push atau force-push tanpa diminta.

## Dokumentasi

- Vault: `~/Harlixuan/PROJECT/_DOCS/celengan/` (Obsidian).
- Setelah perubahan perilaku: perbarui Changelog di `celengan.md` dan
  berkas di `teknis/` yang terdampak (Setup, Database, API, Deployment, Testing).
- Jangan tulis nilai rahasia; cukup nama variabel.
