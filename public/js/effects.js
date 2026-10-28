import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/+esm';
import { rupiah } from './format.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Emoji 3D dari Microsoft Fluent Emoji (paket @lobehub/fluent-emoji-3d), nama file = kode Unicode.
export const emojiUrl = (code) => `https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-3d@1.1.0/assets/${code}.webp`;

const PASTEL = ['#a78bfa', '#f9a8d4', '#86efac', '#fcd34d', '#93c5fd', '#fdba74'];

// Konfeti kecil untuk momen menyenangkan (pemasukan, bayar tagihan).
export function celebrate() {
  confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 35,
    origin: { y: 0.7 },
    colors: PASTEL,
    scalar: 1.1,
    disableForReducedMotion: true,
  });
}

// Konfeti besar dari dua sisi, untuk utang lunas.
export function celebrateBig() {
  const end = Date.now() + 900;
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0 }, colors: PASTEL, disableForReducedMotion: true });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1 }, colors: PASTEL, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// x-countup="angka": nominal rupiah "menghitung" naik/turun ke nilai barunya.
// Ikut menghormati tombol sembunyikan nominal (hideAmounts).
export function registerCountUp(Alpine) {
  Alpine.directive('countup', (el, { expression }, { effect, evaluateLater, cleanup }) => {
    const getTarget = evaluateLater(expression);
    const getHidden = evaluateLater('hideAmounts');
    let shown = 0;
    let frame;

    effect(() => getTarget((target) => getHidden((hidden) => {
      cancelAnimationFrame(frame);
      if (hidden) {
        el.textContent = 'Rp ●●●●●';
        return;
      }
      if (reduceMotion()) {
        shown = target;
        el.textContent = rupiah(target);
        return;
      }
      const from = shown;
      const startTime = performance.now();
      const duration = 900;
      const step = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - (1 - progress) ** 3;
        shown = Math.round(from + (target - from) * eased);
        el.textContent = rupiah(shown);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    })));

    cleanup(() => cancelAnimationFrame(frame));
  });
}
