// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
      }],
      ['module-resolver', {
        root: ['./'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
          '@tripServices': './trips/src/services',
        },
      }],
      // Reanimated plugin MUST be last
      'react-native-reanimated/plugin',
    ],
  };
};
