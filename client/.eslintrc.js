module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    extends: ['plugin:react/recommended', 'airbnb', 'prettier'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaFeatures: {
            jsx: true,
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: ['react', '@typescript-eslint', 'react-hooks'],
    rules: {
        'react/jsx-filename-extension': [2, { extensions: ['.js', '.jsx', '.tsx'] }],
        'max-len': ['error', { ignoreComments: true, code: 100 }],
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/rules-of-hooks': 'error',
        'react/jsx-max-props-per-line': [`error`, { maximum: 3 }],
        'jsx-a11y/no-static-element-interactions': 'off',
        'jsx-a11y/label-has-associated-control': 'off',
        'jsx-a11y/click-events-have-key-events': 'off',
        'jsx-a11y/no-autofocus': 'off',
        'react/jsx-no-useless-fragment': 'off',
        'react/function-component-definition': 'off',
        'import/no-extraneous-dependencies': 'off',
        'import/prefer-default-export': 'off',
        'react/require-default-props': 'off',
        'react/no-array-index-key': 'off',
        'react/react-in-jsx-scope': 'off',
        'no-underscore-dangle': 'off',
        'import/no-unresolved': 'off',
        'no-param-reassign': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        'import/extensions': 'off',
        'no-shadow': 'off',
        'no-undef': 'off',
        'react/jsx-props-no-spreading': 'off',
        'no-return-await': 'warn',
        'no-unused-vars': 'warn',
    },
    globals: {
        IS_DEV: true,
        __API__: true,
    },
};
