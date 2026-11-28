// MongoTab read-only audit, part 2 (mongosh / mongo --nodb): read the server log
// saved by test/run.sh (path in the AUDIT_LOG environment variable) and check every command that
// test/audit.js sent (appName mongotab-audit) against a list of read-only
// commands. Fails on anything else, on an aggregation with $out / $merge, on
// profile with anything but -1 (that would change the profiler level), and when
// too few commands were logged to mean anything.
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
// Why a logged command is not read-only, or '' when it is
function notReadOnly(cmd) {
  var name = typeof cmd === 'object' ? Object.keys(cmd)[0] : String(cmd), body = JSON.stringify(cmd);
  if (READ_ONLY.indexOf(name) < 0) return 'not a read-only command';
  if ((name === 'aggregate' || name === 'explain') && /"\$(out|merge)"/.test(body)) return '$out / $merge';
  if (name === 'profile' && Number(cmd.profile) !== -1) return 'profile ' + cmd.profile + ' changes the profiler level';
  return '';
}
run('audit: the check itself', function () {
  var cases = [[{ insert: 'c', documents: [] }, true], [{ setParameter: 1, ttlMonitorEnabled: true }, true], [{ profile: 1 }, true],
    [{ aggregate: 'c', pipeline: [{ $match: {} }, { $out: 'x' }] }, true], [{ explain: { aggregate: 'c', pipeline: [{ $merge: 'x' }] } }, true],
    [{ profile: -1 }, false], [{ aggregate: 'c', pipeline: [{ $collStats: {} }] }, false], [{ find: 'c' }, false]];
  var wrong = cases.filter(function (x) { return !!notReadOnly(x[0]) !== x[1]; });
  print(wrong.length ? 'wrong: ' + JSON.stringify(wrong) : 'flags writes');
}, ['flags writes']);
var AUDIT_LOG = envVar('AUDIT_LOG');
var text = LEGACY ? cat(AUDIT_LOG) : require('fs').readFileSync(AUDIT_LOG, 'utf8');   // eslint-disable-line no-undef
var counts = {}, bad = [], unknown = [], total = 0;
text.split('\n').forEach(function (line) {
  if (line.indexOf('"mongotab-audit"') < 0 || line.indexOf('"id":51803') < 0) return;
  var e;
  try { e = JSON.parse(line); } catch (x) { return; }
  var a = e.attr || {};
  if (a.appName !== 'mongotab-audit' || !a.command) return;
  total++;
  // A command the server does not know is logged as "unrecognized" and runs nothing (mongosh asks for
  // atlasVersion when it connects, for example): list it, but it is not a failure
  if (a.command === 'unrecognized' && a.errName === 'CommandNotFound') { unknown.push(a.errMsg); return; }
  var cmd = a.command, name = typeof cmd === 'object' ? Object.keys(cmd)[0] : String(cmd), why = notReadOnly(cmd);
  counts[name] = (counts[name] || 0) + 1;
  if (why) bad.push(name + ' on ' + a.ns + ': ' + why + ' ' + JSON.stringify(cmd).slice(0, 200));
});
print('commands logged: ' + total);
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
