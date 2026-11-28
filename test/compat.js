// MongoTab compatibility test. Run with test/run.sh, or directly against a
// single-node replica set from the repo root:
//   mongosh "mongodb://localhost:27017/test?directConnection=true" test/compat.js
// Exits non-zero if any case throws or misses an expected piece of output.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL);
mt.config({ lang: 'zh', tz: 'UTC' });
// 抓下一段输出（不打印），用来检查“没有出现什么”
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}

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
run('help', function () { mt.help(); }, ['mt.csv(x, ...)', '  选项（每次调用时传', "tz ('UTC')", 'limit (50)', 'showCmd (true)', "mt.help('ps')", '显示约定：']);
// ── DBA 命令 ──
run('mt.cmds', function () { mt.cmds(); }, ['── 运行状态 ──', '── 慢查询和执行计划 ──', '── 存储和索引 ──', '── 复制 ──',
  '| mt.ps({secs, ns, all, sort}) | SHOW PROCESSLIST ', 'mt.config({showCmd: false})', "mt.help('ps') 看某个命令的详细用法"]);
// 每个命令都有中英文的详细帮助
var ALL_CMDS = ['host', 'latency', 'desc', 'planCache', 'check', 'ps', 'slow', 'top', 'locks', 'txns', 'repl', 'dbs', 'colls', 'frag', 'idx', 'unusedIdx', 'dupIdx', 'builds',
  'explain', 'explainLog', 'logQuery', 'conns', 'oplog', 'status', 'cache', 'ttl', 'log', 'vars', 'engine', 'qstats', 'rsconf', 'profile', 'shards', 'balancer', 'pool', 'users', 'mem', 'cursors', 'flow', 'initialSync', 'concern', 'elections'];
run('mt.help each command', function () {
  var bad = [];
  ['zh', 'en'].forEach(function (lang) {
    mt.config({ lang: lang });
    ALL_CMDS.forEach(function (k) {
      var o = capOut(function () { mt.help(k); });
      if (o.indexOf('mt.' + k + '() — ') !== 0 || o.indexOf('MySQL: ') < 0 || !/(用法：|Usage:)\n  mt\./.test(o)) bad.push(lang + ':' + k);
      if (typeof mt[k] !== 'function') bad.push('no mt.' + k);
    });
  });
  mt.config({ lang: 'zh' });
  print(bad.length ? 'bad: ' + bad.join(' ') : 'all ' + ALL_CMDS.length + ' ok');
}, ['all 42 ok']);
run('mt.help one', function () { mt.help('mt.slow()'); mt.cmds('ps'); }, ['mt.slow() — 慢查询（profiler）    MySQL: mysql.slow_log', '用法：', '选项：', '输出：', '说明：', '另见：mt.explainLog()',
  'mt.ps() — 正在执行的操作', 'opid          操作 ID']);
run('mt.help unknown', function () { mt.help('nope'); }, ["没有叫 nope 的命令。可以看：'host'、'mem'、'vars'"]);
run('mt.ps', function () { mt.ps(); }, ["-- db.getSiblingDB('admin').aggregate([{$currentOp: {allUsers: true}}, {$match: {active: true}}, {$sort: {secs_running: -1}}, {$limit: 21}])，去掉 $currentOp 自己、内部线程和驱动心跳的长轮询"]);
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
// 条数在服务端截断（多取一条看还有没有）；按服务端排不了的列排时全部取回来，知道总数
// 默认最多列 20 个（多取一条），这一次给了 limit 就按它；不跟 mt.config() 的 limit
run('mt.ps limit 50', function () { mt.ps({ limit: 50 }); }, ['{$sort: {secs_running: -1}}, {$limit: 51}]']);
run('mt.ps ignores config limit', function () { mt.config({ limit: 5 }); try { mt.ps(); } finally { mt.config({ limit: 50 }); } }, ['{$sort: {secs_running: -1}}, {$limit: 21}]']);
run('mt.ps more', function () { mt.ps({ all: true, limit: 1, cols: 'opid' }); }, ['{$limit: 2}]', '1 row in set', '只列了前 1 个，还有更多：{limit: 0} 全部列出']);
run('mt.ps sort client-side', function () { mt.ps({ all: true, sort: { client: 1 }, limit: 1, cols: 'opid' }); }, ["{$currentOp: {allUsers: true, idleConnections: true}}])，去掉 $currentOp 自己", '1 row in set  (共 ']);
run('mt.ps filters on server', function () { mt.ps({ secs: 5, ns: 'mtslow' }); }, ['{$match: {active: true, secs_running: {$gte: 5}, $or: [{ns: mtslow}, {ns: {$regex: ^mtslow\\.}}]}}']);
// mt.builds：打开让建索引停在中途的 fail point（4.4 起和之前名字不同），写入 mtbuild.go，
// run.sh 起的 builder 就会开始建 {a: 1, b: 1}；看完关掉 fail point，等它建完
var BUILD_FPS = ['hangAfterIndexBuildDumpsInsertsFromBulk', 'hangAfterStartingIndexBuild'];
// 不存在的 fail point：老 shell 返回 {ok: 0}，mongosh 抛异常
var buildFp = BUILD_FPS.filter(function (f) { try { return db.adminCommand({ configureFailPoint: f, mode: 'alwaysOn' }).ok; } catch (e) { return false; } });
var bdb = db.getSiblingDB('mtbuild');
bdb.go.insertOne({ go: 1 });
var building = function () {
  return db.adminCommand({ currentOp: 1, $all: true }).inprog.some(function (op) { return /index build/i.test(op.msg || ''); });
};
for (var bi = 0; bi < 60 && !building(); bi++) sleep(250);
run('mt.builds', function () { mt.builds({ table: true }); }, ["-- db.getSiblingDB('admin').aggregate([{$currentOp: {allUsers: true, idleConnections: true}}])", '| mtbuild.c ', '| a_1_b_1 ', '{a: 1, b: 1}', '| phase ']);
buildFp.forEach(function (f) { db.adminCommand({ configureFailPoint: f, mode: 'off' }); });
// 建完的标准：索引已出现、建索引线程已结束、客户端的 createIndexes 也已返回（8.0 上它会多等一会儿提交）
var createPending = function () {
  return db.adminCommand({ currentOp: 1, $all: true }).inprog.some(function (op) { return op.command && op.command.createIndexes && /^mtbuild\./.test(op.ns || ''); });
};
var built = function () { return bdb.c.getIndexes().some(function (ix) { return ix.name === 'a_1_b_1'; }) && !building() && !createPending(); };
for (bi = 0; bi < 60 && !built(); bi++) sleep(250);
run('mt.builds none', function () { mt.builds(); }, ['没有正在建的索引']);
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
run('mt.slow sort desc', function () { mt.slow('mtprof', { limit: 1, cols: 'command' }); }, ['$where', '只列了前 1 条，还有更多：{limit: 0} 全部列出，{count: true} 算出总数']);
// 总数只在 {count: true} 时算（平时多取一条看还有没有更多）
run('mt.slow count', function () { mt.slow('mtprof', { limit: 1, cols: 'command', count: true, showCmd: false }); }, ['(共 2 行，只显示前 1 行)']);
run('mt.slow sort asc', function () { mt.slow('mtprof', { sort: 'asc', limit: 1, cols: 'command' }); }, ['.sort({ts: 1})', '{find: c, filter: {a: 1}']);
run('mt.slow sort ms', function () { mt.slow('mtprof', { sort: 'ms', limit: 1, cols: 'ms,command' }); }, ['.sort({millis: -1, ts: -1})', '$where']);
run('mt.slow sort doc', function () { mt.slow('mtprof', { sort: { millis: 1 }, limit: 1, cols: 'command' }); }, ['.sort({millis: 1})', '{find: c, filter: {a: 1}']);
run('mt.slow bad sort', function () { mt.slow('mtprof', { sort: 'x' }); }, ["mongotab: mt.slow() 的 sort 可以是 'desc'"]);
// mt.explain(行号)：对上一次 mt.slow() 列出的行做 explain
run('mt.explainLog slow row', function () { mt.slow('mtprof', { sort: 'asc', limit: 1, showCmd: false, cols: '#,command' }); mt.explainLog(1); }, [
  '| 1 | {find: c, filter: {a: 1}}', '慢日志里记录的执行情况', 'planSummary: COLLSCAN', 'docsExamined: 1', 'durationMillis: ',
  "-- db.getSiblingDB('mtprof').runCommand({explain: {find: c, filter: {a: 1}}", 'COLLSCAN'
]);
run('mt.logQuery slow row', function () { mt.slow('mtprof', { sort: 'asc', limit: 1, showCmd: false, cols: '#' }); mt.logQuery(1); }, [
  '// 慢日志：', 'COLLSCAN', "db.getSiblingDB('mtprof').c.find({a: 1})"
]);
run('mt.explainLog no row', function () { mt.explainLog(99); }, ['mongotab: 没有第 99 行']);
// explain 时去掉的字段列出来（$db 不算，它决定在哪个库上执行）
run('mt.explainLog dropped', function () {
  mt.explainLog({ find: 'orders', filter: { qty: 2 }, lsid: { id: 1 }, readConcern: { level: 'majority' }, $db: 'mtest', $readPreference: { mode: 'primary' } }, { showCmd: false });
}, ['explain 时去掉了 lsid、readConcern、$readPreference：会话、事务、读写关注和分片路由用的字段']);
// mt.log 的 Slow query 行（4.4 起是 JSON，带命令；之前是纯文本）。slowms 现在是 0，所有操作都会记日志
var V44 = (function () { var v = db.version().split('.').map(Number); return v[0] > 4 || (v[0] === 4 && v[1] >= 4); })();
tdb.orders.find({ 'customer.name': 'Zed' }).toArray();
// 4.4 起日志是 JSON，之前是文本，两种都能 explain
run('mt.explainLog log row', function () { mt.log(/Zed/, { n: 1, cols: '#,msg' }); mt.explainLog(1); },
  // 4.2 及之前 getLog 每行只留前 512 个字符，行尾的耗时可能被截掉
  ['| 1 | ', '慢日志里记录的执行情况', 'planSummary: IXSCAN', "-- db.getSiblingDB('mtest').runCommand({explain: {find: orders, filter: {customer.name: Zed}", 'IXSCAN']
    .concat(V44 ? ['durationMillis: '] : []));
run('mt.slow ms filter', function () { mt.slow('mtprof', { ms: 100000000 }); }, ['.find({millis: {$gte: 100000000}})', 'Empty set']);
// mt.profile：mtprof 开着 level 1、slowms 0
// 4.4 之前 mt.profile() 先看有没有占着库写锁的操作和多文档事务。test/run.sh 的 writer 用 mongosh 时一直在做可重试写入，
// 它们在 $currentOp 里也带 transaction（只有 txnNumber，没有 autocommit: false），不能当成事务，这几个测试照常读出 level
run('mt.profile', function () {
  var out = capOut(function () { mt.profile('mtprof'); });
  print(out);
  print(/\| mtprof \|\s+1 \|/.test(out) ? 'level 1' : 'no level row');
}, ["-- db.getSiblingDB('mtprof'): db.getProfilingStatus()", 'slowms: 0', 'sampleRate: 1', '| db ', '| level |', '| docs ', ' / 1.0 MB', '| oldest ',
  'level 1', '注意：slowms 是 0：所有操作都算慢操作']);
