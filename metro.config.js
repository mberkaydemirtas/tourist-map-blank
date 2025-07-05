const { getDefaultConfig } = require('@expo/metro-config');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // ✅ Allow .cjs modules (used by Firebase)
  config.resolver.sourceExts.push('cjs');

  // ✅ Important: disable package exports enforcement for compatibility
  config.resolver.unstable_enablePackageExports = false;

  return config;
})();
