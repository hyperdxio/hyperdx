import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import { isPersistableUserId as isPersistableUserIdHex } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import User, { type IUser } from '@/models/user';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';
export const NOT_SERVICE_ACCOUNT = { isServiceAccount: { $ne: true } };

export function findUserByAccessKey(accessKey: string) {
  // Service accounts authenticate only through their hashed org API key.
  return User.findOne({ accessKey, ...NOT_SERVICE_ACCOUNT });
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
  return User.find({ team, ...NOT_SERVICE_ACCOUNT }).sort({ createdAt: 1 });
}

// Type-guard wrapper over the shared 24-hex check; rejects the synthetic
// `_local_user_` id injected in IS_LOCAL_APP_MODE (see isPersistableUserIdHex).
function isPersistableUserId(
  userId: string | ObjectId | undefined | null,
): userId is string | ObjectId {
  return userId != null && isPersistableUserIdHex(String(userId));
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
    {
      _id: userId,
      ...NOT_SERVICE_ACCOUNT,
      'onboardingData.completedTasks': { $ne: taskId },
    },
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
  // Delete first: reassigning alerts for a user that wasn't deleted (such as a
  // service account) would steal their attribution.
  const deletedUser = await User.findOneAndDelete({
    team: teamId,
    _id: userIdToDelete,
    ...NOT_SERVICE_ACCOUNT,
  });
  if (deletedUser == null) {
    return null;
  }
  await Alert.updateMany(
    { createdBy: deletedUser._id, team: teamId },
    {
      $set: { createdBy: new mongoose.Types.ObjectId(userIdRequestingDelete) },
    },
  );
  return deletedUser;
}

/**
 * Member removal by an org API key's service account, which must not leave the
 * team without a person who can sign in. Mongo here has no transactions, so
 * delete first and put the member back if a concurrent removal emptied it.
 */
export async function deleteTeamMemberKeepingOne(
  teamId: string | ObjectId,
  userIdToDelete: string,
  serviceAccountId: ObjectId,
): Promise<'deleted' | 'not_found' | 'last_member'> {
  const deletedUser = await User.findOneAndDelete({
    team: teamId,
    _id: userIdToDelete,
    ...NOT_SERVICE_ACCOUNT,
  })
    .select('+hash +salt')
    .lean();
  if (deletedUser == null) {
    return 'not_found';
  }
  let isTeamEmpty = true;
  try {
    isTeamEmpty =
      (await User.countDocuments({ team: teamId, ...NOT_SERVICE_ACCOUNT })) ===
      0;
  } finally {
    // Also runs if the count throws, so a failed check can't lose the member.
    if (isTeamEmpty) {
      await restoreTeamMember(deletedUser);
    }
  }
  if (isTeamEmpty) {
    return 'last_member';
  }
  await Alert.updateMany(
    { createdBy: deletedUser._id, team: teamId },
    { $set: { createdBy: serviceAccountId } },
  );
  return 'deleted';
}

const memberRestoreFailures = getCounter(
  'hyperdx.team.member_restore_failures',
  {
    description:
      'Members deleted by an org API key that could not be put back.',
  },
);

async function restoreTeamMember(user: IUser) {
  try {
    await User.collection.insertOne(user);
  } catch (err) {
    memberRestoreFailures.add(1);
    logger.error(
      { error: err, userId: user._id.toString(), teamId: user.team.toString() },
      'Failed to restore team member removed by an org API key',
    );
    throw err;
  }
}
