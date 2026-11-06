'use strict';

// Entry point for actions/github-script. Approves the `pull_request` runs that
// GitHub holds for first-time fork contributors after Kodiak merges `main`
// into an already-approved PR. Decision logic lives in kodiak-run-approval.js.

const { decideApproval } = require('./kodiak-run-approval');

// Held runs are created alongside this pull_request_target run, so they may
// not be listable yet when it starts.
const POLL_ATTEMPTS = 9;
const POLL_INTERVAL_MS = 10_000;
// Once something has been approved, stop after this many polls find nothing new.
const QUIET_POLLS_TO_STOP = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const { pull_request: eventPr, before, after, sender } = context.payload;

  const listRuns = head_sha =>
    github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      owner,
      repo,
      head_sha,
      event: 'pull_request',
      per_page: 100,
    });

  const { data: pr } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: eventPr.number,
  });
  const { data: headCommit } = await github.rest.repos.getCommit({
    owner,
    repo,
    ref: after,
  });

  let mergeParentOnMain = false;
  const mergedIn = headCommit.parents[1]?.sha;
  if (mergedIn) {
    const { data: cmp } = await github.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${mergedIn}...${pr.base.ref}`,
      per_page: 1,
    });
    mergeParentOnMain = cmp.status === 'identical' || cmp.status === 'ahead';
  }

  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const reviewerPermissions = {};
  for (const login of new Set(
    reviews.map(r => r.user?.login).filter(Boolean),
  )) {
    try {
      const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: login,
      });
      reviewerPermissions[login] = data.permission;
    } catch (err) {
      if (err.status !== 404) throw err;
      reviewerPermissions[login] = 'none';
    }
  }

  const decision = decideApproval({
    sender: sender.login,
    pr,
    before,
    after,
    headCommit,
    mergeParentOnMain,
    reviews,
    reviewerPermissions,
    beforeRuns: await listRuns(before),
  });
  core.info(decision.reason);
  if (!decision.approve) return;

  const approved = new Set();
  let quietPolls = 0;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const held = (await listRuns(after)).filter(
      r => r.conclusion === 'action_required' && !approved.has(r.id),
    );
    for (const run of held) {
      await github.rest.actions.approveWorkflowRun({
        owner,
        repo,
        run_id: run.id,
      });
      approved.add(run.id);
      core.info(`Approved "${run.name}" (${run.html_url})`);
    }
    if (
      held.length === 0 &&
      approved.size > 0 &&
      ++quietPolls >= QUIET_POLLS_TO_STOP
    )
      break;
    if (held.length > 0) quietPolls = 0;
    if (attempt < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }

  if (approved.size === 0) core.info(`No held runs found for ${after}`);
  await core.summary
    .addRaw(
      `Approved ${approved.size} held run(s) for #${pr.number} at ${after}: ${decision.reason}.`,
    )
    .write();
};
