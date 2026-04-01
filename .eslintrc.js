module.exports = {
  root: true,
  extends: '@react-native',
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    semi: ['error', 'never'],
    'react-native/no-inline-styles': 'off',
    'no-trailing-spaces': 'off',
  },
};
