import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  ColorRulesEditor,
  ColorRuleWithId,
} from '@/components/ColorRulesEditor';

// Stable localIds so tests can reference them by index.
// Uses `as ColorRuleWithId` because spreading Partial<ColorRuleWithId> over a
// concrete rule base widens the discriminated union in TS's view; the cast is safe
// because callers always supply valid operator/value combinations.
function makeRule(
  overrides: Partial<ColorRuleWithId> = {},
  id = crypto.randomUUID(),
): ColorRuleWithId {
  return {
    localId: id,
    operator: 'gt',
    value: 0,
    color: 'chart-blue',
    ...overrides,
  } as ColorRuleWithId;
}

describe('ColorRulesEditor', () => {
  describe('Add rule button', () => {
    it('renders an "Add rule" button', () => {
      renderWithMantine(<ColorRulesEditor value={[]} onChange={jest.fn()} />);
      expect(screen.getByTestId('color-rules-add-button')).toBeInTheDocument();
    });

    it('appends a new rule when "Add rule" is clicked', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      renderWithMantine(<ColorRulesEditor value={[]} onChange={onChange} />);
      await user.click(screen.getByTestId('color-rules-add-button'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const [newRules] = onChange.mock.calls[0];
      expect(newRules).toHaveLength(1);
      expect(newRules[0]).toMatchObject({
        operator: 'gt',
        color: 'chart-blue',
      });
      expect(typeof newRules[0].localId).toBe('string');
    });

    it('disables "Add rule" when there are already 10 rules', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      const rules = Array.from({ length: 10 }, (_, i) =>
        makeRule({ value: i }, `id-${i}`),
      );
      renderWithMantine(<ColorRulesEditor value={rules} onChange={onChange} />);
      const btn = screen.getByTestId('color-rules-add-button');
      expect(btn).toBeDisabled();
      await user.click(btn);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Delete rule', () => {
    it('removes the correct rule when delete is clicked', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      const rules = [
        makeRule({ value: 10 }, 'a'),
        makeRule({ value: 20 }, 'b'),
      ];
      renderWithMantine(<ColorRulesEditor value={rules} onChange={onChange} />);
      await user.click(screen.getByTestId('color-rule-delete-0'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const [updated] = onChange.mock.calls[0];
      expect(updated).toHaveLength(1);
      expect(updated[0].localId).toBe('b');
    });
  });

  describe('Operator selector', () => {
    it('renders a select with the current operator', () => {
      renderWithMantine(
        <ColorRulesEditor
          value={[makeRule({ operator: 'gte', value: 50 }, 'r1')]}
          onChange={jest.fn()}
        />,
      );
      const select = screen.getByTestId('color-rule-operator-0');
      expect(select).toBeInTheDocument();
    });

    it('shows two number inputs when operator is "between"', () => {
      renderWithMantine(
        <ColorRulesEditor
          value={[
            makeRule(
              { operator: 'between', value: [10, 100] },
              'r1',
            ) as ColorRuleWithId,
          ]}
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByLabelText('Rule 1 lower bound')).toBeInTheDocument();
      expect(screen.getByLabelText('Rule 1 upper bound')).toBeInTheDocument();
    });

    it('shows a single number input for ordered operators', () => {
      for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
        const onChange = jest.fn();
        const { unmount } = renderWithMantine(
          <ColorRulesEditor
            value={[makeRule({ operator: op, value: 5 }, 'r1')]}
            onChange={onChange}
          />,
        );
        expect(screen.getByLabelText('Rule 1 value')).toBeInTheDocument();
        unmount();
      }
    });

    it('shows a text input for eq operator', () => {
      renderWithMantine(
        <ColorRulesEditor
          value={[
            makeRule({ operator: 'eq', value: 0 }, 'r1') as ColorRuleWithId,
          ]}
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByLabelText('Rule 1 value')).toBeInTheDocument();
    });

    it('shows a text input for neq operator', () => {
      renderWithMantine(
        <ColorRulesEditor
          value={[
            makeRule({ operator: 'neq', value: '' }, 'r1') as ColorRuleWithId,
          ]}
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByLabelText('Rule 1 value')).toBeInTheDocument();
    });
  });

  describe('Color swatch', () => {
    it('renders a color swatch trigger for each rule', () => {
      const rules = [makeRule({}, 'a'), makeRule({}, 'b')];
      renderWithMantine(
        <ColorRulesEditor value={rules} onChange={jest.fn()} />,
      );
      // ColorSwatchInput renders one trigger per rule
      expect(screen.getAllByTestId('color-swatch-input-trigger')).toHaveLength(
        2,
      );
    });
  });

  describe('Rendering', () => {
    it('renders each rule row', () => {
      const rules = [
        makeRule({ value: 10 }, 'a'),
        makeRule({ value: 20 }, 'b'),
        makeRule({ value: 30 }, 'c'),
      ];
      renderWithMantine(
        <ColorRulesEditor value={rules} onChange={jest.fn()} />,
      );
      expect(screen.getByTestId('color-rule-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('color-rule-row-1')).toBeInTheDocument();
      expect(screen.getByTestId('color-rule-row-2')).toBeInTheDocument();
    });

    it('renders empty state with only the Add button', () => {
      renderWithMantine(<ColorRulesEditor value={[]} onChange={jest.fn()} />);
      expect(screen.queryByTestId('color-rule-row-0')).not.toBeInTheDocument();
      expect(screen.getByTestId('color-rules-add-button')).toBeInTheDocument();
    });
  });
});
