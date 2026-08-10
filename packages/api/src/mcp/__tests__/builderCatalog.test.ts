import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  BUILDER_TOOLS,
  builderToolBulletList,
  preferOverSqlNudge,
  SQL_FALLBACK_CRITERIA,
} from '@/mcp/tools/query/builderCatalog';

describe('builderCatalog', () => {
  it('lists every builder tool as a bullet, one per line', () => {
    const list = builderToolBulletList();
    const lines = list.split('\n');
    expect(lines).toHaveLength(BUILDER_TOOLS.length);
    for (const tool of BUILDER_TOOLS) {
      expect(list).toContain(`${tool.name} — ${tool.blurb}`);
    }
  });

  it('never lists clickstack_sql among the builder tools', () => {
    expect(BUILDER_TOOLS.some(t => t.name === 'clickstack_sql')).toBe(false);
    expect(builderToolBulletList()).not.toContain('clickstack_sql —');
  });

  it('honors bullet/indent options', () => {
    const list = builderToolBulletList({ indent: '', bullet: '-' });
    expect(list.split('\n')[0]).toBe(
      `- ${BUILDER_TOOLS[0].name} — ${BUILDER_TOOLS[0].blurb}`,
    );
  });

  it('produces a consistent reciprocal nudge for every tool that has a preferHint', () => {
    for (const tool of BUILDER_TOOLS) {
      if (!tool.preferHint) continue;
      const nudge = preferOverSqlNudge(tool.name);
      expect(nudge).toContain('PREFER THIS over clickstack_sql');
      expect(nudge).toContain(tool.preferHint);
      // The SQL fallback criteria must be shared verbatim (no drift).
      expect(nudge).toContain(SQL_FALLBACK_CRITERIA);
    }
  });

  it('throws for an unknown tool or one without a preferHint', () => {
    expect(() => preferOverSqlNudge('clickstack_does_not_exist')).toThrow();
    const hintless = BUILDER_TOOLS.find(t => !t.preferHint);
    if (hintless) {
      expect(() => preferOverSqlNudge(hintless.name)).toThrow();
    }
  });

  // Drift guard: the catalog must stay in sync with the tools actually
  // registered under tools/query and tools/trace. If a new builder query
  // tool is added (or one is renamed) without updating the catalog, this
  // fails — which is the whole point of centralizing the list.
  it('matches the set of registered non-SQL query/trace tools', () => {
    const dirs = [
      join(__dirname, '..', 'tools', 'query'),
      join(__dirname, '..', 'tools', 'trace'),
    ];
    const registered = new Set<string>();
    const files = dirs.flatMap(dir =>
      // Paths are derived from __dirname (not user input); safe to read.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      readdirSync(dir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(f => join(dir, f)),
    );
    for (const file of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(
        /registerTool\(\s*'(clickstack_[a-z_]+)'/g,
      )) {
        registered.add(m[1]);
      }
    }
    // clickstack_sql is intentionally excluded from the builder catalog.
    registered.delete('clickstack_sql');

    const catalog = new Set(BUILDER_TOOLS.map(t => t.name));
    expect([...catalog].sort()).toEqual([...registered].sort());
  });
});
