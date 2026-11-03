import { Menu } from '@mantine/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  buildMoveTargets,
  MoveTarget,
  MoveToGroupSubmenu,
} from '@/components/dashboard/MoveToGroupSubmenu';

const containers = [
  {
    id: 'tabbed',
    title: 'Ignored',
    collapsed: false,
    tabs: [
      { id: 't1', title: 'Services' },
      { id: 't2', title: 'Queues' },
    ],
  },
  {
    id: 'single',
    title: 'Ignored',
    collapsed: false,
    tabs: [{ id: 's1', title: 'Single tab' }],
  },
  { id: 'plain', title: 'Plain group', collapsed: false },
];

describe('buildMoveTargets', () => {
  it('lists each tab of a multi-tab group under its first tab, and one target per other group', () => {
    expect(buildMoveTargets(containers)).toEqual([
      {
        containerId: 'tabbed',
        tabId: 't1',
        label: 'Services',
        group: 'Services',
      },
      {
        containerId: 'tabbed',
        tabId: 't2',
        label: 'Queues',
        group: 'Services',
      },
      { containerId: 'single', tabId: 's1', label: 'Single tab' },
      { containerId: 'plain', label: 'Plain group' },
    ]);
  });
});

describe('MoveToGroupSubmenu', () => {
  async function openSubmenu(
    props: { containerId?: string; tabId?: string } = {},
    moveTargets: MoveTarget[] = buildMoveTargets(containers),
  ) {
    const onMoveToGroup = jest.fn();
    // jsdom has no layout, so Popover would hide the dropdown as detached
    const { unmount } = renderWithMantine(
      <Menu opened transitionProps={{ duration: 0 }} hideDetached={false}>
        <Menu.Target>
          <button>open</button>
        </Menu.Target>
        <Menu.Dropdown>
          <MoveToGroupSubmenu
            moveTargets={moveTargets}
            onMoveToGroup={onMoveToGroup}
            {...props}
          />
        </Menu.Dropdown>
      </Menu>,
    );
    await userEvent.hover(screen.getByText('Move to group'));
    const submenu = (await screen.findAllByRole('menu')).at(-1)!;
    return { submenu: within(submenu), onMoveToGroup, unmount };
  }

  it('shows one heading per multi-tab group and hides the current location', async () => {
    const { submenu } = await openSubmenu({
      containerId: 'tabbed',
      tabId: 't2',
    });

    expect(submenu.getAllByText('Services')).toHaveLength(2); // heading + tab
    expect(submenu.queryByText('Queues')).not.toBeInTheDocument();
    expect(submenu.getByText('Single tab')).toBeInTheDocument();
    expect(submenu.getByText('(Ungrouped)')).toBeInTheDocument();
  });

  it('offers no "(Ungrouped)" target for an ungrouped tile', async () => {
    const { submenu } = await openSubmenu();
    expect(submenu.queryByText('(Ungrouped)')).not.toBeInTheDocument();
  });

  it('moves to the chosen tab', async () => {
    const { submenu, onMoveToGroup } = await openSubmenu();
    await userEvent.click(submenu.getByText('Queues'));
    expect(onMoveToGroup).toHaveBeenCalledWith('tabbed', 't2');
  });

  it('moves out of its group via "(Ungrouped)"', async () => {
    const { submenu, onMoveToGroup } = await openSubmenu({
      containerId: 'plain',
    });
    expect(submenu.queryByText('Plain group')).not.toBeInTheDocument();
    await userEvent.click(submenu.getByText('(Ungrouped)'));
    expect(onMoveToGroup).toHaveBeenCalledWith(undefined);
  });

  it('gives each multi-tab group its own heading when names repeat', async () => {
    const tabs = (id: string) => [
      { id: `${id}-1`, title: 'New Group' },
      { id: `${id}-2`, title: 'Tab 2' },
    ];
    const { submenu } = await openSubmenu(
      {},
      buildMoveTargets([
        { id: 'a', title: 'New Group', collapsed: false, tabs: tabs('a') },
        { id: 'b', title: 'New Group', collapsed: false, tabs: tabs('b') },
      ]),
    );
    expect(submenu.getAllByText('New Group')).toHaveLength(4);
    expect(
      submenu.getAllByRole('menuitem', { name: 'New Group', hidden: true }),
    ).toHaveLength(2);
  });

  it('separates tabbed sections and "(Ungrouped)" from the groups around them', async () => {
    const separatorsBefore = async (
      props: { containerId?: string },
      targets?: MoveTarget[],
    ) => {
      const { submenu, unmount } = await openSubmenu(props, targets);
      const labels = submenu
        .queryAllByRole('separator', { hidden: true })
        .map(s => s.nextElementSibling?.textContent);
      unmount();
      return labels;
    };

    // Plain groups following each other share no divider
    expect(await separatorsBefore({})).toEqual(['Single tab']);
    expect(await separatorsBefore({ containerId: 'plain' })).toEqual([
      'Services',
      'Single tab',
    ]);
    const [tabbed, single, plain] = containers;
    expect(
      await separatorsBefore({}, buildMoveTargets([plain, tabbed])),
    ).toEqual(['Services']);
    expect(
      await separatorsBefore({}, buildMoveTargets([single, plain])),
    ).toEqual([]);
  });
});
