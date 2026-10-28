// Menggabungkan beberapa objek fitur menjadi satu komponen Alpine.
// Memakai property descriptor supaya getter (get xxx()) tetap getter, tidak dievaluasi saat digabung.
export function combine(...parts) {
  return parts.reduce(
    (target, part) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(part)),
    {},
  );
}
