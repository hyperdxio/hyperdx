// This file has been automatically migrated to valid ESM format by Storybook.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/nextjs';

const require = createRequire(import.meta.url);
const storybookDir = dirname(fileURLToPath(import.meta.url));
const agentDocsDir = join(storybookDir, '../../../agent_docs');

function getAbsolutePath(value: string): any {
  return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-links'),
    getAbsolutePath('@storybook/addon-styling-webpack'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: {
    name: getAbsolutePath('@storybook/nextjs'),
    options: {},
  },
  staticDirs: ['./public'],
  webpackFinal: async config => {
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'next/router': require.resolve('next/router'),
        '@agent-docs': agentDocsDir,
      };
    }

    // Import agent_docs markdown as raw strings (`import doc from '….md?raw'`).
    // resourceQuery keeps this from fighting Next/MDX loaders for other .md files.
    config.module ??= {};
    config.module.rules ??= [];
    config.module.rules.unshift({
      test: /\.md$/,
      include: [agentDocsDir],
      resourceQuery: /raw/,
      type: 'asset/source',
    });

    return config;
  },
};

export default config;
