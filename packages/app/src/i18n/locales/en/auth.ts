export const auth = {
  header: {
    cloud: '{{brandName}} Cloud',
    docs: 'Docs',
    login: 'Login',
    setupAccount: 'Setup Account',
    goToSearch: 'Go to Search',
  },
  passwordCheck: {
    minLength: 'minimum 12 characters',
    uppercase: 'at least 1 uppercase',
    lowercase: 'at least 1 lowercase',
    number: 'at least 1 number',
    special: 'at least 1 special character',
  },
  common: {
    email: 'Email',
    emailPlaceholder: 'you@company.com',
    password: 'Password',
    confirmPassword: 'Confirm Password',
  },
  login: {
    browserTitle: '{{brandName}} - Login',
    title: 'Welcome back!',
    heading: 'Login to <brand>{{brandName}}</brand>',
    submit: 'Login',
    registrationPrompt:
      "Don't have an account yet? <register>Register</register> instead.",
  },
  register: {
    browserTitle: '{{brandName}} - Sign up',
    setupHeading: 'Setup <brand>{{brandName}}</brand>',
    heading: 'Register for <brand>{{brandName}}</brand>',
    intro: "Let's create your user account.",
    submit: 'Register',
    create: 'Create',
    verificationSent: 'Sent verification email! Please check your email inbox.',
    loginPrompt: 'Already have an account? <login>Log in</login> instead.',
  },
  joinTeam: {
    browserTitle: 'Join Team - {{brandName}}',
    title: 'Join Team',
    setupPassword: 'Setup a password',
  },
  errors: {
    unexpected: 'An unexpected error occurred, please try again later.',
    validCredentials: 'Please provide a valid email and password',
    invalidCredentials: 'Email or password is invalid',
    loginFailed: 'Failed to login with email and password, please try again.',
    passwordNotAllowed:
      'Password authentication is not allowed by your team admin.',
    teamExists: 'Team already exists, please login instead.',
    unknown: 'Unknown error occurred, please try again later.',
    invalidPassword: 'Password is invalid',
  },
} as const;
