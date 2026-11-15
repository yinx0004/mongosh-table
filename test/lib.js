// Shared helpers for test/*.js. Scripts load it from the repo root:
//   load('test/lib.js')
var T = { fails: 0 };

// Run fn with print() captured, echo the output, then check that every
// expected string appears in it.
function run(label, fn, expects) {
  var lines = [];
  var realPrint = globalThis.print;
  print('\n### ' + label);
  globalThis.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  var err = null;
  try { fn(); } catch (e) { err = e; } finally { globalThis.print = realPrint; }
  var out = lines.join('\n');
  print(out);
  if (err) { T.fails++; print('!!FAIL ' + label + ': ' + (err && err.stack || err)); return; }
  (expects || []).forEach(function (s) {
    if (out.indexOf(s) < 0) { T.fails++; print('!!FAIL ' + label + ': missing ' + JSON.stringify(s)); }
  });
}

// Print the summary and exit non-zero if anything failed.
function finish() {
  print('\n### RESULT ' + (T.fails ? T.fails + ' FAILED' : 'ALL OK'));
  if (T.fails) quit(1);
}
