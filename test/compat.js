// MongoTab compatibility test. Run with test/run.sh, or directly against a
// single-node replica set from the repo root:
//   mongosh "mongodb://localhost:27017/test?directConnection=true" test/compat.js
// Exits non-zero if any case throws or misses an expected piece of output.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL);
mt.config({ lang: 'zh', tz: 'UTC' });

var tdb = db.getSiblingDB('mtest');
var c = tdb.orders;
c.drop();
c.insertMany([
  {
    _id: 1, orderNo: 'SO1', customer: { name: '张三', vip: true },
    amount: NumberDecimal('1299.50'), qty: NumberInt(2), big: NumberLong('9007199254740993'),
    dbl: 3.14, createdAt: ISODate('2024-01-01T08:30:00.123Z'), remark: null, coupon: '',
    tags: ['a', 'b'], items: [{ sku: 'A', n: 1 }, { sku: 'B', n: 2 }],
    ts: Timestamp(1700000000, 3), uid: UUID('3b241101-e2bb-4255-8caf-4136c566a962'),
    bin: BinData(0, 'AAECAwQFBgcICQ=='), re: /ab+c/i, mk: MinKey(), Mk: MaxKey(),
    oid: ObjectId('65a1b2c3d4e5f60718293a4b'), note: 'line1\nline2\tx'
  },
  { _id: 2, orderNo: 'SO2', customer: { name: 'Alice' }, amount: 88.0, remark: '', coupon: 'VIP10', createdAt: new Date('2024-01-01T09:00:00Z') },
  { _id: 3, orderNo: 'SO3', customer: { name: 'Bob' }, amount: 5, qty: 1 }
]);
c.createIndex({ orderNo: 1 }, { unique: true });
c.createIndex({ 'customer.name': 1, createdAt: -1 });

