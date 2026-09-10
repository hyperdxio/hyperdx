import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import User from '@/models/user';
import logger from '@/utils/logger';
export function findUserByAccessKey(accessKey: string) {
  return User.findOne({ accessKey });
}

/**
 * Rotates a user's personal access key, immediately revoking the previous one.
 *
 * There is exactly one key per user and no grace period: findUserByAccessKey
 * above is hit uncached on every bearer request (see validateUserAccessKey), so
 * requests presenting the old key start 401ing the instant this returns.
 */
export function rotateUserAccessKey(userId: string | ObjectId) {
  return User.findByIdAndUpdate(userId, { accessKey: uuidv4() }, { new: true });
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

// Rejects the synthetic `_local_user_` id injected in IS_LOCAL_APP_MODE, which
// mongoose casts to an ObjectId matching no document (and which
// mongoose.isValidObjectId() wrongly accepts, so it can't be the guard).
function isPersistableUserId(
  userId: string | ObjectId | undefined | null,
): userId is string | ObjectId {
  return userId != null && /^[0-9a-fA-F]{24}$/.test(String(userId));
}

// Returns null for a non-persistable user so the route reports unchanged
// default state rather than a write that silently matched nothing.
export function completeOnboardingTask(
  userId: string | ObjectId,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  return User.findByIdAndUpdate(
    userId,
    { $addToSet: { 'onboardingData.completedTasks': taskId } },
    { new: true },
  );
}

export function setOnboardingDismissed(
  userId: string | ObjectId,
  isDismissed: boolean,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  return User.findByIdAndUpdate(
    userId,
    { $set: { 'onboardingData.isDismissed': isDismissed } },
    { new: true },
  );
}

// Fire-and-forget recording from an unrelated write path (alert/dashboard save,
// MCP tool call): must never fail or delay the triggering operation, so errors
// are swallowed. The $ne skips the write once already recorded — these fire on
// every save / tool call, so it avoids write amplification on hot paths.
export function recordOnboardingTaskCompletion(
  userId: string | ObjectId | undefined | null,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return;
  }
  void User.updateOne(
    { _id: userId, 'onboardingData.completedTasks': { $ne: taskId } },
    { $addToSet: { 'onboardingData.completedTasks': taskId } },
  ).catch(err => {
    logger.warn(
      { error: err, userId: userId.toString(), taskId },
      'Failed to record onboarding task completion',
    );
  });
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
