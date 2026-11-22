// MongoTab formatting test that needs no database, used to check mongosh on
// Linux, macOS and Windows, and the legacy mongo shell. Run from the repo root:
//   mongosh --nodb test/format.js
//   mongo --nodb test/format.js
// If MONGOTAB_LANG / MONGOTAB_TZ are set (and the shell can read them), the
// load message is checked against them.
load('test/lib.js');

var platform = LEGACY ? (_isWindows() ? 'win32' : 'unix') : process.platform;
var win = platform === 'win32';
var cwd = LEGACY ? pwd() : process.cwd();
print('### env platform=' + platform + ' shell=' + SHELL + (LEGACY ? '' : ' node=' + process.version) +
  ' MONGOTAB_LANG=' + envVar('MONGOTAB_LANG') + ' MONGOTAB_TZ=' + envVar('MONGOTAB_TZ') +
  (ENV_READABLE ? '' : ' (this shell cannot read environment variables)'));

var loadExpect = ['MongoTab '];
if (envVar('MONGOTAB_LANG')) loadExpect.push(/^zh/i.test(envVar('MONGOTAB_LANG')) ? '已加载' : 'loaded:');
if (envVar('MONGOTAB_TZ')) loadExpect.push(envVar('MONGOTAB_TZ'));

run('load relative path', function () { load('mongotab.js'); }, loadExpect);
run('load absolute path, forward slashes', function () {
  load(cwd.replace(/\\/g, '/') + '/mongotab.js');
}, loadExpect);
if (win) {
  run('load absolute path, backslashes', function () { load(cwd + '\\mongotab.js'); }, loadExpect);
}
run('globals defined', function () { print(typeof t, typeof g, typeof mt, mt.version); }, ['function function object']);

mt.config({ lang: 'zh', tz: 'UTC' });

var docs = [
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
];

run('pick columns, CJK alignment', function () { t(docs, 'orderNo,customer,amount,qty,remark,coupon'); }, [
  '| orderNo | customer.name | customer.vip | amount  | qty      | remark   | coupon   |',
  '| SO1     | 张三          | true         | 1299.50 |        2 | NULL     |          |',
  '| SO2     | Alice         | (无字段)     |      88 | (无字段) |          | VIP10    |',
  '3 rows in set'
]);
run('BSON types (vertical)', function () { g(docs[0]); }, [
  'customer.name: 张三', 'big: 9007199254740993', 'createdAt: 2024-01-01 08:30:00.123',
  'ts: 2023-11-14 22:13:20 (1700000000:3)', 'uid: 3b241101-e2bb-4255-8caf-4136c566a962',
  'bin: Binary(0, AAECAwQFBgcICQ==, 10 bytes)', 're: /ab+c/i', 'mk: MinKey', 'Mk: MaxKey',
  'oid: 65a1b2c3d4e5f60718293a4b', 'note: line1\\nline2\\tx', 'tags: [a, b]',
  '── items (2) ──', 'sku: B'
]);
run('maxCol cut', function () { t(docs, { exclude: 'items,tags', table: true, maxCol: 20 }); }, ['2024-01-01 08:30:...', 'Binary(0, AAECAwQ...']);
run('narrow width switches to vertical', function () { t(docs, { cols: 'orderNo,customer.name,amount', width: 20 }); }, [
  '*************************** 1. row ***************************', 'customer.name: 张三'
]);
run('exclude columns', function () { g(docs[0], { exclude: 'items,customer.*,tags' }); }, ['orderNo: SO1']);
run('array limit', function () { t(docs, { cols: 'orderNo', limit: 1 }); }, ['(共 3 行，只显示前 1 行)']);
run('sub-table in a single document', function () {
  t({ set: 'rs0', myState: 1, members: [{ name: 'db1:27017', stateStr: 'PRIMARY' }, { name: 'db2:27017', stateStr: 'SECONDARY' }] },
    'set,members.name,members.stateStr');
}, ['set: rs0', '── members (2) ──', '| db2:27017 | SECONDARY |']);
run('tz +08:00', function () { t(docs, { cols: 'orderNo,createdAt', tz: '+08:00' }); }, ['2024-01-01 16:30:00.123']);
runIanaTz('tz IANA', function () { t(docs, { cols: 'orderNo,createdAt', tz: 'Asia/Shanghai' }); }, ['2024-01-01 17:00:00']);
run('tz local', function () { t(docs, { cols: 'orderNo,createdAt', tz: 'local' }); }, ['| SO1     | 2024-01-0']);
run('csv', function () { mt.csv(docs, 'orderNo,customer.name,remark,coupon,qty,amount'); }, [
  'orderNo,customer.name,remark,coupon,qty,amount', 'SO1,张三,NULL,,2,1299.50', 'SO2,Alice,,VIP10,(无字段),88'
]);
run('color', function () { t(docs, { cols: 'orderNo,qty', color: true }); }, ['\x1b[']);
run('empty array', function () { t([]); }, ['Empty set']);
run('primitives', function () { t([1, 'a', null]); g({ a: 1 }); }, ['| value |', '| NULL  |', 'a: 1']);
run('lang en', function () { mt.config({ lang: 'en' }); t(docs, { cols: 'orderNo,qty', limit: 2 }); mt.config({ lang: 'zh' }); }, [
  '| SO2     | (missing) |', '(showing the first 2 of 3 rows)'
]);
run('missingText', function () { t(docs, { cols: 'orderNo,qty', missingText: '-' }); }, ['| SO2     |   - |']);
run('help', function () { mt.help(); }, ['mt.csv(x, ...)']);

finish();
