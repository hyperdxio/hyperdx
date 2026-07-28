import type { auth as englishAuth } from '@/i18n/locales/en/auth';
import type { DeepPartial } from '@/i18n/types';

export const auth = {
  header: {
    cloud: '{{brandName}} Cloud',
    docs: '문서',
    login: '로그인',
    setupAccount: '계정 만들기',
    goToSearch: '검색으로 이동',
  },
  passwordCheck: {
    minLength: '최소 12자',
    uppercase: '대문자 1자 이상',
    lowercase: '소문자 1자 이상',
    number: '숫자 1자 이상',
    special: '특수문자 1자 이상',
  },
  common: {
    email: '이메일',
    emailPlaceholder: 'you@company.com',
    password: '비밀번호',
    confirmPassword: '비밀번호 확인',
  },
  login: {
    browserTitle: '{{brandName}} - 로그인',
    title: '다시 오신 것을 환영합니다!',
    heading: '<brand>{{brandName}}</brand> 로그인',
    submit: '로그인',
    registrationPrompt:
      '아직 계정이 없으신가요? <register>회원가입</register>을 진행해 주세요.',
  },
  register: {
    browserTitle: '{{brandName}} - 회원가입',
    setupHeading: '<brand>{{brandName}}</brand> 설정',
    heading: '<brand>{{brandName}}</brand> 회원가입',
    intro: '사용자 계정을 만들어 보겠습니다.',
    submit: '회원가입',
    create: '생성',
    verificationSent: '인증 메일을 보냈습니다! 받은 편지함을 확인해 주세요.',
    loginPrompt: '이미 계정이 있으신가요? <login>로그인</login>해 주세요.',
  },
  joinTeam: {
    browserTitle: '팀 참여 - {{brandName}}',
    title: '팀 참여',
    setupPassword: '비밀번호 설정',
  },
  errors: {
    unexpected: '예기치 않은 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    validCredentials: '유효한 이메일과 비밀번호를 입력해 주세요',
    invalidCredentials: '이메일 또는 비밀번호가 올바르지 않습니다',
    loginFailed:
      '이메일과 비밀번호로 로그인하지 못했습니다. 다시 시도해 주세요.',
    passwordNotAllowed: '팀 관리자가 비밀번호 인증을 허용하지 않았습니다.',
    teamExists: '이미 존재하는 팀입니다. 로그인해 주세요.',
    unknown: '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    invalidPassword: '비밀번호가 올바르지 않습니다',
  },
} satisfies DeepPartial<typeof englishAuth>;
