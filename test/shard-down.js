// Run by test/shard.sh after test/shard.js, once the sh3 container is stopped:
// mt.pool() on mongos should show sh3 as unreachable, with notes.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (mongos, sh3 stopped)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
// 复制集监视器要过一会儿（几秒到几十秒）才发现 sh3 连不上；先让 mongos 去连一下 sh3
var out = '';
for (var i = 0; i < 90; i++) {
  try { db.getSiblingDB('admin').runCommand({ listDatabases: 1, nameOnly: true }); } catch (e) { }
  out = capOut(function () { mt.pool({ showCmd: false }); });
  if (/\| unreachable /.test(out)) break;
  sleep(1000);
}
run('sh3 down: mt.pool', function () {
  print(/\| \S+-sh3:27017 \| sh3 +\| unreachable \|/.test(out) ? 'sh3 unreachable' : out);
  print(/\| \S+-sh1:27017 \| sh1 +\| PRIMARY +\|/.test(out) ? 'sh1 still primary' : out);
  print(/注意：复制集监视器连不上 \S+-sh3:27017/.test(out) ? 'down note' : out);
  print(/注意：副本集 sh3 没有主节点/.test(out) ? 'no primary note' : out);
}, ['sh3 unreachable', 'sh1 still primary', 'down note', 'no primary note']);

finish();