// level 2、system.profile 很小很快写满：两条提示
run('mt.profile notes', function () {
  var p2 = db.getSiblingDB('mtprof2'); p2.dropDatabase(); p2.c.insertOne({ a: 1 });
  p2.createCollection('system.profile', { capped: true, size: 8192 });
  p2.runCommand({ profile: 2 });
  for (var i = 0; i < 100; i++) p2.c.find({ a: i }).toArray();
  var out = capOut(function () { mt.profile('mtprof2', { showCmd: false }); });
  p2.runCommand({ profile: 0 }); p2.dropDatabase();
  print(/level 2 的库（mtprof2）/.test(out) ? 'level2 note' : out);
  print(/system\.profile 已经满了、只存了不到 1 小时（mtprof2/.test(out) ? 'short note' : out);
}, ['level2 note', 'short note']);
pdb.runCommand({ profile: 0, slowms: 100 });
pdb.dropDatabase();
run('mt.slow profiler off', function () { mt.slow('mtnoprof'); }, ['level: 0', 'Empty set', '没有开 profiler']);
run('mt.profile all', function () {
  var out = capOut(function () { mt.profile(); });
  print(/slowms: 100/.test(out) && !/slowms 是 0/.test(out) ? 'slowms 100, no note' : out);
  print(/\| admin /.test(out) && /\| local /.test(out) ? 'all dbs' : out);
}, ['slowms 100, no note', 'all dbs']);
run('mt.top totals', function () { mt.top({ interval: 0, ns: 'mtest' }); }, ['-- db.adminCommand({top: 1})，启动以来累计', '| mtest.orders ', '| totalMs |']);
// mt.latency：采样时 run.sh 起的写入循环会往 mtlock.c 写；累计模式下 mtest.orders 有读
run('mt.latency', function () { mt.latency({ table: true }); }, ['-- db.serverStatus().opLatencies; every user db', '间隔 1 秒采样两次', 'writes.avgMs: ', 'writes.ops/s: ', '| mtlock.c ', '| writeOps ']);
run('mt.latency totals', function () { mt.latency('mtest', { interval: 0, table: true }); }, ['启动以来累计', 'reads.ops: ', '| mtest.orders ', '| readOps ']);
// quick：只看整台，不探集合，也不列集合表
run('mt.latency quick', function () {
  var out = capOut(function () { mt.latency({ quick: true }); });
  print(/^-- db\.serverStatus\(\)\.opLatencies，间隔 1 秒采样两次/.test(out) && !/collStats/.test(out) ? 'server only cmd' : out);
  print(/writes\.ops\/s: /.test(out) && !/\| ns /.test(out) && !/readOps/.test(out) ? 'no collection table' : out);
}, ['server only cmd', 'no collection table']);
run('mt.latency quick totals', function () { mt.latency({ quick: true, interval: 0, showCmd: false }); }, ['reads.ops: ', 'commands.ops: ']);
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
  run('mt.txns', function () { mt.txns({ table: true }); }, ["-- db.getSiblingDB('admin').aggregate([{$currentOp: {allUsers: true, idleConnections: true}}])", '| lsid ', '| idle ', '| openSecs ']);
  run('mt.txns secs filter', function () { mt.txns({ secs: 100000 }); }, ['Empty set']);
  run('mt.txns sort asc', function () { mt.txns({ sort: 'asc', cols: 'state,openSecs' }); }, ['| idle  ']);
  sess.abortTransaction();
}
run('mt.txns bad sort', function () { mt.txns({ sort: 'x' }); }, ["mongotab: mt.txns() 的 sort 可以是 'desc'"]);
run('mt.txns none', function () { mt.txns(); }, ['没有未提交的事务']);
run('mt.frag', function () { mt.frag('mtest'); }, ["-- db.getSiblingDB('mtest').getCollectionInfos()", '| orders ', '| disk ', '| reusable ', '| indexDisk ', '合计可回收 ']);
run('mt.frag db handle', function () { mt.frag(tdb, { cols: 'name,disk', showCmd: false }); }, ['| orders ']);
run('mt.cache', function () { mt.cache(); }, ['-- db.serverStatus().wiredTiger.cache', 'used: ', '| ns ', '| dataCached ', '| indexCached ', '| mtest.orders ', '以上集合在缓存里合计 ']);
run('mt.cache db', function () { mt.cache('mtest', { cols: 'ns,cached' }); }, ['| mtest.orders ']);
// 逐个集合查的命令：maxColls / budgetMs 到了就停；打开的文件和连接到了上限的 80% 也停（_maxOpenFiles 只给测试用，把上限调低）
run('mt.cache maxColls', function () { mt.cache({ maxColls: 1, showCmd: false }); }, ['只查了前 1/', ' 个集合（maxColls 1）：可以调大 maxColls / budgetMs']);
run('mt.colls open files', function () { mt.colls('mtest', { _maxOpenFiles: 10, showCmd: false }); }, ['只查了前 0/', '（打开的文件和连接 ', ' 已接近上限 10 的 80%）', 'Too many open files']);
run('mt.latency maxColls', function () { mt.latency({ interval: 0, maxColls: 1, showCmd: false }); }, ['只查了前 1/']);
run('mt.config maxColls', function () {
  mt.config({ maxColls: 1 });
  try { mt.dupIdx({ showCmd: false }); mt.ttl({ showCmd: false }); } finally { mt.config({ maxColls: 1000 }); }
}, ['只查了前 1/']);
run('mt.colls maxColls 0', function () { mt.colls('mtest', { maxColls: 0, showCmd: false }); }, ['| orders ']);
run('mt.log', function () { mt.log({ cols: 'time,sev,comp,ctx,msg' }); }, ["-- db.adminCommand({getLog: 'global'})", '| time ', '| sev ', '| comp ', '(共 ', '只显示最后 20 行)']);
run('mt.log n', function () { mt.log(3, { cols: 'sev,msg', table: true }); }, ['3 rows in set', '只显示最后 3 行)']);
run('mt.log grep', function () { mt.log('connection accepted', { n: 2, cols: 'comp,msg', table: true }); }, ['| NETWORK ', 'onnection accepted']);
run('mt.log regex', function () { mt.log(/connection ACCEPTED/i, { n: 1, cols: 'msg', table: true }); }, ['onnection accepted', '1 row in set']);
run('mt.log sev', function () { mt.log({ sev: 'E', n: 5, cols: 'sev,msg' }); }, ["-- db.adminCommand({getLog: 'global'})"]);
run('mt.log startup', function () { mt.log({ startup: true, n: 50, cols: 'msg', maxCol: 0, table: true }); }, ["getLog: 'startupWarnings'", 'Access control']);
run('mt.log bad sev', function () { mt.log({ sev: 'x' }); }, ["mongotab: mt.log() 的 sev 可以是 'F'"]);
// mt.ttl：先停掉 TTL 线程，再放一条 2 天前的文档（过期时间 1 小时），它就会一直超期。
// 放在单独的库里：建时间序列集合会顺带建 system.views，影响 mt.colls('mtest')
db.adminCommand({ setParameter: 1, ttlMonitorEnabled: false });
var tt = db.getSiblingDB('mtttl'); tt.dropDatabase();
var ev = tt.events;
ev.createIndex({ at: 1 }, { expireAfterSeconds: 3600 });
ev.insertOne({ at: new Date(Date.now() - 2 * 86400000) });
var VER = db.version().split('.').map(Number);
if (VER[0] >= 5) tt.createCollection('ts', { timeseries: { timeField: 't' }, expireAfterSeconds: 86400 });
if (VER[0] >= 6) tt.createCollection('cl', { clusteredIndex: { key: { _id: 1 }, unique: true }, expireAfterSeconds: 7200 });
run('mt.ttl', function () { mt.ttl('mtttl', { table: true }); }, [
  "-- db.getSiblingDB('mtttl'): getCollectionInfos()", 'ttlMonitorEnabled: false', 'ttlMonitorSleepSecs: 60',
  '| mtttl.events ', '| at_1 ', '| at ', '|               3600 | 1h 0m '
].concat(VER[0] >= 5 ? ['| mtttl.ts ', '(timeseries)'] : []).concat(VER[0] >= 6 ? ['| mtttl.cl ', '(clustered)'] : []));
run('mt.ttl overdue', function () {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { mt.ttl(tt, { cols: 'ns,overdueSecs', showCmd: false }); } finally { G.print = realPrint; }
  var m = /\| mtttl\.events \|\s+(\d+) \|/.exec(lines.join('\n'));
  var secs = m ? Number(m[1]) : -1;
  print(secs > 2 * 86400 - 3600 - 600 && secs < 2 * 86400 - 3600 + 600 ? 'overdue ok' : 'overdue bad ' + secs);
}, ['overdue ok']);
run('mt.ttl all dbs', function () { mt.ttl({ cols: 'ns,index' }); }, ['| mtttl.events ']);
db.adminCommand({ setParameter: 1, ttlMonitorEnabled: true });
tt.dropDatabase();
run('mt.ttl none', function () { mt.ttl('nottl'); }, ['Empty set', '没有 TTL 索引']);
// 索引体检：单独的库 mtidx。a_1 ⊂ a_1_b_1 ⊂ a_1_b_1_c_1 是冗余；u_1 是唯一索引、p_1 只被部分索引覆盖、
// d_-1 方向不同，都不算冗余。a_1_b_1_c_1 用过一次，其余都没用过
var ixd = db.getSiblingDB('mtidx'); ixd.dropDatabase();
var ic = ixd.c;
ic.insertOne({ a: 1, b: 1, c: 1, u: 1, v: 1, p: 1, q: 1, d: 1, e: 1 });
[[{ a: 1 }], [{ a: 1, b: 1 }], [{ a: 1, b: 1, c: 1 }], [{ u: 1 }, { unique: true }], [{ u: 1, v: 1 }],
  [{ p: 1, q: 1 }, { partialFilterExpression: { p: { $gt: 0 } } }], [{ p: 1 }], [{ d: -1 }], [{ d: 1, e: 1 }]]
  .forEach(function (x) { ic.createIndex(x[0], x[1] || {}); });
