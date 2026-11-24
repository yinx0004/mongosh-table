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

// 经 mongos 时其他命令：能用的照常输出，只能连 mongod 的打印一行说明
run('mongos: mt.status', function () { mt.status({ interval: 0, cols: 'role' }); }, ['role: mongos']);
run('mongos: mt.vars', function () { mt.vars('ttlMonitor'); }, ['-- db.adminCommand({getParameter: ']);
run('mongos: mongod-only commands', function () {
  ['check', 'engine', 'qstats', 'profile', 'rsconf'].forEach(function (k) {
    var out = capOut(function () { mt[k]({ interval: 0 }); });
    print(/当前连的是 mongos/.test(out) ? k + ': mongos message' : k + ': ' + out);
  });
}, ['check: mongos message', 'engine: mongos message', 'qstats: mongos message', 'profile: mongos message', 'rsconf: mongos message']);
run('mongos: mt.shards help', function () { mt.help('shards'); }, ['mt.shards() — ', 'MySQL: sh.status()']);

finish();
