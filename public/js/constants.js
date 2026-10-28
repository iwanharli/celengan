// Konstanta yang dipakai di banyak halaman (label, ikon, pilihan).

export const PAGES = [
  { id: 'home', label: 'Beranda', emoji: '1f3e0' },
  { id: 'transactions', label: 'Transaksi', emoji: '1f4dd' },
  { id: 'budget', label: 'Anggaran', emoji: '1f967' },
  { id: 'bills', label: 'Tagihan', emoji: '1f4c5' },
  { id: 'categories', label: 'Kategori', emoji: '1f3f7-fe0f' },
  { id: 'recipients', label: 'Penerima', emoji: '1f4ec' },
  { id: 'debts', label: 'Utang', emoji: '1f91d' },
  { id: 'assets', label: 'Aset', emoji: '1f48e' },
  { id: 'wishlist', label: 'Wishlist', emoji: '1f381' },
  { id: 'reports', label: 'Laporan', emoji: '1f4ca' },
  { id: 'export', label: 'Export', emoji: '1f4e4' },
  { id: 'accounts', label: 'Akun', emoji: '1f45b' },
  { id: 'settings', label: 'Pengaturan', emoji: '2699-fe0f' },
];

export const ACCOUNT_TYPES = {
  cash: { label: 'Tunai', icon: 'money' },
  bank: { label: 'Bank', icon: 'bank' },
  ewallet: { label: 'E-Wallet', icon: 'device-mobile' },
  goal: { label: 'Tabungan impian', icon: 'gift' }, // dibuat otomatis untuk tiap wishlist
};

export const DEBT_TYPES = {
  personal: 'Pribadi',
  invoice: 'Invoice klien',
  loan: 'Pinjaman Online / Bank',
  paylater: 'Paylater',
  credit_card: 'Kartu Kredit',
};

export const ASSET_TYPES = {
  gold: { label: 'Emas', icon: 'coins', color: '#ca8a04' },
  mutual_fund: { label: 'Reksa Dana', icon: 'chart-pie', color: '#2563eb' },
  stock: { label: 'Saham', icon: 'chart-line-up', color: '#16a34a' },
  crypto: { label: 'Kripto', icon: 'currency-btc', color: '#f97316' },
  deposit: { label: 'Deposito', icon: 'vault', color: '#0891b2' },
  property: { label: 'Properti', icon: 'buildings', color: '#7c3aed' },
  vehicle: { label: 'Kendaraan', icon: 'motorcycle', color: '#64748b' },
  other: { label: 'Lainnya', icon: 'package', color: '#94a3b8' },
};

// Pilihan ikon (Phosphor) & warna untuk kategori buatan sendiri.
export const ICON_CHOICES = [
  'fork-knife', 'coffee', 'hamburger', 'car', 'bus', 'gas-pump', 'receipt', 'lightning', 'drop',
  'wifi-high', 'phone', 'shopping-bag', 'shopping-cart', 't-shirt', 'house', 'wrench', 'heartbeat',
  'pill', 'game-controller', 'film-strip', 'music-notes', 'graduation-cap', 'book-open', 'baby',
  'paw-print', 'gift', 'airplane', 'hand-heart', 'briefcase', 'money', 'trend-up', 'storefront',
  'barbell', 'scissors', 'dots-three', 'tag',
  'laptop', 'moon-stars', 'percent', 'key', 'coins', 'users-three', 'arrow-u-up-left', 'medal', 'hand-coins', 'bank',
];
export const COLOR_CHOICES = [
  '#ef4444', '#f97316', '#eab308', '#16a34a', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#a16207', '#64748b',
];

// Wishlist: pilihan emoji barang & tingkat prioritas.
export const WISH_EMOJIS = [
  '1f381', '1f4f1', '1f4bb', '1f3a7', '1f4f7', '231a', '1f3ae', '1f45f', '1f392', '1f457',
  '1f48d', '1f4da', '1f3b8', '1f9f8', '1f6cb-fe0f', '1f3e0', '1f6f5', '1f697', '2708-fe0f', '1f3d6-fe0f',
  '1f492', '1f393', '1f6df', '1f476', '1f54b', '2728',
];
export const PRIORITIES = {
  high: { label: 'Penting', icon: 'fire', tone: 'danger' },
  medium: { label: 'Biasa', icon: 'heart', tone: 'info' },
  low: { label: 'Nanti saja', icon: 'hourglass', tone: 'neutral' },
};
// Aturan 30 hari: tahan dulu keinginan baru supaya tidak beli karena impulsif.
export const COOLDOWN_DAYS = 30;

export const TENOR_CHOICES = [3, 6, 9, 12, 18, 24];

export const INSTALLMENT_STATUS = {
  paid: { icon: 'check-circle', tone: 'positive' },
  overdue: { icon: 'warning-circle', tone: 'negative' },
  upcoming: { icon: 'circle', tone: 'muted' },
};

