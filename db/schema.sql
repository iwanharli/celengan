-- Semua nominal uang disimpan sebagai BIGINT (rupiah utuh), bukan float.

CREATE TABLE IF NOT EXISTS settings (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  month_start_day int NOT NULL DEFAULT 1 CHECK (month_start_day BETWEEN 1 AND 28)
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Jenis penghasilan: gaji tetap atau freelance (tanggal & jumlah tidak tentu).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS income_mode text NOT NULL DEFAULT 'fixed'
  CHECK (income_mode IN ('fixed', 'freelance'));

CREATE TABLE IF NOT EXISTS accounts (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('cash', 'bank', 'ewallet')),
  initial_balance bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('income', 'expense')),
  icon           text NOT NULL DEFAULT 'tag',
  color          text NOT NULL DEFAULT '#64748b',
  monthly_budget bigint CHECK (monthly_budget > 0)
);

-- Utang (payable) & piutang (receivable): pribadi, pinjol, paylater, kartu kredit.
CREATE TABLE IF NOT EXISTS debts (
  id           serial PRIMARY KEY,
  direction    text NOT NULL CHECK (direction IN ('payable', 'receivable')),
  type         text NOT NULL DEFAULT 'personal'
               CHECK (type IN ('personal', 'loan', 'paylater', 'credit_card')),
  counterparty text NOT NULL,
  principal    bigint NOT NULL CHECK (principal > 0),
  total_amount bigint NOT NULL,              -- pokok + bunga + biaya admin
  installment  bigint CHECK (installment > 0),
  due_date     date,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount >= principal)
);

-- Tagihan berulang. Cukup simpan jatuh tempo berikutnya; riwayat ada di transactions.bill_id.
CREATE TABLE IF NOT EXISTS bills (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  frequency   text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  next_due    date NOT NULL,
  category_id int REFERENCES categories ON DELETE SET NULL,
  account_id  int REFERENCES accounts ON DELETE SET NULL,
  debt_id     int REFERENCES debts ON DELETE CASCADE,   -- terisi jika ini cicilan utang
  active      boolean NOT NULL DEFAULT true
);

-- Aset & investasi. Nilai sekarang diperbarui manual; modal dihitung dari initial_cost + beli - jual.
CREATE TABLE IF NOT EXISTS assets (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  type          text NOT NULL
                CHECK (type IN ('gold', 'mutual_fund', 'stock', 'crypto', 'deposit', 'property', 'vehicle', 'other')),
  initial_cost  bigint NOT NULL DEFAULT 0,   -- modal yang sudah ada sebelum dicatat di aplikasi
  current_value bigint NOT NULL DEFAULT 0,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Riwayat kekayaan bersih, satu baris per bulan (diperbarui setiap halaman Aset dibuka).
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  month text PRIMARY KEY,   -- 'YYYY-MM'
  value bigint NOT NULL
);

-- kind:
--   income / expense  -> masuk laporan pemasukan & pengeluaran
--   transfer          -> pindah antar akun, bukan pengeluaran
--   adjustment        -> penyesuaian saldo (boleh negatif)
--   debt_in / debt_out-> uang masuk/keluar karena utang, bukan pemasukan/pengeluaran
--   asset_in / asset_out -> jual / beli aset (uang berpindah bentuk, bukan pengeluaran)
CREATE TABLE IF NOT EXISTS transactions (
  id            serial PRIMARY KEY,
  kind          text NOT NULL
                CHECK (kind IN ('income', 'expense', 'transfer', 'adjustment', 'debt_in', 'debt_out')),
  amount        bigint NOT NULL CHECK (amount <> 0),
  account_id    int NOT NULL REFERENCES accounts ON DELETE CASCADE,
  to_account_id int REFERENCES accounts ON DELETE CASCADE,
  category_id   int REFERENCES categories ON DELETE SET NULL,
  debt_id       int REFERENCES debts ON DELETE CASCADE,
  bill_id       int REFERENCES bills ON DELETE SET NULL,
  date          date NOT NULL DEFAULT current_date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'adjustment' OR amount > 0),
  CHECK ((kind = 'transfer') = (to_account_id IS NOT NULL)),
  CHECK (kind NOT IN ('debt_in', 'debt_out') OR debt_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (date);

-- Migrasi untuk database lama: tambah jenis transaksi aset.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_id int REFERENCES assets ON DELETE CASCADE;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN
  ('income', 'expense', 'transfer', 'adjustment', 'debt_in', 'debt_out', 'asset_in', 'asset_out'));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_asset_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_asset_check
  CHECK (kind NOT IN ('asset_in', 'asset_out') OR asset_id IS NOT NULL);

