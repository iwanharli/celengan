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

// Konfirmasi sebelum menyimpan sesuatu yang berisiko (misal saldo jadi minus). Hasil: true = lanjut.
export async function confirmWarning(message, title = 'Yakin lanjut?', confirmText = 'Tetap simpan') {
  const result = await celengan.fire({
    title, text: message, showCancelButton: true, confirmButtonText: confirmText, cancelButtonText: 'Batal',
    reverseButtons: true, focusCancel: true,
    customClass: { popup: 'swal-celengan', confirmButton: 'button primary', cancelButton: 'button' },
  });
  return result.isConfirmed;
}
