#!/usr/bin/env node
// Spike A: replay a show script with agent-browser, with no agent involved.
// Each step targets a test id, takes a screenshot, and the whole run is
// recorded to video when agent-browser can. The replay stops at the first
// step that fails, which is what a slice's base is expected to do.
//
//   node replay.mjs <script.json> <base-url> <out-dir>
//
// Needs `agent-browser` on PATH (or AGENT_BROWSER_BIN). Throwaway spike code:
// the real provider lands in core/src/evidence/agent-browser.mjs in phase 3.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser'
const session = `replay-${process.pid}`
const id = testid => `[data-testid="${testid}"]`

// One show-script step as agent-browser arguments.
function command(step) {
  if (step.fill) return [ 'fill', id(step.fill), step.text ]
  if (step.click) return [ 'click', id(step.click) ]
  if (step.check) return [ 'check', id(step.check) ]
  if (step.select) return [ 'select', id(step.select), step.value ]
  if (step.wait) return [ 'wait', id(step.wait) ]
  throw new Error(`Unknown step ${JSON.stringify(step)}`)
}

function run(args) {
  return execFileSync(bin, [ '--session', session, ...args ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ], timeout: 30_000 })
}

export function replay(script, baseUrl, out) {
  mkdirSync(out, { recursive: true })
  const url = new URL(script.url ?? '/', baseUrl).href
  const result = { ac: script.ac, url, steps: [], video: null, ok: true }
  run([ 'open', url ])
  try {
    run([ 'record', 'start', join(out, 'replay.webm') ])
    result.video = 'replay.webm'
  } catch (error) {
    result.videoError = String(error.stderr || error.message).trim()
  }
  const shot = name => { run([ 'screenshot', join(out, name) ]); return name }
  result.steps.push({ step: 'open', ok: true, screenshot: shot('00-open.png') })
  for (const [ index, step ] of script.steps.entries()) {
    const name = `${String(index + 1).padStart(2, '0')}-${Object.keys(step)[0]}.png`
    try {
      run(command(step))
      result.steps.push({ step, ok: true, screenshot: shot(name) })
    } catch (error) {
      result.ok = false
      result.steps.push({ step, ok: false, error: String(error.stderr || error.message).trim().split('\n')[0], screenshot: shot(name) })
      break
    }
  }
  if (result.video) {
    try { run([ 'record', 'stop' ]) } catch (error) { result.videoError = String(error.stderr || error.message).trim() }
  }
  run([ 'close' ])
  writeFileSync(join(out, 'replay.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (import.meta.main) {
  const [ file, baseUrl, out ] = process.argv.slice(2)
  const result = replay(JSON.parse(readFileSync(file, 'utf8')), baseUrl, out)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.ok ? 0 : 2
}
