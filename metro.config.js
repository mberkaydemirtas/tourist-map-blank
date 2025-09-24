// metro.config.js
const { getDefaultConfig } = require('@expo/metro-config');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // Firebase vb. için .cjs desteği (opsiyonel ama zararsız)
  if (!config.resolver.sourceExts.includes('cjs')) {
    config.resolver.sourceExts.push('cjs');
  }

  // CSV'yi asset olarak paketle
  if (!config.resolver.assetExts.includes('csv')) {
    config.resolver.assetExts.push('csv');
  }

  // (Opsiyonel) Bazı paketlerle uyumluluk için
  // Gerek yoksa bırakmayabilirsin; kalması da sorun çıkarmaz.
  config.resolver.unstable_enablePackageExports = false;

  return config;
})();
