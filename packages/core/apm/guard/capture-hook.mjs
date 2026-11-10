// Session hook: hands the transcript to `factory-foreman note --extract` in the
// background and returns at once, so capture never slows or fails a session.
// Works for Claude Code (PreCompact, SessionEnd), Codex (Stop, SessionEnd) and
// VS Code / Copilot (agentStop, sessionEnd, preCompact) payloads. Zero deps.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  try {
    const p = JSON.parse(input || '{}')
    const transcript = p.transcript_path ?? p.transcriptPath
    const cwd = p.cwd ?? process.cwd()
    if (typeof transcript !== 'string' || !transcript || process.env.FACTORY_FOREMAN_CAPTURE === '1') return
    // The target's own install, or else factory-foreman on PATH.
    let command = 'factory-foreman'
    const args = [ 'note', '--extract', '--transcript', transcript ]
    try {
      args.unshift(createRequire(join(cwd, 'package.json')).resolve('factory-foreman/src/cli.mjs'))
      command = process.execPath
    } catch { /* not installed in the target: use PATH */ }
    const session = p.session_id ?? p.sessionId
    const event = p.hook_event_name ?? p.hookEventName
    if (typeof session === 'string' && session) args.push('--session', session)
    if (typeof event === 'string' && event) args.push('--event', event)
    spawn(command, args, { cwd, detached: true, stdio: 'ignore' }).on('error', (error) => process.stderr.write(`factory-foreman capture: ${error.message}\n`)).unref()
  } catch (error) {
    process.stderr.write(`factory-foreman capture: ${error.message}\n`)
  }
})
