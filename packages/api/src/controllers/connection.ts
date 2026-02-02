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
