import Connection, { IConnection } from '@/models/connection';

export function getConnections(team: string) {
  // Never return password back to the user
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
  connection: Omit<IConnection, '_id'>,
) {
  return Connection.create({ ...connection, team });
}

export function updateConnection(
  team: string,
  connectionId: string,
  connection: Omit<IConnection, '_id'>,
) {
  return Connection.findOneAndUpdate({ _id: connectionId, team }, connection, {
    new: true,
  });
}

export function deleteConnection(team: string, connectionId: string) {
  return Connection.findOneAndDelete({ _id: connectionId, team });
}
