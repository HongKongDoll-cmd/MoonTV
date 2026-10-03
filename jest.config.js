// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],

  testEnvironment: 'jest-environment-jsdom',

  /**
   * Absolute imports and Module Path Aliases
   */
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/public/$1',
    '^.+\\.(svg)$': '<rootDir>/src/__mocks__/svg.tsx',
  },

  /**
   * 备份目录一律不扫。
   *
   * 搬迁/重装 node_modules 时会留下 `node_modules.old` / `node_modules.partial`
   * 这类备份，它们里面是**依赖包自己的测试文件**（比如 zod 自带上千个 .test.ts）。
   * 不排除的话 jest 会把它们全当成本项目的测试跑 —— 表现为「测试数量翻倍、
   * 大量 cannot find module 报错」，其实是假象（.next 同理，缓存目录）。
   */
  testPathIgnorePatterns: [
    // 备份目录：node_modules.old / node_modules.partial 都在项目根下，
    // 用 `node_modules` 开头匹配才能盖住（`/node_modules/` 只匹配路径分隔后的那一层）
    'node_modules',
    // 生成补丁的临时基线副本（是 main 的完整源码树，含全部测试文件）
    '\\.patch-tmp',
    '\\.ignored_zod/',
    '\\.next/',
    'playwright-report',
    'test-results',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
