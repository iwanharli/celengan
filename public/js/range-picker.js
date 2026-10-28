import flatpickr from 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/+esm';
import { Indonesian } from 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/esm/l10n/id.js/+esm';

// x-range-picker: kalender rentang tanggal (flatpickr) yang langsung tampil di dalam modal.
// Tanggal terpilih disalin ke form.start & form.end ('YYYY-MM-DD').
const toISO = (date) => date.toLocaleDateString('sv-SE');

export function registerRangePicker(Alpine) {
  Alpine.directive('range-picker', (el, _directive, { cleanup }) => {
    const data = Alpine.$data(el);
    const picker = flatpickr(el, {
      inline: true,
      appendTo: el, // taruh kalender DI DALAM kotak (bawaannya di sebelahnya)
      mode: 'range',
      locale: { ...Indonesian, rangeSeparator: ' – ' },
      showMonths: window.innerWidth > 760 ? 2 : 1,
      defaultDate: [data.form.start, data.form.end].filter(Boolean),
      dateFormat: 'Y-m-d',
      onChange(dates) {
        data.form.start = dates[0] ? toISO(dates[0]) : '';
        data.form.end = dates[1] ? toISO(dates[1]) : '';
      },
    });
    // Saat dibuka dengan rentang yang sudah ada, tampilkan bulan tanggal awalnya.
    if (data.form.start) picker.jumpToDate(data.form.start);
    cleanup(() => picker.destroy());
  });
}
