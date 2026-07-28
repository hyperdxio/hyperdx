import { alerts } from './alerts';
import { auth } from './auth';
import { charts } from './charts';
import { common } from './common';
import { dashboard } from './dashboard';
import { dashboards } from './dashboards';
import { infrastructure } from './infrastructure';
import { marketing } from './marketing';
import { navigation } from './navigation';
import { onboarding } from './onboarding';
import { search } from './search';
import { services } from './services';
import { sessions } from './sessions';
import { settings } from './settings';
import { sources } from './sources';

export const enResources = {
  alerts,
  auth,
  charts,
  common,
  dashboard,
  dashboards,
  infrastructure,
  marketing,
  navigation,
  onboarding,
  search,
  services,
  sessions,
  settings,
  sources,
} as const;
