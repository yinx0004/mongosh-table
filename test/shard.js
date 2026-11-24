// MongoTab test on a sharded cluster, through mongos. Run with test/shard.sh,
// which sets up the cluster described there.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (mongos)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
var vmaj = Number(db.version().split('.')[0]);
var hasDist = false;   // 6.0.3 起；不支持时 mongosh 会抛错，老 shell 返回 ok: 0
try { hasDist = !!db.adminCommand({ aggregate: 1, pipeline: [{ $shardedDataDistribution: {} }], cursor: {} }).ok; } catch (e) { }

run('mt.shards', function () { mt.shards(); }, [
  '-- listShards, balancerStatus', 'balancer: off', 'shards: 3', 'shardedCollections: 2',
  '── 分片 ──', '| shard | host ', '| draining |', '| zones |', '| chunks |', '| primaryFor |',
  '| sh1   | sh1/', '| sh2   | sh2/', '| EU ', '| sh3   | sh3/', '| true ', '| shop ', '| crm ',
  '── 分片的集合 ──', '| shop.orders | {customerId: 1} |', '| shop.events | {_id: hashed}   |',
  '注意：均衡器关着', '注意：sh3 正在排空'
]);
run('mt.shards distribution', function () {
  var out = capOut(function () { mt.shards({ showCmd: false }); });
  // shop.orders：按 100 / 200 / 300 切成 4 块，两块移到了 sh2
  print(/\| shop\.orders \| \{customerId: 1\} \|\s+4 \| sh1 2[^|]*sh2 2/.test(out) ? 'orders 4 chunks, 2 / 2' : out);
  print(/\| size /.test(out) === hasDist ? 'size column right' : out);
  // 分片表里各分片的块数加起来，等于集合表里的总块数。哈希分片的初始块有几个、放在哪个分片因版本而异，不检查具体数字
  var bySh = 0, byColl = 0, re1 = /\| sh\d +\| [^|]+\|[^|]*\|[^|]*\|\s+(\d+) \|/g, re2 = /\| shop\.\w+ +\| [^|]+\|\s+(\d+) \|/g, mm;
  while ((mm = re1.exec(out))) bySh += Number(mm[1]);
  while ((mm = re2.exec(out))) byColl += Number(mm[1]);
  print(bySh > 0 && bySh === byColl ? 'chunk totals match' : 'shards ' + bySh + ' colls ' + byColl + '\n' + out);
}, ['orders 4 chunks, 2 / 2', 'size column right', 'chunk totals match']);
run('mt.shards one db', function () {
  var out = capOut(function () { mt.shards('crm', { showCmd: false }); });
  print(/没有分片的集合/.test(out) && !/shop\.orders/.test(out) ? 'crm has none' : out);
  out = capOut(function () { mt.shards(db.getSiblingDB('shop'), { showCmd: false }); });
  print(/shop\.orders/.test(out) && /shop\.events/.test(out) ? 'shop by handle' : out);
}, ['crm has none', 'shop by handle']);

// 迁移记录：shard.sh 把 shop.orders 的两块从 sh1 迁到了 sh2（哈希分片建集合时有的版本也会迁，不检查条数）
run('mt.balancer', function () {
  var out = capOut(function () { mt.balancer({ n: 0 }); });
  print(/-- balancerStatus; config\.settings/.test(out) && /balancer: off/.test(out) && /migrations: \d+ \(success \d+\)/.test(out) ? 'header' : out);
  print(/── 最近 24 小时的迁移 ──/.test(out) ? 'title' : out);
  ['200 → 300', '300 → MaxKey'].forEach(function (r) {
    print(new RegExp('\\| shop\\.orders \\| sh1 +\\| sh2 \\| ' + r + ' +\\| +1000 \\| [^|]+\\| +\\d+ \\| success \\|').test(out) ? r + ' success' : r + ': ' + out);
  });
  print(/注意：均衡器关着/.test(out) && !/没有成功/.test(out) ? 'notes' : out);
}, ['header', 'title', '200 → 300 success', '300 → MaxKey success', 'notes']);
run('mt.balancer filters', function () {
  var out = capOut(function () { mt.balancer('crm', { showCmd: false }); });
  print(/migrations: 0/.test(out) && /最近 24 小时没有迁移/.test(out) ? 'crm none' : out);
  out = capOut(function () { mt.balancer('shop.orders', { n: 1, hours: 2, showCmd: false }); });
  print(/── 最近 2 小时的迁移 ──/.test(out) && /1 row in set/.test(out) && /300 → MaxKey/.test(out) && !/shop\.events/.test(out) ? 'one newest row' : out);
}, ['crm none', 'one newest row']);
// 迁到正在排空的 sh3：7.0 起源分片先开始迁移再中止，记一条 aborted；之前的版本直接拒绝，不留记录
run('mt.balancer aborted', function () {
  try { db.adminCommand({ moveChunk: 'shop.orders', find: { customerId: 150 }, to: 'sh3' }); } catch (e) { }
  var out = capOut(function () { mt.balancer('shop.orders', { showCmd: false }); });
  var ab = /\| shop\.orders \| sh1 +\| sh3 \| 100 → 200 +\|[^\n]*\| aborted \|/.test(out);
  print(ab === (vmaj >= 7) ? 'aborted row right' : out);
  print(/注意：1 次迁移没有成功/.test(out) === ab ? 'aborted note right' : out);
}, ['aborted row right', 'aborted note right']);
run('mongos: mt.balancer help', function () { mt.help('balancer'); }, ['mt.balancer() — ', 'MySQL: sh.status() migration results']);

