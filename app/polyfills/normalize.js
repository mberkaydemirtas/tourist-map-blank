// app/polyfills/normalize.js (yeni dosya)
(function () {
  if (typeof String.prototype.normalize !== 'function') {
    // Basit fallback: normalleştirme yoksa string'i olduğu gibi döndür.
    // Biz zaten TR karakterlerini regex ile ayrıca ele alıyoruz.
    // Bu sayede Hermes'te hata atmaz.
    // İstersen ileri seviye için 'unorm' gibi bir kütüphane kullanabilirsin.
    // (mobile bundle boyutu için bu basit fallback genelde yeterli)
    // eslint-disable-next-line no-extend-native
    String.prototype.normalize = function () {
      return String(this);
    };
  }
})();