-- Detail akun: provider = nama bank / e-wallet / tempat simpan tunai;
-- account_number = no. rekening atau no. HP (hanya angka). Ditambahkan sebelum view di bawah dibuat.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS holder_name text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS note text;
-- Akun utama: dipakai sebagai pilihan bawaan di semua form. Maksimal satu.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_primary ON accounts (is_primary) WHERE is_primary;

-- View di-DROP dulu karena Postgres membekukan daftar kolom a.* saat view dibuat.
DROP VIEW IF EXISTS account_balances;
CREATE VIEW account_balances AS
SELECT a.*, a.initial_balance + COALESCE(SUM(m.delta), 0)::bigint AS balance
FROM accounts a
LEFT JOIN (
  SELECT account_id,
         CASE WHEN kind IN ('income', 'adjustment', 'debt_in', 'asset_in') THEN amount ELSE -amount END AS delta
  FROM transactions
  UNION ALL
  SELECT to_account_id, amount FROM transactions WHERE kind = 'transfer'
) m ON m.account_id = a.id
GROUP BY a.id;

-- Invoice klien: piutang ke klien atas proyek yang sudah dikerjakan.
-- Pembayarannya dicatat sebagai pemasukan (kind 'income' dengan debt_id).
ALTER TABLE debts DROP CONSTRAINT IF EXISTS debts_type_check;
ALTER TABLE debts ADD CONSTRAINT debts_type_check
  CHECK (type IN ('personal', 'loan', 'paylater', 'credit_card', 'invoice'));
ALTER TABLE debts DROP CONSTRAINT IF EXISTS debts_invoice_check;
ALTER TABLE debts ADD CONSTRAINT debts_invoice_check CHECK (type <> 'invoice' OR direction = 'receivable');

-- count_as_expense: pembayaran utang ini dicatat sebagai PENGELUARAN (kategori "Bayar utang"),
-- misal utang lama yang dicatat tanpa uang masuk. Kalau false: debt_out (bukan pengeluaran).
ALTER TABLE debts ADD COLUMN IF NOT EXISTS count_as_expense boolean NOT NULL DEFAULT false;

-- Tenor cicilan (3, 6, 12 bulan, ...). Ditambahkan sebelum view di bawah dibuat.
ALTER TABLE debts ADD COLUMN IF NOT EXISTS tenor int CHECK (tenor > 0);

-- PPh 21 yang dipotong klien dari sebuah pemasukan. amount = uang yang diterima (neto);
-- penghasilan bruto untuk pajak = amount + tax_withheld. Ditambahkan sebelum view di bawah dibuat.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_withheld bigint NOT NULL DEFAULT 0 CHECK (tax_withheld >= 0);

-- "paid" = pembayaran ke arah pelunasan (bukan pencairan awal).
-- Invoice yang dipotong PPh 21 klien: potongannya ikut melunasi invoice.
-- View di-DROP dulu karena Postgres membekukan daftar kolom d.* saat view dibuat.
DROP VIEW IF EXISTS debt_status;
CREATE VIEW debt_status AS
SELECT s.*, s.total_amount - s.paid AS remaining
FROM (
  SELECT d.*,
         COALESCE(SUM(t.amount + t.tax_withheld) FILTER (
           WHERE (d.direction = 'payable'    AND t.kind IN ('debt_out', 'expense'))
              OR (d.direction = 'receivable' AND t.kind IN ('debt_in', 'income'))
         ), 0)::bigint AS paid
  FROM debts d
  LEFT JOIN transactions t ON t.debt_id = d.id
  GROUP BY d.id
) s;

