module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
      }],
      // ⬇️ Add this at the very end:
      'react-native-reanimated/plugin',
    ],
  };
};
