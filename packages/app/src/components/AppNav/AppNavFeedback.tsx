import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import HyperDX from '@hyperdx/browser';
import {
  ActionIcon,
  Button,
  Group,
  Popover,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconMessageHeart,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from '@tabler/icons-react';

import { AppNavContext } from './AppNav.components';

import styles from './AppNav.module.scss';

type FeedbackVote = 'up' | 'down' | null;

type FeedbackState = 'vote' | 'comment' | 'thanks';

export const AppNavFeedback = () => {
  const { isCollapsed } = React.useContext(AppNavContext);
  const [opened, { close, toggle }] = useDisclosure(false);
  const [vote, setVote] = useState<FeedbackVote>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<FeedbackState>('vote');
  const router = useRouter();

  const reset = useCallback(() => {
    setVote(null);
    setComment('');
    setState('vote');
  }, []);

  const handleClose = useCallback(() => {
    close();
    setTimeout(reset, 200);
  }, [close, reset]);

  const handleVote = useCallback(
    (newVote: FeedbackVote) => {
      setVote(newVote);
      setState('comment');
    },
    [setVote, setState],
  );

  const handleSubmit = useCallback(() => {
    HyperDX.addAction('user feedback submitted', {
      vote: vote ?? '',
      comment,
      page: router.pathname,
      route: router.asPath,
      query: JSON.stringify(router.query),
    });

    setState('thanks');
    setTimeout(handleClose, 1500);
  }, [vote, comment, router, handleClose]);

  return (
    <Popover
      opened={opened}
      onClose={handleClose}
      position="right-start"
      shadow="md"
      width={280}
    >
      <Popover.Target>
        <Tooltip label="Feedback" position="right" disabled={!isCollapsed}>
          <UnstyledButton
            data-testid="feedback-trigger"
            className={styles.navItem}
            onClick={toggle}
          >
            <span className={styles.navItemContent}>
              <span className={styles.navItemIcon}>
                <IconMessageHeart size={16} />
              </span>
              {!isCollapsed && <span>Feedback</span>}
            </span>
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        {state === 'vote' && (
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              How&apos;s your experience?
            </Text>
            <Group gap="xs" justify="center">
              <ActionIcon
                data-testid="feedback-thumbs-up"
                variant="subtle"
                size="xl"
                onClick={() => handleVote('up')}
                title="Thumbs up"
              >
                {vote === 'up' ? (
                  <IconThumbUpFilled size={24} />
                ) : (
                  <IconThumbUp size={24} />
                )}
              </ActionIcon>
              <ActionIcon
                data-testid="feedback-thumbs-down"
                variant="subtle"
                size="xl"
                onClick={() => handleVote('down')}
                title="Thumbs down"
              >
                {vote === 'down' ? (
                  <IconThumbDownFilled size={24} />
                ) : (
                  <IconThumbDown size={24} />
                )}
              </ActionIcon>
            </Group>
          </Stack>
        )}
        {state === 'comment' && (
          <Stack gap="sm">
            <Group gap="xs" justify="center">
              <ActionIcon
                data-testid="feedback-thumbs-up"
                variant="subtle"
                size="lg"
                onClick={() => handleVote('up')}
                title="Thumbs up"
              >
                {vote === 'up' ? (
                  <IconThumbUpFilled size={20} />
                ) : (
                  <IconThumbUp size={20} />
                )}
              </ActionIcon>
              <ActionIcon
                data-testid="feedback-thumbs-down"
                variant="subtle"
                size="lg"
                onClick={() => handleVote('down')}
                title="Thumbs down"
              >
                {vote === 'down' ? (
                  <IconThumbDownFilled size={20} />
                ) : (
                  <IconThumbDown size={20} />
                )}
              </ActionIcon>
            </Group>
            <Textarea
              data-testid="feedback-comment"
              placeholder="Tell us more (optional)"
              value={comment}
              onChange={e => setComment(e.currentTarget.value)}
              minRows={2}
              maxRows={4}
              autosize
              autoFocus
            />
            <Button
              data-testid="feedback-submit"
              variant="primary"
              size="xs"
              fullWidth
              onClick={handleSubmit}
            >
              Submit Feedback
            </Button>
          </Stack>
        )}
        {state === 'thanks' && (
          <Text size="sm" ta="center" py="sm" data-testid="feedback-thanks">
            Thanks for your feedback!
          </Text>
        )}
      </Popover.Dropdown>
    </Popover>
  );
};
