// The rubric judge: for one case, a batch of anonymous replies and the case's
// recall lines, it says which reply earns which line, quoting the sentence that
// earns it. A pass whose quote isn't in the reply word for word counts as a fail,
// so the judge can't credit what wasn't said.
import { findingsFrom } from './findings.mjs'

export const JUDGE_INSTRUCTIONS = `You grade code-review replies against a rubric. You don't review the code yourself.

For every reply and every rubric line, decide whether the reply makes that point: the same defect or gap, in any
words, about the same code. A reply that makes the point only as a passing remark, or attributes it to the wrong
code, doesn't earn it. When it does, quote the shortest sentence or phrase from the reply that makes it, copied
exactly. Don't reward length, confidence or format.`

export const JUDGE_OUTPUT = 'Reply with only a JSON array, one entry per reply and line: [{ "reply": "R1", "line": 1, "pass": true, "quote": "<exact words from the reply, or empty when pass is false>" }].'

export function judgePrompt(scenario, readInput, lines, replies) {
  const inputs = scenario.inputs.map((f) => `<file path="${f}">\n${readInput(f)}\n</file>`).join('\n\n')
  const rubric = lines.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const body = replies.map((r) => `<reply id="${r.id}">\n${r.text}\n</reply>`).join('\n\n')
  return `${JUDGE_INSTRUCTIONS}\n\n# The change under review\n\n${inputs}\n\n# Rubric\n\n${rubric}\n\n# Replies\n\n${body}\n\n${JUDGE_OUTPUT}\n`
}

const squash = (s) => String(s).replace(/[\s`*_"'“”‘’]+/gu, ' ').trim().toLowerCase()

// The verdicts for each reply and line, with a pass kept only when its quote is
// really in that reply.
export function verdicts(judgeReply, replies, lineCount) {
  const raw = findingsFrom(judgeReply) ?? []
  const out = {}
  for (const r of replies) {
    out[r.id] = Array.from({ length: lineCount }, (_, i) => {
      const v = raw.find((x) => x.reply === r.id && Number(x.line) === i + 1)
      if (!v) return { pass: false, why: 'no verdict' }
      if (!v.pass) return { pass: false, why: 'judged not made' }
      const quoted = squash(v.quote ?? '')
      return quoted.length >= 8 && squash(r.text).includes(quoted) ? { pass: true, quote: v.quote } : { pass: false, why: 'quote not in the reply', quote: v.quote }
    })
  }
  return out
}

// The recall checks of a case: those that look for something said. Structural
// checks (citations, severities, status, absent-style precision) stay as code.
export const isRecall = (criterion) => criterion.kind === 'recall' || (criterion.kind === undefined && /\bmatches\(/u.test(String(criterion.check)) && !/\babsent\(/u.test(String(criterion.check)))
