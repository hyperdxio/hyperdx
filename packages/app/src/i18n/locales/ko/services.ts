import type { services as englishServices } from '@/i18n/locales/en/services';
import type { DeepPartial } from '@/i18n/types';

export const services = {
  dashboard: {
    browserTitle: '서비스 대시보드 – {{brandName}}',
    breadcrumb: '서비스',
    allServices: '전체 서비스',
    editFilters: '필터 편집',
    run: '실행',
    selectTraceSource: '트레이스 소스를 선택해 주세요',
    tabs: {
      http: 'HTTP 서비스',
      database: '데이터베이스',
      errors: '오류',
    },
  },
  http: {
    displayAsLine: '선형 차트로 보기',
    displayAsHistogram: '히스토그램으로 보기',
    requestLatency: '요청 지연 시간',
    requestErrorRate: '요청 오류율',
    errorRateOverall: '전체',
    errorRateByEndpoint: '엔드포인트별',
    requestThroughput: '요청 처리량',
    topEndpoints: '소요 시간이 가장 긴 엔드포인트 상위 20개',
    topEndpointsTimeTitle: '소요 시간 상위 20개',
    topEndpointsErrorTitle: '오류율 상위 20개',
    sortByTime: '시간순 정렬',
    sortByErrors: '오류순 정렬',
  },
  database: {
    showAsList: '목록으로 보기',
    showAsTable: '테이블로 보기',
    totalTimePerQuery: '쿼리별 총 소요 시간',
    throughputPerQuery: '쿼리별 처리량',
    topQueries: '소요 시간이 가장 긴 쿼리 상위 20개',
  },
  errors: {
    eventsPerService: '서비스별 오류 이벤트',
  },
  sidePanel: {
    detailsFor: '{{name}} 상세',
    totalQueryTime: '총 쿼리 시간',
    queryThroughput: '쿼리 처리량',
    slowestQueries: '가장 느린 상위 5% 쿼리',
    slowestTransactions: '가장 느린 상위 5% 트랜잭션',
    topOperations: '소요 시간이 가장 긴 작업 상위 20개',
  },
  slowestEvents: {
    threshold: '({{threshold}}ms 초과)',
    loading: '차트 데이터를 불러오는 중...',
    empty: '해당 시간 범위에 데이터가 없습니다.',
  },
  map: {
    browserTitle: '서비스 맵 - {{brandName}}',
    title: '서비스 맵',
    beta: '베타',
    sampling: '샘플링 {{label}}',
    allServices: '전체 서비스',
    createSourceTitle: '새 트레이스 소스 구성',
    emptyTitle: '구성된 트레이스 소스가 없습니다',
    emptyDescription:
      '서비스 맵은 트레이스 데이터를 사용해 서비스 간의 관계를 시각화합니다. 시작하려면 트레이스 소스를 구성하세요.',
    createTraceSource: '트레이스 소스 생성',
    goToTeamSettings: '팀 설정으로 이동',
    noServices:
      '서비스를 찾을 수 없습니다. 서비스 맵은 Client 및 Server 종류의 연관 스팬이 있는 서비스 간 연결을 표시합니다.',
    errorMessage: '오류 메시지:',
    originalQuery: '원본 쿼리:',
    loadError: '서비스 맵을 불러오지 못했습니다',
    legendLow: '낮음',
    legendNodeSize: '노드 크기 = 처리량',
    percentiles: 'p50 ~{{p50}} · p95 ~{{p95}} · p99 ~{{p99}}',
    clearFocus: '집중 해제',
    focusOnService: '이 서비스에 집중',
  },
} satisfies DeepPartial<typeof englishServices>;
