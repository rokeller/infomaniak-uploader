import { default as eslint } from '@eslint/js';
import jest from 'eslint-plugin-jest';
import github from 'eslint-plugin-github';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        plugins: {
            jest,
            github,
        }
    },
    {
        ignores: [
            '**/dist/',
            '**/lib/',
            'eslint.config.mjs',
            'jest.config.js',
        ],
    }
);
