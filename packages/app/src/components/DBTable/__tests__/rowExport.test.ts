import { toExportableRow } from '@/components/DBTable/rowExport';

describe('toExportableRow', () => {
  it('drops the hidden severity number', () => {
    expect(
      toExportableRow({ SeverityText: 'info', __hyperdx_severity_number: 17 }),
    ).toEqual({ SeverityText: 'info' });
  });
});
