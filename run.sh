#!/usr/bin/env bash
# Menjalankan Catat Keuangan dengan satu perintah.
#
#   ./run.sh          mode pengembangan (server restart otomatis saat file berubah)
#   ./run.sh prod     mode production
#
set -euo pipefail
cd "$(dirname "$0")"

info()  { printf '\033[1;34m▸\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$1"; }
fail()  { printf '\033[1;31m✖ %s\033[0m\n' "$1"; exit 1; }

# 1. Node.js
command -v node >/dev/null || fail "Node.js belum terpasang (butuh versi 20.6 ke atas)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $(node -v) terlalu lama, butuh versi 20.6 ke atas."
ok "Node.js $(node -v)"

# 2. File .env
if [ ! -f .env ]; then
  info "Membuat .env dengan pengaturan default..."
  printf 'DATABASE_URL=postgres://%s@localhost:5432/catat_keuangan\nPORT=3000\n' "$(whoami)" > .env
  ok ".env dibuat — ubah DATABASE_URL jika PostgreSQL kamu memakai user/password lain"
fi
set -a; source .env; set +a

# 3. Dependensi
if [ ! -d node_modules ]; then
  info "Memasang dependensi..."
  npm install --silent
fi
ok "Dependensi siap"

# 4. PostgreSQL harus sudah berjalan
node -e "
  const url = new URL(process.env.DATABASE_URL); url.pathname = '/postgres';
  const c = new (require('pg').Client)({ connectionString: url.toString() });
  c.connect().then(() => c.end()).catch(() => process.exit(1));
" || fail "Tidak bisa terhubung ke PostgreSQL. Pastikan PostgreSQL berjalan dan DATABASE_URL di .env benar."
ok "PostgreSQL terhubung"

# 5. Database & migrasi (aman dijalankan berulang kali)
npm run --silent db:setup | sed 's/^/  /'
ok "Database siap"

# 6. Jalankan server
echo
if [ "${1:-}" = "prod" ]; then
  info "Mode production → http://localhost:${PORT:-3000}"
  NODE_ENV=production exec npm start --silent
else
  info "Mode pengembangan → http://localhost:${PORT:-3000}  (Ctrl+C untuk berhenti)"
  exec npm run dev --silent
fi