ic.find({ a: 1, b: 1, c: 1 }).hint('a_1_b_1_c_1').toArray();
// 取出表格里 mtidx.c 那几行的索引名
function idxNames(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  var names = [];
  lines.join('\n').split('\n').forEach(function (l) { var m = /^\| mtidx\.c \| (\S+) /.exec(l); if (m) names.push(m[1]); });
  return names.sort().join(',');
}
run('mt.dupIdx', function () { mt.dupIdx('mtidx', { table: true }); }, [
  "-- db.getSiblingDB('mtidx'): each collection getIndexes()", '| coveredBy ', '| a_1     | {a: 1}       |', '| a_1_b_1 '
]);
run('mt.dupIdx rows', function () {
  var got = idxNames(function () { mt.dupIdx('mtidx', { cols: 'ns,index', showCmd: false }); });
  print(got === 'a_1,a_1_b_1' ? 'dup ok' : 'dup bad ' + got);
}, ['dup ok']);
// 刚建的索引计数开始（since）不到 7 天：默认不列，{days: 0} 才列出来
var hideOk = Number(db.version().split('.')[0]) > 4 || db.version().indexOf('4.4') === 0;
run('mt.unusedIdx', function () { mt.unusedIdx(ixd, { table: true, days: 0 }); }, [
  "-- db.getSiblingDB('mtidx'): each collection", 'accesses.ops = 0', 'node: ', 'uptime: ', '| u_1 ', 'unique',
  '计数只是本节点 ', hideOk ? "先 db.集合.hideIndex('名字') 观察一段时间，再 dropIndex" : '再 dropIndex（4.4 起可以先 hideIndex 观察）'
]);
run('mt.unusedIdx young', function () { mt.unusedIdx(ixd, { table: true }); }, [
  'accesses.since ≥ 7 days ago', 'Empty set', '没有没被用过的索引', '另有 8 个索引计数开始不到 7 天（since 太近），没列出；{days: 0} 全部列出'
]);
run('mt.unusedIdx rows', function () {
  var got = idxNames(function () { mt.unusedIdx('mtidx', { cols: 'ns,index', showCmd: false, days: 0 }); });
  print(got === 'a_1,a_1_b_1,d_-1,d_1_e_1,p_1,p_1_q_1,u_1,u_1_v_1' ? 'unused ok' : 'unused bad ' + got);
}, ['unused ok']);
// 分片键：在分片的 mongod 上从 config.cache.collections 读，这里假造一条；以分片键开头的索引标 shardKey
run('mt.unusedIdx shard key', function () {
  var cc = db.getSiblingDB('config').getCollection('cache.collections');
  cc.insertOne({ _id: 'mtidx.c', key: { p: 1 }, unique: false });
  var out;
  try { out = capOut(function () { mt.unusedIdx('mtidx', { cols: 'index,options', days: 0, showCmd: false }); }); } finally { cc.deleteOne({ _id: 'mtidx.c' }); }
  var flagged = out.split('\n').filter(function (l) { return /shardKey/.test(l); }).map(function (l) { return l.split('|')[1].trim(); }).sort().join(',');
  print(flagged === 'p_1,p_1_q_1' ? 'shard key ok' : 'shard key bad ' + flagged + '\n' + out);
}, ['shard key ok']);
run('mt.dupIdx all dbs', function () { mt.dupIdx({ cols: 'ns,index' }); }, ['| mtidx.c ']);
run('mt.unusedIdx all dbs', function () { mt.unusedIdx({ cols: 'ns,index', days: 0 }); }, ['| mtidx.c ']);
run('mt.dupIdx none', function () { mt.dupIdx('mtest'); }, ['Empty set', '没有冗余索引']);
ixd.dropDatabase();
// mt.explain：mtest.orders 上有 customer.name_1_createdAt_-1 索引；amount / qty 上没有索引
run('mt.explain index', function () { mt.explain(c.find({ 'customer.name': 'Alice' }), { table: true, analyze: true }); }, [
  "-- cursor.explain('executionStats')", 'engine: classic', 'totalKeysExamined: 1', 'nReturned: 1', 'IXSCAN', '| customer.name_1_createdAt_-1 ', 'FETCH'
]);
run('mt.explain collscan sort', function () { mt.explain(c.find({ amount: { $gt: 1 } }).sort({ qty: -1 }), { table: true, analyze: true }); }, [
  'SORT', 'COLLSCAN', '全表扫描', '内存排序', '注意：', 'docsExaminedPerReturned: '
]);
// 默认只看计划，不执行：没有 executionTimeMillis / nReturned 这些执行统计
run('mt.explain default plan only', function () {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { mt.explain(c.find({ 'customer.name': 'Bob' })); } finally { G.print = realPrint; }
  var outText = lines.join('\n');
  print(outText);
  print(/executionTimeMillis|nReturned:|totalDocsExamined/.test(outText) ? 'has stats' : 'no stats');
}, ["-- cursor.explain('queryPlanner')", 'IXSCAN', 'no stats']);
run('mt.explain analyze false', function () { mt.explain(c.find({ 'customer.name': 'Bob' }), { analyze: false }); }, ["-- cursor.explain('queryPlanner')", 'IXSCAN']);
run('mt.explain aggregate', function () {
  mt.explain(c.explain('executionStats').aggregate([{ $match: { qty: { $gte: 1 } } }, { $group: { _id: '$qty', n: { $sum: 1 } } }]), { table: true });
}, ['engine: ', 'COLLSCAN', '全表扫描']);
// 慢日志里的命令：去掉 mongos / 驱动加的字段
run('mt.explainLog command doc', function () {
  mt.explainLog({ find: 'orders', filter: { 'customer.name': 'Alice' }, sort: { createdAt: -1 }, limit: 5,
    projection: { $sortKey: { $meta: 'sortKey' } }, shardVersion: [new Date(0), ObjectId()],
    lsid: { id: UUID('3b241101-e2bb-4255-8caf-4136c566a962') }, $db: 'mtest' }, { table: true, analyze: true });
}, ["-- db.getSiblingDB('mtest').runCommand({explain: {find: orders, filter: {customer.name: Alice}, sort: {createdAt: -1}, limit: 5}, verbosity: 'executionStats'})", 'IXSCAN', 'nReturned: 1']);
// 4.4 起的 JSON 日志行：{$date: ...} 要换回日期，否则查不到
run('mt.explainLog json log line', function () {
  mt.explainLog('{"t":{"$date":"2026-01-01T00:00:00.000+00:00"},"s":"I","c":"COMMAND","id":51803,"ctx":"conn1","msg":"Slow query",' +
    '"attr":{"type":"command","ns":"mtest.orders","command":{"find":"orders","filter":{"createdAt":{"$gte":{"$date":"2024-01-01T00:00:00.000Z"}}},"$db":"mtest"},' +
    '"planSummary":"COLLSCAN","keysExamined":0,"docsExamined":3,"nreturned":2,"numYields":0,"reslen":321,"remote":"10.0.0.1:5555",' +
    '"storage":{"data":{"bytesRead":{"$numberLong":"2048"},"timeReadingMicros":1500}},"durationMillis":321}}', { analyze: true });
}, ['慢日志里记录的执行情况', 'time: 2026-01-01 00:00:00', 'durationMillis: 321', 'planSummary: COLLSCAN', 'docsExaminedPerReturned: 1.5',
  'bytesRead: 2.0 KB', 'readMs: 1.5', 'client: 10.0.0.1:5555', "db.getSiblingDB('mtest')", 'COLLSCAN', 'nReturned: 2']);
// 慢日志里的计划和现在一样时不提示
run('mt.explainLog json same plan', function () {
  var o = capOut(function () {
    mt.explainLog('{"t":{"$date":"2026-01-01T00:00:00.000+00:00"},"msg":"Slow query","attr":{"ns":"mtest.orders","command":{"find":"orders","filter":{"qty":2},"$db":"mtest"},"planSummary":"COLLSCAN","durationMillis":5}}');
  });
  print(o.indexOf('慢日志里用的是') < 0 ? 'no plan note' : 'plan note');
}, ['no plan note']);
// 4.4 之前的文本日志行：shell 写法，字段名不带引号（带点）、Timestamp / ObjectId / BinData(十六进制) / 超大整数
run('mt.explainLog text log line', function () {
  mt.explainLog('2026-11-21T15:46:55.624+0000 I COMMAND  [conn2166] command mtest.orders appName: "order-service" command: find { find: "orders", ' +
    'filter: { customer.name: "Alice", amount: { $in: [ 88, 5 ] } }, projection: { $sortKey: { $meta: "sortKey" } }, sort: { createdAt: -1 }, limit: 20, ' +
    "shardVersion: [ Timestamp(0, 0), ObjectId('000000000000000000000000') ], $clusterTime: { clusterTime: Timestamp(1795276015, 2), " +
    'signature: { hash: BinData(0, D9414CF6101A9BBBE43BC15ACE884BFEDC177A72), keyId: 7710591826859655200 } }, ' +
    '$client: { application: { name: "order-service" }, mongos: { host: "h:3067", client: "[fdbd::410]:59008" } }, $db: "mtest" } ' +
    'planSummary: COLLSCAN keysExamined:0 docsExamined:1005163 hasSortStage:1 nreturned:1 465ms', { analyze: true });
}, ["-- db.getSiblingDB('mtest').runCommand({explain: {find: orders, filter: {customer.name: Alice, amount: {$in: [88, 5]}}, sort: {createdAt: -1}, limit: 20}, verbosity: 'executionStats'})",
  'IXSCAN', 'nReturned: 1',
  '慢日志里记录的执行情况', 'time: 2026-11-21 15:46:55.624', 'durationMillis: 465', 'planSummary: COLLSCAN', 'keysExamined: 0', 'docsExamined: 1005163',
  'nreturned: 1', 'docsExaminedPerReturned: 1005163', 'hasSortStage: true', 'appName: order-service', 'client: [fdbd::410]:59008',
  '注意：慢日志里用的是 COLLSCAN，现在的计划是 IXSCAN { customer.name: 1, createdAt: -1 }']);
run('mt.explainLog text log date', function () {
  mt.explainLog('2026 I COMMAND  [conn1] command mtest.orders command: find { find: "orders", filter: { createdAt: { $gte: new Date(1704067200000) } }, $db: "mtest" } planSummary: COLLSCAN 3ms', { analyze: true });
}, ['nReturned: 2']);
run('mt.explainLog text log update', function () {
  mt.explainLog('2026 I WRITE    [conn5] update mtest.orders command: { q: { orderNo: "SO2" }, u: { $set: { explained: true } }, multi: false, upsert: false } planSummary: IXSCAN 3ms');
  print('written: ' + c.find({ explained: true }).count());
}, ["runCommand({explain: {update: orders, updates: [{q: {orderNo: SO2}", 'UPDATE', 'written: 0']);
run('mt.explainLog shell-style command', function () { mt.explainLog('{ find: "orders", filter: { qty: 2 } }', { db: 'mtest', analyze: true }); }, ["db.getSiblingDB('mtest')", 'COLLSCAN', 'nReturned: 1']);
run('mt.explainLog command only', function () {
  var o = capOut(function () { mt.explainLog({ find: 'orders', filter: { qty: 2 } }, { db: 'mtest' }); });
  print(o.indexOf('慢日志里记录') < 0 ? 'no record' : 'has record');
}, ['no record']);
run('mt.explainLog display text', function () { mt.explainLog('{find: s02orders, filter: {status: shipped}}'); }, ['mongotab: 解析不了这段文字']);
run('mt.explainLog insert', function () { mt.explainLog({ insert: 'orders', documents: [{ a: 1 }] }); }, ['mongotab: insert 命令不能 explain']);
run('mt.explain bad input', function () { mt.explain(); mt.explain(1); mt.explainLog({ a: 1 }); mt.explainLog(); }, [
  'mongotab: mt.explain() 只接受游标或 explain 的结果；慢日志里的行号、日志行、命令请用 mt.explainLog(...)', 'mongotab: a 命令不能 explain',
  'mongotab: mt.explainLog() / mt.logQuery() 需要慢日志里的东西']);
