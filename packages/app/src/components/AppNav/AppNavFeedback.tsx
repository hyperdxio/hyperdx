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

import { IS_LOCAL_MODE } from '@/config';

import { AppNavContext } from './AppNav.components';

import styles from './AppNav.module.scss';

type FeedbackVote = 'up' | 'down' | null;

type FeedbackState = 'idle' | 'voted' | 'thanks';

const FORCE_ENABLE_KEY = 'hdx-feedback-enabled';

export const AppNavFeedback = () => {
  const { isCollapsed } = React.useContext(AppNavContext);
  const [forceEnabled] = useLocalStorage<boolean>({
    key: FORCE_ENABLE_KEY,
    defaultValue: false,
  });
  const [hidden, setHidden] = useLocalStorage<boolean>({
    key: 'feedbackHidden',
    defaultValue: false,
  });

  const [vote, setVote] = useState<FeedbackVote>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<FeedbackState>('idle');
  const router = useRouter();

  // Only show when HyperDX SDK is active (non-local mode),
  // or when overridden via: localStorage.setItem('hdx-feedback-enabled', 'true')
  const sdkEnabled = !IS_LOCAL_MODE || forceEnabled === true;

  const reset = useCallback(() => {
    setVote(null);
    setComment('');
    setState('idle');
  }, []);

  const pageContext = useCallback(
    () => ({
      page: router.pathname,
      route: router.asPath,
    }),
    [router],
  );

  const handleVote = useCallback(
    (newVote: FeedbackVote) => {
      setVote(newVote);
      setState('voted');
      HyperDX.addAction('user feedback vote', {
        vote: newVote ?? '',
        ...pageContext(),
      });
    },
    [setVote, setState, pageContext],
  );

  const [dismissed, setDismissed] = useState(false);

  const handleSubmit = useCallback(() => {
    HyperDX.addAction('user feedback comment', {
      vote: vote ?? '',
      comment,
      ...pageContext(),
    });

    setState('thanks');
    setTimeout(() => {
      reset();
      setDismissed(true);
    }, 1500);
  }, [vote, comment, pageContext, reset]);

  if (!sdkEnabled || hidden || dismissed) return null;

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
            onClick={() => handleVote('up')}
            title="Thumbs up"
          >
            <IconThumbUp size={14} />
          </ActionIcon>
          <ActionIcon
            data-testid="feedback-thumbs-down"
            variant="subtle"
            size="sm"
            onClick={() => handleVote('down')}
            title="Thumbs down"
          >
            <IconThumbDown size={14} />
          </ActionIcon>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Box data-testid="feedback-inline">
      {state === 'thanks' ? (
        <Text
          size="xs"
          c="dimmed"
          data-testid="feedback-thanks"
          className={styles.feedbackLabel}
          px="lg"
          py={4}
        >
          Thanks for your feedback!
        </Text>
      ) : (
        <>
          <Group
            gap={6}
            wrap="nowrap"
            align="center"
            className={styles.navItem}
          >
            <span className={styles.navItemContent}>
              <span className={styles.navItemIcon}>
                <ActionIcon
                  data-testid="feedback-thumbs-up"
                  variant={vote === 'up' ? 'secondary' : 'subtle'}
                  size="xs"
                  onClick={() => handleVote('up')}
                  title="Thumbs up"
                >
                  {vote === 'up' ? (
                    <IconThumbUpFilled size={14} />
                  ) : (
                    <IconThumbUp size={14} />
                  )}
                </ActionIcon>
              </span>
              <ActionIcon
                data-testid="feedback-thumbs-down"
                variant={vote === 'down' ? 'secondary' : 'subtle'}
                size="xs"
                onClick={() => handleVote('down')}
                title="Thumbs down"
                mr={4}
              >
                {vote === 'down' ? (
                  <IconThumbDownFilled size={14} />
                ) : (
                  <IconThumbDown size={14} />
                )}
              </ActionIcon>
              <Text size="xs" c="dimmed" className={styles.feedbackLabel}>
                Feedback?
              </Text>
            </span>
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
            <Box px="lg" pt={4} pb={2}>
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
