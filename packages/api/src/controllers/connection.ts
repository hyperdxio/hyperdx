import Connection, { IConnection } from '@/models/connection';

export function getConnections() {
  // Never return password back to the user
  // Return all connections in current tenant
  return Connection.find({});
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

export async function updateConnection(
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

  await Connection.updateOne({ _id: connectionId, team }, updateOperation);
  return Connection.findOne({ _id: connectionId, team });
}

export async function deleteConnection(team: string, connectionId: string) {
  const doc = await Connection.findOne({ _id: connectionId, team });
  if (doc) {
    await Connection.deleteOne({ _id: connectionId, team });
  }
  return doc;
}
