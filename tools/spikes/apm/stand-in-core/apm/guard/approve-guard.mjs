// Stand-in guard: reads the hook payload and allows everything.
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