run('pick columns', function () { t(c.find(), 'orderNo,customer,amount,qty,remark,coupon'); }, [
  '| orderNo | customer.name | customer.vip | amount  | qty      | remark   | coupon   |',
  '| SO1     | 张三          | true         | 1299.50 |        2 | NULL     |          |',
  '| SO2     | Alice         | (无字段)     |      88 | (无字段) |          | VIP10    |',
  '3 rows in set'
]);
run('BSON types (vertical)', function () { g(c.findOne({ _id: 1 })); }, [
  'customer.name: 张三', 'big: 9007199254740993', 'createdAt: 2024-01-01 08:30:00.123',
  'ts: 2023-11-14 22:13:20 (1700000000:3)', 'uid: 3b241101-e2bb-4255-8caf-4136c566a962',
  'bin: Binary(0, AAECAwQFBgcICQ==, 10 bytes)', 're: /ab+c/i', 'mk: MinKey', 'Mk: MaxKey',
  'oid: 65a1b2c3d4e5f60718293a4b', 'note: line1\\nline2\\tx', 'tags: [a, b]',
  '── items (2) ──', 'sku: B'
]);
run('wide table', function () { t(c.find({}, { items: 0, tags: 0 }), { table: true, maxCol: 20 }); }, [
  '2024-01-01 08:30:...', 'Binary(0, AAECAwQ...'
]);
run('exclude columns', function () { g(c.find({ _id: 1 }), { exclude: 'items,customer.*,tags' }); }, ['orderNo: SO1', '1 row in set']);
run('sort/limit chain', function () { t(c.find().sort({ _id: -1 }).limit(2), 'orderNo,amount'); }, ['| SO3     |      5 |', '2 rows in set']);
run('limit hint t', function () { t(c.find(), { cols: 'orderNo', limit: 1 }); }, ['用 t(x, {limit: 200}) 看更多']);
run('limit hint g', function () { g(c.find(), { cols: 'orderNo', limit: 1 }); }, ['用 g(x, {limit: 200}) 看更多']);
run('toArray', function () { t(c.find().toArray(), 'orderNo,createdAt'); }, ['| SO3     | (无字段)                |']);
run('aggregate cursor', function () {
  t(c.aggregate([{ $group: { _id: '$coupon', n: { $sum: 1 }, total: { $sum: '$amount' } } }, { $sort: { total: -1 } }]));
}, ['|       | 1 | 1299.50 |', '| VIP10 | 1 |      88 |', '| NULL  | 1 |       5 |']);
run('tz +08:00', function () { t(c.find(), { cols: 'orderNo,createdAt', tz: '+08:00' }); }, ['2024-01-01 16:30:00.123']);
runIanaTz('tz IANA', function () { t(c.find(), { cols: 'orderNo,createdAt', tz: 'Asia/Shanghai' }); }, ['2024-01-01 17:00:00']);
run('csv', function () { mt.csv(c.find(), 'orderNo,customer.name,remark,coupon,qty,amount'); }, [
  'orderNo,customer.name,remark,coupon,qty,amount', 'SO1,张三,NULL,,2,1299.50', 'SO2,Alice,,VIP10,(无字段),88'
]);
run('getIndexes', function () { t(c.getIndexes()); }, ['orderNo_1', 'customer.name_1_createdAt_-1']);
run('listDatabases', function () { t(db.adminCommand({ listDatabases: 1 }).databases); }, ['| mtest ']);
run('currentOp', function () { t(db.currentOp({ active: true }).inprog, 'opid,secs_running,op,ns,client,desc'); }, ['| opid ']);
run('rs.status members', function () { t(rs.status().members, 'name,stateStr,health,optimeDate'); }, ['PRIMARY']);
run('rs.status subtable', function () { t(rs.status(), 'set,myState,members.name,members.stateStr'); }, ['set: rs0', '── members (1) ──', 'PRIMARY']);
run('rs.conf members', function () { t(rs.conf().members); }, ['| host ', 'votes']);
run('serverStatus', function () { t(db.serverStatus(), 'connections,opcounters'); }, ['connections.current: ', 'opcounters.insert: ']);
run('$collStats', function () { t(c.aggregate([{ $collStats: { count: {} } }])); }, ['mtest.orders']);
run('getCollectionInfos', function () { t(tdb.getCollectionInfos(), 'name,type,options'); }, ['| orders | collection | {}      |']);
run('explain', function () { g(c.find({ orderNo: 'SO1' }).explain(), { depth: 1 }); }, ['queryPlanner.winningPlan: ']);
run('empty result', function () { t(c.find({ _id: 999 })); }, ['Empty set']);
run('primitives', function () { t([1, 'a', null]); g({ a: 1 }); }, ['| value |', '| NULL  |', 'a: 1']);
run('lang en', function () { mt.config({ lang: 'en' }); t(c.find(), { cols: 'orderNo,qty', limit: 2 }); mt.config({ lang: 'zh' }); }, [
  '| SO2     | (missing) |', 'use t(x, {limit: 200}) to see more'
]);
run('missingText', function () { t(c.find(), { cols: 'orderNo,qty', missingText: '-' }); }, ['| SO2     |   - |']);
run('config', function () { mt.config(); }, ['"limit":50']);
run('help', function () { mt.help(); }, ['mt.csv(x, ...)']);
// ── DBA 命令 ──
run('mt.cmds', function () { mt.cmds(); }, ['| mt.ps({secs, ns, all, sort}) | SHOW PROCESSLIST ', 'mt.config({showCmd: false})']);
run('mt.ps', function () { mt.ps(); }, ['-- db.adminCommand({currentOp: 1, active: true})']);
run('mt.ps slow query', function () {
  for (var i = 0; i < 20 && !db.currentOp({ ns: 'mtslow.slow' }).inprog.length; i++) sleep(500);
  mt.ps({ ns: 'mtslow.slow' });
}, ['| mtslow.slow |', '$where']);
run('mt.ps secs filter', function () { mt.ps({ secs: 100000 }); }, ['Empty set']);
run('mt.ps all', function () { mt.ps({ all: true, cols: 'opid,secs,op,client' }); }, ['| opid ']);
// mt.ps 排序：取出某一列的数字，检查顺序
function psCol(col, opts) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { mt.ps(Object.assign({ all: true, cols: col, table: true, showCmd: false, limit: 0 }, opts)); } finally { G.print = realPrint; }
  var v = [];
  lines.join('\n').split('\n').forEach(function (l) { var m = /^\|\s*(\d+)\s*\|$/.exec(l); if (m) v.push(Number(m[1])); });
  return v;
}
function orderOk(v, dir) {
  for (var i = 1; i < v.length; i++) if ((v[i] - v[i - 1]) * dir < 0) return false;
  return v.length > 1;
}
run('mt.ps sort desc', function () { var v = psCol('secs', {}); print(orderOk(v, -1) ? 'order ok' : 'order bad ' + v); }, ['order ok']);
run('mt.ps sort asc', function () { var v = psCol('secs', { sort: 'asc' }); print(orderOk(v, 1) ? 'order ok' : 'order bad ' + v); }, ['order ok']);
run('mt.ps sort opid', function () { var v = psCol('opid', { sort: 'opid' }); print(orderOk(v, 1) ? 'order ok' : 'order bad ' + v); }, ['order ok']);
run('mt.ps sort doc', function () { var v = psCol('opid', { sort: { opid: -1 } }); print(orderOk(v, -1) ? 'order ok' : 'order bad ' + v); }, ['order ok']);
run('mt.ps bad sort', function () { mt.ps({ sort: 'x' }); }, ["mongotab: mt.ps() 的 sort 可以是 'desc'"]);
run('mt.ps ns filter', function () { mt.ps({ ns: 'nosuchdb' }); }, ['Empty set']);
// mt.slow：在单独的库里开 profiler（slowms 0 记下所有操作），用完关掉
var pdb = db.getSiblingDB('mtprof');
pdb.dropDatabase();
pdb.c.insert({ a: 1 });
pdb.runCommand({ profile: 1, slowms: 0 });
pdb.c.find({ a: 1 }).toArray();
pdb.c.find({ $where: 'sleep(50) || true' }).toArray();   // 更慢、更晚的一条
run('mt.slow', function () { mt.slow('mtprof', { table: true }); }, ['-- db.getSiblingDB(\'mtprof\').system.profile.find({}).sort({ts: -1})', 'level: 1', 'slowms: 0', '| mtprof.c ', '| ts ']);
run('mt.slow ns filter', function () { mt.slow(pdb, { ns: 'c', cols: 'ns,op,docsExamined,command', showCmd: false }); }, ['| mtprof.c | query ', '{find: c, filter: {a: 1}']);
run('mt.slow sort desc', function () { mt.slow('mtprof', { limit: 1, cols: 'command' }); }, ['$where', '(共 2 行，只显示前 1 行)']);
run('mt.slow sort asc', function () { mt.slow('mtprof', { sort: 'asc', limit: 1, cols: 'command' }); }, ['.sort({ts: 1})', '{find: c, filter: {a: 1}']);
run('mt.slow sort ms', function () { mt.slow('mtprof', { sort: 'ms', limit: 1, cols: 'ms,command' }); }, ['.sort({millis: -1, ts: -1})', '$where']);
run('mt.slow sort doc', function () { mt.slow('mtprof', { sort: { millis: 1 }, limit: 1, cols: 'command' }); }, ['.sort({millis: 1})', '{find: c, filter: {a: 1}']);
run('mt.slow bad sort', function () { mt.slow('mtprof', { sort: 'x' }); }, ["mongotab: mt.slow() 的 sort 可以是 'desc'"]);
run('mt.slow ms filter', function () { mt.slow('mtprof', { ms: 100000000 }); }, ['.find({millis: {$gte: 100000000}})', 'Empty set']);
pdb.runCommand({ profile: 0, slowms: 100 });
pdb.dropDatabase();
run('mt.slow profiler off', function () { mt.slow('mtnoprof'); }, ['level: 0', 'Empty set', '没有开 profiler']);
run('mt.top totals', function () { mt.top({ interval: 0, ns: 'mtest' }); }, ['-- db.adminCommand({top: 1})，启动以来累计', '| mtest.orders ', '| totalMs |']);
run('mt.top', function () { mt.top(); }, ['-- db.adminCommand({top: 1})，间隔 1 秒采样两次']);
// mt.locks：fsyncLock 期间，run.sh 起的写入循环会排队等全局锁
run('mt.locks none', function () { mt.locks(); }, ['-- db.adminCommand({lockInfo: 1})', '没有在等锁的操作']);
run('mt.locks', function () {
  db.fsyncLock();
  try {
    for (var i = 0; i < 40 && !db.currentOp({ waitingForLock: true, ns: 'mtlock.c' }).inprog.length; i++) sleep(250);
    mt.locks({ table: true });
  } finally { db.fsyncUnlock(); }
}, ['| HOLD ', 'fsyncLockWorker', '| WAIT ', '| mtlock.c ']);
run('mt.locks all', function () { mt.locks({ all: true }); }, ['-- db.adminCommand({lockInfo: 1})']);
// mt.txns：4.0 起才有事务；开一个不提交的事务
var TXN = (function () { var v = db.version().split('.'); return Number(v[0]) >= 4; })();
if (TXN) {
  var xdb = db.getSiblingDB('mtx'); xdb.c.drop(); xdb.createCollection('c');
  var sess = db.getMongo().startSession();
  sess.startTransaction();
  sess.getDatabase('mtx').c.insertOne({ a: 1 });
  run('mt.txns', function () { mt.txns({ table: true }); }, ['-- db.adminCommand({currentOp: 1, $all: true})', '| lsid ', '| idle ', '| openSecs ']);
  run('mt.txns secs filter', function () { mt.txns({ secs: 100000 }); }, ['Empty set']);
  run('mt.txns sort asc', function () { mt.txns({ sort: 'asc', cols: 'state,openSecs' }); }, ['| idle  ']);
  sess.abortTransaction();
}
run('mt.txns bad sort', function () { mt.txns({ sort: 'x' }); }, ["mongotab: mt.txns() 的 sort 可以是 'desc'"]);
run('mt.txns none', function () { mt.txns(); }, ['没有未提交的事务']);
run('mt.frag', function () { mt.frag('mtest'); }, ["-- db.getSiblingDB('mtest').getCollectionInfos()", '| orders ', '| reusable ', '合计可回收 ']);
run('mt.frag db handle', function () { mt.frag(tdb, { cols: 'name,storage', showCmd: false }); }, ['| orders ']);
run('mt.cache', function () { mt.cache(); }, ['-- db.serverStatus().wiredTiger.cache', 'used: ', '| ns ', '| mtest.orders ', '以上集合在缓存里合计 ']);
run('mt.cache db', function () { mt.cache('mtest', { cols: 'ns,cached' }); }, ['| mtest.orders ']);
run('mt.log', function () { mt.log({ cols: 'time,sev,comp,ctx,msg' }); }, ["-- db.adminCommand({getLog: 'global'})", '| time ', '| sev ', '| comp ', '(共 ', '只显示最后 20 行)']);
run('mt.log n', function () { mt.log(3, { cols: 'sev,msg', table: true }); }, ['3 rows in set', '只显示最后 3 行)']);
run('mt.log grep', function () { mt.log('connection accepted', { n: 2, cols: 'comp,msg', table: true }); }, ['| NETWORK ', 'onnection accepted']);
run('mt.log regex', function () { mt.log(/connection ACCEPTED/i, { n: 1, cols: 'msg', table: true }); }, ['onnection accepted', '1 row in set']);
run('mt.log sev', function () { mt.log({ sev: 'E', n: 5, cols: 'sev,msg' }); }, ["-- db.adminCommand({getLog: 'global'})"]);
run('mt.log startup', function () { mt.log({ startup: true, n: 50, cols: 'msg', maxCol: 0, table: true }); }, ["getLog: 'startupWarnings'", 'Access control']);
run('mt.log bad sev', function () { mt.log({ sev: 'x' }); }, ["mongotab: mt.log() 的 sev 可以是 'F'"]);
run('mt.repl', function () { mt.repl(); }, ['-- rs.status()', 'set: rs0', '| name ', '| PRIMARY ', '| lagSecs |', '1 row in set']);
run('mt.dbs', function () { mt.dbs(); }, ['| mtest ', '合计 ']);
run('mt.colls', function () { mt.colls('mtest'); }, ['| orders | ', '| name   | count | size ']);
run('mt.colls db handle', function () { mt.colls(tdb, { cols: 'name,count', showCmd: false }); }, ['| orders |     3 |']);
run('mt.idx', function () { mt.idx('orders'.length ? 'mtest.orders' : ''); }, ['| _id_ ', '{_id: 1}', '| orderNo_1 ', 'unique']);
run('mt.idx coll object', function () { mt.idx(c, 'name,key,options'); }, ['| customer.name_1_createdAt_-1 | {customer.name: 1, createdAt: -1} |']);
run('mt.idx missing', function () { mt.idx('nope_no_such'); }, ['mongotab: 集合 test.nope_no_such 不存在']);
run('mt.conns', function () { mt.conns(); }, ['current: ', '| client ', '| conns |']);
run('mt.oplog', function () { mt.oplog(); }, ['-- rs.printReplicationInfo()', 'maxSize: ', 'firstEvent: ', 'window: ']);
run('mt.status', function () { mt.status(); }, ['role: PRIMARY (rs0)', 'ops/s.insert: ', 'connections.current: ']);
run('mt.status totals', function () { mt.status({ interval: 0, cols: 'opcounters' }); }, ['opcounters.insert: ']);
run('mt.status en', function () { mt.config({ lang: 'en' }); mt.idx(); mt.config({ lang: 'zh' }); }, ["mongotab: mt.idx() needs a collection"]);

run('reload', function () { load('mongotab.js'); t([{ ok: 1 }]); }, ['MongoTab ' + mt.version, '| ok |']);

finish();