// 经 mongos 时其他命令：能用的照常输出，只能连 mongod 的打印一行说明
run('mongos: mt.status', function () { mt.status({ interval: 0, cols: 'role' }); }, ['role: mongos']);
run('mongos: mt.vars', function () { mt.vars('ttlMonitor'); }, ['-- db.adminCommand({getParameter: ']);
run('mongos: mt.users', function () { mt.users(); }, ['-- db.adminCommand({usersInfo: {forAllDBs: true}})', 'authorization: disabled', '── 用户 ──', '注意：没开认证']);
// mongos 上没有 WiredTiger 缓存：没有 cacheMax 和缓存那一行，tcmalloc 的几行照常
run('mongos: mt.mem', function () {
  var out = capOut(function () { mt.mem(); });
  print(/resident: /.test(out) && !/cacheMax/.test(out) && !/WiredTiger cache/.test(out) && /\| other in use +\|/.test(out) && /\| tcmalloc free +\|/.test(out) ? 'no cache, tcmalloc rows' : out);
  print(/注意：/.test(out) ? out : 'no notes');
}, ['no cache, tcmalloc rows', 'no notes']);
run('mongos: mongod-only commands', function () {
  ['check', 'engine', 'qstats', 'profile', 'rsconf'].forEach(function (k) {
    var out = capOut(function () { mt[k]({ interval: 0 }); });
    print(/当前连的是 mongos/.test(out) ? k + ': mongos message' : k + ': ' + out);
  });
}, ['check: mongos message', 'engine: mongos message', 'qstats: mongos message', 'profile: mongos message', 'rsconf: mongos message']);
// mongos 连出去的连接池：各分片和配置服务器都在表里（sh3 没连接也会从复制集监视器列出来），都是主节点，没有提示
run('mongos: mt.pool', function () {
  db.getSiblingDB('shop').orders.find({ customerId: { $gt: 0 } }).itcount();
  var out = capOut(function () { mt.pool({ showCmd: false }); });
  print(/inUse: \d+/.test(out) && /created: \d+/.test(out) ? 'header' : out);
  ['cfg', 'sh1', 'sh2', 'sh3'].forEach(function (s) {
    print(new RegExp('\\| \\S+-' + s + ':27017 \\| ' + s + ' +\\| PRIMARY \\|').test(out) ? s + ' primary' : s + ': ' + out);
  });
  print(/\| slowWaits \|/.test(out) === (vmaj >= 7) ? 'slowWaits right' : out);
  print(/注意：/.test(out) ? out : 'no notes');
  out = capOut(function () { mt.pool({ all: true, showCmd: false }); });
  print(/── 各连接池 ──/.test(out) && /\| NetworkInterface\w+-TaskExecutorPool-\d+ /.test(out) ? 'per pool' : out);
}, ['header', 'cfg primary', 'sh1 primary', 'sh2 primary', 'sh3 primary', 'slowWaits right', 'no notes', 'per pool']);
run('mongos: mt.shards help', function () { mt.help('shards'); }, ['mt.shards() — ', 'MySQL: sh.status()']);

finish();
