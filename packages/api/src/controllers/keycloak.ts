import mongoose from 'mongoose';
import ms from 'ms';
import type { IDToken } from 'openid-client';

import { findUserByEmail } from '@/controllers/user';
import Team from '@/models/team';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';
import { setBusinessContext } from '@/utils/instrumentation';

export async function resolveKeycloakUser(
  claims: IDToken,
  inviteToken?: string,
) {
  // Wait for the unique identity index before accepting concurrent first logins.
  await User.init();
  const identity = { issuer: claims.iss, subject: claims.sub };
  const filter = {
    'keycloak.issuer': identity.issuer,
    'keycloak.subject': identity.subject,
  };
  const existing = await User.findOne(filter);
  if (existing) {
    return existing.team && (await Team.exists({ _id: existing.team }))
      ? existing
      : null;
  }
  if (
    !inviteToken ||
    claims.email_verified !== true ||
    typeof claims.email !== 'string'
  ) {
    return null;
  }

  const email = claims.email.toLowerCase();
  const invitation = await TeamInvite.findOne({
    token: inviteToken,
    email,
    createdAt: { $gt: new Date(Date.now() - ms('30d')) },
  });
  if (
    !invitation ||
    !(await Team.exists({ _id: invitation.teamId })) ||
    (await findUserByEmail(email))
  )
    return null;

  setBusinessContext({ teamId: invitation.teamId.toString(), email });
  try {
    const user = await User.create({
      email,
      name: email,
      team: invitation.teamId,
      keycloak: identity,
    });
    await TeamInvite.deleteOne({ _id: invitation._id });
    return user;
  } catch (error) {
    if (
      error instanceof mongoose.mongo.MongoServerError &&
      error.code === 11000
    ) {
      // Only a concurrent creation of this identity in the invited team can win.
      return User.findOne({ ...filter, team: invitation.teamId });
    }
    throw error;
  }
}
