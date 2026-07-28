import type { onboarding as englishOnboarding } from '@/i18n/locales/en/onboarding';
import type { DeepPartial } from '@/i18n/types';

export const onboarding = {
  modal: {
    title: '{{brandName}}에 오신 것을 환영합니다',
    connectionIntro: 'ClickHouse 연결을 설정해 보겠습니다',
    connectionHint: '연결은 나중에 언제든지 추가하거나 수정할 수 있습니다.',
    or: '또는',
    demoServer: '데모 서버에 연결',
    detecting: '사용 가능한 테이블을 감지하는 중...',
    skipToManual: '건너뛰고 직접 설정',
    back: '뒤로',
    autoDetected_one:
      '연결에서 소스 {{count}}개를 자동으로 감지해 생성했습니다. 확인 후 수정하거나 계속 진행하세요.',
    autoDetected_other:
      '연결에서 소스 {{count}}개를 자동으로 감지해 생성했습니다. 확인 후 수정하거나 계속 진행하세요.',
    addMoreSources: '소스 더 추가',
    continue: '계속',
    noTablesDetected:
      'OTel 테이블이 자동으로 감지되지 않았습니다. 소스를 직접 설정해 주세요.',
    sourceIntro: '텔레메트리를 조회할 소스 테이블을 설정해 보겠습니다.',
    sourceHint: '소스는 나중에 언제든지 추가하거나 수정할 수 있습니다.',
    successTitle: '성공',
    errorTitle: '오류',
    autoDetectSuccess_one: '소스 {{count}}개를 자동으로 감지해 생성했습니다.',
    autoDetectSuccess_other: '소스 {{count}}개를 자동으로 감지해 생성했습니다.',
    autoDetectError:
      '텔레메트리 소스를 자동으로 감지하지 못했습니다. 직접 설정해 주세요.',
    demoConnected: '{{brandName}} 데모 서버에 연결했습니다.',
    demoFailed:
      '{{brandName}} 데모 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },
  mcp: {
    hostLabel: 'MCP 호스트',
    hostOther: '기타',
    pasteInTerminal: '터미널에 붙여넣으세요:',
    addToCursor: 'Cursor에 추가',
    cursorFallback: '또는 이 JSON을 Cursor 설정 > MCP에 붙여넣으세요:',
    addToVsCode: 'VS Code에 추가',
    vscodeFallback: '또는 이 JSON을 .vscode/mcp.json에 붙여넣으세요:',
    vscodeNote:
      'Copilot Chat MCP 기능이 활성화된 VS Code 1.99 이상이 필요합니다.',
    openCodeConfig:
      '`opencode.json`(프로젝트) 또는 `~/.config/opencode/config.json`(전역)에 붙여넣으세요:',
    otherConfig: '사용 중인 호스트의 MCP 설정에 붙여넣으세요:',
    deeplinkTooltip: '서버가 미리 구성된 상태로 호스트를 엽니다',
    hideManualSetup: '수동 설정 숨기기',
    manualSetup: '수동 설정',
  },
  banner: {
    clickstackWarning:
      '이 구성은 프로덕션 사용에 권장되지 않으며, 알림과 저장된 검색 같은 핵심 ClickStack 기능이 포함되어 있지 않습니다. 온전한 환경을 사용하려면 <docs>ClickStack 문서</docs>를 확인하세요',
  },
} satisfies DeepPartial<typeof englishOnboarding>;
