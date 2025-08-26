/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:react-hooks/recommended', 'prettier'],
  plugins: ['react-hooks', 'prettier'],
  rules: {
    'prettier/prettier': ['warn'],
    'max-lines': ['warn', 300],
    'max-lines-per-function': ['warn', 120],
    'complexity': ['warn', 10],
    'max-depth': ['warn', 4],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'react-hooks/exhaustive-deps': 'error'
  },
  ignorePatterns: ['node_modules/', 'android/', 'ios/', '.expo/', 'dist/', 'build/']
};
