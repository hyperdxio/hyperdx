'use strict';

// Run with: node --test .github/scripts/__tests__/kodiak-run-approval.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  decideApproval,
  latestReviewStates,
} = require('../kodiak-run-approval');

const BEFORE = 'b'.repeat(40);
const AFTER = 'a'.repeat(40);
const MAIN_SHA = 'c'.repeat(40);

function run(conclusion, actor) {
  return { conclusion, triggering_actor: { login: actor } };
}

function makeInput(overrides = {}) {
  return {
    sender: 'kodiakhq[bot]',
    pr: {
      head: { sha: AFTER, repo: { full_name: 'contributor/hyperdx' } },
      base: { repo: { full_name: 'hyperdxio/hyperdx' } },
      labels: [{ name: 'external' }, { name: 'automerge' }],
    },
    before: BEFORE,
    after: AFTER,
    headCommit: { sha: AFTER, parents: [{ sha: BEFORE }, { sha: MAIN_SHA }] },
    mergeParentOnMain: true,
    reviews: [{ user: { login: 'maintainer' }, state: 'APPROVED' }],
    permissions: { maintainer: 'write' },
    beforeRuns: [
      run('success', 'maintainer'),
      run('failure', 'github-actions[bot]'),
    ],
    ...overrides,
  };
}

describe('decideApproval', () => {
  it('approves a Kodiak merge onto an approved head', () => {
    assert.equal(decideApproval(makeInput()).approve, true);
  });

  const rejected = {
    'push by someone other than Kodiak': { sender: 'contributor' },
    'PR from the same repo': {
      pr: {
        ...makeInput().pr,
        head: { sha: AFTER, repo: { full_name: 'hyperdxio/hyperdx' } },
      },
    },
    'missing automerge label': {
      pr: { ...makeInput().pr, labels: [{ name: 'external' }] },
    },
    'PR head already moved on': {
      pr: {
        ...makeInput().pr,
        head: {
          sha: 'd'.repeat(40),
          repo: { full_name: 'contributor/hyperdx' },
        },
      },
    },
    'non-merge head': {
      headCommit: { sha: AFTER, parents: [{ sha: BEFORE }] },
    },
    'first parent is not the previous head': {
      headCommit: {
        sha: AFTER,
        parents: [{ sha: 'e'.repeat(40) }, { sha: MAIN_SHA }],
      },
    },
    'merged-in parent not on main': { mergeParentOnMain: false },
    'no reviews': { reviews: [] },
    'approval from someone without write access': {
      permissions: { maintainer: 'read' },
    },
    'outstanding change request from a writer': {
      reviews: [
        { user: { login: 'maintainer' }, state: 'APPROVED' },
        { user: { login: 'other' }, state: 'CHANGES_REQUESTED' },
      ],
      permissions: { maintainer: 'write', other: 'admin' },
    },
    'approval later dismissed': {
      reviews: [
        { user: { login: 'maintainer' }, state: 'APPROVED' },
        { user: { login: 'maintainer' }, state: 'DISMISSED' },
      ],
    },
    'no runs for the previous head': { beforeRuns: [] },
    'previous head runs still held': {
      beforeRuns: [
        run('success', 'maintainer'),
        run('action_required', 'contributor'),
      ],
    },
    'previous head runs expired without approval': {
      beforeRuns: [run('failure', 'contributor')],
    },
    'previous head runs cancelled without approval': {
      beforeRuns: [run('cancelled', 'contributor')],
    },
    'previous head runs started by Kodiak, not approved': {
      beforeRuns: [run('failure', 'kodiakhq[bot]')],
    },
    'previous head runs started by someone with read access': {
      beforeRuns: [run('success', 'maintainer'), run('success', 'reader')],
      permissions: { maintainer: 'write', reader: 'read' },
    },
    'previous head run with no triggering actor': {
      beforeRuns: [{ conclusion: 'success' }],
    },
  };

  for (const [name, overrides] of Object.entries(rejected)) {
    it(`rejects: ${name}`, () => {
      const decision = decideApproval(makeInput(overrides));
      assert.equal(decision.approve, false);
      assert.ok(decision.reason.length > 0);
    });
  }

  it('ignores change requests from people without write access', () => {
    const decision = decideApproval(
      makeInput({
        reviews: [
          { user: { login: 'maintainer' }, state: 'APPROVED' },
          { user: { login: 'drive-by' }, state: 'CHANGES_REQUESTED' },
        ],
        permissions: { maintainer: 'write', 'drive-by': 'none' },
      }),
    );
    assert.equal(decision.approve, true);
  });
});

describe('latestReviewStates', () => {
  it('keeps an approval when a later review is only a comment', () => {
    const states = latestReviewStates([
      { user: { login: 'm' }, state: 'APPROVED' },
      { user: { login: 'm' }, state: 'COMMENTED' },
    ]);
    assert.equal(states.get('m'), 'APPROVED');
  });

  it('uses the latest decisive review', () => {
    const states = latestReviewStates([
      { user: { login: 'm' }, state: 'CHANGES_REQUESTED' },
      { user: { login: 'm' }, state: 'APPROVED' },
    ]);
    assert.equal(states.get('m'), 'APPROVED');
  });
});
