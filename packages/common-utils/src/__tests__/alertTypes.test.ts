import {
  AlertBaseObjectSchema,
  AlertChangeType,
  AlertConditionType,
  AlertSchema,
  AlertThresholdType,
  validateAlertChangeType,
} from '../types';

describe('AlertConditionType and AlertChangeType', () => {
  it('should have correct enum values', () => {
    expect(AlertConditionType.THRESHOLD).toBe('threshold');
    expect(AlertConditionType.RATE_OF_CHANGE).toBe('rate_of_change');
    expect(AlertChangeType.ABSOLUTE).toBe('absolute');
    expect(AlertChangeType.PERCENTAGE).toBe('percentage');
  });
});

describe('AlertBaseObjectSchema', () => {
  const baseAlert = {
    interval: '5m' as const,
    threshold: 10,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook' as const, webhookId: 'wh1' },
  };

  it('should accept threshold alert without conditionType', () => {
    const result = AlertBaseObjectSchema.safeParse(baseAlert);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conditionType).toBeUndefined();
    }
  });

  it('should accept explicit threshold conditionType without changeType', () => {
    const result = AlertBaseObjectSchema.safeParse({
      ...baseAlert,
      conditionType: AlertConditionType.THRESHOLD,
    });
    expect(result.success).toBe(true);
  });

  it('should accept rate_of_change with changeType absolute', () => {
    const result = AlertBaseObjectSchema.safeParse({
      ...baseAlert,
      conditionType: AlertConditionType.RATE_OF_CHANGE,
      changeType: AlertChangeType.ABSOLUTE,
    });
    expect(result.success).toBe(true);
  });

  it('should accept rate_of_change with changeType percentage', () => {
    const result = AlertBaseObjectSchema.safeParse({
      ...baseAlert,
      conditionType: AlertConditionType.RATE_OF_CHANGE,
      changeType: AlertChangeType.PERCENTAGE,
    });
    expect(result.success).toBe(true);
  });
});

describe('validateAlertChangeType', () => {
  it('should add issue when conditionType is rate_of_change but changeType is missing', () => {
    const issues: any[] = [];
    const ctx = {
      addIssue: (issue: any) => issues.push(issue),
    } as any;

    validateAlertChangeType(
      { conditionType: AlertConditionType.RATE_OF_CHANGE },
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['changeType']);
  });

  it('should not add issue when conditionType is threshold', () => {
    const issues: any[] = [];
    const ctx = {
      addIssue: (issue: any) => issues.push(issue),
    } as any;

    validateAlertChangeType(
      { conditionType: AlertConditionType.THRESHOLD },
      ctx,
    );
    expect(issues).toHaveLength(0);
  });

  it('should not add issue when conditionType is rate_of_change with changeType', () => {
    const issues: any[] = [];
    const ctx = {
      addIssue: (issue: any) => issues.push(issue),
    } as any;

    validateAlertChangeType(
      {
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.ABSOLUTE,
      },
      ctx,
    );
    expect(issues).toHaveLength(0);
  });
});

describe('AlertSchema with rate of change', () => {
  const baseSavedSearchAlert = {
    interval: '5m' as const,
    threshold: 10,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook' as const, webhookId: 'wh1' },
    source: 'saved_search' as const,
    savedSearchId: 'ss1',
  };

  it('should reject rate_of_change without changeType', () => {
    const result = AlertSchema.safeParse({
      ...baseSavedSearchAlert,
      conditionType: AlertConditionType.RATE_OF_CHANGE,
    });
    expect(result.success).toBe(false);
  });

  it('should accept rate_of_change with changeType for saved search', () => {
    const result = AlertSchema.safeParse({
      ...baseSavedSearchAlert,
      conditionType: AlertConditionType.RATE_OF_CHANGE,
      changeType: AlertChangeType.PERCENTAGE,
    });
    expect(result.success).toBe(true);
  });

  it('should accept rate_of_change with changeType for tile alert', () => {
    const result = AlertSchema.safeParse({
      interval: '5m' as const,
      threshold: 50,
      thresholdType: AlertThresholdType.ABOVE,
      conditionType: AlertConditionType.RATE_OF_CHANGE,
      changeType: AlertChangeType.ABSOLUTE,
      channel: { type: 'webhook' as const, webhookId: 'wh1' },
      source: 'tile' as const,
      tileId: 't1',
      dashboardId: 'd1',
    });
    expect(result.success).toBe(true);
  });
});
