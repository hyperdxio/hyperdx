import React from 'react';
import { useForm } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useSources } from '@/source';

import { SourceManagementMenu, SourceSelectControlled } from '../SourceSelect';

jest.mock('@/source', () => ({
  useSources: jest.fn(),
}));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// useSources returns a large UseQueryResult; the selector reads only `data`.
const asMock = (fn: unknown) => fn as jest.Mock;

const makeSource = (
  id: string,
  name: string,
  kind: SourceKind,
  overrides: Partial<TSource> = {},
): TSource =>
  ({
    id,
    name,
    kind,
    connection: 'conn-a',
    ...overrides,
  }) as unknown as TSource;

describe('SourceManagementMenu', () => {
  it('does not render the kebab trigger when no actions are wired', () => {
    renderWithMantine(<SourceManagementMenu hasSelection={false} />);
    expect(screen.queryByTestId('source-actions-menu')).not.toBeInTheDocument();
  });

  it('renders the kebab trigger when onSchemaPreview is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onSchemaPreview={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  it('renders the kebab trigger when only onEdit is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onEdit={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  it('renders the kebab trigger when only onManageSources is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onManageSources={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  it('renders the kebab trigger when only onCreate is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onCreate={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  describe('View schema item', () => {
    it('is disabled when hasSelection is false', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection={false}
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      const viewSchemaBtn = await screen.findByText('View schema');
      expect(viewSchemaBtn.closest('button')).toHaveAttribute(
        'data-disabled',
        'true',
      );
    });

    it('is disabled when isSchemaPreviewEnabled is false', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled={false}
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      const viewSchemaBtn = await screen.findByText('View schema');
      expect(viewSchemaBtn.closest('button')).toHaveAttribute(
        'data-disabled',
        'true',
      );
    });

    it('is enabled when hasSelection and isSchemaPreviewEnabled are both true', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      const viewSchemaBtn = await screen.findByText('View schema');
      expect(viewSchemaBtn.closest('button')).not.toHaveAttribute(
        'data-disabled',
      );
    });

    it('calls onSchemaPreview when clicked', async () => {
      const onSchemaPreview = jest.fn();
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={onSchemaPreview}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      await userEvent.click(await screen.findByText('View schema'));
      expect(onSchemaPreview).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onEdit when Edit source is clicked', async () => {
    const onEdit = jest.fn();
    renderWithMantine(
      // hasSelection required: Edit source is disabled without a selection.
      <SourceManagementMenu hasSelection onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByTestId('source-actions-menu'));
    await userEvent.click(await screen.findByText('Edit source'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls onManageSources when Manage sources is clicked', async () => {
    const onManageSources = jest.fn();
    renderWithMantine(
      <SourceManagementMenu
        hasSelection={false}
        onManageSources={onManageSources}
      />,
    );
    await userEvent.click(screen.getByTestId('source-actions-menu'));
    await userEvent.click(await screen.findByText('Manage sources'));
    expect(onManageSources).toHaveBeenCalledTimes(1);
  });

  it('calls onCreate when Create new source is clicked', async () => {
    const onCreate = jest.fn();
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onCreate={onCreate} />,
    );
    await userEvent.click(screen.getByTestId('source-actions-menu'));
    await userEvent.click(await screen.findByText('Create new source'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('SourceSelectControlled (grouped rendering + tag-style search)', () => {
  const SECTIONED_SOURCES = [
    makeSource('billing-logs', 'Billing Logs', SourceKind.Log, {
      section: 'Billing',
    }),
    // No "billing" in the name: it should still surface for a "billing" query
    // because it sits under the Billing section header (the section is the tag).
    makeSource('refund-logs', 'Refund Logs', SourceKind.Log, {
      section: 'Billing',
    }),
    makeSource('prod-logs', 'Prod Logs', SourceKind.Log, {
      section: 'Control Plane Prod',
    }),
  ];

  function SelectHarness() {
    const { control } = useForm();
    return <SourceSelectControlled control={control} name="source" />;
  }

  // The searchable Select reuses its placeholder input for typing.
  const openSelect = async () => {
    const input = screen.getByPlaceholderText('Data Source');
    await userEvent.click(input);
    return input;
  };

  it('renders sources grouped under their section headers', async () => {
    asMock(useSources).mockReturnValue({ data: SECTIONED_SOURCES });
    renderWithMantine(<SelectHarness />);
    await openSelect();

    // Grouping switches on because at least one source carries a section.
    expect(await screen.findByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Control Plane Prod')).toBeInTheDocument();
    // Options render under their headers.
    expect(screen.getByText('Billing Logs')).toBeInTheDocument();
    expect(screen.getByText('Refund Logs')).toBeInTheDocument();
    expect(screen.getByText('Prod Logs')).toBeInTheDocument();
  });

  it('treats the section as a tag: "billing logs" keeps section-mates whose name lacks "billing" and drops other sections', async () => {
    asMock(useSources).mockReturnValue({ data: SECTIONED_SOURCES });
    renderWithMantine(<SelectHarness />);
    const input = await openSelect();
    await userEvent.type(input, 'billing logs');

    // "Billing Logs" matches on its name; "Refund Logs" matches on the Billing
    // section tag plus the "logs" name token, even though its name has no "billing".
    expect(await screen.findByText('Refund Logs')).toBeInTheDocument();
    expect(screen.getByText('Billing Logs')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    // "Prod Logs" matches "logs" but not "billing", so its whole section drops out.
    expect(screen.queryByText('Prod Logs')).not.toBeInTheDocument();
    expect(screen.queryByText('Control Plane Prod')).not.toBeInTheDocument();
  });

  it('stays flat with no catch-all header until a source has a section', async () => {
    asMock(useSources).mockReturnValue({
      data: [
        makeSource('a', 'Apple Traces', SourceKind.Trace),
        makeSource('z', 'Zebra Logs', SourceKind.Log),
      ],
    });
    renderWithMantine(<SelectHarness />);
    await openSelect();

    // Both options render with no lone "Other" header, matching the flat
    // selector a deployment that has not adopted sections sees today.
    expect(await screen.findByText('Apple Traces')).toBeInTheDocument();
    expect(screen.getByText('Zebra Logs')).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });
});
