import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Only analyze the main extension source code (not lib/ workspace)
  entry: ['src/extension.ts'],
  project: ['src/**/*.ts'],
};

export default config;
