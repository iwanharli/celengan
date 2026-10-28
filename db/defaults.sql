-- Kategori bawaan. Dimasukkan sekali saat tabel kategori masih kosong.
-- Kategori bisa diubah atau ditambah dari halaman Pengaturan.

INSERT INTO categories (name, kind, icon, color, monthly_budget) VALUES
  ('Makan & Minum', 'expense', 'fork-knife',      '#f97316', NULL),
  ('Transportasi',  'expense', 'car',             '#3b82f6', NULL),
  ('Tagihan',       'expense', 'receipt',         '#8b5cf6', NULL),
  ('Belanja',       'expense', 'shopping-bag',    '#ec4899', NULL),
  ('Rumah',         'expense', 'house',           '#14b8a6', NULL),
  ('Kesehatan',     'expense', 'heartbeat',       '#ef4444', NULL),
  ('Hiburan',       'expense', 'game-controller', '#eab308', NULL),
  ('Pendidikan',    'expense', 'graduation-cap',  '#06b6d4', NULL),
  ('Lainnya',       'expense', 'dots-three',      '#64748b', NULL),
  ('Gaji',          'income',  'briefcase',       '#16a34a', NULL),
  ('Bonus',         'income',  'gift',            '#22c55e', NULL),
  ('Investasi',     'income',  'trend-up',        '#10b981', NULL),
  ('Freelance',      'income', 'laptop',           '#0ea5e9', NULL),
  ('THR',            'income', 'moon-stars',       '#059669', NULL),
  ('Komisi',         'income', 'percent',          '#0d9488', NULL),
  ('Usaha / Jualan', 'income', 'storefront',       '#65a30d', NULL),
  ('Jual Barang',    'income', 'tag',              '#84cc16', NULL),
  ('Bunga & Dividen','income', 'coins',            '#ca8a04', NULL),
  ('Sewa',           'income', 'key',              '#0891b2', NULL),
  ('Hadiah',         'income', 'hand-heart',       '#db2777', NULL),
  ('Kiriman Keluarga','income','users-three',      '#7c3aed', NULL),
  ('Cashback & Refund','income','arrow-u-up-left', '#2563eb', NULL),
  ('Pemasukan Lain', 'income', 'dots-three',       '#64748b', NULL);
