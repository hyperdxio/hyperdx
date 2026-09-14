import {
  AGENT_PRESETS,
  DEFAULT_AGENT_PRESET,
} from '@/components/TeamSettings/agentPresets';

describe('agent presets', () => {
  it('offers distinct types, each with a label', () => {
    const values = AGENT_PRESETS.map(p => p.value);
    expect(new Set(values).size).toBe(values.length);
    expect(AGENT_PRESETS.every(p => p.label.trim().length > 0)).toBe(true);
  });

  // The standing prompt is already a general SRE brief, so the default adds
  // nothing rather than repeating it.
  it('defaults to a type that contributes no extra brief', () => {
    expect(DEFAULT_AGENT_PRESET.instructions).toBe('');
  });

  it('gives every non-default type an actual brief', () => {
    const specialists = AGENT_PRESETS.filter(
      p => p.value !== DEFAULT_AGENT_PRESET.value,
    );
    expect(specialists.length).toBeGreaterThan(0);
    expect(specialists.every(p => p.instructions.trim().length > 20)).toBe(
      true,
    );
  });
});
