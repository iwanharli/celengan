import { api } from '../api.js';
import { parseAmount, shortMonthLabel, formatAmountInput } from '../format.js';

const parsePercent = (text) => Number(String(text ?? '').replace(',', '.').replace('%', '')) || 0;

// Halaman Anggaran: batas pengeluaran bulanan per kategori — nominal tetap atau % dari pemasukan.
export default {
  budgetSuggestions: null,

  budgetPercent(category) {
    return Math.round((category.spent / category.monthly_budget) * 100);
  },

  budgetTone(category) {
    const percent = this.budgetPercent(category);
    if (percent >= 100) return 'danger';
    if (percent >= 80) return 'warning';
    return 'ok';
  },

  // "15% dari pemasukan ≈ Rp 1.200.000" atau "Rp 2.000.000"
  budgetLabel(category) {
    if (category.budget_percent) {
      const amount = category.monthly_budget ? ` ≈ ${this.money(category.monthly_budget)}` : '';
      return `${String(category.budget_percent).replace('.', ',')}% dari pemasukan${amount}`;
    }
    return this.money(category.monthly_budget);
  },

  // Total semua anggaran dibanding rata-rata pemasukan.
  get budgetTotals() {
    const income = this.summary?.budgetIncome ?? 0;
    const total = (this.summary?.categories ?? []).reduce((sum, category) => sum + (category.monthly_budget ?? 0), 0);
    return { total, income, percent: income > 0 ? Math.round((total / income) * 100) : null };
  },

  async openBudget(category) {
    this.budgetSuggestions = null;
    this.open('budget', {
      category,
      mode: category.budget_percent ? 'percent' : 'amount',
      amountText: category.fixed_budget ? formatAmountInput(category.fixed_budget) : '',
      percentText: category.budget_percent ? String(category.budget_percent).replace('.', ',') : '',
    });
    try {
      this.budgetSuggestions = await api.get(`/categories/${category.id}/budget-suggestions`);
    } catch {
      this.budgetSuggestions = { options: [], history: [], referenceIncome: 0 };
    }
  },

  // Nominal anggaran dari isian sekarang (untuk pratinjau & grafik).
  get budgetFormAmount() {
    if (this.form.mode === 'percent') {
      const income = this.budgetSuggestions?.referenceIncome ?? 0;
      return Math.round((income * parsePercent(this.form.percentText)) / 100);
    }
    return parseAmount(this.form.amountText);
  },

  // Tinggi batang grafik riwayat (0–100%), skala mengikuti nilai terbesar termasuk anggaran.
  budgetBarHeight(spent) {
    const history = this.budgetSuggestions?.history ?? [];
    const max = Math.max(this.budgetFormAmount, ...history.map((row) => row.spent), 1);
    return Math.round((spent / max) * 100);
  },

  budgetMonthLabel(month) {
    return shortMonthLabel(month);
  },

  applyBudgetSuggestion(option) {
    this.form.mode = 'amount';
    this.form.amountText = formatAmountInput(option.amount);
  },

  applyBudgetGuideline(percent) {
    this.form.mode = 'percent';
    this.form.percentText = String(percent);
  },

  saveBudget() {
    return this.submit(async () => {
      const body = this.form.mode === 'percent'
        ? { budget_percent: parsePercent(this.form.percentText) || null }
        : { monthly_budget: parseAmount(this.form.amountText) || null };
      if (this.form.mode === 'percent' && body.budget_percent > 100) throw new Error('Persentase maksimal 100%');
      await api.put(`/categories/${this.form.category.id}/budget`, body);
    }, 'Anggaran diperbarui');
  },
};
