const { createCjsPreset } = require('jest-preset-angular/presets');

const preset = createCjsPreset({
  tsconfig: '<rootDir>/tsconfig.spec.json',
});

module.exports = {
  ...preset,
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!@angular|@ngrx|@angular/cdk|primeng|@primeng|@primeuix|uuid)'
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
    '!src/environments/*',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};
