import type { ObjectId } from '@/models';
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

export async function deleteTeamMember(
  teamId: string | ObjectId,
  userIdToDelete: string,
) {
  const deletedUser = await User.findOneAndDelete({
    team: teamId,
    _id: userIdToDelete,
  });

  return deletedUser;
}
