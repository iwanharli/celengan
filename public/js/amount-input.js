import { formatAmountInput } from './format.js';

// x-rupiah: kolom nominal otomatis diberi titik ribuan saat diketik (1500000 → 1.500.000).
// Dipasang bersama x-model; listener "capture" berjalan lebih dulu sehingga x-model menerima teks yang sudah rapi.
// Posisi kursor dijaga dengan menghitung jumlah angka di sebelah kirinya.
export function registerAmountInput(Alpine) {
  Alpine.directive('rupiah', (el) => {
    el.addEventListener('input', () => {
      const before = el.value;
      const formatted = formatAmountInput(before);
      if (formatted === before) return;

      const caret = el.selectionStart ?? before.length;
      const digitsLeft = before.slice(0, caret).replace(/[^\d-]/g, '').length;
      el.value = formatted;

      let position = 0;
      for (let seen = 0; position < formatted.length && seen < digitsLeft; position += 1) {
        if (/[\d-]/.test(formatted[position])) seen += 1;
      }
      el.setSelectionRange(position, position);
    }, true);
  });
}
