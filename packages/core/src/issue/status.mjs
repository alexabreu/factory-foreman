// The status line at the top of the issue body.
const title = (step) => step[0].toUpperCase() + step.slice(1)

function describe(step, { latest, approved }) {
  if (!latest) return `${title(step)} not started`
  if (approved && latest.comment && approved.checkpoint === latest.comment.id) return `${title(step)} ${latest.version} approved`
  const before = approved ? ` (${approved.version} approved)` : ''
  return `${title(step)} ${latest.version} awaiting approval${before}`
}

export function statusLine(states) {
  return `**Status:** ${[ 'shape', 'design' ].map((step) => describe(step, states[step])).join(' · ')}`
}
