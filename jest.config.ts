import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s', '!src/main.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@l0/(.*)$': '<rootDir>/src/l0/$1',
    '^@platform/(.*)$': '<rootDir>/src/platform/$1',
    '^@iam/(.*)$': '<rootDir>/src/iam/$1',
    '^@projects/(.*)$': '<rootDir>/src/projects/$1',
    '^@ingestion/(.*)$': '<rootDir>/src/ingestion/$1',
    '^@retrieval/(.*)$': '<rootDir>/src/retrieval/$1',
    '^@evidence/(.*)$': '<rootDir>/src/evidence/$1',
    '^@orchestration/(.*)$': '<rootDir>/src/orchestration/$1',
    '^@ai/(.*)$': '<rootDir>/src/ai/$1',
  },
};

export default config;
