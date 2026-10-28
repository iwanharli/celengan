import { api } from '../api.js';
import { celebrate } from '../effects.js';

// Login satu pemilik: buat password pertama kali, masuk, keluar, ganti password.
export default {
  auth: { ready: false, hasOwner: false, loggedIn: false, name: '' },
  authForm: { name: '', password: '', confirm: '' },
  authError: '',
  passwordForm: { current_password: '', new_password: '', confirm: '' },

  async checkAuth() {
    const status = await api.get('/auth/status');
    this.auth = { ready: true, ...status };
    if (status.loggedIn) await this.loadApp();
  },

  async submitAuth() {
    this.authError = '';
    try {
      if (this.auth.hasOwner) {
        await api.post('/auth/login', { password: this.authForm.password });
      } else {
        if (this.authForm.password !== this.authForm.confirm) throw new Error('Konfirmasi password tidak sama');
        await api.post('/auth/setup', { name: this.authForm.name, password: this.authForm.password });
      }
      this.authForm = { name: '', password: '', confirm: '' };
      await this.checkAuth();
      celebrate();
    } catch (error) {
      this.authError = error.message;
    }
  },

  logout() {
    this.askConfirm({
      title: 'Keluar dari aplikasi?',
      emoji: '1f44b',
      tone: 'info',
      message: 'Kamu perlu memasukkan password lagi untuk membuka catatan keuangan.',
      confirmLabel: 'Keluar',
      successMessage: 'Sampai jumpa! 👋',
    }, async () => {
      await api.post('/auth/logout');
      this.auth.loggedIn = false;
      this.summary = null;
    });
  },

  async changePassword() {
    try {
      if (this.passwordForm.new_password !== this.passwordForm.confirm) {
        throw new Error('Konfirmasi password baru tidak sama');
      }
      await api.put('/auth/password', this.passwordForm);
      this.passwordForm = { current_password: '', new_password: '', confirm: '' };
      this.showToast('Password diganti. Perangkat lain otomatis keluar.');
    } catch (error) {
      this.showToast(error.message);
    }
  },
};
