import type { ObjectId } from '@/models';
import Connection, { IConnection } from '@/models/connection';
import { objectIdSchema } from '@/utils/zod';

export type ConnectionValidation =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string };

export async function validateConnectionId(
  connection: unknown,
  teamId: string | ObjectId | undefined,
): Promise<ConnectionValidation> {
  const parsed = objectIdSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be a valid connection id',
    };
  }
  if (teamId == null) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  const connectionExists = await Connection.exists({
    _id: parsed.data,
    team: teamId,
  });
  if (connectionExists == null) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be an existing connection id',
    };
  }
  return { ok: true };
}

// Returns all connections across all teams. Only intended for instance-level
// operations (e.g. startup auto-provisioning); user-facing routes must use
// the team-scoped variants below.
export function getConnections() {
  // Never return password back to the user
  return Connection.find({});
}

export function getConnectionsByTeam(team: string) {
  return Connection.find({ team });
}

export function getConnectionById(
  team: string,
  connectionId: string,
  selectPassword = false,
) {
  return Connection.findOne({ _id: connectionId, team }).select(
    selectPassword ? '+password' : '',
  );
}

export function createConnection(
  team: string,
  connection: Omit<IConnection, 'id' | '_id'>,
) {
  return Connection.create({ ...connection, team });
}

export function updateConnection(
  team: string,
  connectionId: string,
  connection: Omit<IConnection, 'id' | '_id'>,
  unsetFields: string[] = [],
) {
  const updateOperation: Record<string, unknown> = { $set: connection };

  if (unsetFields.length > 0) {
    updateOperation.$unset = unsetFields.reduce(
      (acc, field) => {
        acc[field] = '';
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  return Connection.findOneAndUpdate(
    { _id: connectionId, team },
    updateOperation,
    {
      new: true,
    },
  );
}

export function deleteConnection(team: string, connectionId: string) {
  return Connection.findOneAndDelete({ _id: connectionId, team });
}
