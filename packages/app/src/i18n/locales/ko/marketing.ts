import type { marketing as englishMarketing } from '@/i18n/locales/en/marketing';
import type { DeepPartial } from '@/i18n/types';

export const marketing = {
  careers: {
    browserTitle: '채용 | HyperDX',
    title: 'ClickHouse 채용: 옵저버빌리티의 미래를 함께 만들어요',
    intro:
      'ClickHouse에서 ClickStack을 만들며, 메트릭·로그·트레이스를 아우르는 페타바이트 규모의 텔레메트리를 수집하고 조회하는 고성능 옵저버빌리티 플랫폼을 함께 확장해 나갑니다.',
    openPositions: '채용 중인 포지션은 아래에 있습니다.',
    loadError: '채용 공고를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
    noPositions: '현재 채용 중인 포지션이 없습니다. 곧 다시 확인해 주세요!',
    recentActivity: '최근 활동',
    recentActivityDescription:
      '저희 팀(과 커뮤니티)이 최근 어떤 문제를 다루고 있는지 살펴보세요.',
  },
  benchmark: {
    title: 'ClickHouse 쿼리 벤치마크',
    queryOne: '쿼리 1',
    queryTwo: '쿼리 2',
    run: '벤치마크 실행',
    running: '벤치마크 실행 중...',
    estimates: '쿼리 예상치 및 인덱스',
    estimatesDescription: '쿼리의 인덱스 활용도',
  },
} satisfies DeepPartial<typeof englishMarketing>;
