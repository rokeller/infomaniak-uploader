export default {
    clearMocks: true,
    extensionsToTreatAsEsm: ['.ts'],
    moduleFileExtensions: ['js', 'ts'],
    moduleNameMapper: {
        "axios": "axios/dist/node/axios.cjs",
    },
    setupFiles: ['dotenv/config'],
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    verbose: true
}
