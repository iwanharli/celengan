import * as FilePond from 'https://cdn.jsdelivr.net/npm/filepond@4.32.7/dist/filepond.esm.js';
import FilePondPluginImagePreview from 'https://cdn.jsdelivr.net/npm/filepond-plugin-image-preview@4.6.12/dist/filepond-plugin-image-preview.esm.js';
import FilePondPluginFileValidateType from 'https://cdn.jsdelivr.net/npm/filepond-plugin-file-validate-type@1.2.9/dist/filepond-plugin-file-validate-type.esm.js';
import FilePondPluginImageExifOrientation from 'https://cdn.jsdelivr.net/npm/filepond-plugin-image-exif-orientation@1.0.11/dist/filepond-plugin-image-exif-orientation.esm.js';

FilePond.registerPlugin(FilePondPluginImagePreview, FilePondPluginFileValidateType, FilePondPluginImageExifOrientation);

const MAX_PHOTOS = 10;

// Kotak unggah foto (FilePond) yang sedang tampil — dipakai tombol Kamera untuk menambah foto ke kotak ini.
let activePond = null;
export const addToDropzone = (files) => activePond?.addFiles(files);
export const removeFromDropzone = (id) => activePond?.removeFile(id);

// x-photo-dropzone: kotak garis putus-putus untuk foto struk/bukti (drag & drop atau klik).
// File yang dipilih disalin ke form.photos ({ key, file }); unggahnya dilakukan saat transaksi disimpan.
// Batas jumlah ikut berkurang sebanyak foto lama yang masih dipakai (form.attachments).
export function registerPhotoDropzone(Alpine) {
  Alpine.directive('photo-dropzone', (el, _directive, { effect, cleanup }) => {
    const data = Alpine.$data(el);
    const input = document.createElement('input');
    input.type = 'file';
    el.appendChild(input);

    const pond = FilePond.create(input, {
      allowMultiple: true,
      maxFiles: MAX_PHOTOS,
      acceptedFileTypes: ['image/*'],
      labelFileTypeNotAllowed: 'Hanya file gambar',
      fileValidateTypeLabelExpectedTypes: 'JPG, PNG, WEBP, HEIC',
      credits: false,
      storeAsFile: false,
      itemInsertLocation: 'after',
      imagePreviewHeight: 140,
      labelIdle: `
        <span class="pond-idle">
          <i class="ph-duotone ph-image-square"></i>
          <strong>Tarik foto ke sini</strong>
          <span>atau <span class="filepond--label-action">pilih file</span> · bisa banyak sekaligus</span>
        </span>`,
      labelMaxFilesExceeded: 'Terlalu banyak foto',
      labelMaxFilesMessage: `Maksimal ${MAX_PHOTOS} foto per transaksi`,
      labelButtonRemoveItem: 'Hapus',
      labelTapToUndo: '',
      labelTapToCancel: '',
    });

    pond.on('updatefiles', (items) => {
      data.form.photos = items.map((item) => ({ key: item.id, file: item.file }));
    });

    // Foto lama yang masih dipakai mengurangi sisa kuota.
    effect(() => {
      const kept = (data.form.attachments ?? []).filter((photo) => !photo.removed).length;
      pond.maxFiles = Math.max(0, MAX_PHOTOS - kept);
    });

    activePond = pond;
    cleanup(() => {
      if (activePond === pond) activePond = null;
      pond.destroy();
    });
  });
}