CREATE OR REPLACE VIEW asset_status AS
SELECT a.*,
       (a.initial_cost
         + COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'asset_out'), 0)
         - COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'asset_in'), 0))::bigint AS invested
FROM assets a
LEFT JOIN transactions t ON t.asset_id = a.id
GROUP BY a.id;

-- Login: aplikasi ini untuk satu pemilik. Password di-hash dengan scrypt.
CREATE TABLE IF NOT EXISTS owner (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name          text NOT NULL,
  password_hash text NOT NULL
);

-- Yang disimpan hanya hash token; token aslinya hanya ada di cookie browser.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

-- Jadwal cicilan (opsional) untuk utang/piutang bertenor: 3, 6, 12 bulan, dst.
-- Status lunas tiap cicilan TIDAK disimpan, tapi dihitung dari total pembayaran
-- (pembayaran dialokasikan ke cicilan paling awal), jadi selalu konsisten
-- walaupun ada pembayaran yang dihapus.

CREATE TABLE IF NOT EXISTS debt_installments (
  id       serial PRIMARY KEY,
  debt_id  int NOT NULL REFERENCES debts ON DELETE CASCADE,
  number   int NOT NULL,
  due_date date NOT NULL,
  amount   bigint NOT NULL CHECK (amount > 0),
  UNIQUE (debt_id, number)
);

-- Wishlist: barang yang ingin dibeli.
-- "saved" = uang yang sudah disisihkan untuk barang ini (amplop virtual, tidak memindahkan saldo akun).
-- Saat dibeli, dicatat sebagai transaksi pengeluaran dan transaction_id terisi.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  price          bigint NOT NULL CHECK (price > 0),
  saved          bigint NOT NULL DEFAULT 0 CHECK (saved >= 0),
  priority       text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  emoji          text NOT NULL DEFAULT '1f381',
  link           text,
  note           text,
  target_date    date,
  bought_at      date,
  transaction_id int REFERENCES transactions ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- Tagihan: tanggal jatuh tempo tetap (misal tiap tanggal 31) ----------
-- due_day menyimpan tanggal aslinya. Di bulan pendek dipakai hari terakhir bulan itu,
-- lalu kembali ke tanggal aslinya di bulan berikutnya (31 Jan → 28 Feb → 31 Mar).
ALTER TABLE bills ADD COLUMN IF NOT EXISTS due_day int CHECK (due_day BETWEEN 1 AND 31);
-- Potong otomatis sudah dihapus: tagihan hanya pengingat, dibayar manual.
ALTER TABLE bills DROP COLUMN IF EXISTS auto_pay;

-- Tagihan yang dihentikan (berhenti langganan): tidak aktif, tapi riwayatnya tetap bisa dilihat.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS ended_at date;

-- Biaya admin transfer: pengeluaran (kategori "Biaya admin") dari akun pengirim yang menempel
-- ke transfernya. Ikut terhapus saat transfernya dihapus.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_of int REFERENCES transactions ON DELETE CASCADE;

