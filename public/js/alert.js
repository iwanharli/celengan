import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11.14.5/+esm';

// Peringatan form (saldo tidak cukup, isian kurang, dll.) memakai SweetAlert2 bergaya Celengan.
const celengan = Swal.mixin({
  icon: 'warning',
  confirmButtonText: 'Oke, mengerti',
  buttonsStyling: false,
  customClass: {
    popup: 'swal-celengan',
    confirmButton: 'button primary',
  },
  showClass: { popup: 'swal2-show' },
});

export function showWarning(message, title = 'Ups, belum bisa disimpan') {
  return celengan.fire({ title, text: message });
}
