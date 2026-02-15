/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    verbose: true,
    preset: 'ts-jest',
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleFileExtensions: ['js', 'ts'],

    testMatch: ['**/tests/**/*.test.ts'],


};