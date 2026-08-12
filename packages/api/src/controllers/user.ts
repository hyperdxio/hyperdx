import type { UserLabs } from '@hyperdx/common-utils/dist/types';
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
  // Case-insensitive email search - lowercase the email since User model stores emails in lowercase
  return User.findOne({ email: email.toLowerCase() });
}

export function findUsersByTeam(team: string | ObjectId) {
  return User.find({ team }).sort({ createdAt: 1 });
}

/**
 * Replaces a user's lab opt-ins wholesale.
 *
 * Whole-object `$set`, deliberately not `$set: { ['labs.' + id]: value }`: a
 * dotted path is the one place a client-supplied key stops being update *data*
 * and becomes part of the update *instruction*. Keeping keys in value position
 * removes that class of bug outright, which is what lets LabIdSchema's key
 * regex be defense-in-depth rather than the only defense.
 *
 * There is nothing to read first because the semantics are full-replace: the
 * read-modify-write happens on the client, which is the only place that knows
 * the current lab registry and therefore the only place that can prune the ids
 * of retired labs. See agent_docs/labs.md.
 */
export function setUserLabs(userId: ObjectId, labs: UserLabs) {
  return User.findByIdAndUpdate(
    userId,
    { $set: { labs } },
    { new: true, projection: { labs: 1 } },
  );
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
