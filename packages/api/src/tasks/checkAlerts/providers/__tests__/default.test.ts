import * as models from '@/models';
import DefaultAlertProvider from '@/tasks/checkAlerts/providers/default';

jest.mock('@/models', () => ({
  ...jest.requireActual('@/models'),
  connectDB: jest.fn().mockResolvedValue(undefined),
  mongooseConnection: {
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('DefaultAlertProvider.init', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables both autoIndex and autoCreate when connecting to MongoDB', async () => {
    const provider = new DefaultAlertProvider();
    await provider.init();

    expect(models.connectDB).toHaveBeenCalledTimes(1);
    expect(models.connectDB).toHaveBeenCalledWith({
      autoIndex: false,
      autoCreate: false,
    });
  });
});
