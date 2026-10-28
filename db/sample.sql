-- Data CONTOH untuk mencoba aplikasi (npm run db:sample).
-- Hanya dipakai pada database kosong: id kategori 1–12 mengikuti urutan di defaults.sql.
-- Hapus kapan saja lewat Pengaturan → "Mulai dari nol".

UPDATE categories SET monthly_budget = 2000000 WHERE id = 1;
UPDATE categories SET monthly_budget = 600000  WHERE id = 2;
UPDATE categories SET monthly_budget = 1000000 WHERE id = 4;
UPDATE categories SET monthly_budget = 400000  WHERE id = 7;

INSERT INTO accounts (name, type, initial_balance) VALUES
  ('Dompet', 'cash', 500000),
  ('BCA', 'bank', 5000000),
  ('GoPay', 'ewallet', 150000);

INSERT INTO transactions (kind, amount, account_id, category_id, date, note) VALUES
  ('income',  8000000, 2, 10, current_date - 20, 'Gaji bulan ini'),
  ('expense',   25000, 1, 1,  current_date - 6,  'Bakso'),
  ('expense',   18000, 3, 1,  current_date - 5,  'Kopi'),
  ('expense',   45000, 3, 2,  current_date - 5,  'Ojek online'),
  ('expense',  350000, 2, 4,  current_date - 3,  'Sepatu'),
  ('expense',   85000, 1, 1,  current_date - 2,  'Makan malam'),
  ('expense',  150000, 2, 7,  current_date - 1,  'Nonton bioskop'),
  ('expense',   60000, 1, 2,  current_date,      'Bensin');

INSERT INTO transactions (kind, amount, account_id, to_account_id, date, note) VALUES
  ('transfer', 200000, 2, 3, current_date - 4, 'Top up GoPay');

INSERT INTO bills (name, amount, frequency, next_due, category_id, account_id) VALUES
  ('Netflix',          54000, 'monthly', current_date + 2,  3, 2),
  ('Internet rumah',  350000, 'monthly', current_date + 9,  3, 2),
  ('Listrik',         400000, 'monthly', current_date - 1,  3, 2);

INSERT INTO debts (direction, type, counterparty, principal, total_amount, installment, tenor, note) VALUES
  ('payable',    'paylater', 'SPayLater', 1500000, 1800000, 300000, 6,    'Cicilan HP'),
  ('receivable', 'personal', 'Budi',       500000,  500000, NULL,   NULL, 'Pinjam buat bensin');

-- 6 cicilan bulanan; cicilan ke-2 jatuh tempo 5 hari lagi (sama dengan tagihannya).
INSERT INTO debt_installments (debt_id, number, due_date, amount)
SELECT 1, n, (current_date + 5 + (n - 2) * interval '1 month')::date, 300000
FROM generate_series(1, 6) AS n;

INSERT INTO transactions (kind, amount, account_id, debt_id, date, note) VALUES
  ('debt_out', 300000, 2, 1, current_date - 15, 'Cicilan ke-1'),
  ('debt_out', 500000, 2, 2, current_date - 10, 'Dipinjam Budi');

INSERT INTO bills (name, amount, frequency, next_due, account_id, debt_id) VALUES
  ('Cicilan SPayLater', 300000, 'monthly', current_date + 5, 2, 1);

INSERT INTO assets (name, type, initial_cost, current_value, note) VALUES
  ('Emas Antam 10 gram', 'gold',        10500000, 13200000, 'Disimpan di rumah'),
  ('Reksa Dana Pasar Uang', 'mutual_fund',  0,     2050000, NULL),
  ('Motor Beat', 'vehicle',             18000000, 12000000, NULL);

INSERT INTO transactions (kind, amount, account_id, asset_id, date, note) VALUES
  ('asset_out', 2000000, 2, 2, current_date - 12, 'Beli Reksa Dana Pasar Uang');
