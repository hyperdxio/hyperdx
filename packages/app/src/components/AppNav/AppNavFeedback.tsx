import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import HyperDX from '@hyperdx/browser';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from '@tabler/icons-react';

import { AppNavContext } from './AppNav.components';

import styles from './AppNav.module.scss';

type FeedbackVote = 'up' | 'down' | null;

type FeedbackState = 'idle' | 'voted' | 'thanks';

export const AppNavFeedback = () => {
  const { isCollapsed } = React.useContext(AppNavContext);
  const [hidden, setHidden] = useLocalStorage<boolean>({
    key: 'feedbackHidden',
    defaultValue: false,
  });
  const [vote, setVote] = useState<FeedbackVote>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<FeedbackState>('idle');
  const router = useRouter();

  const reset = useCallback(() => {
    setVote(null);
    setComment('');
    setState('idle');
  }, []);

  const handleVote = useCallback(
    (newVote: FeedbackVote) => {
      setVote(newVote);
      setState('voted');
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
    setTimeout(() => {
      reset();
      setHidden(true);
    }, 1500);
  }, [vote, comment, router, reset, setHidden]);

  if (hidden) return null;

  if (isCollapsed) {
    return (
      <Tooltip label="Feedback" position="right">
        <Group
          data-testid="feedback-inline"
          gap={0}
          justify="center"
          py={4}
          wrap="nowrap"
        >
          <ActionIcon
            data-testid="feedback-thumbs-up"
            variant="subtle"
            size="sm"
            onClick={() => {
              handleVote('up');
              HyperDX.addAction('user feedback submitted', {
                vote: 'up',
                comment: '',
                page: router.pathname,
                route: router.asPath,
                query: JSON.stringify(router.query),
              });
            }}
            title="Thumbs up"
          >
            <IconThumbUp size={14} />
          </ActionIcon>
          <ActionIcon
            data-testid="feedback-thumbs-down"
            variant="subtle"
            size="sm"
            onClick={() => {
              handleVote('down');
              HyperDX.addAction('user feedback submitted', {
                vote: 'down',
                comment: '',
                page: router.pathname,
                route: router.asPath,
                query: JSON.stringify(router.query),
              });
            }}
            title="Thumbs down"
          >
            <IconThumbDown size={14} />
          </ActionIcon>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Box data-testid="feedback-inline" px="lg" py={4}>
      {state === 'thanks' ? (
        <Text
          size="xs"
          c="dimmed"
          data-testid="feedback-thanks"
          className={styles.feedbackLabel}
        >
          Thanks for your feedback!
        </Text>
      ) : (
        <>
          <Group gap={6} wrap="nowrap" align="center">
            <ActionIcon
              data-testid="feedback-thumbs-up"
              variant={vote === 'up' ? 'secondary' : 'subtle'}
              size="sm"
              onClick={() => handleVote('up')}
              title="Thumbs up"
            >
              {vote === 'up' ? (
                <IconThumbUpFilled size={14} />
              ) : (
                <IconThumbUp size={14} />
              )}
            </ActionIcon>
            <ActionIcon
              data-testid="feedback-thumbs-down"
              variant={vote === 'down' ? 'secondary' : 'subtle'}
              size="sm"
              onClick={() => handleVote('down')}
              title="Thumbs down"
            >
              {vote === 'down' ? (
                <IconThumbDownFilled size={14} />
              ) : (
                <IconThumbDown size={14} />
              )}
            </ActionIcon>
            <Text
              size="xs"
              c="dimmed"
              className={styles.feedbackLabel}
              style={{ flex: 1 }}
            >
              How&apos;s your experience?
            </Text>
            <Text
              data-testid="feedback-hide"
              size="xs"
              c="dimmed"
              className={styles.feedbackHide}
              onClick={() => setHidden(true)}
              role="button"
              tabIndex={0}
            >
              Hide
            </Text>
          </Group>
          {state === 'voted' && (
            <Box pt={6}>
              <Textarea
                data-testid="feedback-comment"
                placeholder="Tell us more (optional)"
                value={comment}
                onChange={e => setComment(e.currentTarget.value)}
                minRows={2}
                maxRows={4}
                autosize
                autoFocus
                size="xs"
              />
              <Button
                data-testid="feedback-submit"
                variant="primary"
                size="compact-xs"
                fullWidth
                mt={6}
                onClick={handleSubmit}
              >
                Submit
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};
