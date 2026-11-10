// What a slice owns, read from the approved Design (and Shape): its acceptance
// criteria, its files and the contracts it builds.
import { Refusal } from '../errors.mjs'

export const sliceBranch = (issue, n) => `factory-foreman/${issue}-slice-${n}`
export const issueBranch = (issue) => `factory-foreman/${issue}`
export const iterationTag = (issue, n, k) => `factory-foreman/${issue}/slice-${n}/iter-${k}`

export function sliceOf(design, n) {
  const slice = design.slices.find((s) => s.n === n)
  if (!slice) throw new Refusal(`Slice ${n} isn't in the approved Design; it has slices ${design.slices.map((s) => s.n).join(', ')}.`)
  return slice
}

// A contract belongs to the slice it names, or else to every slice owning one
// of its files.
export function contractsFor(design, n) {
  const slice = sliceOf(design, n)
  return design.contracts.filter((c) => !c.error).map((c) => c.value).filter((c) => (c.slice !== undefined ? c.slice === n : (c.files ?? []).some((f) => slice.files.includes(f))))
}

// The plan for one slice: what it owns and what its tests must cover.
export function slicePlan({ shape, design }, n) {
  const slice = sliceOf(design, n)
  const criteria = shape.criteria.filter((c) => slice.acs.includes(c.id))
  const contracts = contractsFor(design, n)
  return {
    n,
    title: slice.title,
    acs: slice.acs,
    visual: criteria.filter((c) => c.visual).map((c) => c.id),
    criteria,
    files: slice.files,
    contracts,
    testIds: [ ...new Set(contracts.flatMap((c) => c.testIds)) ],
  }
}

// Which ACs a test file covers: AC-n in the file's name, or in the title of a
// test, it or describe block. A mention in a comment doesn't count.
const TITLE = /(?<![.\w$])(?:test|it|describe)(?:\.\w+)*\(\s*(['"`])((?:(?!\1).)*)\1/g
export function acsIn(text, name = '') {
  const found = new Set([ ...name.matchAll(/\bAC-\d+\b/g) ].map((m) => m[0]))
  for (const m of String(text).matchAll(TITLE)) for (const ac of m[2].matchAll(/\bAC-\d+\b/g)) found.add(ac[0])
  return found
}

// Which of the approved Design's slices an amendment touches: for a Shape, the
// slices owning a changed criterion; for a Design, the slices whose criteria,
// files, contracts, visual behaviors or wireframes differ.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim()
function sliceView(design, n) {
  const slice = design.slices.find((s) => s.n === n)
  if (!slice) return null
  const contracts = design.contracts.filter((c) => !c.error).map((c) => c.value).filter((c) => (c.slice !== undefined ? c.slice === n : (c.files ?? []).some((f) => slice.files.includes(f))))
  return JSON.stringify({
    acs: slice.acs,
    files: slice.files,
    contracts,
    visual: design.visualBehaviors.filter((v) => slice.acs.includes(v.id)).map((v) => [ v.id, squash(v.text) ]),
    wireframes: design.wireframes.filter((w) => slice.acs.includes(w.id)).map((w) => [ w.id, w.state, w.hash ]),
  })
}
export function affectedSlices({ step, before, after, design }) {
  if (step === 'shape') {
    if (!design) return []
    const key = (c) => JSON.stringify([ squash(c.criterion), c.visual ])
    const old = new Map(before.criteria.map((c) => [ c.id, key(c) ]))
    const now = new Map(after.criteria.map((c) => [ c.id, key(c) ]))
    const changed = new Set([ ...old.keys(), ...now.keys() ].filter((id) => old.get(id) !== now.get(id)))
    return design.slices.filter((s) => s.acs.some((a) => changed.has(a))).map((s) => s.n)
  }
  const numbers = [ ...new Set([ ...before.slices, ...after.slices ].map((s) => s.n)) ].sort((a, b) => a - b)
  return numbers.filter((n) => sliceView(before, n) !== sliceView(after, n))
}
