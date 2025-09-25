// metro.config.js
const { getDefaultConfig } = require('@expo/metro-config');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  if (!config.resolver.sourceExts.includes('cjs')) {
    config.resolver.sourceExts.push('cjs');
  }
  // ⬇️ EKLE
  if (!config.resolver.assetExts.includes('db')) {
    config.resolver.assetExts.push('db');
  }
  // csv kalabilir ama artık şart değil
  if (!config.resolver.assetExts.includes('csv')) {
    config.resolver.assetExts.push('csv');
  }

  config.resolver.unstable_enablePackageExports = false;
  return config;
})();
