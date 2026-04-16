'use strict';

// Entry point for actions/github-script@v7 via script-path.
// Pure classification logic lives in pr-triage-classify.js so it can be
// unit-tested without GitHub API machinery.

const {
  TIER_LABELS,
  computeSignals, determineTier, buildTierComment,
} = require('./pr-triage-classify');

module.exports = async ({ github, context }) => {
  const owner = context.repo.owner;
  const repo  = context.repo.repo;

  // ── Determine which PRs to process ──────────────────────────────────────
  let prNumbers;
  if (context.eventName === 'workflow_dispatch') {
    // Use context.payload.inputs to avoid script-injection via template interpolation
    const input = (context.payload.inputs?.pr_number ?? '').trim();
    if (input !== '') {
      prNumbers = [Number(input)];
    } else {
      const openPRs = await github.paginate(
        github.rest.pulls.list,
        { owner, repo, state: 'open', per_page: 100 }
      );
      prNumbers = openPRs.map(pr => pr.number);
      console.log(`Bulk triage: found ${prNumbers.length} open PRs`);
    }
  } else {
    prNumbers = [context.payload.pull_request.number];
  }

  // ── Ensure tier labels exist (once, before the loop) ────────────────────
  const repoLabels = await github.paginate(
    github.rest.issues.listLabelsForRepo,
    { owner, repo, per_page: 100 }
  );
  const repoLabelNames = new Set(repoLabels.map(l => l.name));
  for (const label of Object.values(TIER_LABELS)) {
    if (!repoLabelNames.has(label.name)) {
      await github.rest.issues.createLabel({ owner, repo, ...label });
      repoLabelNames.add(label.name);
    }
  }

  // ── Classify a single PR ─────────────────────────────────────────────────
  async function classifyPR(prNumber) {
    const filesRes = await github.paginate(
      github.rest.pulls.listFiles,
      { owner, repo, pull_number: prNumber, per_page: 100 }
    );
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
    const { data: currentLabels } = await github.rest.issues.listLabelsOnIssue({ owner, repo, issue_number: prNumber });
    const currentLabelNames = new Set(currentLabels.map(l => l.name));

    // Skip drafts (bulk mode; PR events already filter these via the job condition)
    if (pr.draft) {
      console.log(`PR #${prNumber}: skipping draft`);
      return;
    }

    // Respect manual tier overrides — don't overwrite labels applied by humans
    const existingTierLabel = currentLabels.find(l => l.name.startsWith('review/tier-'));
    if (existingTierLabel) {
      const events = await github.paginate(
        github.rest.issues.listEvents,
        { owner, repo, issue_number: prNumber, per_page: 100 }
      );
      const lastLabelEvent = events
        .filter(e => e.event === 'labeled' && e.label?.name === existingTierLabel.name)
        .pop();
      if (lastLabelEvent && lastLabelEvent.actor.type !== 'Bot') {
        console.log(`PR #${prNumber}: tier manually set to ${existingTierLabel.name} by ${lastLabelEvent.actor.login} — skipping`);
        return;
      }
    }

    const signals = computeSignals(pr, filesRes);
    const tier    = determineTier(signals);
    const body    = buildTierComment(tier, signals);

    // Apply the tier label (remove any stale tier label first)
    for (const label of currentLabels) {
      if (label.name.startsWith('review/tier-') && label.name !== TIER_LABELS[tier].name) {
        await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name: label.name });
      }
    }
    if (!currentLabelNames.has(TIER_LABELS[tier].name)) {
      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [TIER_LABELS[tier].name] });
    }

    // Post or update the triage comment
    const comments = await github.paginate(
      github.rest.issues.listComments,
      { owner, repo, issue_number: prNumber, per_page: 100 }
    );
    const existingComment = comments.find(
      c => c.user.login === 'github-actions[bot]' && c.body.includes('<!-- pr-triage -->')
    );
    if (existingComment) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existingComment.id, body });
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    }

    console.log(`PR #${prNumber}: Tier ${tier} (${signals.prodLines} prod lines, ${signals.prodFiles.length} prod files, ${signals.testLines} test lines)`);
  }

  // ── Process all target PRs ───────────────────────────────────────────────
  for (const prNumber of prNumbers) {
    try {
      await classifyPR(prNumber);
    } catch (err) {
      console.error(`PR #${prNumber}: classification failed — ${err.message}`);
    }
  }
};
