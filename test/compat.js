// MongoTab compatibility test. Run with test/run.sh, or directly against a
// single-node replica set from the repo root:
//   mongosh "mongodb://localhost:27017/test?directConnection=true" test/compat.js
// Exits non-zero if any case throws or misses an expected piece of output.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' mongosh=' + version());
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
    ts: Timestamp({ t: 1700000000, i: 3 }), uid: UUID('3b241101-e2bb-4255-8caf-4136c566a962'),
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
run('tz IANA', function () { t(c.find(), { cols: 'orderNo,createdAt', tz: 'Asia/Shanghai' }); }, ['2024-01-01 17:00:00']);
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
run('reload', function () { load('mongotab.js'); t([{ ok: 1 }]); }, ['MongoTab ' + mt.version, '| ok |']);

finish();