export const FREQUENCIES = { weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' };

// Tampilan tiap jenis transaksi: tanda (+/-), warna, dan ikon cadangan.
export const TRANSACTION_STYLE = {
  income: { sign: '+', tone: 'positive', icon: 'arrow-down-left' },
  expense: { sign: '−', tone: 'negative', icon: 'arrow-up-right' },
  transfer: { sign: '', tone: 'neutral', icon: 'arrows-left-right' },
  adjustment: { sign: '', tone: 'neutral', icon: 'scales' },
  debt_in: { sign: '+', tone: 'positive', icon: 'hand-coins' },
  debt_out: { sign: '−', tone: 'negative', icon: 'hand-coins' },
  asset_in: { sign: '+', tone: 'positive', icon: 'chart-line-up' },
  asset_out: { sign: '−', tone: 'neutral', icon: 'chart-line-up' },
};

export const EDITABLE_KINDS = ['income', 'expense', 'transfer'];

// Wishlist: tab per status & label riwayat.
export const WISH_TABS = [
  { id: 'wanted', label: 'Diinginkan', icon: 'sparkle' },
  { id: 'bought', label: 'Terbeli / tercapai', icon: 'check-circle' },
  { id: 'cancelled', label: 'Dibatalkan', icon: 'x-circle' },
];

export const WISH_EVENTS = {
  created: { label: 'Masuk wishlist', icon: 'sparkle', tone: 'info' },
  edited: { label: 'Diubah', icon: 'pencil-simple', tone: 'muted' },
  saved: { label: 'Disisihkan', icon: 'piggy-bank', tone: 'positive' },
  withdrawn: { label: 'Diambil kembali', icon: 'arrow-u-up-left', tone: 'muted' },
  bought: { label: 'Dibeli', icon: 'shopping-bag', tone: 'positive' },
  part_paid: { label: 'Bayar rincian', icon: 'receipt', tone: 'positive' },
  completed: { label: 'Tercapai', icon: 'trophy', tone: 'positive' },
  purchase_cancelled: { label: 'Pembelian dibatalkan', icon: 'arrow-counter-clockwise', tone: 'negative' },
  cancelled: { label: 'Tidak jadi beli', icon: 'x-circle', tone: 'negative' },
  restored: { label: 'Diinginkan lagi', icon: 'arrow-counter-clockwise', tone: 'info' },
};

// Pilihan cepat persentase pajak freelance (bisa juga diketik sendiri).
export const TAX_RATE_CHOICES = [0.5, 2.5, 5, 10];

// Peringatan anggaran di Beranda.
export const BUDGET_ALERT_STYLE = {
  over: { label: 'Lewat anggaran', tone: 'danger', emoji: '1f6a8' },
  almost: { label: 'Hampir habis', tone: 'warning', emoji: '26a0-fe0f' },
  fast: { label: 'Terlalu cepat', tone: 'info', emoji: '1f3c3' },
};

// Pengelompokan menu samping. Kelompok tanpa label tidak diberi judul.
// "bottom: true" = ditempel di bagian bawah menu.
export const NAV_GROUPS = [
  { label: null, pages: ['home'] },
  { label: 'Harian', pages: ['transactions', 'budget', 'bills', 'recipients', 'categories'] },
  { label: 'Kekayaan', pages: ['accounts', 'assets', 'debts'] },
  { label: 'Rencana', pages: ['wishlist', 'reports', 'export'] },
  { label: null, pages: ['settings'], bottom: true },
];

// Status tabungan wishlist terhadap target tanggal.
export const WISH_TARGET_STYLE = {
  ahead: { label: 'Lebih cepat', tone: 'ok', icon: 'rocket-launch' },
  on_track: { label: 'Sesuai jalur', tone: 'info', icon: 'check-circle' },
  behind: { label: 'Tertinggal', tone: 'warning', icon: 'clock-countdown' },
  late: { label: 'Lewat target', tone: 'danger', icon: 'warning-circle' },
};

// Pilihan penyedia akun (tetap bisa diketik bebas).
export const ACCOUNT_PROVIDERS = {
  bank: [
    'BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata', 'Danamon', 'BTN', 'OCBC',
    'Bank Jago', 'SeaBank', 'blu by BCA Digital', 'Jenius', 'Allo Bank', 'Bank Neo Commerce', 'Bank DKI', 'Bank Jatim',
  ],
  ewallet: ['GoPay', 'OVO', 'DANA', 'ShopeePay', 'LinkAja', 'i.saku', 'Sakuku', 'Flip'],
  cash: ['Dompet', 'Celengan', 'Brankas', 'Amplop', 'Laci'],
};

// Label kolom per jenis akun.
export const ACCOUNT_FIELDS = {
  bank: { provider: 'Nama bank', number: 'Nomor rekening', numberHint: '5–20 angka, spasi/tanda hubung boleh' },
  ewallet: { provider: 'Penyedia e-wallet', number: 'Nomor HP terdaftar', numberHint: 'contoh: 0812 3456 7890' },
  cash: { provider: 'Tempat simpan' },
};

// Jenis impian di wishlist + contoh rincian biaya (bisa diubah bebas).
export const WISH_KINDS = {
  item: { label: 'Barang', emoji: '1f381', done: 'Terbeli', template: [] },
  wedding: {
    label: 'Pernikahan', emoji: '1f492', done: 'Tercapai',
    template: ['Gedung', 'Katering', 'Dekorasi', 'Busana & rias', 'Dokumentasi', 'Undangan & souvenir', 'Mahar & seserahan', 'Lain-lain'],
  },
  proposal: { label: 'Lamaran', emoji: '1f48d', done: 'Tercapai', template: ['Seserahan', 'Cincin', 'Konsumsi', 'Busana', 'Transport & oleh-oleh'] },
  travel: { label: 'Liburan', emoji: '2708-fe0f', done: 'Tercapai', template: ['Tiket', 'Penginapan', 'Makan', 'Transport lokal', 'Aktivitas & tiket masuk', 'Oleh-oleh'] },
  home: { label: 'Rumah', emoji: '1f3e0', done: 'Tercapai', template: ['DP', 'Notaris & pajak', 'Renovasi', 'Perabot', 'Pindahan'] },
  vehicle: { label: 'Kendaraan', emoji: '1f697', done: 'Tercapai', template: ['DP', 'Asuransi', 'Pajak & surat', 'Aksesoris'] },
  education: { label: 'Pendidikan', emoji: '1f393', done: 'Tercapai', template: ['Uang pangkal', 'SPP / UKT', 'Buku & perlengkapan', 'Biaya hidup'] },
  emergency: { label: 'Dana darurat', emoji: '1f6df', done: 'Tercapai', template: [] },
  other: { label: 'Lainnya', emoji: '2728', done: 'Tercapai', template: [] },
};

// Modal yang isinya panjang ditampilkan lebih lebar (dan dua kolom bila ada .modal-columns),
// supaya tidak perlu banyak scroll.
export const WIDE_MODALS = [
  'transaction', 'account', 'bill', 'debt', 'debtEdit', 'budget', 'category', 'categoryDelete',
  'asset', 'wish', 'wishBuy', 'wishPartPay', 'schedule', 'photos', 'period',
];

// Sub-menu halaman Pengaturan.
export const SETTINGS_SECTIONS = [
  { id: 'income', label: 'Penghasilan', hint: 'Gaji tetap / freelance', icon: 'briefcase' },
  { id: 'tax', label: 'Pajak', hint: 'Sisihkan untuk pajak', icon: 'receipt', freelanceOnly: true },
  { id: 'data', label: 'Data', hint: 'Backup otomatis', icon: 'database' },
  { id: 'security', label: 'Keamanan', hint: 'Password & keluar', icon: 'lock-key' },
  { id: 'danger', label: 'Zona berbahaya', hint: 'Mulai dari nol', icon: 'warning-octagon' },
];

// Data yang bisa diekspor (urutan = urutan sheet di Excel).
export const EXPORT_DATASETS = [
  { key: 'transactions', label: 'Transaksi', icon: 'list-bullets', hint: 'Bisa difilter periode, jenis, akun & kategori' },
  { key: 'accounts', label: 'Akun & saldo', icon: 'wallet', hint: 'Termasuk no. rekening & saldo sekarang' },
  { key: 'bills', label: 'Tagihan rutin', icon: 'calendar-check', hint: 'Nominal, frekuensi & jatuh tempo' },
  { key: 'debts', label: 'Utang & piutang', icon: 'handshake', hint: 'Pokok, total, dibayar & sisa' },
  { key: 'installments', label: 'Jadwal cicilan', icon: 'calendar-dots', hint: 'Cicilan per bulan tiap utang' },
  { key: 'assets', label: 'Aset', icon: 'chart-line-up', hint: 'Modal, nilai sekarang & untung/rugi' },
  { key: 'wishlist', label: 'Wishlist & impian', icon: 'gift', hint: 'Target, terkumpul & status' },
  { key: 'wishlist_parts', label: 'Rincian wishlist', icon: 'receipt', hint: 'Pos biaya tiap impian' },
  { key: 'budgets', label: 'Anggaran', icon: 'chart-pie-slice', hint: 'Batas per kategori' },
  { key: 'categories', label: 'Kategori', icon: 'tag', hint: 'Daftar kategori & pemakaiannya' },
];

// Pilihan cepat biaya admin transfer (0 = gratis). Rp6.500 = transfer antarbank online non BI-FAST.
export const TRANSFER_FEES = [0, 1000, 2500, 6500];

// Penerima kiriman uang: hubungan & cara kirim.
export const RECIPIENT_RELATIONS = {
  parent: { label: 'Orang tua', icon: 'heart', color: '#f43f5e' },
  family: { label: 'Keluarga', icon: 'users-three', color: '#f97316' },
  partner: { label: 'Pasangan', icon: 'heart-half', color: '#ec4899' },
  friend: { label: 'Teman', icon: 'handshake', color: '#3b82f6' },
  other: { label: 'Lainnya', icon: 'user', color: '#64748b' },
};
export const RECIPIENT_METHODS = {
  bank: { label: 'Rekening bank', icon: 'bank', number: 'No. rekening' },
  ewallet: { label: 'E-Wallet', icon: 'device-mobile', number: 'No. HP' },
  cash: { label: 'Tunai', icon: 'hand-coins', number: '' },
};