// mt.logQuery：把慢日志转成 mongosh 语句（不执行），类型照原样
run('mt.logQuery text line', function () {
  mt.logQuery('2026-11-21T15:46:55.624+0000 I COMMAND  [conn2166] command mtest.orders appName: "order-service" command: find { find: "orders", ' +
    'filter: { customer.name: "Alice", amount: { $in: [ 88, 5 ] }, createdAt: { $gte: new Date(1704067200000) }, oid: ObjectId(\'65a1b2c3d4e5f60718293a4b\'), big: 9007199254740993 }, ' +
    'projection: { $sortKey: { $meta: "sortKey" } }, sort: { createdAt: -1 }, skip: 0, limit: 20, shardVersion: [ Timestamp(0, 0), ObjectId(\'000000000000000000000000\') ], $db: "mtest" } ' +
    'planSummary: COLLSCAN keysExamined:0 docsExamined:1005163 nreturned:1 465ms');
}, ['// 慢日志：2026-11-21 15:46:55.624，465ms，COLLSCAN，docsExamined 1005163，nreturned 1，order-service',
  "db.getSiblingDB('mtest').orders.find({'customer.name': 'Alice', amount: {$in: [88, 5]}, createdAt: {$gte: ISODate('2024-01-01T00:00:00.000Z')}, " +
  "oid: ObjectId('65a1b2c3d4e5f60718293a4b'), big: NumberLong('9007199254740993')}).sort({createdAt: -1}).limit(20)"]);
