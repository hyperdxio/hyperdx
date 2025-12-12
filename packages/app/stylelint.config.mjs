/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard-scss', 'stylelint-prettier/recommended'],
  rules: {
    'selector-class-pattern': null,
    'no-descending-specificity': null,
    'property-no-deprecated': null,
    'declaration-property-value-keyword-no-deprecated': [
      true,
      {
        severity: 'warning',
      },
    ],
    'scss/at-extend-no-missing-placeholder': [
      true,
      {
        severity: 'warning',
      },
    ],
    'scss/dollar-variable-pattern': null,
  },
};
