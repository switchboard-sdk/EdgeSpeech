const reactNativeConfig = require('@react-native/eslint-config/flat')
const prettierConfig = require('eslint-config-prettier')

module.exports = [
  ...reactNativeConfig,
  prettierConfig,
  {
    rules: {
      'react-native/no-inline-styles': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'example/node_modules/**'],
  },
]
