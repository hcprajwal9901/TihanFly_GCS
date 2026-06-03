module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/test_frontend/unit_test'],
  setupFilesAfterEnv: ['<rootDir>/test_frontend/unit_test/setup.js'],
  verbose: true,
  testMatch: ['**/*.test.js'],
  transform: {
    '^.+\\.js$': '<rootDir>/test_frontend/unit_test/coverage_transformer.js'
  },
  coverageProvider: 'v8',
  collectCoverage: true,
  coverageReporters: [],
  collectCoverageFrom: [
    'js/**/*.js',
    'plan-flight-modules/**/*.js',
    '!**/node_modules/**',
    '!**/leaflet/**'
  ],
  reporters: [
    'default',
    [
      'jest-html-reporter',
      {
        pageTitle: 'TiHANFly GCS Frontend Unit Test Report',
        outputPath: 'test_frontend/unit_test/test-report.html',
        includeFailureMsg: true,
        includeConsoleLog: true
      }
    ],
    [
      'jest-monocart-coverage',
      {
        name: 'TiHANFly GCS Native V8 Coverage Report',
        reports: [
          ['v8', {
            metrics: ['lines', 'functions']
          }],
          'lcovonly',
          'json-summary'
        ],
        outputDir: './test_frontend/unit_test/coverage'
      }
    ]
  ]
};
