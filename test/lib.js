// Shared helpers for test/*.js. Scripts load it from the repo root:
//   load('test/lib.js')
// Works in mongosh and in the legacy mongo shell (no globalThis / process there).
var G = typeof globalThis !== 'undefined' ? globalThis : Function('return this')();
var LEGACY = typeof process === 'undefined';
var T = { fails: 0 };

// Environment variable, or '' when the shell cannot read it
// (the legacy shell only has _getEnv from 4.4 on).
function envVar(name) {
  if (!LEGACY) return process.env[name] || '';
  return typeof _getEnv === 'function' ? (_getEnv(name) || '') : '';
}
var ENV_READABLE = !LEGACY || typeof _getEnv === 'function';
var SHELL = LEGACY ? 'mongo ' + version() : 'mongosh ' + version();

// Run fn with print() captured, echo the output, then check that every
// expected string appears in it.
function run(label, fn, expects) {
  var lines = [];
  var realPrint = G.print;
  print('\n### ' + label);
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  var err = null;
  try { fn(); } catch (e) { err = e; } finally { G.print = realPrint; }
  var out = lines.join('\n');
  print(out);
  if (err) { T.fails++; print('!!FAIL ' + label + ': ' + err + (err && err.stack ? '\n' + err.stack : '')); return; }
  (expects || []).forEach(function (s) {
    if (out.indexOf(s) < 0) { T.fails++; print('!!FAIL ' + label + ': missing ' + JSON.stringify(s)); }
  });
}

// Time zone names need Intl, which the legacy shell lacks: there t() throws a
// clear message instead.
function runIanaTz(label, fn, expectsWithIntl) {
  if (typeof Intl !== 'undefined') return run(label, fn, expectsWithIntl);
  run(label, function () {
    try { fn(); print('no error thrown'); } catch (e) { print(e.message); }
  }, ["mongotab: 老的 mongo shell 不支持时区名 'Asia/Shanghai'"]);
}

// Print the summary and exit non-zero if anything failed.
function finish() {
  print('\n### RESULT ' + (T.fails ? T.fails + ' FAILED' : 'ALL OK'));
  if (T.fails) quit(1);
}
