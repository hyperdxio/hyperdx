import Favorite, { IFavorite } from '@/models/favorite';

export function getFavorites(userId: string, teamId: string) {
  return Favorite.find({ user: userId, team: teamId });
}

export function addFavorite(
  userId: string,
  teamId: string,
  resourceType: IFavorite['resourceType'],
  resourceId: string,
) {
  return Favorite.findOneAndUpdate(
    { user: userId, team: teamId, resourceType, resourceId },
    { user: userId, team: teamId, resourceType, resourceId },
    { upsert: true, new: true },
  );
}

export function removeFavorite(
  userId: string,
  teamId: string,
  resourceType: IFavorite['resourceType'],
  resourceId: string,
) {
  return Favorite.deleteOne({
    user: userId,
    team: teamId,
    resourceType,
    resourceId,
  });
}
