import { renderHook } from '@testing-library/react';

import api from '../api';
import { useSavedSearches } from '../savedSearch';
import { useSpotlightActions } from '../Spotlights';

jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '',
      query: '',
      asPath: '',
      push: jest.fn(),
      events: {
        on: jest.fn(),
        off: jest.fn(),
      },
      beforePopState: jest.fn(() => null),
      prefetch: jest.fn(() => null),
    };
  },
}));
jest.mock('../savedSearch');
jest.mock('../api');

const mockUseSavedSearches = useSavedSearches as jest.Mock;
const mockUseDashboards = api.useDashboards as jest.Mock;

describe('useSpotlightActions', () => {
  const mockSavedSearches = {
    data: [
      {
        _id: '67ced5f5d02ab8b11d7f1638',
        team: '67c25ae0e3b6d5e2f2443787',
        name: 'save template1',
        select: '',
        where: '200',
        whereLanguage: 'lucene',
        orderBy: '',
        source: '67c25aeee3b6d5e2f24437b3',
        tags: [],
        createdAt: '2025-03-10T12:07:17.062Z',
        updatedAt: '2025-03-10T12:07:17.062Z',
        __v: 0,
        id: '67ced5f5d02ab8b11d7f1638',
      },
    ],
  };
  const mockSavedDashboard = {
    data: [
      {
        _id: '67cfc5f7d02ab8b11d7f87c1',
        name: 'save dashboard1',
        tiles: [
          {
            id: 'c9mnw',
            x: 0,
            y: 0,
            w: 8,
            h: 10,
            config: {
              name: 'saved line',
              select: [
                {
                  aggFn: 'count',
                  aggCondition: '200',
                  aggConditionLanguage: 'lucene',
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene',
              displayType: 'line',
              granularity: 'auto',
              source: '67c25aeee3b6d5e2f24437b3',
            },
          },
        ],
        team: '67c25ae0e3b6d5e2f2443787',
        tags: [],
        createdAt: '2025-03-11T05:11:19.141Z',
        updatedAt: '2025-03-11T05:12:02.967Z',
        __v: 0,
        id: '67cfc5f7d02ab8b11d7f87c1',
      },
    ],
  };

  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSavedSearches.mockReturnValue(mockSavedSearches);
    mockUseDashboards.mockReturnValue(mockSavedDashboard);
  });
  it('saved searches and dashboards should be loaded', () => {
    const { result } = renderHook(() => useSpotlightActions());
    expect(result.current.actions[0].id).toEqual(mockSavedSearches.data[0]._id);
    expect(result.current.actions[0].label).toEqual(
      mockSavedSearches.data[0].name,
    );
    expect(result.current.actions[1].id).toEqual(
      mockSavedDashboard.data[0]._id,
    );
    expect(result.current.actions[1].label).toEqual(
      mockSavedDashboard.data[0].name,
    );
  });
});