-- Penerima: buku rekening tujuan kiriman uang (orang tua, keluarga, teman, dll.).
-- Kiriman dicatat sebagai pengeluaran dengan recipient_id; biaya admin-nya ikut (fee_of).
CREATE TABLE IF NOT EXISTS recipients (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  relation       text NOT NULL DEFAULT 'other' CHECK (relation IN ('parent', 'family', 'partner', 'friend', 'other')),
  method         text NOT NULL DEFAULT 'bank' CHECK (method IN ('bank', 'ewallet', 'cash')),
  provider       text,
  account_number text,
  holder_name    text,
  category_id    int REFERENCES categories ON DELETE SET NULL,
  note           text,
  is_favorite    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_id int REFERENCES recipients ON DELETE SET NULL;

-- Periode tagihan yang dilewati (tombol "Lewati"). Pembayarannya sendiri ada di transactions.bill_id.
CREATE TABLE IF NOT EXISTS bill_skips (
  id         serial PRIMARY KEY,
  bill_id    int NOT NULL REFERENCES bills ON DELETE CASCADE,
  due_date   date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
UPDATE bills SET due_day = extract(day FROM next_due) WHERE due_day IS NULL;

CREATE OR REPLACE FUNCTION next_due_date(current_due date, frequency text, due_day int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE $2
    WHEN 'weekly' THEN $1 + 7
    ELSE (
      SELECT (month_start + (LEAST($3, extract(day FROM month_start + interval '1 month' - interval '1 day')::int) - 1)
              * interval '1 day')::date
      FROM (SELECT date_trunc('month', $1)
                   + CASE $2 WHEN 'monthly' THEN interval '1 month' ELSE interval '1 year' END AS month_start) AS target
    )
  END
$$;

-- Tagihan baru otomatis mengingat tanggal jatuh temponya.
CREATE OR REPLACE FUNCTION bills_set_due_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_day IS NULL THEN NEW.due_day := extract(day FROM NEW.next_due); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bills_due_day ON bills;
CREATE TRIGGER bills_due_day BEFORE INSERT ON bills FOR EACH ROW EXECUTE FUNCTION bills_set_due_day();

-- ---------- Wishlist: status & riwayat ----------
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'wanted'
  CHECK (status IN ('wanted', 'bought', 'cancelled'));
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS cancelled_at date;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS cancel_reason text;
UPDATE wishlist_items SET status = 'bought' WHERE bought_at IS NOT NULL AND status = 'wanted';

CREATE TABLE IF NOT EXISTS wishlist_events (
  id         serial PRIMARY KEY,
  item_id    int NOT NULL REFERENCES wishlist_items ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN
               ('created', 'edited', 'saved', 'withdrawn', 'bought', 'purchase_cancelled', 'cancelled', 'restored')),
  amount     bigint,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Pajak freelance ----------
-- tax_rate: persen dari pemasukan kena pajak yang disisihkan (0 = fitur mati).
-- tax_category_ids: kategori pemasukan yang dikenai pajak (default: kategori "Freelance").
-- Pembayaran pajak dicatat sebagai pengeluaran kategori "Pajak".
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_rate numeric(5, 2) NOT NULL DEFAULT 0
  CHECK (tax_rate >= 0 AND tax_rate <= 50);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_category_ids int[] NOT NULL DEFAULT '{}';

-- ---------- Klien pada pemasukan ----------
-- Proyek freelance bisa dicatat lewat invoice (dibayar belakangan) ATAU langsung sebagai pemasukan
-- saat sudah dibayar. Kolom client menyatukan keduanya untuk laporan per klien.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client text;
UPDATE transactions t SET client = d.counterparty
FROM debts d
WHERE d.id = t.debt_id AND d.type = 'invoice' AND t.kind = 'income' AND t.client IS NULL;

-- ---------- Kategori: arsip ----------
-- Kategori yang diarsipkan tidak muncul di form, tapi transaksi lamanya tetap memakainya.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- ---------- Anggaran dalam persen ----------
-- budget_percent terisi → anggaran = persen × rata-rata pemasukan (dihitung tiap kali dibuka).
-- monthly_budget terisi → anggaran nominal tetap. Hanya salah satu yang dipakai.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS budget_percent numeric(5, 2)
  CHECK (budget_percent > 0 AND budget_percent <= 100);

-- ---------- Wishlist & impian: jenis + rincian biaya ----------
-- kind: barang, pernikahan, lamaran, liburan, rumah, kendaraan, pendidikan, dana darurat, lainnya.
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'item'
  CHECK (kind IN ('item', 'wedding', 'proposal', 'travel', 'home', 'vehicle', 'education', 'emergency', 'other'));

-- Rincian biaya sebuah impian (opsional), misal Pernikahan → Gedung, Katering, ...
-- Yang sudah dibayar dihitung dari transaksi pengeluaran yang menunjuk ke rincian ini.
CREATE TABLE IF NOT EXISTS wishlist_parts (
  id       serial PRIMARY KEY,
  item_id  int NOT NULL REFERENCES wishlist_items ON DELETE CASCADE,
  name     text NOT NULL,
  amount   bigint NOT NULL CHECK (amount >= 0),
  note     text,
  position int NOT NULL DEFAULT 0
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wish_part_id int REFERENCES wishlist_parts ON DELETE SET NULL;

-- Riwayat: tambah jenis "part_paid" (bayar rincian) & "completed" (impian tercapai tanpa transaksi pembelian).
ALTER TABLE wishlist_events DROP CONSTRAINT IF EXISTS wishlist_events_type_check;
ALTER TABLE wishlist_events ADD CONSTRAINT wishlist_events_type_check CHECK (type IN
  ('created', 'edited', 'saved', 'withdrawn', 'bought', 'purchase_cancelled', 'cancelled', 'restored', 'part_paid', 'completed'));

-- ---------- Foto / bukti transaksi ----------
-- File disimpan di folder uploads/ (nama acak); tabel ini menyimpan datanya.
CREATE TABLE IF NOT EXISTS transaction_attachments (
  id             serial PRIMARY KEY,
  transaction_id int NOT NULL REFERENCES transactions ON DELETE CASCADE,
  stored_name    text NOT NULL UNIQUE,
  original_name  text,
  mime           text NOT NULL,
  size           int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_attachments_transaction_idx ON transaction_attachments (transaction_id);

-- ---------- Transaksi favorit (template sekali klik) ----------
CREATE TABLE IF NOT EXISTS transaction_templates (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  amount        bigint NOT NULL CHECK (amount > 0),
  account_id    int NOT NULL REFERENCES accounts ON DELETE CASCADE,
  to_account_id int REFERENCES accounts ON DELETE CASCADE,
  category_id   int REFERENCES categories ON DELETE SET NULL,
  note          text,
  position      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Riwayat perubahan transaksi ----------
-- Dicatat otomatis oleh trigger: berlaku untuk SEMUA cara transaksi berubah (form, bayar tagihan, dll.).
-- changes (untuk 'updated') = { kolom: [nilai lama, nilai baru] }; snapshot = isi transaksi setelah/ sebelum dihapus.
CREATE TABLE IF NOT EXISTS transaction_history (
  id             serial PRIMARY KEY,
  transaction_id int NOT NULL,            -- tanpa foreign key: riwayat tetap ada setelah transaksi dihapus
  action         text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changes        jsonb,
  snapshot       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_history_transaction_idx ON transaction_history (transaction_id, id);

CREATE OR REPLACE FUNCTION log_transaction_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  diff jsonb := '{}';
  key text;
BEGIN
  -- Saat memulihkan backup, riwayat tidak dicatat (diatur lewat SET LOCAL celengan.skip_history = 'on').
  IF current_setting('celengan.skip_history', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO transaction_history (transaction_id, action, snapshot) VALUES (NEW.id, 'created', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF key <> 'created_at' AND (to_jsonb(OLD) -> key) IS DISTINCT FROM (to_jsonb(NEW) -> key) THEN
        diff := diff || jsonb_build_object(key, jsonb_build_array(to_jsonb(OLD) -> key, to_jsonb(NEW) -> key));
      END IF;
    END LOOP;
    IF diff <> '{}' THEN
      INSERT INTO transaction_history (transaction_id, action, changes, snapshot) VALUES (NEW.id, 'updated', diff, to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO transaction_history (transaction_id, action, snapshot) VALUES (OLD.id, 'deleted', to_jsonb(OLD));
    RETURN OLD;
  END IF;
END $$;

DROP TRIGGER IF EXISTS transactions_history ON transactions;
CREATE TRIGGER transactions_history AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION log_transaction_change();

-- ---------- Akun tabungan impian (wishlist) ----------
-- Setiap impian punya akun sendiri (type 'goal'). "Sisihkan" = transfer ke akun itu, jadi uangnya
-- benar-benar berpindah. Saldo akun impian = uang yang sudah disisihkan.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
-- emoney = kartu uang elektronik (Mandiri e-money, BCA Flazz, BRI Brizzi, BNI TapCash, ...), nomor kartu 16 digit.
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check CHECK (type IN ('cash', 'bank', 'ewallet', 'emoney', 'goal'));
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS account_id int REFERENCES accounts ON DELETE SET NULL;

-- Migrasi: impian yang masih diinginkan & belum punya akun → dibuatkan akun. Uang yang dulu
-- "disisihkan" secara virtual dipindah dari akun utama (atau akun pertama) supaya total tetap sama.
DO $$
DECLARE
  item record;
  goal_id int;
  source_id int;
BEGIN
  FOR item IN SELECT * FROM wishlist_items WHERE account_id IS NULL AND status = 'wanted' LOOP
    INSERT INTO accounts (name, type, initial_balance) VALUES ('🎁 ' || item.name, 'goal', 0) RETURNING id INTO goal_id;
    UPDATE wishlist_items SET account_id = goal_id WHERE id = item.id;
    IF item.saved > 0 THEN
      SELECT id INTO source_id FROM accounts WHERE type <> 'goal' ORDER BY is_primary DESC, id LIMIT 1;
      IF source_id IS NOT NULL THEN
        INSERT INTO transactions (kind, amount, account_id, to_account_id, note)
        VALUES ('transfer', item.saved, source_id, goal_id, 'Sisihkan untuk ' || item.name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------- Migrasi: utang tanpa uang masuk → pembayarannya dihitung pengeluaran ----------
-- Dijalankan sekali (ditandai di settings). Pembayaran yang sudah ada dikonversi ke 'expense'.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS migrated_debt_expense boolean NOT NULL DEFAULT false;

-- Salinan backup ke folder kedua (misal iCloud Drive / Google Drive), supaya backup tidak hanya
-- ada di komputer yang sama dengan database. Status salinan terakhir ikut disimpan.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS backup_mirror_dir text;

-- Metode pajak freelancer (lihat public/js/tax-calc.js): flat (persentase tetap, cara lama),
-- final (PPh Final 0,5% dengan Rp500 juta bebas), nppn (norma × bruto − PTKP, tarif progresif).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_method text NOT NULL DEFAULT 'flat'
  CHECK (tax_method IN ('flat', 'final', 'nppn'));
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_norma numeric(5, 2) CHECK (tax_norma > 0 AND tax_norma <= 100);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_ptkp text NOT NULL DEFAULT 'TK/0';

-- Pengingat tagihan lewat notifikasi browser (Web Push). Kunci VAPID dibuat otomatis sekali.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vapid_public text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vapid_private text;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         serial PRIMARY KEY,
  endpoint   text NOT NULL UNIQUE,
  keys       jsonb NOT NULL,
  device     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Pengingat yang sudah dikirim, supaya satu tagihan tidak diingatkan dua kali untuk jatuh tempo yang sama.
CREATE TABLE IF NOT EXISTS bill_reminders (
  bill_id  int NOT NULL REFERENCES bills ON DELETE CASCADE,
  due_date date NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('tomorrow', 'today')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bill_id, due_date, kind)
);

-- Target dana darurat: berapa bulan kebutuhan yang ingin selalu tersedia (ideal 6–12).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emergency_months int NOT NULL DEFAULT 6 CHECK (emergency_months BETWEEN 1 AND 24);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS backup_mirror_at timestamptz;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS backup_mirror_error text;
DO $$
DECLARE
  debt_category int;
BEGIN
  IF (SELECT migrated_debt_expense FROM settings WHERE id = 1) THEN RETURN; END IF;
  UPDATE debts d SET count_as_expense = true
  WHERE d.direction = 'payable'
    AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.debt_id = d.id AND t.kind = 'debt_in');
  IF EXISTS (SELECT 1 FROM debts WHERE count_as_expense) THEN
    SELECT id INTO debt_category FROM categories WHERE kind = 'expense' AND name = 'Bayar utang' LIMIT 1;
    IF debt_category IS NULL THEN
      INSERT INTO categories (name, kind, icon, color) VALUES ('Bayar utang', 'expense', 'hand-coins', '#f97316')
      RETURNING id INTO debt_category;
    END IF;
    UPDATE transactions t SET kind = 'expense', category_id = debt_category
    FROM debts d WHERE d.id = t.debt_id AND d.count_as_expense AND t.kind = 'debt_out';
  END IF;
  UPDATE settings SET migrated_debt_expense = true WHERE id = 1;
END $$;
