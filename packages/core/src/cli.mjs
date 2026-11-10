#!/usr/bin/env node
// factory-foreman command line. Phase 0 ships only the entry point, so an
// install can be checked end to end; the commands arrive from phase 1.
import { readFileSync } from 'node:fs'
import process from 'node:process'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export function main(argv) {
  const [ command ] = argv
  if (command === '--version' || command === 'version') return { code: 0, out: version }
  if (!command || command === '--help' || command === 'help') {
    return { code: 0, out: `factory-foreman ${version}\n\nNo commands yet: they arrive from phase 1.` }
  }
  return { code: 1, err: `Unknown command "${command}". Run factory-foreman --help.` }
}

if (import.meta.main) {
  const { code, out, err } = main(process.argv.slice(2))
  if (out) process.stdout.write(`${out}\n`)
  if (err) process.stderr.write(`${err}\n`)
  process.exitCode = code
}
