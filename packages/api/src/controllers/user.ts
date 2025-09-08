import mongoose from 'mongoose';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import User from '@/models/user';
export function findUserByAccessKey(accessKey: string) {
  return User.findOne({ accessKey });
}

export function findUserById(id: string) {
  return User.findById(id);
}

export function findUserByEmail(email: string) {
  return User.findOne({ email });
}

export async function findUserByEmailInTeam(
  email: string,
  team: string | ObjectId,
) {
  return User.findOne({ email, team });
}

export function findUsersByTeam(team: string | ObjectId) {
  return User.find({ team }).sort({ createdAt: 1 });
}

export async function deleteTeamMember(
  teamId: string | ObjectId,
  userIdToDelete: string,
  userIdRequestingDelete: string | ObjectId,
) {
  const [, deletedUser] = await Promise.all([
    Alert.updateMany(
      { createdBy: new mongoose.Types.ObjectId(userIdToDelete), team: teamId },
      {
        $set: {
          createdBy: new mongoose.Types.ObjectId(userIdRequestingDelete),
        },
      },
    ),
    User.findOneAndDelete({
      team: teamId,
      _id: userIdToDelete,
    }),
  ]);

  return deletedUser;
}
