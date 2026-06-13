import { createRunQueryKeyBinding } from '../SQLEditor';

jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn().mockReturnValue({ data: [] }),
}));

describe('SQLEditor', () => {
  it('creates a Cmd/Ctrl+Enter key binding that submits the query', () => {
    const onSubmit = jest.fn();
    const binding = createRunQueryKeyBinding(onSubmit);

    expect(binding.key).toBe('Mod-Enter');
    expect(binding.run()).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
