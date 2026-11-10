// The status line at the top of the issue body.
const title = (step) => step[0].toUpperCase() + step.slice(1)

function describe(step, state) {
  const { latest, approved, approvedCheckpoint } = state
  if (!latest) return `${title(step)} not started`
  if (approvedCheckpoint && latest.comment && approvedCheckpoint.comment.id === latest.comment.id) {
    return latest.version === approved.version ? `${title(step)} ${latest.version} approved` : `${title(step)} ${latest.version} approved (carries ${approved.version})`
  }
  const before = approvedCheckpoint ? ` (${approvedCheckpoint.version} approved)` : ''
  return `${title(step)} ${latest.version} awaiting approval${before}`
}

export function statusLine(states) {
  return `**Status:** ${[ 'shape', 'design' ].map((step) => describe(step, states[step])).join(' · ')}`
}
