import { common as englishCommon } from '@/i18n/locales/en/common';
import type { DeepPartial } from '@/i18n/types';

export const common = {
  actions: {
    add: '추가',
    back: '뒤로',
    cancel: '취소',
    close: '닫기',
    confirm: '확인',
    copy: '복사',
    copied: '복사됨!',
    delete: '삭제',
    confirmDelete: '삭제 확인',
    closeModal: '모달 닫기',
    edit: '편집',
    retry: '다시 시도',
    save: '저장',
  },
  support: {
    contact: '지원팀에 문의해 주세요.',
    github: '<github>GitHub</github>에 이슈를 등록해 주세요.',
  },
  states: {
    loading: '불러오는 중',
    nothingFound: '결과가 없습니다...',
    empty: '비어 있음',
  },
  tags: {
    searchOrCreate: '태그 검색 또는 생성',
    search: '태그 검색',
    createHint: '입력 후 <key>Enter</key>를 누르면 새 태그가 생성됩니다',
    empty: '태그가 없습니다',
    only: '이 태그만',
    selected: '{{count}}개 선택됨',
    none: '없음',
    clearAll: '전체 해제',
    error: '오류',
  },
  aiSummary: {
    hide: '요약 숨기기',
    summarize: '요약하기',
    regenerate: '다시 생성',
    title: 'AI 요약',
    disclaimer:
      '만우절 기념입니다! AI는 사용되지 않았습니다. 이 요약은 미리 작성된 문구 템플릿으로 브라우저에서 직접 생성되었으며, 데이터는 브라우저를 벗어나지 않았습니다.',
    dismiss: '다시 표시하지 않기',
  },
  export: {
    disabled: '내보내기를 사용할 수 없습니다',
    noData: '내보낼 데이터가 없습니다',
  },
  selects: {
    connection: '연결',
    database: '데이터베이스',
  },
  timePicker: {
    placeholder: '시간 범위',
    liveTailHint:
      'Live Tail이 얼마나 이전부터 로그 스트리밍을 시작할지 설정합니다.',
    relativeTime: '상대 시간',
    hourBack: '1시간 이전',
    hourForward: '1시간 이후',
    startTime: '시작 시각',
    endTime: '종료 시각',
    time: '시각',
    duration: '기간 ±',
    pickValue: '값 선택',
    naturalLanguageHint:
      '자연어로 날짜를 지정할 수 있습니다 (예: yesterday, last monday at 5pm)',
    apply: '적용',
    presets: {
      liveTail: 'Live Tail',
      last1Minute: '최근 1분',
      last5Minutes: '최근 5분',
      last15Minutes: '최근 15분',
      last30Minutes: '최근 30분',
      last45Minutes: '최근 45분',
      last1Hour: '최근 1시간',
      last3Hours: '최근 3시간',
      last6Hours: '최근 6시간',
      last12Hours: '최근 12시간',
      last1Day: '최근 1일',
      last2Days: '최근 2일',
      last7Days: '최근 7일',
      last14Days: '최근 14일',
      last30Days: '최근 30일',
    },
  },
  errors: {
    generic: '문제가 발생했습니다',
    contactTeam: '문제가 발생했습니다. {{brandName}} 팀에 문의해 주세요.',
  },
} satisfies DeepPartial<typeof englishCommon>;
