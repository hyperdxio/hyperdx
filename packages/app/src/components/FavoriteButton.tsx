import { ActionIcon, Tooltip } from '@mantine/core';
import { IconStar, IconStarFilled } from '@tabler/icons-react';

import { type Favorite, useToggleFavorite } from '@/favorites';

export function FavoriteButton({
  resourceType,
  resourceId,
  size = 'sm',
}: {
  resourceType: Favorite['resourceType'];
  resourceId: string;
  size?: 'sm' | 'xs';
}) {
  const { isFavorited, toggleFavorite } = useToggleFavorite(
    resourceType,
    resourceId,
  );

  const iconSize = size === 'sm' ? 16 : 14;

  return (
    <Tooltip label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}>
      <ActionIcon
        variant="subtle"
        size={size}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite();
        }}
        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        data-testid="favorite-button"
      >
        {isFavorited ? (
          <IconStarFilled
            size={iconSize}
            color="var(--mantine-color-yellow-5)"
          />
        ) : (
          <IconStar size={iconSize} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
