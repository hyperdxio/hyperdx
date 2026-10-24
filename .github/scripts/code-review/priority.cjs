'use strict';
/**
 * Priority: the one label users see, and the rule that decides what is folded.
 *
 * Split from review-comments.cjs so the rule can be read, and tested, on its own: it is
 * the policy decision of the grading pass, while review-comments.cjs is delivery
 * mechanics. hdx-code-reviewer's src/types.ts carries a port of `effectivePriority` that
 * must stay in lockstep with this one, or the eval measures a rule that does not ship.
 */

/**
 * What users see. Severity above is still produced by the reviewer and still drives the
 * policy below, but it is no longer rendered: one comment carrying two grades on two
 * different scales was the thing to avoid. Icons match deep-review.yml's sections
 * (🔴 P0/P1, 🟡 P2, 🔵 P3) so the two bots read the same on one PR.
 */
const PRIORITY_ICON = { P0: '🔴', P1: '🔴', P2: '🟡', P3: '🔵' };
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const SEVERITIES = ['critical', 'major', 'minor'];

/** Normalize a severity we may have received from a model to one of the three the reviewer emits. */
function severityOf(finding) {
  return SEVERITIES.includes(finding.severity) ? finding.severity : 'minor';
}

/**
 * Security-shaped wording. A finding like this may be graded down, but never collapsed: a
 * grader once filed an unescaped SQL splice as a nit on the grounds that the attacker would
 * need DDL rights (hdx-code-reviewer, PR #1620). Matching wording rather than a field is
 * deliberate here -- this is a floor, so a false positive only keeps a comment visible.
 * Ends in `\w*`, not `\b`: the stems must also match "deserialization", "sanitize",
 * "secrets", "passwords", "API keys".
 */
const SECURITY_SHAPED =
  /\b(sql[- ]?injection|injection|xss|cross[- ]site|rce|remote code execution|deserializ|ssrf|csrf|path traversal|directory traversal|auth(?:n|z)?\s+bypass|authentication bypass|authorization bypass|privilege escalation|unescaped|unsanitized|sanitiz|secret|credential|api[- ]?key|password|token leak)\w*/i;

function isSecurityShaped(finding) {
  return SECURITY_SHAPED.test(
    `${finding.title || ''} ${finding.body || ''} ${finding.consequence || ''}`,
  );
}

/**
 * Without a grade, nothing is hidden. The grading pass is a separate model call and can
 * fail on its own; when it does, every finding is still posted, ranked the way the
 * reviewer's own severity always ranked it. Failing toward "post it" is the same direction
 * every other fallback in this workflow takes.
 */
const UNGRADED_PRIORITY = { critical: 'P0', major: 'P1', minor: 'P2' };

/**
 * Folded out of the inline threads only when BOTH graders call it low, and nothing says it
 * matters today:
 *
 *  - the reviewer itself labelled it `minor`, AND
 *  - the grading pass put it at P2 or P3, AND
 *  - the grader does not say the harm is reachable in the merged code, AND
 *  - it does not read as security-related.
 *
 * Neither grader alone can fold anything. A grader P3 on a finding the reviewer called
 * major/critical is shown as P2: one model call must not hide a critical. The reachable
 * floor is what kept 3 of the 10 caught must-fix gold items visible (each was
 * reviewer-`minor`, grader-P2). Measured: hides ~35% of comments on 75 human-voted
 * findings and 29 of 122 on the gold set, folding no must-fix item.
 *
 * hasFailureMode is recorded but not consulted. The grading prompt promises that a P3
 * naming a failure mode is raised to P2; that is subsumed here, since any graded P3 that
 * is not folded is shown as P2 anyway.
 */
function shouldFold(finding) {
  return (
    (finding.priority === 'P2' || finding.priority === 'P3') &&
    severityOf(finding) === 'minor' &&
    finding.reachableToday !== true &&
    !isSecurityShaped(finding)
  );
}

/** The one priority this finding is shown and routed with. */
function effectivePriority(finding) {
  if (!PRIORITIES.includes(finding.priority)) return UNGRADED_PRIORITY[severityOf(finding)];
  if (shouldFold(finding)) return 'P3';
  return finding.priority === 'P3' ? 'P2' : finding.priority;
}

/**
 * Merge the grading pass's output onto the reviewer's findings by index. A grade for an
 * index that does not exist, or with an unknown priority, is dropped and that finding stays
 * ungraded (posted, per UNGRADED_PRIORITY) rather than guessed at.
 */
function applyGrades(findings, grades) {
  const byIndex = new Map();
  for (const g of grades || []) {
    if (Number.isInteger(g && g.index) && PRIORITIES.includes(g.priority)) byIndex.set(g.index, g);
  }
  return (findings || []).map((f, i) => {
    const g = byIndex.get(i);
    if (!g) return f;
    return {
      ...f,
      priority: g.priority,
      hasFailureMode: g.hasFailureMode === true,
      reachableToday: g.reachableToday === true,
      consequence: typeof g.consequence === 'string' ? g.consequence : undefined,
    };
  });
}

/** The findings as the grading pass reads them. Bodies are capped like the harness capped them. */
function regradeInput(findings) {
  return [
    `FINDINGS TO GRADE (${(findings || []).length}) -- return exactly one grade per index:`,
    '',
    ...(findings || []).map(
      (f, i) =>
        `- index: ${i}\n  file: ${f.file}\n  issue: ${f.title}\n  detail: ${String(f.body || '').slice(0, 1200)}`,
    ),
    '',
  ].join('\n');
}

module.exports = {
  PRIORITY_ICON,
  PRIORITIES,
  SEVERITIES,
  severityOf,
  isSecurityShaped,
  shouldFold,
  effectivePriority,
  applyGrades,
  regradeInput,
};
