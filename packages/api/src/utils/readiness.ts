import mongoose from 'mongoose';

import { mongooseConnection } from '@/models';

/**
 * Readiness helpers shared by the API and OpAMP servers.
 *
 * Both servers expose:
 *   - `/health`: pure liveness — 200 whenever the process can serve HTTP.
 *     Orchestrators restart on liveness failures, and restarting does not fix
 *     a dependency outage, so `/health` deliberately checks nothing external.
 *   - `/ready`: readiness — 503 unless MongoDB is connected, since almost
 *     every request (including OpAMP config handling) is Mongo-backed.
 *     Kubernetes readiness failures take the pod out of Service endpoints
 *     without restarting it (https://github.com/hyperdxio/hyperdx/issues/2966).
 */
export const isMongoConnected = () =>
  mongooseConnection.readyState === mongoose.ConnectionStates.connected;

export const mongoReadyStateName = () =>
  mongoose.STATES[mongooseConnection.readyState] ??
  String(mongooseConnection.readyState);
