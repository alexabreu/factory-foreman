// The implementer's status: the first "STATUS: X" line of its reply, or null.
export const STATUSES = [ 'DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT' ]
export function statusOf(reply) {
  const m = /^\W*STATUS\W*:?\s*\W*(DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED|DONE)\b/imu.exec(String(reply))
  return m ? m[1].toUpperCase() : null
}
// A check that passes when the status is one of `allowed`.
export const statusIn = (allowed) => (o) => {
  const status = statusOf(o)
  return { passed: allowed.includes(status), evidence: `Status: ${status ?? 'none'}; wanted ${allowed.join(' or ')}` }
}
