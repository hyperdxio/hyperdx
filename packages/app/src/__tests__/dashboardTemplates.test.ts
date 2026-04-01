import fs from 'fs';
import path from 'path';
import { DashboardTemplateSchema } from '@hyperdx/common-utils/dist/types';

const TEMPLATES_DIR = path.resolve(__dirname, '../dashboardTemplates');

const jsonFiles = fs
  .readdirSync(TEMPLATES_DIR)
  .filter(f => f.endsWith('.json'));

describe('dashboard templates', () => {
  it('should have at least one template', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it.each(jsonFiles)('%s should be a valid DashboardTemplate', file => {
    const raw = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    const json = JSON.parse(raw);
    const result = DashboardTemplateSchema.safeParse(json);

    if (!result.success) {
      throw new Error(
        `${file} failed validation:\n${result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
      );
    }
  });

  it.each(jsonFiles)('%s should have a description', file => {
    const raw = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    const json = JSON.parse(raw);
    expect(json.description).toBeTruthy();
  });
});
