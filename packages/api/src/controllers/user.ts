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

// Idempotent: $addToSet means completing an already-completed task is a no-op,
// so the frontend can fire optimistically without guarding against duplicates.
// taskId is typed OnboardingTaskId so call sites can't pass an unknown key.
export function completeOnboardingTask(
  userId: string | ObjectId,
  taskId: OnboardingTaskId,
) {
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
  return User.findByIdAndUpdate(
    userId,
    { $set: { 'onboardingData.isDismissed': isDismissed } },
    { new: true },
  );
}

// Fire-and-forget wrapper for recording a product-usage task from an unrelated
// write path (creating an alert, saving a dashboard, an MCP tool call).
// Onboarding bookkeeping must never fail or delay the operation that triggered
// it, so errors are swallowed after logging. No-op when userId is absent (e.g.
// a tile alert upserted without an owning user).
//
// Unlike completeOnboardingTask (which the /me/onboarding/task route calls and
// whose returned doc seeds the client cache), this path ignores the result, so
// it guards on $ne to skip the DB write entirely once the task is recorded.
// These call sites fire on every save / every MCP tool call, so skipping the
// redundant $addToSet avoids write amplification on hot paths.
export function recordOnboardingTaskCompletion(
  userId: string | ObjectId | undefined | null,
  taskId: OnboardingTaskId,
) {
  if (userId == null) {
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
