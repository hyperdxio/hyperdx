import fs from 'fs';
import path from 'path';

import { WEBHOOK_TEMPLATE_VARIABLES } from '@/types';

// The form callout and the API's fallback body both derive from
// WEBHOOK_TEMPLATE_VARIABLES, so they cannot fall behind it. The docs table is
// hand-written and has no such guarantee, which is what this pins.
describe('docs/alert-webhook-template-variables.md', () => {
  const docPath = path.join(
    __dirname,
    '../../../../docs/alert-webhook-template-variables.md',
  );

  it('documents every published template variable', () => {
    const doc = fs.readFileSync(docPath, 'utf8');
    // Table rows only: the prose and examples also contain {{#if}}/{{else}},
    // and a row may pair two variables (`{{startTime}}` / `{{endTime}}`).
    const documented = new Set(
      doc
        .split('\n')
        .filter(line => line.startsWith('|'))
        .flatMap(line => [...line.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])),
    );

    expect([...WEBHOOK_TEMPLATE_VARIABLES].sort()).toEqual(
      [...documented].sort(),
    );
  });
});
