import {
  IS_EXPRESS_SESSION_SECRET_GENERATED,
  IS_LOCAL_APP_MODE,
} from '@/config';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const generatedSecretCounter = getCounter('hyperdx.session_secret.generated', {
  description:
    'API processes using a generated session secret with authentication enabled.',
});

let reported = false;

export function verifySessionSecret(): void {
  if (reported || IS_LOCAL_APP_MODE || !IS_EXPRESS_SESSION_SECRET_GENERATED)
    return;
  reported = true;
  generatedSecretCounter.add(1);
  logger.error(
    'EXPRESS_SESSION_SECRET is missing or uses the public legacy value: generated a random secret for this process. Users are signed out whenever it restarts, and replicas do not share sessions. Configure a random secret shared by all replicas to keep sessions.',
  );
}
