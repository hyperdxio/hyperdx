import type { AgentAttribute } from '@/opamp/models/agent';
import {
  decodeAgentCapabilities,
  getAgentAttribute,
  toSafeNumber,
} from '@/opamp/utils/agentTelemetry';

describe('agentTelemetry', () => {
  describe('toSafeNumber', () => {
    it('passes through finite numbers', () => {
      expect(toSafeNumber(0)).toBe(0);
      expect(toSafeNumber(42)).toBe(42);
    });

    it('coerces long.js-style objects via toNumber()', () => {
      expect(toSafeNumber({ toNumber: () => 6 })).toBe(6);
    });

    it('returns undefined for absent or non-finite values', () => {
      expect(toSafeNumber(undefined)).toBeUndefined();
      expect(toSafeNumber(null)).toBeUndefined();
      expect(toSafeNumber(NaN)).toBeUndefined();
      expect(toSafeNumber({ toNumber: () => NaN })).toBeUndefined();
      expect(toSafeNumber('7')).toBeUndefined();
    });
  });

  describe('decodeAgentCapabilities', () => {
    it('decodes a single bit', () => {
      expect(decodeAgentCapabilities(0x00000001)).toEqual(['ReportsStatus']);
    });

    it('decodes multiple bits in enum order', () => {
      // ReportsStatus | AcceptsRemoteConfig | ReportsHealth
      expect(
        decodeAgentCapabilities(0x00000001 | 0x00000002 | 0x00000800),
      ).toEqual(['ReportsStatus', 'AcceptsRemoteConfig', 'ReportsHealth']);
    });

    it('ignores unknown/future bits', () => {
      expect(decodeAgentCapabilities(0x00000002 | 0x80000000)).toEqual([
        'AcceptsRemoteConfig',
      ]);
    });

    it('accepts a Long-style bitmask', () => {
      expect(decodeAgentCapabilities({ toNumber: () => 0x00000004 })).toEqual([
        'ReportsEffectiveConfig',
      ]);
    });

    it('returns an empty list for zero or undefined', () => {
      expect(decodeAgentCapabilities(0)).toEqual([]);
      expect(decodeAgentCapabilities(undefined)).toEqual([]);
    });
  });

  describe('getAgentAttribute', () => {
    const attrs: AgentAttribute[] = [
      { key: 'service.name', value: { stringValue: 'otelcol' } },
      { key: 'service.version', value: { stringValue: '0.154.0' } },
      { key: 'process.pid', value: { intValue: 0 } },
      { key: 'enabled', value: { boolValue: false } },
    ];

    it('extracts a string value', () => {
      expect(getAgentAttribute(attrs, 'service.version')).toBe('0.154.0');
    });

    it('preserves falsy scalar values (0, false)', () => {
      expect(getAgentAttribute(attrs, 'process.pid')).toBe(0);
      expect(getAgentAttribute(attrs, 'enabled')).toBe(false);
    });

    it('returns undefined for a missing key or missing list', () => {
      expect(getAgentAttribute(attrs, 'host.arch')).toBeUndefined();
      expect(getAgentAttribute(undefined, 'service.name')).toBeUndefined();
    });
  });
});