run('mt.logQuery runs', function () {
  // 生成的语句真的能执行：Alice 的 amount 是 88
  var o = capOut(function () { mt.logQuery({ find: 'orders', filter: { 'customer.name': 'Alice', amount: { $in: [88, 5] } }, sort: { createdAt: -1 } }, { db: 'mtest' }); });
  var code = o.split('\n').filter(function (l) { return l.indexOf('db.') === 0; })[0];
  var r;
  if (typeof require === 'function') {
    // mongosh：new Function 里的代码不会被自动 await；写进文件再 load()，和在 shell 里粘贴执行一样
    require('fs').writeFileSync('/tmp/mt-logquery.js', 'globalThis.__mtq = ' + code + '.toArray();');
    load('/tmp/mt-logquery.js');
    r = G.__mtq;
  } else {
    r = (new Function('db', 'return ' + code + '.toArray();'))(db);
  }
  print('rows: ' + r.length + ' ' + (r[0] && r[0].orderNo));
}, ['rows: 1 SO2']);
// 写操作默认给只看计划的 explain（执行它不改数据），原语句注释掉；{raw: true} 才给可以直接执行的
run('mt.logQuery update', function () {
  var line = '2026 I WRITE    [conn5] update mtest.orders command: { q: { orderNo: "SO2" }, u: { $set: { x: 1 } }, multi: true, upsert: false } planSummary: IXSCAN 3ms';
  var out = capOut(function () { mt.logQuery(line); });
  print(out);
  var ex = out.split('\n').filter(function (l) { return /^db\.getSiblingDB\('mtest'\)\.runCommand\(\{explain: /.test(l); })[0];
  var before = tdb.orders.find({ orderNo: 'SO2', x: 1 }).count();
  var r = ex ? eval(ex) : null;   // eslint-disable-line no-eval
  print(r && r.ok === 1 && r.queryPlanner && tdb.orders.find({ orderNo: 'SO2', x: 1 }).count() === before ? 'explain ran, nothing changed' : 'explain line: ' + ex + ' ' + JSON.stringify(r));
  mt.logQuery(line, { raw: true });
}, ['// 注意：原语句是写操作，执行会修改数据。下面是只看执行计划、不执行的 explain', "verbosity: 'queryPlanner'})",
  "// db.getSiblingDB('mtest').orders.updateMany({orderNo: 'SO2'}, {$set: {x: 1}})", 'explain ran, nothing changed',
  '// 注意：这是写操作，执行会修改数据', "\ndb.getSiblingDB('mtest').orders.updateMany({orderNo: 'SO2'}, {$set: {x: 1}})"]);
run('mt.logQuery others', function () {
  mt.logQuery({ aggregate: 'orders', pipeline: [{ $match: { qty: 2 } }, { $group: { _id: '$qty', n: { $sum: 1 } } }], cursor: {}, allowDiskUse: true, $db: 'mtest' });
  mt.logQuery({ count: 'orders', query: { qty: 2 }, $db: 'mtest' });
  mt.logQuery({ distinct: 'orders', key: 'qty', query: {}, $db: 'mtest' });
  mt.logQuery({ delete: 'orders', deletes: [{ q: { qty: 9 }, limit: 1 }], $db: 'mtest' });
  mt.logQuery({ find: 'stats', filter: { a: 'it\'s' }, $db: 'mtest' });
}, ["db.getSiblingDB('mtest').orders.aggregate([{$match: {qty: 2}}, {$group: {_id: '$qty', n: {$sum: 1}}}], {allowDiskUse: true})",
  "db.getSiblingDB('mtest').orders.count({qty: 2})", "db.getSiblingDB('mtest').orders.distinct('qty', {})",
  "db.getSiblingDB('mtest').orders.deleteOne({qty: 9})", "db.getSiblingDB('mtest').getCollection('stats').find({a: 'it\\'s'})"]);

run('mt.repl', function () { mt.repl(); }, ['-- rs.status()', 'set: rs0', '| name ', '| PRIMARY ', '| lagSecs |', '1 row in set']);
run('mt.dbs', function () { mt.dbs(); }, ['| name ', '| disk ', '| mtest ', '合计 ']);
run('mt.colls', function () { mt.colls('mtest'); }, ['| orders | ', '| name   | count | logical | disk ']);
run('mt.colls db handle', function () { mt.colls(tdb, { cols: 'name,count', showCmd: false }); }, ['| orders |     3 |']);
run('mt.idx', function () { mt.idx('orders'.length ? 'mtest.orders' : ''); }, ['| _id_ ', '{_id: 1}', '| disk ', '| orderNo_1 ', 'unique']);
run('mt.idx coll object', function () { mt.idx(c, 'name,key,options'); }, ['| customer.name_1_createdAt_-1 | {customer.name: 1, createdAt: -1} |']);
run('mt.idx missing', function () { mt.idx('nope_no_such'); }, ['mongotab: 集合 test.nope_no_such 不存在']);
run('mt.conns', function () { mt.conns(); }, ['current: ', '| client ', '| conns |']);
run('mt.oplog', function () { mt.oplog(); }, ['-- rs.printReplicationInfo()', 'maxLogical: ', 'usedLogical: ', 'fill: ', 'disk: ', 'firstEvent: ', 'window: ',
  'oplog 还没写满（用了 ', '不到 1 小时，估不出写满后能覆盖多久']);
// Some servers (6.0.28 on GitHub's x86 runners) return hostInfo without `extra`, so maxOpenFiles is only expected when it is there.
var hostExtra = db.adminCommand({ hostInfo: 1 }).extra || {};
run('mt.host', function () { mt.host(); }, ['-- db.hostInfo()', 'host.hostname: ', 'host.platform: 容器（', 'mongod 是 1 号进程', 'host.cpuCores: ', 'host.memory: ', 'os.type: Linux',
  'mongod.version: ' + db.version(), 'mongod.edition: ', 'mongod.storageEngine: wiredTiger', 'mongod.uptime: ', 'startup.argv: mongod', 'startup.replSet: rs0'].concat(hostExtra.maxOpenFiles != null ? ['os.maxOpenFiles: '] : []));
run('mt.host cols', function () { mt.host('mongod.version'); }, ['mongod.version: ' + db.version()]);
// mt.vars：运行参数；4.2 起有 runtime 一列（能不能在运行时改）
var hasDetails = false;   // 4.2 起；不支持时 mongosh 会抛错，老 shell 返回 ok: 0
try { hasDetails = !!db.adminCommand({ getParameter: { allParameters: true, showDetails: true } }).ok; } catch (e) { }
run('mt.vars filter', function () { mt.vars('ttlMonitor'); }, hasDetails
  ? ['-- db.adminCommand({getParameter: {allParameters: true, showDetails: true}})', '| name ', '| value ', '| runtime |', '| ttlMonitorEnabled ', '| ttlMonitorSleepSecs ']
  : ["-- db.adminCommand({getParameter: '*'})", '| name ', '| value |', '| ttlMonitorEnabled ', '| ttlMonitorSleepSecs ']);
run('mt.vars no runtime column before 4.4', function () {
  var out = capOut(function () { mt.vars('ttlMonitorEnabled'); });
  print(/\| runtime \|/.test(out) === hasDetails ? 'runtime column right' : out);
  print(/\| ttlMonitorEnabled\s+\| true\s+\|/.test(out) ? 'value right' : out);
}, ['runtime column right', 'value right']);
run('mt.vars wildcard and regex', function () { mt.vars('featureCompat*', { showCmd: false }); mt.vars(/^ttlMonitorSleep/); }, [
  '| featureCompatibilityVersion | {version: ' + db.version().split('.').slice(0, 2).join('.') + '}', '| ttlMonitorSleepSecs ', '1 row in set'
]);
run('mt.vars limit', function () { mt.vars({ limit: 2, showCmd: false }); }, ['2 rows in set  (共 ']);
run('mt.vars none', function () { mt.vars('noSuchParameterX'); }, ['没有名字里含 noSuchParameterX 的参数']);
// mt.engine：WiredTiger 的状态；4.4 起有 updates 和 history store，8.0 起检查点没有 running
var v8 = Number(db.version().split('.')[0]) >= 8;
run('mt.engine', function () { mt.engine(); }, [
  '-- db.serverStatus().wiredTiger，间隔 1 秒采样两次，带 /s 的是每秒的量', 'cache.max: ', 'cache.used: ', '%)', 'cache.dirty: ', 'cache.read/s: ',
  'cache.evicted/s: ', 'cache.appEvicted/s: 0', 'cache.aggressive: ', 'checkpoint.count: ', 'checkpoint.lastMs: ', 'tickets.read: ', 'tickets.write: ',
  'journal.syncs/s: ', 'disk.written/s: ', 'handles.data: ', 'handles.files: '
].concat(hideOk ? ['cache.updates: ', 'historyStore.disk: '] : []).concat(v8 ? [] : ['checkpoint.running: ']));
run('mt.engine versions', function () {
  var out = capOut(function () { mt.engine({ interval: 0 }); });
  print(/cache\.updates:/.test(out) === hideOk && /historyStore\.disk:/.test(out) === hideOk ? 'updates/history store right' : out);
  print(/checkpoint\.running:/.test(out) === !v8 ? 'running right' : out);
  print(/\/s:/.test(out) ? out : 'totals, no /s');
}, ['updates/history store right', 'running right', 'totals, no /s', ]);
// mt.qstats：查询效率计数；全表扫描 4.4 起，排序落盘和计划缓存 7.0 起，maxTimeMS 8.0 起
var vmaj = Number(db.version().split('.')[0]), v44 = hideOk;
run('mt.qstats', function () { mt.qstats(); }, [
  '-- db.serverStatus().metrics，间隔 1 秒采样两次，带 /s 的是每秒的量', 'read.keysExamined/s: ', 'read.docsExamined/s: ', 'read.returned/s: ',
  'scans.inMemorySorts/s: ', 'write.inserted/s: ', 'write.conflicts/s: ', 'cursors.open: ', 'cursors.timedOut/s: '
].concat(v44 ? ['scans.collScans/s: ', 'scans.collScansNonTailable/s: '] : []).concat(vmaj >= 7 ? ['scans.sortSpills/s: ', 'planCache.hits/s: '] : [])
  .concat(vmaj >= 8 ? ['killed.maxTimeMS/s: '] : []));
run('mt.qstats totals', function () {
  var qd = db.getSiblingDB('mtqs'); qd.dropDatabase(); qd.t.insertMany([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  var before = db.serverStatus().metrics.queryExecutor.scannedObjects;
  qd.t.find({ a: 3 }).toArray();   // 没有索引：扫 4 条返回 1 条
  var out = capOut(function () { mt.qstats({ interval: 0, showCmd: false }); });
  print(/\/s:/.test(out) ? out : 'totals, no /s');
  print(/read\.docsPerReturned: [\d.]+/.test(out) ? 'has ratio' : out);
  print(/scans\.collScans:/.test(out) === v44 ? 'collScans right' : out);
  print(/killed\.maxTimeMS:/.test(out) === (vmaj >= 8) ? 'maxTimeMS right' : out);
  var m1 = /read\.docsExamined: (\d+)/.exec(out);
  print(m1 && Number(m1[1]) >= Number(before) + 4 ? 'docsExamined counted' : out);
  qd.dropDatabase();
}, ['totals, no /s', 'has ratio', 'collScans right', 'maxTimeMS right', 'docsExamined counted']);
run('mt.qstats cols', function () {
  var out = capOut(function () { mt.qstats('read'); });
  print(/read\.returned\/s:/.test(out) && !/write\./.test(out) && !/cursors\./.test(out) ? 'only read' : out);
}, ['only read']);
// mt.rsconf：测试用的单节点副本集，一个成员、一票：没有可选的列，也没有提示
run('mt.rsconf', function () { mt.rsconf(); }, [
  '-- rs.conf(); rs.status(); db.adminCommand({getDefaultRWConcern: 1})', 'set: rs0', 'version: ', 'protocolVersion: 1', 'chainingAllowed: true',
  'electionTimeoutMillis: 10000', '| id | host ', '| state   | priority | votes |', '| PRIMARY |        1 |     1 |', '1 row in set'
]);
// mt.elections：测试用的单节点副本集，一个成员一票。最近一次选举和按原因分的次数 4.0 后期版本起才有，3.6 打印一行说明；
// 换主记录只有建好时的那一次，是现在的主节点（有换主的样子在 test/elect.js）
run('mt.elections', function () {
  var hasEm = !!db.serverStatus().electionMetrics, me = rs.status().members.filter(function (x) { return x.self; })[0].name;
  var out = capOut(function () { mt.elections(); });
  print(/set: rs0/.test(out) && /state: PRIMARY/.test(out) && /voters: 1 个有投票权，选主要 1 票/.test(out) ? 'head' : out);
  print(hasEm ? (/── 最近一次选举（这个主节点当选）──/.test(out) && /\| cause +\| called \| successful \|/.test(out) ? 'metrics' : out) :
    (/这个版本没有选举的原因和统计/.test(out) ? 'metrics' : out));
  print(out.indexOf('换主记录用 mt.elections({history: true}) 看') >= 0 ? 'history hint' : out);
  var h = capOut(function () { mt.elections({ history: true, showCmd: false }); });
  print(h.split('\n').some(function (l) { return / 1 \| /.test(l) && l.indexOf(' ' + me + ' | status ') > 0 && /（至今）/.test(l); }) ? 'history' : h);
  print(h.indexOf('换主记录用') < 0 && !/24 小时内换了/.test(h) && h.indexOf('注意：oplog 从') < 0 ? 'no notes' : h);
  // 默认只扫最近 24 小时：命令带 ts 下限；hours: 0 是整个 oplog；范围里没有换主时说明
  var c24 = capOut(function () { mt.elections({ history: true }); }), all = capOut(function () { mt.elections({ history: true, hours: 0 }); });
  print(/find\(\{ts: \{\$gte: Timestamp\(\d+, 0\)\}, op: 'n'/.test(c24) && /── 最近 24 小时的换主（oplog 里成功当选的记录，新的在前）──/.test(c24) ? 'hours 24' : c24);
  print(/find\(\{op: 'n'/.test(all) && /── 换主（整个 oplog 里成功当选的记录，新的在前）──/.test(all) && / 1 \| /.test(all) ? 'hours 0' : all);
  var none = capOut(function () { mt.elections({ history: true, hours: 0.0001, showCmd: false }); });   // 最近 0.36 秒
  print(/这段时间 oplog 里没有换主的记录/.test(none) ? 'none in range' : none);
}, ['head', 'metrics', 'history hint', 'history', 'no notes', 'hours 24', 'hours 0', 'none in range']);
run('mt.shards not mongos', function () { mt.shards(); }, ['mt.shards() 要连 mongos（分片集群的路由）']);   // 分片集群的测试在 test/shard.js
run('mt.balancer not mongos', function () { mt.balancer(); }, ['mt.balancer() 要连 mongos（分片集群的路由）']);
// 用户和自定义角色（这里没开认证；开了认证的情况在 test/auth.js）。测完删掉
(function () {
  var a = db.getSiblingDB('admin'), d = db.getSiblingDB('mtusr');
  var tryIt = function (fn) { try { fn(); return true; } catch (e) { return false; } };
  d.createRole({ role: 'reporter', privileges: [{ resource: { db: 'mtusr', collection: 'orders' }, actions: ['find'] }], roles: [{ role: 'read', db: 'mtusr' }] });
  a.createRole({ role: 'mtmon', privileges: [{ resource: { cluster: true }, actions: ['serverStatus'] }], roles: ['clusterMonitor'] });
  // mechanisms 4.0 起才有：只给 SHA-1
  if (!tryIt(function () { d.createUser({ user: 'app', pwd: 'x', roles: ['readWrite', 'reporter'], mechanisms: ['SCRAM-SHA-1'] }); })) d.createUser({ user: 'app', pwd: 'x', roles: ['readWrite', 'reporter'] });
  d.createUser({ user: 'nobody', pwd: 'x', roles: [] });
  a.createUser({ user: 'mtops', pwd: 'x', roles: ['root'] });
  a.createUser({ user: 'mtmon', pwd: 'x', roles: ['mtmon', { role: 'read', db: 'mtusr' }] });
})();
run('mt.users', function () {
  var out = capOut(function () { mt.users(); });
  print(/-- db\.adminCommand\(\{usersInfo: \{forAllDBs: true\}\}\)/.test(out) && /authorization: disabled/.test(out) ? 'header' : out);
  print(/\| mtmon +\| admin \| mtmon, read@mtusr +\|/.test(out) && /\| mtops +\| admin \| root +\|/.test(out) &&
    /\| app +\| mtusr \| readWrite, reporter \|/.test(out) && /\| nobody +\| mtusr \| +\|/.test(out) ? 'users' : out);
  print(/\| mechanisms +\|/.test(out) === (vmaj >= 4) ? 'mechanisms column right' : out);
  print(/\| mtmon +\| admin \| clusterMonitor \| cluster: serverStatus +\| +1 \|/.test(out) &&
    /\| reporter +\| mtusr \| read +\| mtusr\.orders: find +\| +1 \|/.test(out) ? 'roles' : out);
  print(/注意：没开认证/.test(out) ? 'no auth note' : out);
  print(/注意：能给自己授予任何权限的用户：[^\n]*mtops@admin/.test(out) ? 'power note' : out);
  print(/注意：没有任何角色的用户：nobody@mtusr/.test(out) ? 'no roles note' : out);
  print(/注意：只能用 SCRAM-SHA-1 登录的用户：app@mtusr/.test(out) === (vmaj >= 4) ? 'sha1 note right' : out);
}, ['header', 'users', 'mechanisms column right', 'roles', 'no auth note', 'power note', 'no roles note', 'sha1 note right']);
run('mt.users one db', function () {
  var out = capOut(function () { mt.users(db.getSiblingDB('mtusr'), { showCmd: false }); });
  print(/users: 2\n/.test(out) && /customRoles: 1\n/.test(out) && !/mtops/.test(out) && !/能给自己授予/.test(out) ? 'mtusr only' : out);
}, ['mtusr only']);
(function () {
  var a = db.getSiblingDB('admin'), d = db.getSiblingDB('mtusr');
  d.runCommand({ dropAllUsersFromDatabase: 1 }); d.runCommand({ dropAllRolesFromDatabase: 1 }); a.dropUser('mtops'); a.dropUser('mtmon'); a.dropRole('mtmon');
})();
// 单节点副本集通常没有连出去的连接：要么是空表的提示，要么是表；不该有提示
run('mt.pool', function () {
  var out = capOut(function () { mt.pool(); });
  print(/^-- db\.adminCommand\(\{connPoolStats: 1\}\)\n +inUse: \d+\n/.test(out) ? 'header' : out);
  print(/没有连出去的连接|\| host +\|/.test(out) ? 'rows or none' : out);
  print(/注意：/.test(out) ? out : 'no notes');
  print(/slowWaits: \d+/.test(out) === (vmaj >= 7) ? 'slowWaits right' : out);
  out = capOut(function () { mt.pool({ all: true, showCmd: false }); });
  print(/── 各连接池 ──/.test(out) ? 'per pool' : out);
}, ['header', 'rows or none', 'no notes', 'slowWaits right', 'per pool']);
// mt.mem：常驻内存分成几部分，各部分的比例加起来是 100%；测试机内存很空，不该有提示
run('mt.mem', function () {
  var out = capOut(function () { mt.mem(); });
  print(/^-- db\.serverStatus\(\{tcmalloc: 1\}\)[^\n]*\n +memory: [\d.]+ [KMGT]?B\n/.test(out) ? 'header' : out);
  print(/resident: [\d.]+ [KMG]?B \([\d.]+%\)/.test(out) && /cacheMax: [\d.]+ [KMG]?B \([\d.]+%\)/.test(out) && /connections: \d+/.test(out) ? 'resident, cacheMax' : out);
  print(/── 常驻内存的去向 ──/.test(out) && /\| WiredTiger cache +\| +[\d.]+ [KMG]?B \| +[\d.]+% \| 占上限 [\d.]+%，脏数据 [\d.]+% +\|/.test(out) ? 'cache row' : out);
  print(/\| other in use +\|[^\n]*\| 连接 \d+ 个/.test(out) && /\| tcmalloc free +\|[^\n]*\| 页堆 [\d.]+ [KMG]?B，各级缓存 /.test(out) ? 'tcmalloc rows' : out);
  var sum = 0, re = /\| (WiredTiger cache|other in use|tcmalloc free|outside tcmalloc) +\|[^|]+\| +([\d.]+)% \|/g, mm;
  while ((mm = re.exec(out))) sum += Number(mm[2]);
  print(sum > 99 && sum < 101 || (sum > 0 && sum <= 100.1 && !/outside tcmalloc/.test(out)) ? 'shares add up' : sum + '\n' + out);
  print(/注意：/.test(out) ? out : 'no notes');
}, ['header', 'resident, cacheMax', 'cache row', 'tcmalloc rows', 'shares add up', 'no notes']);
// 把缓存上限临时调到可用内存的 90%，看提示；测完调回来
run('mt.mem big cache', function () {
  var a = db.getSiblingDB('admin'), num = function (v) { return v != null && v.toNumber ? v.toNumber() : Number(v); };
  var max = num(a.runCommand({ serverStatus: 1 }).wiredTiger.cache['maximum bytes configured']), sy = a.runCommand({ hostInfo: 1 }).system;
  var avail = Math.min(num(sy.memSizeMB), sy.memLimitMB != null ? num(sy.memLimitMB) : Infinity);
  a.runCommand({ setParameter: 1, wiredTigerEngineRuntimeConfig: 'cache_size=' + Math.round(avail * 0.9) + 'M' });
  var out = capOut(function () { mt.mem({ showCmd: false }); });
  a.runCommand({ setParameter: 1, wiredTigerEngineRuntimeConfig: 'cache_size=' + Math.round(max / 1048576) + 'M' });
  print(/注意：缓存上限占可用内存的 (89|90)\.\d%/.test(out) ? 'big cache note' : out);
  print(num(a.runCommand({ serverStatus: 1 }).wiredTiger.cache['maximum bytes configured']) === max ? 'restored' : 'not restored');
}, ['big cache note', 'restored']);
// mt.cursors：开三个没读完的游标（一个 noCursorTimeout，一个带 comment 的聚合）；4.2 起逐个列出，之前只有计数
var cur42 = vmaj > 4 || (vmaj === 4 && Number(db.version().split('.')[1]) >= 2), curs = [];
(function () {
  var d = db.getSiblingDB('mtcur'), docs = [];
  d.dropDatabase();
  for (var i = 0; i < 50; i++) docs.push({ _id: i, a: i % 5 });
  d.t.insertMany(docs);
  curs.push(d.t.find({ a: { $gte: 0 } }).batchSize(2));
  curs.push((d.t.find().noCursorTimeout ? d.t.find().noCursorTimeout() : d.t.find().addOption(16)).batchSize(2));
  curs.push(d.t.aggregate([{ $match: { a: 1 } }], { cursor: { batchSize: 1 }, comment: 'mtcur report' }));
  curs.forEach(function (c) { c.next(); });
})();
run('mt.cursors', function () {
  var out = capOut(function () { mt.cursors({ ns: 'mtcur', width: 400, maxCol: 0 }); });
  print(/^-- db\.serverStatus\(\)\.metrics\.cursor[^\n]*\n +open: \d+\n +noTimeout: [1-9]\d*\n +pinned: \d+\n +timedOut: \d+\n/.test(out) && /cursorTimeout: 10m 0s\n *sessionTimeout: 30m 0s/.test(out) ? 'header' : out);
  print(/totalOpened: \d+/.test(out) === (vmaj >= 5) ? 'totalOpened right' : out);
  if (cur42) {
    print((out.match(/\| \d+ +\| mtcur\.t +\| +\d+ \| +\d+ \| +\d+ \| +\d+ \|/g) || []).length === 3 && /3 rows in set/.test(out) ? 'three cursors' : out);
    print(/\| noTimeout +\| COLLSCAN \| \{find: t, filter: \{\}\} +\|/.test(out) ? 'noTimeout row' : out);
    print(/\{comment: mtcur report, aggregate: t, pipeline: \[\{\$match: \{a: 1\}\}\]\} +\|/.test(out) ? 'aggregate with comment' : out);
  } else {
    print(/4\.2 之前 \$currentOp 列不出空闲的游标/.test(out) ? 'three cursors\nnoTimeout row\naggregate with comment' : out);
  }
  print(/注意：有 [1-9]\d* 个 noCursorTimeout 的游标/.test(out) ? 'noTimeout note' : out);
}, ['header', 'totalOpened right', 'three cursors', 'noTimeout row', 'aggregate with comment', 'noTimeout note']);
run('mt.cursors filters', function () {
  var o1 = capOut(function () { mt.cursors({ ns: 'mtcur.other', showCmd: false }); });
  var o2 = capOut(function () { mt.cursors({ ns: 'mtcur', secs: 3600, showCmd: false }); });
  var o3 = capOut(function () { mt.cursors({ ns: 'mtcur.t', showCmd: false }); });
  print(!cur42 || /没有空闲的游标/.test(o1) && /没有空闲的游标/.test(o2) && /mtcur\.t/.test(o3) ? 'filters' : o1 + o2 + o3);
}, ['filters']);
// 空闲超时：把 cursorTimeoutMillis 临时调成 1 秒，开一个游标，等过检查线程（默认 4 秒一次），测完调回来。
// 4.4 之前会被回收，有提示；4.4 起会话里的游标不按它回收，游标还在
run('mt.cursors timed out', function () {
  var a = db.getSiblingDB('admin'), old = a.runCommand({ getParameter: 1, cursorTimeoutMillis: 1 }).cursorTimeoutMillis;
  var reaps = vmaj < 4 || (vmaj === 4 && Number(db.version().split('.')[1]) < 4);
  a.runCommand({ setParameter: 1, cursorTimeoutMillis: 1000 });
  var c = db.getSiblingDB('mtcur').t.find({ a: 4 }).batchSize(2);
  c.next();
  sleep(9000);
  var out = capOut(function () { mt.cursors({ ns: 'mtcur', width: 400, maxCol: 0, showCmd: false }); });
  a.runCommand({ setParameter: 1, cursorTimeoutMillis: old });
  print(/cursorTimeout: 1s/.test(out) && /注意：启动以来有 [1-9]\d* 个游标空闲超过 1s 被回收了/.test(out) === reaps ? 'timed out note right' : out);
  print(!cur42 || /filter: \{a: 4\}/.test(out) === !reaps ? 'session cursor right' : out);
  print(String(a.runCommand({ getParameter: 1, cursorTimeoutMillis: 1 }).cursorTimeoutMillis) === String(old) ? 'restored' : 'not restored');
  db.getSiblingDB('mtcur').dropDatabase();
}, ['timed out note right', 'session cursor right', 'restored']);
// mt.flow：单节点副本集上 flow control 开着、不限流；4.2 之前打印一行（限流时的样子在 test/flow.js）
run('mt.flow', function () {
  var out = capOut(function () { mt.flow({ interval: 0 }); });
  if (cur42) {
    print(/state: PRIMARY\n/.test(out) && /enabled: true\n/.test(out) && /isLagged: false\n/.test(out) && /targetLag: 10s\n/.test(out) && /laggedCount: 0\n/.test(out) ? 'header' : out);
    print(/── 各成员落后主节点 ──/.test(out) && /\| PRIMARY \| +1 \| +0 \| \* +\|/.test(out) && !/注意：/.test(out) ? 'one member, no notes' : out);
  } else print(/flow control 4\.2 起才有/.test(out) ? 'header\none member, no notes' : out);
}, ['header', 'one member, no notes']);
// mt.initialSync：单节点副本集不在初始同步（同步中的样子在 test/isync.js）
run('mt.initialSync', function () { mt.initialSync(); }, [
  '-- db.adminCommand({replSetGetStatus: 1, initialSync: 1}).initialSyncStatus', 'state: PRIMARY', 'sinceStartup: completed 0, failedAttempts 0, failures 0', '这个节点没有在初始同步']);
// mt.concern：单节点副本集、没打开写关注计数（PSA、计数和显式设置的样子在 test/concern.js）
run('mt.concern', function () {
  var out = capOut(function () { mt.concern(); });
  var v44c = vmaj > 4 || (vmaj === 4 && Number(db.version().split('.')[1]) >= 4);
  print((vmaj >= 5 ? /defaultWriteConcern: \{w: majority, wtimeout: 0\} \(implicit\)\n/.test(out) && /defaultReadConcern: \{level: local\} \(implicit\)\n/.test(out) :
    /defaultWriteConcern: \{w: 1, wtimeout: 0\} \(getLastErrorDefaults\)\n/.test(out)) ? 'defaults' : out);
  print(/writeConcern: 没设，用服务端的默认值\n/.test(out) && /readPreference: primary\n/.test(out) ? 'this connection' : out);
  print((v44c ? /写关注没有计数：要在启动时加 --setParameter reportOpWriteConcernCountersInServerStatus=true/.test(out) : /4\.4 之前没有写关注的计数/.test(out)) ? 'no write counts' : out);
  print(/── 读关注的使用次数（启动以来） ──\n\+/.test(out) && !/注意：/.test(out) ? 'read counts, no notes' : out);
}, ['defaults', 'this connection', 'no write counts', 'read counts, no notes']);
run('mt.rsconf versions', function () {
  var conf = rs.conf(), out = capOut(function () { mt.rsconf({ showCmd: false }); });
  print(/term: \d+/.test(out) === (conf.term != null) ? 'term right' : out);
  print(/majorityJournalDefault: true/.test(out) === (conf.writeConcernMajorityJournalDefault === true) ? 'journal right' : out);
  print(/defaultWriteConcern: \{w: majority, wtimeout: 0\} \(implicit\)/.test(out) === (vmaj >= 5) ? 'rwc right' : out);
  print(/\| (arbiter|hidden|delay|tags) /.test(out) || /注意：/.test(out) ? out : 'no optional columns, no notes');
}, ['term right', 'journal right', 'rwc right', 'no optional columns, no notes']);
// mt.rsconf 的提示按 electionMajority / writeMajority 算：writeMajority = min(投票多数, 有投票权的数据节点数)。
// 用 _members 换成各种拓扑的配置（只用来算表和提示）
function rsNotes(members) {
  var out = capOut(function () { mt.rsconf({ showCmd: false, _members: members }); });
  return out.split('\n').filter(function (l) { return /Majority: |注意：|Note: /.test(l); }).map(function (l) { return l.trim(); }).join('\n');
}
function rsD(i, x) { return Object.assign({ _id: i, host: 'd' + i + ':27017', priority: 1, votes: 1 }, x || {}); }
function rsA(i) { return { _id: i, host: 'a' + i + ':27017', arbiterOnly: true, priority: 0, votes: 1 }; }
var rsDl = { priority: 0, hidden: true, secondaryDelaySecs: 3600 };
run('mt.rsconf PSS', function () { print(rsNotes([rsD(0), rsD(1), rsD(2)])); }, ['electionMajority: 2 / 3\nwriteMajority: 2 / 3']);
run('mt.rsconf PSA', function () { print(rsNotes([rsD(0), rsD(1), rsA(2)])); }, [
  'writeMajority: 2 / 2\n注意：有仲裁节点，有投票权的数据节点只有 2 个，w: \'majority\' 的写入要 2 个确认：任何一个数据节点挂掉或者跟不上，majority 写入就等不到确认']);
run('mt.rsconf PSSSA', function () { print(rsNotes([rsD(0), rsD(1), rsD(2), rsD(3), rsA(4)])); }, [
  'electionMajority: 3 / 5\nwriteMajority: 3 / 4\n注意：有仲裁节点：选举能容忍挂掉 2 个成员，w: \'majority\' 的写入只能容忍挂掉 1 个有投票权的数据节点']);
run('mt.rsconf delayed always', function () { print(rsNotes([rsD(0), rsD(1), rsD(2, rsDl), rsA(3)])); }, [
  '注意：有投票权的成员是偶数个（4 个）', '注意：有仲裁节点，有投票权的数据节点只有 3 个，w: \'majority\' 的写入要 3 个确认',
  '注意：延迟成员有投票权（d2:27017）：w: \'majority\' 的写入要 3 个有投票权的数据节点确认，不延迟的只有 2 个，所以每次都要等延迟成员，至少多等 1h 0m']);
run('mt.rsconf delayed later', function () { print(rsNotes([rsD(0), rsD(1), rsD(2), rsD(3), rsD(4, { priority: 0, slaveDelay: 600 })])); }, [
  'writeMajority: 3 / 5\n注意：延迟成员有投票权（d4:27017）：不延迟的数据节点挂掉 2 个后，w: \'majority\' 的写入就要等延迟成员，至少多等 10m 0s']);
run('mt.rsconf non-voting', function () { var x = rsNotes([rsD(0), rsD(1), rsD(2), rsD(3, { votes: 0, priority: 0, secondaryDelaySecs: 60 })]); print(/注意/.test(x) ? x : x + '\nno notes'); }, ['electionMajority: 2 / 3\nwriteMajority: 2 / 3\nno notes']);
run('mt.rsconf en', function () {
  mt.config({ lang: 'en' });
  try { print(rsNotes([rsD(0), rsD(1), rsD(2), rsD(3), rsA(4)])); print(rsNotes([rsD(0), rsD(1), rsD(2), rsD(3, rsDl)])); } finally { mt.config({ lang: 'zh' }); }
}, ["Note: there is an arbiter: elections tolerate 2 members down, but w: 'majority' writes tolerate only 1 voting data-bearing member down",
  "Note: delayed members can vote (d3:27017): once 1 non-delayed data-bearing member is down, w: 'majority' writes wait for a delayed member, at least 1h 0m longer"]);
run('mt.engine cols', function () {
  var out = capOut(function () { mt.engine({ cols: 'checkpoint', interval: 0, showCmd: false }); });
  print(/checkpoint\.count:/.test(out) && !/cache\./.test(out) ? 'only checkpoint' : out);
  var out2 = capOut(function () { mt.engine('cache,checkpoint'); });   // 字符串就是 cols
  print(/cache\.used:/.test(out2) && /checkpoint\.count:/.test(out2) && !/tickets\./.test(out2) ? 'string cols' : out2);
}, ['only checkpoint', 'string cols']);
run('mt.host all', function () { mt.host({ all: true, cols: 'parsed' }); }, ['parsed.replication.']);
run('mt.status', function () { mt.status(); }, ['role: PRIMARY (rs0)', 'ops/s.insert: ', 'connections.current: ']);
run('mt.status totals', function () { mt.status({ interval: 0, cols: 'opcounters' }); }, ['opcounters.insert: ']);
run('mt.status en', function () { mt.config({ lang: 'en' }); mt.idx(); mt.config({ lang: 'zh' }); }, ["mongotab: mt.idx() needs a collection"]);

// mt.check：单独的库里放一对冗余索引；停掉 TTL 线程、fsyncLock 时对应的项要报出来
var ckd = db.getSiblingDB('mtcheck'); ckd.dropDatabase();
ckd.c.insertOne({ a: 1, b: 1 }); ckd.c.createIndex({ a: 1 }); ckd.c.createIndex({ a: 1, b: 1 });
run('mt.check', function () { mt.check({ table: true }); }, [
  '-- serverStatus, currentOp', 'role: PRIMARY (rs0)', 'uptime: ', '| check ', '| 启动警告 ', '| 写入被锁（fsyncLock） | OK ', '| FCV 版本 ', '| 副本集成员 ', '| 复制延迟 ',
  '| oplog 窗口 ', '| 缓存使用率 ', '| 连接数 ', '| 冗余索引 ', '| WARN   | 1 个，共 ', '| 没被用过的索引 ', 'INFO', '| 可回收的磁盘空间 '
]);
run('mt.check problems', function () {
  db.adminCommand({ setParameter: 1, ttlMonitorEnabled: false });
  db.fsyncLock();
  try { mt.check({ quick: true, issues: true, table: true }); } finally { db.fsyncUnlock(); db.adminCommand({ setParameter: 1, ttlMonitorEnabled: true }); }
}, ['| 写入被锁（fsyncLock） | CRIT ', '| TTL 线程 ', '| WARN   | 已停止 ', 'quick: true']);
run('mt.check issues only', function () {
  var o = capOut(function () { mt.check({ issues: true, quick: true }); });
  print(/\| OK\s/.test(o) ? 'has ok' : 'no ok rows');
}, ['no ok rows']);
// 逐个集合的检查只遍历一次，超过 maxColls / budgetMs 就停下，没查到的算 UNKNOWN
run('mt.check maxColls', function () { mt.check({ maxColls: 1, table: true }); }, [
  'per collection (maxColls 1, budgetMs 30000)', '| 冗余索引 ', 'UNKNOWN | 只查了前 1/', ' 个集合（maxColls 1）', "调大 maxColls / budgetMs", '（逐个集合的检查：1/'
]);
run('mt.check budgetMs', function () {
  var out = capOut(function () { mt.check({ budgetMs: 1, table: true }); });
  print(/只查了前 \d+\/\d+ 个集合（budgetMs 1）/.test(out) ? 'budget hit' : out);
}, ['budget hit']);
// 要读票据的命令都带 maxTimeMS，读票据用完时不会一直等。maxTimeAlwaysTimeOut 让带 maxTimeMS 的命令立刻超时，相当于一直拿不到票据
function timeoutAll(fn) {
  db.adminCommand({ configureFailPoint: 'maxTimeAlwaysTimeOut', mode: 'alwaysOn' });
  try { fn(); } finally { db.adminCommand({ configureFailPoint: 'maxTimeAlwaysTimeOut', mode: 'off' }); }
}
run('timeout mt.dbs', function () { timeoutAll(function () { mt.dbs(); }); }, ['mongotab: listDatabases 没在 10000 ms 内返回（maxTimeMS）：服务器可能很忙，或者读票据用完了']);
run('timeout maxTimeMS 0', function () { timeoutAll(function () { mt.dbs({ maxTimeMS: 0 }); }); }, ['| mtcheck ']);
run('timeout mt.colls', function () { timeoutAll(function () { mt.colls('mtcheck'); }); }, ['mongotab: listCollections 没在 10000 ms 内返回']);
run('timeout mt.oplog', function () { timeoutAll(function () { mt.oplog(); }); }, ['mongotab: find local.oplog.rs 没在 10000 ms 内返回']);
run('timeout mt.users', function () { timeoutAll(function () { mt.users(); }); }, [' 没在 10000 ms 内返回（maxTimeMS）']);
run('timeout mt.ps', function () { timeoutAll(function () { mt.ps({ all: true, limit: 1, cols: 'opid' }); }); }, ['1 row in set']);
// 4.4 之前 mt.check() 不查 profiler（profile 命令要拿库锁），这一项是 SKIP
var ckProf44 = vmaj > 4 || (vmaj === 4 && Number(db.version().split('.')[1]) >= 4);
run('timeout mt.check quick', function () { timeoutAll(function () { mt.check({ quick: true, table: true }); }); }, [
  '| oplog 窗口 ', '| UNKNOWN | find local.oplog.rs 超过 maxTimeMS（10000 ms）', '| profiler ',
  ckProf44 ? '| UNKNOWN | 没查：前面的 find local.oplog.rs 已经超过 maxTimeMS（10000 ms）' : '| SKIP    | 4.4 之前查 profile 要拿库锁，可能让写入排队',
  '服务器可能很忙或读票据用完了：mt.ps()、mt.status()'
]);
run('timeout mt.explainLog', function () { timeoutAll(function () { mt.explainLog({ find: 'orders', filter: { qty: 2 }, $db: 'mtest' }); }); }, ['mongotab: explain 没在 10000 ms 内返回（maxTimeMS）']);
// 4.4 之前 profile 命令要拿库锁：库上有占着写锁的操作或没提交的事务时，mt.profile() / mt.slow() 不查这个库，mt.check() 不查这一项。
// 用一个没提交的事务（4.0 起）占着 mtxn；4.4 起照常查
if (vmaj >= 4) {
  run('profile: open transaction', function () {
    var xd = db.getSiblingDB('mtxn'); xd.dropDatabase(); xd.c.insertOne({ a: 1 });
    var ses = db.getMongo().startSession(), sc = ses.getDatabase('mtxn').getCollection('c');
    ses.startTransaction();
    sc.insertOne({ b: 1 });
    try {
      var p = capOut(function () { mt.profile('mtxn', { showCmd: false }); }), sl = capOut(function () { mt.slow('mtxn', { showCmd: false }); });
      var ck = capOut(function () { mt.check({ quick: true, table: true }); });
      if (ckProf44) print(!/没查 level|profiler 的设置没查/.test(p + sl) && /\| mtxn \|\s+0 \|/.test(p) && /\| profiler .*\| OK /.test(ck) ? 'read as usual' : p + '\n' + sl + '\n' + ck);
      else print(/注意：这些库没查 level：mtxn: 没提交的事务（开了 \d+s）/.test(p) && /注意：profiler 的设置没查（没提交的事务（开了 \d+s））/.test(sl) &&
        /\| profiler .*\| SKIP .*4\.4 之前查 profile 要拿库锁/.test(ck) ? 'not read' : p + '\n' + sl + '\n' + ck);
    } finally { ses.abortTransaction(); ses.endSession(); }
    xd.dropDatabase();
  }, [ckProf44 ? 'read as usual' : 'not read']);
}
run('timeout mt.check', function () { timeoutAll(function () { mt.check({ table: true }); }); }, ['| 冗余索引 ', '没查：前面的 find local.oplog.rs', '（有命令超过 maxTimeMS，跳过了逐个集合的检查）']);
run('timeout en', function () { mt.config({ lang: 'en' }); try { timeoutAll(function () { mt.dbs(); }); } finally { mt.config({ lang: 'zh' }); } }, [
  'mongotab: listDatabases did not return within 10000 ms (maxTimeMS): the server may be busy or out of read tickets; mt.ps() and mt.status() need no ticket and still work'
]);
// 缓存、票据、等锁队列、连接数有 CRIT 时，默认跳过逐个集合的检查；{deep: true} 照样做。用阈值把连接数调成 CRIT
run('mt.check under pressure', function () {
  var out = capOut(function () { mt.check({ thresholds: { conns: [0, 0] }, table: true }); });
  print(/（服务器压力大：连接数 是 CRIT，跳过了逐个集合的检查；mt\.check\(\{deep: true\}\) 照样做）/.test(out) && !/冗余索引/.test(out) ? 'skipped' : out);
  out = capOut(function () { mt.check({ thresholds: { conns: [0, 0] }, deep: true, table: true }); });
  print(/（逐个集合的检查：\d+\/\d+ 个集合）/.test(out) && /冗余索引/.test(out) ? 'deep runs it' : out);
}, ['skipped', 'deep runs it']);
run('mt.check no limit', function () {
  var out = capOut(function () { mt.check({ maxColls: 0, budgetMs: 0, table: true }); });
  var m = /（逐个集合的检查：(\d+)\/(\d+) 个集合）/.exec(out);
  print(m && m[1] === m[2] && !/只查了前/.test(out) ? 'all scanned' : out);
}, ['all scanned']);
// 阈值：这一次改、本会话改；值不对时报错，不跑检查
run('mt.check thresholds', function () {
  var dflt = capOut(function () { mt.check({ quick: true, table: true }); });
  var out = capOut(function () { mt.check({ quick: true, table: true, thresholds: { queue: [0, 0], oplog: [0, 0], longOps: [7200, 7200], txns: 90 } }); });
  // 测试实例刚建，oplog 还没写满、时间太短估不出，是 INFO（不看阈值）；等锁队列默认 OK，阈值改成 0 就 CRIT
  print(/oplog 窗口\s*\|\s*INFO\s*\|[^|\n]*还没写满（用了 [\d.]+%），时间太短估不出/.test(dflt) && /oplog 窗口\s*\|\s*INFO/.test(out) ? 'oplog not full' : dflt + out);
  print(/等锁队列\s*\|\s*OK/.test(dflt) && /等锁队列\s*\|\s*CRIT/.test(out) ? 'queue follows' : dflt + out);
  print(/没有超过 60 秒的/.test(dflt) && /没有超过 2 小时的/.test(out) && /开了 90 秒以上/.test(out) ? 'texts follow' : dflt + out);
  print(/改过的阈值/.test(dflt) ? 'default lists changes' : 'default lists none');
  print(out.split('\n').filter(function (l) { return /^改过的阈值/.test(l); }).join('\n'));
}, ['oplog not full', 'queue follows', 'texts follow', 'default lists none',
  '改过的阈值：oplog 0 / 0 小时，queue 0 / 0 个，longOps 7200 / 7200 秒，txns 90 秒']);
run('mt.check bad thresholds', function () {
  var out = capOut(function () {
    mt.check({ thresholds: { lag: 5 } });
    mt.check({ thresholds: { nope: 1 } });
    mt.check({ thresholds: { txns: [1, 2] } });
    mt.check({ thresholds: { lag: [60, 10] } });
    mt.check({ thresholds: { oplog: [3, 24] } });
    mt.check({ thresholds: { conns: [90, 101] } });
    mt.check({ thresholds: { lag: ['10', 60] } });
    mt.check({ thresholds: { lag: [-1, 60] } });
    mt.check({ thresholds: [1] });
  });
  print(out);
  print(/serverStatus|\| check/.test(out) ? 'ran anyway' : 'nothing ran');
}, ['mongotab: lag 要写成 [WARN, CRIT]，如 [10, 60]', 'mongotab: 没有叫 nope 的阈值，可以用：lag、oplog、', 'mongotab: txns 只有 WARN 一档，写一个数，如 30',
  'mongotab: lag 的 WARN 不能大于 CRIT', 'mongotab: oplog 越低越坏，WARN 要大于等于 CRIT', 'mongotab: conns 是百分比，不能超过 100',
  'mongotab: lag 的值要是 ≥ 0 的数字', 'mongotab: thresholds 要写成对象', 'nothing ran']);
run('mt.config checkThresholds', function () {
  mt.config({ checkThresholds: { lag: [30, 300], txns: 120 } });
  mt.config({ checkThresholds: { lag: null, queue: [0, 0] } });   // 按键合并，null 恢复默认
  mt.config();
  try { mt.config({ checkThresholds: { x: 1 } }); } catch (e) { print(e.message); }
  try { mt.check({ quick: true, issues: true, table: true, showCmd: false }); mt.help('check'); } finally { mt.config({ checkThresholds: null }); }
  mt.config();
}, ['"checkThresholds":{"txns":[120],"queue":[0,0]}', 'mongotab: 没有叫 x 的阈值', '| 等锁队列 ', '| CRIT ', '改过的阈值：queue 0 / 0 个，txns 120 秒',
  '阈值（WARN / CRIT；只有一个数的只报 WARN）：', 'queue       0 / 0 个（默认 5 / 50 个）', 'lag         10 / 60 秒', 'oplog 窗口（越低越坏）', '"checkThresholds":null']);
// 查不全时不能显示 OK：用 failCommand 让 aggregate / listDatabases 真的失败（4.0 起才有 failCommand）
var failCmd = function (cmds) {
  try { return db.adminCommand({ configureFailPoint: 'failCommand', mode: 'alwaysOn', data: { failCommands: cmds, errorCode: 2 } }).ok; } catch (e) { return false; }
};
var failOff = function () { try { db.adminCommand({ configureFailPoint: 'failCommand', mode: 'off' }); } catch (e) { } };
var hasFailCmd = failCmd(['mtNoSuchCommand']); failOff();
if (hasFailCmd) {
  run('mt.check aggregate fails', function () {
    failCmd(['aggregate']);
    var out;
    try { out = capOut(function () { mt.check({ table: true }); }); } finally { failOff(); }
    print(/可回收的磁盘空间\s*\|\s*UNKNOWN\s*\|\s*查了 0\/\d+ 个集合，\d+ 个失败/.test(out) ? 'frag unknown' : out);
    print(/可回收的磁盘空间\s*\|\s*OK/.test(out) ? 'frag ok' : 'frag not ok');
    print(/UNKNOWN \d/.test(out) ? 'summary has unknown' : 'summary missing unknown');
  }, ['frag unknown', 'frag not ok', 'summary has unknown']);
  run('mt.check listDatabases fails', function () {
    failCmd(['listDatabases']);
    var out;
    try { out = capOut(function () { mt.check({ issues: true, table: true }); }); } finally { failOff(); }
    // 4.4 之前 profiler 这一项是 SKIP（不列库也不查），{issues: true} 不显示
    (ckProf44 ? ['profiler'] : []).concat(['TTL 超期', '冗余索引', '可回收的磁盘空间']).forEach(function (k) {
      print(new RegExp(k + '\\s*\\|\\s*UNKNOWN').test(out) ? k + ' unknown' : k + ' wrong: ' + out);
    });
  }, (ckProf44 ? ['profiler unknown'] : []).concat(['TTL 超期 unknown', '冗余索引 unknown', '可回收的磁盘空间 unknown']));
  run('mt.frag aggregate fails', function () {
    failCmd(['aggregate']);
    try { mt.frag('mtest', { showCmd: false }); } finally { failOff(); }
  }, ['合计可回收 ']);
} else print('skip failCommand cases: not supported on ' + db.version());
ckd.dropDatabase();
// mt.desc：字段结构；mt.planCache：计划缓存（有两个候选索引的查询才会被缓存）
var dsc = db.getSiblingDB('mtdesc'); dsc.dropDatabase();
dsc.o.insertMany([{ a: 1, s: 'x', n: null, sub: { k: 1 }, arr: [{ q: 1 }], tags: ['t'] }, { a: NumberLong(2), s: 'y', n: 5, sub: { k: 2, j: true }, arr: [{ q: 2 }] },
  { a: 3, s: 'z', when: new Date(0) }]);
dsc.o.createIndex({ s: 1 }); dsc.o.createIndex({ s: 1, a: 1 });
for (var pi = 0; pi < 3; pi++) dsc.o.find({ s: 'x', a: 1 }).toArray();
run('mt.desc', function () { mt.desc(dsc.o, { table: true }); }, [
  "aggregate([{$sample: {size: 1000}}])", 'ns: mtdesc.o', 'type: collection', 'count: 3', 'sampled: 3', 'indexes: _id_, s_1, s_1_a_1',
  '| field ', '| a     | number 67%, long 33% ', '| s     | string ', '| n     | null 50%, number 50% |   66.7% |', '| sub.k | number ', '| sub.j | bool ',
  '| arr   | array<object> ', '| arr.q | number ', '| tags  | array<string> ', '[t]', '| when  | date '
]);
run('mt.desc order', function () {
  // 抽样顺序随机，字段顺序要稳定：按在父文档里的平均位置排（when 在第 3 条里排第 4，和 n 一样，按名字排在 n 后面）
  var o = capOut(function () { mt.desc(dsc.o, { cols: 'field', showCmd: false, table: true }); });
  var f = o.split('\n').map(function (l) { var mm = /^\| (\S+)\s+\|$/.exec(l); return mm ? mm[1] : null; }).filter(function (x) { return x && x !== 'field'; });
  print(f.join(','));
}, ['_id,a,s,n,when,sub,sub.k,sub.j,arr,arr.q,tags']);
run('mt.desc depth', function () { mt.desc('mtdesc.o', { depth: 1, cols: 'field', showCmd: false }); }, ['| sub   |']);
// 视图：只有逐条处理的阶段时取前 N 条；管道里（包括它依赖的视图里）有 $group 等时不执行，{force: true} 才抽样
dsc.createView('v1', 'o', [{ $match: { a: { $gte: 1 } } }, { $project: { s: 1 } }]);
dsc.createView('v2', 'o', [{ $group: { _id: '$s', n: { $sum: 1 } } }]);
dsc.createView('v3', 'v2', [{ $match: { n: 1 } }]);
run('mt.desc view', function () { mt.desc(dsc.v1, { table: true }); }, ['aggregate([{$limit: 1000}])', 'type: view (o)', 'sampled: 3', '取的是前 3 条，不是随机抽样']);
run('mt.desc view blocking', function () { mt.desc(dsc.v3); }, ['视图的管道里有 $group：要先读完 o 的全部数据', "mt.desc('o')"]);
run('mt.desc view force', function () { mt.desc(dsc.v2, { force: true, table: true }); }, ['aggregate([{$sample: {size: 1000}}])', 'sampled: 3']);
if (VER[0] >= 5) {
  dsc.createCollection('ts', { timeseries: { timeField: 't' } });
  dsc.ts.insertMany([{ t: new Date(), v: 1 }, { t: new Date(), v: 2 }]);
  run('mt.desc timeseries', function () { mt.desc(dsc.ts, { table: true }); }, ['aggregate([{$limit: 1000}])', 'type: timeseries', '取的是前 2 条']);
}
// 要抽的超过集合的 5% 时 $sample 会扫全表：集合超过 10 万条时不执行
var big = []; for (var bi = 0; bi < 100001; bi++) big.push({ i: bi });
dsc.big.insertMany(big, { ordered: false }); big = null;
run('mt.desc big sample', function () { mt.desc(dsc.big, { sample: 6000 }); }, ['要抽 6000 条，超过了集合 100001 条的 5%']);
run('mt.desc big sample ok', function () { mt.desc(dsc.big, { sample: 100, showCmd: false, table: true }); }, ['sampled: 100']);
run('mt.planCache', function () { mt.planCache('mtdesc.o', { table: true }); }, ['| shape ', '| plan ', '{s: x, a: 1}', 'IXSCAN']);
run('mt.planCache hash none', function () { mt.planCache(dsc.o, { hash: 'NOPE' }); }, ['Empty set']);
run('mt.desc missing', function () { mt.desc('nope_no_such'); }, ['mongotab: 集合 test.nope_no_such 不存在']);
dsc.dropDatabase();
run('reload', function () { load('mongotab.js'); t([{ ok: 1 }]); }, ['MongoTab ' + mt.version, '| ok |']);

finish();
