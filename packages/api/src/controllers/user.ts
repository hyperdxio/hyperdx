import type { ObjectId } from '@/models';
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

export const deleteUserByIdAndTeam = async (
  id: string,
  team: string | ObjectId,
) => {
  const user = await User.findOneAndDelete({ _id: id, team }).lean();

  return user;
};

export function findUsersByTeam(team: string | ObjectId) {
  return User.find({ team }).sort({ createdAt: 1 });
}
