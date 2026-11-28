// MongoTab read-only audit, part 2 (mongosh / mongo --nodb): read the server log
// saved by test/run.sh and check every command test/audit.js sent against a list
// of read-only commands. Fails on anything else, on an aggregation with $out /
// $merge, on profile with anything but -1 (that would change the profiler level),
// on a WRITE log line, and when too few commands were logged to mean anything.
//
// test/run.sh passes AUDIT = {log, from, to, ip} with --eval (the 3.6 shell cannot
// read environment variables). The audit's connections are the ones the server
// accepted from the audit client's address (ip, from whatsmyuri) between from and
// to (serverStatus().localTime read just before and just after it; the log uses
// the same clock): the 3.6 shell does not send the appName in the connection
// string, and connection numbers do not follow serverStatus' counters from 7.0,
// so this is how the audit is told apart. Both log formats are read: JSON from
// 4.4, text before.
load('test/lib.js');

print('### read-only audit: check the commands in the server log');
var READ_ONLY = [
  // reads
  'find', 'getMore', 'aggregate', 'count', 'distinct', 'explain',
  'listDatabases', 'listCollections', 'listIndexes', 'collStats', 'dbStats', 'dbstats',
  'planCacheListQueryShapes', 'planCacheListPlans',
  // status and configuration
  'serverStatus', 'replSetGetStatus', 'replSetGetConfig', 'getDefaultRWConcern', 'getParameter', 'getCmdLineOpts',
  'getLog', 'hostInfo', 'buildInfo', 'buildinfo', 'connPoolStats', 'connectionStatus', 'usersInfo', 'rolesInfo',
  'top', 'lockInfo', 'currentOp', 'listShards', 'balancerStatus', 'profile',
  // the shell and driver themselves: handshake, monitoring, sessions, closing MongoTab's own cursors
  'hello', 'isMaster', 'ismaster', 'ping', 'whatsmyuri', 'endSessions', 'killCursors', 'getFreeMonitoringStatus',
  'saslStart', 'saslContinue', 'logout'
];
// Why a logged command is not read-only, or '' when it is. body is the command as logged
// (JSON from 4.4, the server's own text before), profile its profile value
function notReadOnly(name, body, profile) {
  if (READ_ONLY.indexOf(name) < 0) return 'not a read-only command';
  if ((name === 'aggregate' || name === 'explain') && /"?\$(out|merge)"?\s*:/.test(body)) return '$out / $merge';
  if (name === 'profile' && Number(profile) !== -1) return 'profile ' + profile + ' changes the profiler level';
  return '';
}
function notReadOnlyDoc(cmd) { var name = Object.keys(cmd)[0]; return notReadOnly(name, JSON.stringify(cmd), cmd.profile); }
run('audit: the check itself', function () {
  var cases = [[{ insert: 'c', documents: [] }, true], [{ setParameter: 1, ttlMonitorEnabled: true }, true], [{ profile: 1 }, true],
    [{ aggregate: 'c', pipeline: [{ $match: {} }, { $out: 'x' }] }, true], [{ explain: { aggregate: 'c', pipeline: [{ $merge: 'x' }] } }, true],
    [{ profile: -1 }, false], [{ aggregate: 'c', pipeline: [{ $collStats: {} }] }, false], [{ find: 'c' }, false]];
  var wrong = cases.filter(function (x) { return !!notReadOnlyDoc(x[0]) !== x[1]; });
  // the text log (before 4.4) writes commands in the server's own format
  var asText = [['aggregate', '{ aggregate: "c", pipeline: [ { $out: "x" } ], cursor: {} }', null, true],
    ['profile', '{ profile: 1.0 }', '1.0', true], ['profile', '{ profile: -1.0 }', '-1.0', false],
    ['aggregate', '{ aggregate: "c", pipeline: [ { $collStats: { storageStats: {} } } ] }', null, false]];
  wrong = wrong.concat(asText.filter(function (x) { return !!notReadOnly(x[0], x[1], x[2]) !== x[3]; }));
  print(wrong.length ? 'wrong: ' + JSON.stringify(wrong) : 'flags writes');
}, ['flags writes']);

