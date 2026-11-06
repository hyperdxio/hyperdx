'use strict';

// Pure decision logic for approve-kodiak-update-runs.js, split out so it can
// be unit-tested without GitHub API machinery.

const KODIAK_LOGIN = 'kodiakhq[bot]';
const AUTOMERGE_LABEL = 'automerge';
const WRITE_PERMISSIONS = new Set(['admin', 'write']);

// Latest decisive review per reviewer. COMMENTED does not replace an earlier
// approval, matching how GitHub computes review state; DISMISSED does.
function latestReviewStates(reviews) {
  const states = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || review.state === 'COMMENTED' || review.state === 'PENDING')
      continue;
    states.set(login, review.state);
  }
  return states;
}

/**
 * Decide whether the runs held on a Kodiak branch update can be approved.
 *
 * The contributor's code was already reviewed and its runs approved by a
 * maintainer; a Kodiak update only merges `main` into it. So approval is safe
 * when the new head is exactly that merge and nothing else.
 *
 * @returns {{ approve: boolean, reason: string }}
 */
function decideApproval({
  sender,
  pr,
  before,
  after,
  headCommit,
  mergeParentOnMain,
  reviews,
  reviewerPermissions,
  beforeRuns,
}) {
  const no = reason => ({ approve: false, reason });

  if (sender !== KODIAK_LOGIN)
    return no(`push was by ${sender}, not ${KODIAK_LOGIN}`);
  if (pr.head.repo?.full_name === pr.base.repo.full_name) {
    return no('PR is not from a fork, so its runs are not held');
  }
  if (!pr.labels.some(l => l.name === AUTOMERGE_LABEL)) {
    return no(`PR does not have the ${AUTOMERGE_LABEL} label`);
  }
  if (pr.head.sha !== after)
    return no(`PR head moved past ${after} to ${pr.head.sha}`);

  if (headCommit.sha !== after)
    return no(`commit ${headCommit.sha} is not the pushed head ${after}`);
  const parents = headCommit.parents.map(p => p.sha);
  if (parents.length !== 2) return no(`head ${after} is not a merge commit`);
  if (parents[0] !== before) {
    return no(
      `head ${after} first parent ${parents[0]} is not the previous head ${before}`,
    );
  }
  if (!mergeParentOnMain)
    return no(`merged-in parent ${parents[1]} is not on the base branch`);

  const states = latestReviewStates(reviews);
  const writer = login => WRITE_PERMISSIONS.has(reviewerPermissions[login]);
  const blocking = [...states].filter(
    ([login, s]) => s === 'CHANGES_REQUESTED' && writer(login),
  );
  if (blocking.length > 0)
    return no(`changes requested by ${blocking.map(([l]) => l).join(', ')}`);
  if (![...states].some(([login, s]) => s === 'APPROVED' && writer(login))) {
    return no('no approving review from someone with write access');
  }

  // The previous head is the code a maintainer let run. If its runs are still
  // held (or never existed), nobody has vouched for running it.
  if (beforeRuns.length === 0)
    return no(`no pull_request runs found for previous head ${before}`);
  if (beforeRuns.some(r => r.conclusion === 'action_required')) {
    return no(`runs for previous head ${before} were never approved`);
  }

  return {
    approve: true,
    reason: `Kodiak merged the base branch into approved head ${before}`,
  };
}

module.exports = {
  KODIAK_LOGIN,
  AUTOMERGE_LABEL,
  latestReviewStates,
  decideApproval,
};
