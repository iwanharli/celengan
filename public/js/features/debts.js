import { api } from '../api.js';
import { DEBT_TYPES } from '../constants.js';
import { parseAmount, formatDate, formatMonthYear, daysUntil, addMonths, todayISO, formatAmountInput } from '../format.js';

// Halaman Utang: utang, piutang, invoice klien, dan jadwal cicilan.
export default {
  debtTab: 'active', // 'active' | 'settled' (lunas)
  debtDirection: 'payable', // sub-menu: 'payable' (utang saya) | 'receivable' (piutang)

  goToDebtTab(direction) {
    this.debtDirection = direction;
    history.replaceState(null, '', direction === 'payable' ? '#debts' : '#debts/piutang');
  },

  debtsBy(direction) {
    return this.debts.filter((debt) => debt.direction === direction && (this.debtTab === 'settled' ? debt.remaining <= 0 : debt.remaining > 0));
  },

  // Sub-kelompok di halaman Utang (hanya yang ada isinya).
  debtSections(direction) {
    const sections = direction === 'payable'
      ? [
        { key: 'personal', label: 'Pribadi', icon: 'user', types: ['personal'] },
        { key: 'lender', label: 'Pinjol, paylater & kartu kredit', icon: 'bank', types: ['loan', 'paylater', 'credit_card'] },
      ]
      : [
        { key: 'personal', label: 'Pribadi', icon: 'user', types: ['personal', 'loan', 'paylater', 'credit_card'] },
        { key: 'invoice', label: 'Invoice klien', icon: 'receipt', types: ['invoice'] },
      ];
    const debts = this.debtsBy(direction);
    return sections
      .map((section) => ({ ...section, items: debts.filter((debt) => section.types.includes(debt.type)) }))
      .filter((section) => section.items.length);
  },

  get settledDebtCount() {
    return this.debts.filter((debt) => debt.remaining <= 0).length;
  },

  async openDebtHistory(debt) {
    this.open('debtHistory', { debt, history: null });
    this.form.history = await api.get(`/debts/${debt.id}/history`);
  },

  debtEventStyle(event, debt) {
    const borrowing = debt.direction === 'payable';
    switch (event.type) {
      case 'disbursed': return { icon: 'arrow-down-left', tone: 'info', label: borrowing ? 'Uang pinjaman diterima' : 'Uang dipinjamkan' };
      case 'created': return { icon: 'note-pencil', tone: 'neutral', label: debt.type === 'invoice' ? 'Invoice dicatat' : borrowing ? 'Utang dicatat' : 'Piutang dicatat' };
      case 'settled': return { icon: 'seal-check', tone: 'positive', label: 'Lunas 🎉' };
      default: return { icon: 'check', tone: 'positive', label: borrowing ? 'Dibayar' : 'Diterima' };
    }
  },

  debtPercent(debt) {
    return Math.min(100, Math.round((debt.paid / debt.total_amount) * 100));
  },

  debtCostPercent(debt) {
    return Math.round(((debt.total_amount - debt.principal) / debt.principal) * 100);
  },

  // Rasio cicilan terhadap pemasukan: di atas 30% dianggap berbahaya.
  get debtRatio() {
    if (!this.summary?.income) return null;
    return Math.round((this.summary.debts.monthly_installments / this.summary.income) * 100);
  },

  // Jenis utang yang bisa dipilih: invoice hanya untuk piutang.
  debtTypesFor(direction) {
    return Object.entries(DEBT_TYPES).filter(([type]) => type !== 'invoice' || direction === 'receivable');
  },

  // ---------- Jadwal cicilan ----------

  // Ringkasan jadwal: berapa yang lunas, cicilan berikutnya, dan bulan lunas.
  installmentInfo(debt) {
    const list = debt.installments ?? [];
    const unpaid = list.filter((item) => item.status !== 'paid');
    return {
      paidCount: list.length - unpaid.length,
      total: list.length,
      next: unpaid[0] ?? null,
      overdueCount: unpaid.filter((item) => item.status === 'overdue').length,
      finishMonth: list.length ? formatMonthYear(list[list.length - 1].due_date) : null,
    };
  },

  installmentStatusText(item) {
    if (item.status === 'paid') return `Lunas ${formatDate(item.paid_on)}`;
    const partial = item.outstanding < item.amount ? ` · kurang ${this.money(item.outstanding)}` : '';
    const days = daysUntil(item.due_date);
    if (item.status === 'overdue') return `Telat ${-days} hari${partial}`;
    return `Jatuh tempo ${formatDate(item.due_date)}${partial}`;
  },

  // Pilihan cepat di form bayar: 1 cicilan, 2 cicilan, ..., lunasi semua.
  payOptions(debt) {
    const unpaid = (debt.installments ?? []).filter((item) => item.status !== 'paid');
    const options = [];
    let sum = 0;
    unpaid.slice(0, 3).forEach((item, index) => {
      sum += item.outstanding;
      if (sum < debt.remaining) options.push({ label: `${index + 1} cicilan`, amount: sum });
    });
    options.push({ label: 'Lunasi semua', amount: debt.remaining });
    return options;
  },

  // Perhitungan di form utang (sama dengan logika di server):
  // total kosong -> cicilan × tenor; cicilan kosong -> total ÷ tenor.
  get debtTerms() {
    const principal = parseAmount(this.form.amountText);
    const tenor = Number(this.form.tenor) || 0;
    let installment = parseAmount(this.form.installmentText);
    let total = parseAmount(this.form.totalText);
    if (!total) total = installment && tenor ? installment * tenor : principal;
    if (!installment && tenor) installment = Math.ceil(total / tenor);
    const finish = tenor && this.form.first_due ? formatMonthYear(addMonths(this.form.first_due, tenor - 1)) : null;
    return { principal, tenor, installment, total, finish };
  },

  // ---------- Form ----------

  openDebt(direction) {
    this.open('debt', { direction, type: direction === 'payable' ? 'loan' : 'personal', recordCash: true, tenor: '', count_as_expense: false });
  },

  openInvoice() {
    this.open('debt', { direction: 'receivable', type: 'invoice', recordCash: false, tenor: '' });
  },

  saveDebt() {
    return this.submit(async () => {
      this.requireAmount();
      const terms = this.debtTerms;
      await api.post('/debts', {
        direction: this.form.direction,
        type: this.form.type,
        counterparty: this.form.counterparty,
        principal: terms.principal,
        total_amount: terms.total,
        installment: terms.installment || null,
        tenor: terms.tenor || null,
        due_date: this.form.due_date || null,
        first_due: this.form.first_due || null,
        account_id: this.form.recordCash ? Number(this.form.account_id) : null,
        count_as_expense: this.form.direction === 'payable' && this.form.type !== 'invoice' ? Boolean(this.form.count_as_expense) : false,
        note: this.form.note,
      });
    }, this.form.type === 'invoice' ? 'Invoice tercatat' : this.form.direction === 'payable' ? 'Utang tercatat' : 'Piutang tercatat');
  },

  openEditDebt(debt) {
    this.open('debtEdit', {
      debt,
      counterparty: debt.counterparty,
      type: debt.type,
      amountText: formatAmountInput(debt.principal),
      totalText: formatAmountInput(debt.total_amount),
      due_date: debt.due_date ?? '',
      note: debt.note ?? '',
      count_as_expense: debt.count_as_expense,
    });
  },

  saveDebtEdit() {
    return this.submit(async () => {
      const principal = this.requireAmount();
      await api.put(`/debts/${this.form.debt.id}`, {
        counterparty: this.form.counterparty,
        type: this.form.type,
        principal,
        total_amount: parseAmount(this.form.totalText) || principal,
        due_date: this.form.due_date || null,
        note: this.form.note,
        count_as_expense: Boolean(this.form.count_as_expense),
      });
    }, 'Catatan diperbarui');
  },

  deleteDebt(debt) {
    const count = debt.transaction_count;
    const label = debt.type === 'invoice' ? 'invoice' : debt.direction === 'payable' ? 'utang' : 'piutang';
    this.askConfirm({
      title: `Hapus ${label} ${debt.counterparty}?`,
      emoji: '1f91d',
      message: debt.remaining <= 0
        ? 'Sudah lunas — sebenarnya aman dibiarkan sebagai riwayat.'
        : `Catatan ${label} beserta jadwal cicilan & tagihannya dihapus.`,
      details: [
        { icon: 'coins', text: `Total ${this.money(debt.total_amount)} · sudah dibayar ${this.money(debt.paid)}` },
        { icon: 'list-bullets', text: `${count} transaksi terhubung (pencairan & pembayaran)` },
      ],
      warning: count
        ? `${count} transaksi terhubung ikut terhapus, jadi saldo akun berubah${debt.type === 'invoice' ? ' dan pemasukan dari invoice ini hilang dari laporan' : ''}.`
        : null,
      requireCheck: count > 0,
      successMessage: 'Catatan dihapus',
    }, () => api.delete(`/debts/${debt.id}`));
  },

  openSchedule(debt) {
    this.open('schedule', {
      debt,
      tenor: debt.tenor ?? 6,
      first_due: debt.installments?.[0]?.due_date ?? todayISO(),
      installmentText: '',
    });
  },

  saveSchedule() {
    return this.submit(async () => {
      await api.put(`/debts/${this.form.debt.id}/schedule`, {
        tenor: Number(this.form.tenor),
        first_due: this.form.first_due,
        installment: parseAmount(this.form.installmentText) || null,
      });
    }, 'Jadwal cicilan dibuat');
  },

  openPayDebt(debt) {
    const next = this.installmentInfo(debt).next;
    const suggestion = next ? next.outstanding : Math.min(debt.installment ?? debt.remaining, debt.remaining);
    this.open('payDebt', { debt, amountText: formatAmountInput(suggestion), withheldText: '' });
  },

  async payDebt() {
    if (this.form.debt.direction === 'payable' && !(await this.confirmEnoughBalance(this.form.account_id, this.parsedAmount))) return;
    const paysOff = this.parsedAmount >= this.form.debt.remaining;
    const withheld = this.form.debt.type === 'invoice' ? parseAmount(this.form.withheldText) || 0 : 0;
    const tax = this.form.debt.type === 'invoice' ? this.taxShare(this.parsedAmount, null, withheld) : 0;
    const paysOffWithTax = this.parsedAmount + withheld >= this.form.debt.remaining;
    const message = tax
      ? `Diterima! Sisihkan ${this.money(tax)} untuk pajak 🧾`
      : paysOff || paysOffWithTax ? 'Lunas! Hebat 🎉' : 'Pembayaran tercatat';
    return this.submit(async () => {
      await api.post(`/debts/${this.form.debt.id}/pay`, {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        date: this.form.date,
        tax_withheld: withheld,
      });
    }, message, paysOff || paysOffWithTax ? 'big' : 'small');
  },
};