var text = LEGACY ? cat(AUDIT.log) : require('fs').readFileSync(AUDIT.log, 'utf8');   // eslint-disable-line no-undef
// "2026-11-28T05:12:58.639+0000" (text log) or "...+00:00" (JSON log, localTime) → milliseconds
function ms(t) { return Date.parse(String(t).replace(/([+-]\d\d)(\d\d)$/, '$1:$2').replace(/Z$/, '+00:00')); }
var lines = text.split('\n'), t0 = ms(AUDIT.from), t1 = ms(AUDIT.to), inWindow = function (t) { return t > t0 && t < t1; };
var mine = {}, others = {}, counts = {}, bad = [], unknown = [], total = 0;
// First pass: which connections are the audit's (opened in the window, from the audit client)
lines.forEach(function (line) {
  var n = null, ip = null, t = null, m;
  if (line.charAt(0) === '{') {
    if (line.indexOf('"id":22943') < 0) return;   // Connection accepted
    try { var e = JSON.parse(line), a = e.attr || {}; n = Number(a.connectionId); ip = String(a.remote || '').split(':')[0]; t = ms(e.t.$date); } catch (x) { return; }
  } else if ((m = /^(\S+) .*connection accepted from ([0-9.]+):\d+ #(\d+)/.exec(line))) { t = ms(m[1]); ip = m[2]; n = Number(m[3]); }
  if (n == null || !inWindow(t)) return;
  if (ip === AUDIT.ip) mine[n] = true; else others[n] = ip;
});
// Second pass: what those connections sent
function seen(n, name, ns, body, profile) {
  total++;
  counts[name] = (counts[name] || 0) + 1;
  var why = notReadOnly(name, body, profile);
  if (why) bad.push('conn' + n + ' ' + name + ' on ' + ns + ': ' + why + ' ' + body.slice(0, 200));
}
lines.forEach(function (line) {
  var m, n;
  if (line.charAt(0) === '{') {
    if (line.indexOf('"id":51803') < 0) return;   // the command log line ("Slow query")
    var e;
    try { e = JSON.parse(line); } catch (x) { return; }
    var a = e.attr || {};
    n = Number(String(e.ctx || '').replace(/^conn/, ''));
    if (!mine[n] || !a.command) return;
    // A command the server does not know runs nothing (mongosh asks for atlasVersion when it connects,
    // for example): list it, but it is not a failure
    if (a.command === 'unrecognized' && a.errName === 'CommandNotFound') { total++; unknown.push(a.errMsg); return; }
    if (typeof a.command !== 'object') { total++; bad.push('conn' + n + ' command ' + a.command + ': ' + line.slice(0, 200)); return; }
    seen(n, Object.keys(a.command)[0], a.ns, JSON.stringify(a.command), a.command.profile);
    return;
  }
  // Before 4.4: "... I COMMAND  [conn12] command db.coll appName: "..." command: find { find: "c", ... } planSummary: ...",
  // and a write also gets a WRITE line
  if ((m = /\s[A-Z]\s+WRITE\s+\[conn(\d+)\]/.exec(line)) && mine[Number(m[1])]) { total++; bad.push('conn' + m[1] + ' WRITE log line: ' + line.slice(0, 200)); return; }
  m = /\s[A-Z]\s+COMMAND\s+\[conn(\d+)\] command (\S+) (?:appName: "(?:[^"\\]|\\.)*" )?command: (\S+) (.*)$/.exec(line);
  if (!m || !mine[Number(m[1])]) return;
  if (/CommandNotFound|no such (cmd|command)/.test(m[4])) {   // 3.6 logs it as "command: { name: ...", 4.0-4.2 as "command: unrecognized { name: ..."
    var k = m[3] === '{' ? /^(\w+):/.exec(m[4]) : /^\{ (\w+):/.exec(m[4]);
    total++; unknown.push(k ? k[1] : m[3]); return;
  }
  var p = /\bprofile: (-?[0-9.]+)/.exec(m[4]);
  seen(Number(m[1]), m[3], m[2], m[4], p ? p[1] : null);
});
var ips = {};
Object.keys(others).forEach(function (k) { ips[others[k]] = (ips[others[k]] || 0) + 1; });
print('audit client ' + AUDIT.ip + ': ' + Object.keys(mine).length + ' connections, ' + total + ' commands logged');
if (Object.keys(ips).length) print('other clients during the audit (not checked): ' + Object.keys(ips).map(function (k) { return k + ' x' + ips[k]; }).join(', '));
print(Object.keys(counts).sort().map(function (k) { return k + ' ' + counts[k]; }).join(', '));
if (unknown.length) print('rejected as unknown (nothing ran): ' + unknown.join('; '));
run('audit: only read-only commands', function () { print(bad.length ? bad.join('\n') : 'none other'); }, ['none other']);
// Guard against a log that silently missed the run: these must all be there
run('audit: the run was logged', function () {
  var need = ['serverStatus', 'listDatabases', 'listCollections', 'listIndexes', 'aggregate', 'find', 'explain', 'replSetGetStatus', 'profile', 'getLog'];
  var miss = need.filter(function (k) { return !counts[k]; });
  print(total >= 200 && !miss.length ? 'logged' : 'only ' + total + ' commands; missing ' + miss.join(', '));
}, ['logged']);
finish();
