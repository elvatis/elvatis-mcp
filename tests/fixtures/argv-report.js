/**
 * Stands in for the `gemini` CLI and reports what it ACTUALLY received.
 *
 * The defect this fixture exists to measure is invisible from the parent side:
 * spawnLocal builds a cmd.exe command string on Windows and hands it over, so
 * the only place the truncation becomes observable is inside the child. Asking
 * the child is the difference between testing the code that builds the string
 * and testing what the operating system did with it.
 *
 * CommonJS on purpose: this package has no `"type": "module"` and compiles with
 * `"module": "commonjs"`, so a `.js` file here is CJS. `.js` is also in the
 * em-dash gate's include list in aahp.config.json, while `.cjs` and `.mjs` are
 * not, so naming it `.js` keeps the file inside the governance gate instead of
 * quietly adding a file type nothing scans.
 *
 * Prints one JSON object on stdout and nothing else.
 */
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const argv = process.argv.slice(2);
  process.stdout.write(JSON.stringify({
    argvCount: argv.length,
    argv,
    firstArgLines: argv.length ? argv[0].split('\n').length : 0,
    firstArgLen: argv.length ? argv[0].length : 0,
    stdinLines: stdin.length ? stdin.split('\n').length : 0,
    stdinLen: stdin.length,
  }));
});
