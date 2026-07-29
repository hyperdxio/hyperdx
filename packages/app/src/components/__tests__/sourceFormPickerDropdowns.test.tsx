import { useForm } from 'react-hook-form';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useDatabasesDirect, useTablesDirect } from '@/clickhouse';
import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { DatabaseSelectControlled } from '@/components/DatabaseSelect';
import { DBTableSelectControlled } from '@/components/DBTableSelect';
import { useConnections } from '@/connection';

jest.mock('@/clickhouse', () => ({
  useDatabasesDirect: jest.fn(),
  useTablesDirect: jest.fn(),
}));
jest.mock('@/connection', () => ({
  useConnections: jest.fn(),
}));
// DBTableSelect renders these next to the table picker; not relevant to this test.
jest.mock('../SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => null,
  isSourceSchemaPreviewEnabled: () => false,
}));
jest.mock('../SourceSelect', () => ({
  SourceManagementMenu: () => null,
}));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// The hooks return large `UseQueryResult`/connection types; the components only
// read a couple of fields, so cast to a loose mock for these minimal fixtures.
const asMock = (fn: unknown) => fn as jest.Mock;

// Use a large list so the dropdown overflows like the bug report (HDX-4445).
const OPTION_COUNT = 20;
const databaseNames = Array.from(
  { length: OPTION_COUNT },
  (_, i) => `db_${String(i).padStart(2, '0')}`,
);
const tableNames = Array.from(
  { length: OPTION_COUNT },
  (_, i) => `table_${String(i).padStart(2, '0')}`,
);
const connections = Array.from({ length: OPTION_COUNT }, (_, i) => ({
  id: `conn-${i}`,
  name: `Connection ${String(i).padStart(2, '0')}`,
}));

beforeEach(() => {
  asMock(useDatabasesDirect).mockReturnValue({
    data: { data: databaseNames.map(name => ({ name })) },
    isLoading: false,
  });
  asMock(useTablesDirect).mockReturnValue({
    data: { data: tableNames.map(name => ({ name })) },
    isLoading: false,
  });
  asMock(useConnections).mockReturnValue({ data: connections });
});

function DatabaseHarness() {
  const { control } = useForm();
  return (
    <DatabaseSelectControlled
      control={control}
      name="databaseName"
      connectionId="conn-1"
    />
  );
}

function TableHarness() {
  const { control } = useForm();
  return (
    <DBTableSelectControlled
      control={control}
      name="tableName"
      database="default"
      connectionId="conn-1"
    />
  );
}

function ConnectionHarness() {
  const { control } = useForm();
  return <ConnectionSelectControlled control={control} name="connection" />;
}

/**
 * HDX-4445: these pickers live inside the source-setup modal. With many entries
 * the dropdown must (a) render every option and (b) render them in a portal, so
 * the modal's overflow can't clip the list.
 *
 * `hidden: true` — jsdom has no layout, so the portaled dropdown computes as
 * "hidden"; the default role query would skip it.
 *
 * Note on what jsdom can/can't prove: clipping is a *visual* effect of
 * `overflow:hidden`, which does not change the DOM or an element's box, and
 * jsdom has no layout — so pixel visibility ("is option 20 actually on screen")
 * is not assertable here. The two checks below are what's both meaningful and
 * deterministic: every option is rendered (no truncation/virtualization), and
 * the options are portaled OUT of the picker's container so a modal can't clip
 * them. The container check is what flips between fixed (`withinPortal: true`)
 * and broken (`false`) — independent of option count. True on-screen proof
 * would require a real-browser (E2E) test.
 */
async function expectAllOptionsRenderedInPortal(
  container: HTMLElement,
  trigger: HTMLElement,
) {
  await userEvent.click(trigger);

  // (a) All options are rendered — none dropped by truncation/virtualization.
  const allOptions = await screen.findAllByRole('option', { hidden: true });
  expect(allOptions).toHaveLength(OPTION_COUNT);

  // (b) None are nested inside the picker's own container: they are portaled
  // out, so the modal's overflow cannot clip them. Fails on withinPortal:false.
  expect(
    within(container).queryAllByRole('option', { hidden: true }),
  ).toHaveLength(0);
}

describe('source form picker dropdowns render all options in a portal', () => {
  it(`DatabaseSelect renders all ${OPTION_COUNT} databases in a portal`, async () => {
    const { container } = renderWithMantine(<DatabaseHarness />);
    await expectAllOptionsRenderedInPortal(
      container,
      screen.getByPlaceholderText('Database'),
    );
  });

  it(`DBTableSelect renders all ${OPTION_COUNT} tables in a portal`, async () => {
    const { container } = renderWithMantine(<TableHarness />);
    await expectAllOptionsRenderedInPortal(
      container,
      screen.getByPlaceholderText('Table'),
    );
  });

  it(`ConnectionSelect renders all ${OPTION_COUNT} connections in a portal`, async () => {
    const { container } = renderWithMantine(<ConnectionHarness />);
    await expectAllOptionsRenderedInPortal(
      container,
      screen.getByPlaceholderText('Connection'),
    );
  });
});
