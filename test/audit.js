// MongoTab read-only audit, part 1: run every mt command once, from a client
// container of its own. test/run.sh turns on logging of every command first
// (command log verbosity 1), then test/audit-check.js reads the server log and
// checks that everything this client sent is read-only. The "audit client" line
// is this client's address as the server sees it, which test/run.sh passes on.
// Errors are fine here (some commands only work on a mongos, for example): only
// what reaches the server matters. The data in mtaudit comes from test/run.sh,
// on another connection.
load('test/lib.js');
load('mongotab.js');

print('audit client: ' + db.adminCommand({ whatsmyuri: 1 }).you);
print('### env server=' + db.version() + ' shell=' + SHELL + ' (read-only audit: commands)');
mt.config({ lang: 'zh', tz: 'UTC' });
var ad = db.getSiblingDB('mtaudit');
var calls = [
  ['t(cursor)', function () { t(ad.c.find({ a: { $gte: 1 } }).sort({ a: 1 })); }],
  ['g(cursor)', function () { g(ad.c.find().limit(2)); }],
  ['t(aggregate)', function () { t(ad.c.aggregate([{ $group: { _id: '$b', n: { $sum: 1 } } }])); }],
  ['mt.ps()', function () { mt.ps(); }],
  ['mt.ps({all: true})', function () { mt.ps({ all: true, sort: { client: 1 } }); }],
  ['mt.ps({secs, ns})', function () { mt.ps({ secs: 1, ns: 'mtaudit' }); }],
  ['mt.cursors()', function () { mt.cursors(); }],
  ['mt.locks()', function () { mt.locks(); }],
  ['mt.locks({all: true})', function () { mt.locks({ all: true }); }],
  ['mt.txns()', function () { mt.txns(); }],
  ['mt.conflicts()', function () { mt.conflicts({ interval: 1 }); }],
  ['mt.conflicts({quick: true})', function () { mt.conflicts({ quick: true }); }],
  ['mt.conflicts({source: log})', function () { mt.conflicts('mtaudit', { source: 'log', interval: 0 }); }],
  ['mt.conns()', function () { mt.conns(); }],
  ['mt.builds()', function () { mt.builds(); }],
  ['mt.status()', function () { mt.status({ interval: 1 }); }],
  ['mt.engine()', function () { mt.engine({ interval: 1 }); }],
  ['mt.qstats()', function () { mt.qstats({ interval: 1 }); }],
  ['mt.top()', function () { mt.top({ interval: 1 }); }],
  ['mt.latency()', function () { mt.latency({ interval: 1 }); }],
  ["mt.latency('mtaudit')", function () { mt.latency('mtaudit', { interval: 0 }); }],
  ['mt.latency({quick: true})', function () { mt.latency({ quick: true, interval: 1 }); }],
  ['mt.flow()', function () { mt.flow({ interval: 1 }); }],
  ['mt.repl()', function () { mt.repl(); }],
  ['mt.rsconf()', function () { mt.rsconf(); }],
  ['mt.elections()', function () { mt.elections(); }],
  ['mt.elections({history: true})', function () { mt.elections({ history: true, hours: 0 }); }],
  ['mt.concern()', function () { mt.concern(); }],
  ['mt.initialSync()', function () { mt.initialSync(); }],
  ['mt.oplog()', function () { mt.oplog(); }],
  ['mt.shards()', function () { mt.shards(); }],
  ['mt.balancer()', function () { mt.balancer(); }],
  ['mt.pool()', function () { mt.pool({ all: true }); }],
  ['mt.users()', function () { mt.users(); }],
  ['mt.host()', function () { mt.host({ all: true }); }],
  ['mt.mem()', function () { mt.mem(); }],
  ['mt.cache()', function () { mt.cache(); }],
  ['mt.vars()', function () { mt.vars(); }],
  ["mt.vars('ttl')", function () { mt.vars('ttl'); }],
  ['mt.log()', function () { mt.log(); }],
  ['mt.log({startup: true})', function () { mt.log({ startup: true }); }],
  ['mt.profile()', function () { mt.profile(); }],
  ["mt.profile('mtaudit')", function () { mt.profile('mtaudit'); }],
  ["mt.slow('mtaudit')", function () { mt.slow('mtaudit', { limit: 5 }); }],
  ["mt.slow('mtaudit', {count: true})", function () { mt.slow('mtaudit', { count: true, sort: 'ms' }); }],
  ['mt.explainLog(1)', function () { mt.slow('mtaudit', { limit: 5 }); mt.explainLog(1); }],
  ['mt.logQuery(1)', function () { mt.logQuery(1); }],
  ['mt.explainLog(update)', function () { mt.explainLog({ update: 'c', updates: [{ q: { a: 1 }, u: { $set: { z: 1 } } }], $db: 'mtaudit' }); }],
  ['mt.explainLog(delete)', function () { mt.explainLog({ delete: 'c', deletes: [{ q: { a: 2 }, limit: 1 }], $db: 'mtaudit' }); }],
  ['mt.explain(cursor)', function () { mt.explain(ad.c.find({ a: 1 })); }],
  ['mt.explain(cursor, analyze)', function () { mt.explain(ad.c.find({ a: 1 }), { analyze: true }); }],
  ['mt.dbs()', function () { mt.dbs(); }],
  ["mt.colls('mtaudit')", function () { mt.colls('mtaudit'); }],
  ["mt.frag('mtaudit')", function () { mt.frag('mtaudit'); }],
  ['mt.desc(coll)', function () { mt.desc(ad.c); }],
  ['mt.desc(view)', function () { mt.desc(ad.v); }],
  ['mt.idx(coll)', function () { mt.idx(ad.c); }],
  ['mt.planCache(coll)', function () { mt.planCache(ad.c); }],
  ['mt.unusedIdx()', function () { mt.unusedIdx(); }],
  ["mt.unusedIdx('mtaudit')", function () { mt.unusedIdx('mtaudit', { days: 0 }); }],
  ['mt.dupIdx()', function () { mt.dupIdx(); }],
  ['mt.ttl()', function () { mt.ttl(); }],
  ['mt.check()', function () { mt.check(); }],
  ['mt.check({quick: true})', function () { mt.check({ quick: true }); }],
  ['mt.check({deep: true})', function () { mt.check({ deep: true }); }],
  ['mt.help()', function () { mt.help(); mt.help('ps'); mt.cmds(); mt.config(); }]
];
var errs = 0;
calls.forEach(function (c) {
  var realPrint = G.print;
  G.print = function () {};
  try { c[1](); } catch (e) { G.print = realPrint; errs++; print('  ' + c[0] + ' threw: ' + String(e.message || e).slice(0, 120)); } finally { G.print = realPrint; }
});
print('ran ' + calls.length + ' calls (' + errs + ' threw)');
