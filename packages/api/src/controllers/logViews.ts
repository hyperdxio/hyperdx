import type { ObjectId } from '@/models';
import LogView, { ILogView } from '@/models/logView';
import Alert from '@/models/alert';

export type LogViewInput = Omit<ILogView, '_id' | 'creator'>;

const makeLogView = (logView: LogViewInput, team: ObjectId): LogViewInput => {
  return {
    name: logView.name,
    query: logView.query,
    team: team,
  };
};

export const createLogView = async (
  userId: ObjectId,
  teamId: ObjectId,
  logView: LogViewInput,
) => {
  return new LogView({
    ...makeLogView(logView, teamId),
    creator: userId,
    team: teamId,
  }).save();
};

export const updateLogView = async (
  id: string,
  teamId: ObjectId,
  logViewInput: LogViewInput,
) => {
  const logView = await LogView.findOne({ _id: id, team: teamId });
  await logView?.updateOne(makeLogView(logViewInput, teamId));
  return LogView.findOne({ _id: id, team: teamId });
};

export const getLogView = async (id: string, teamId: ObjectId) => {
  return LogView.findOne({ _id: id, team: teamId });
};

export const getAllLogViews = async (teamId: ObjectId) => {
  return LogView.find({ team: teamId });
};

export const deleteLogView = async (id: string, teamId: ObjectId) => {
  const logView = await LogView.findOne({ _id: id, team: teamId });
  if (logView === null) {
    return null;
  }
  await Alert.deleteMany({ logView: id });
  const result = await logView.remove();
  return logView;
};
