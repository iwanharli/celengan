import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/module.esm.js';
import { combine } from './combine.js';
import { registerCountUp } from './effects.js';
import { registerAmountInput } from './amount-input.js';
import { registerPhotoDropzone } from './photo-dropzone.js';
import { registerRangePicker } from './range-picker.js';
import core from './features/core.js';
import auth from './features/auth.js';
import home from './features/home.js';
import transactions from './features/transactions.js';
import budget from './features/budget.js';
import bills from './features/bills.js';
import debts from './features/debts.js';
import assets from './features/assets.js';
import accounts from './features/accounts.js';
import wishlist from './features/wishlist.js';
import settings from './features/settings.js';
import reports from './features/reports.js';
import categories from './features/categories.js';
import period from './features/period.js';
import exporter from './features/export.js';
import recipients from './features/recipients.js';
import notifications from './features/notifications.js';
import importer from './features/import.js';

// Satu komponen Alpine untuk seluruh aplikasi, disusun dari modul per fitur di features/.
// Tampilannya ada di views/ (layout, pages, modals, components).
Alpine.data('app', () => combine(
  core, auth, home, transactions, budget, bills, debts, assets, accounts, categories, wishlist, reports, period, exporter, settings, recipients, notifications, importer,
));

registerCountUp(Alpine);
registerAmountInput(Alpine);
registerPhotoDropzone(Alpine);
registerRangePicker(Alpine);
Alpine.start();
