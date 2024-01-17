import type { ObjectId } from '@/models';
import AlertChannel, {
  AlertChannelPriority,
  AlertChannelType,
  IAlertChannel,
} from '@/models/alertChannel';

export type AlertChannelInput = Omit<IAlertChannel, '_id' | 'teamId'>;

const makeAlertChannel = (alertChannel: AlertChannelInput) => {
  return {
    ...alertChannel,
    priority: alertChannel.priority || 'P3',
  };
};

export const createAlert = async (
  teamId: ObjectId,
  alertInput: AlertChannelInput,
) => {
  return new AlertChannel({
    ...makeAlertChannel(alertInput),
    team: teamId,
  }).save();
};

// create an update alert function based off of the above create alert function
export const updateAlert = async (
  id: string,
  teamId: ObjectId,
  alertChannelInput: AlertChannelInput,
) => {
  return AlertChannel.findOneAndUpdate(
    { id, teamId },
    makeAlertChannel(alertChannelInput),
    {
      returnDocument: 'after',
    },
  );
};
