// MongoTab test of mt.check()'s replication lag with a delayed member. Run by test/concern.sh after
// test/concern.js: the PSA set gets a fourth member, hidden, non-voting, delayed by 30 seconds.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (delayed member)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}

// 延迟成员落后 30 秒左右是设定的，只算超出的部分。主节点空闲时每 10 秒写一条 noop，延迟成员只应用 30 秒前的，
// 原始落后在 20 到 40 秒之间：阈值设成 20 秒 WARN，不扣掉设定的延迟就会是 WARN，扣掉之后最多 10 秒，是 OK。
// 加成员之后普通从节点偶尔会短暂落后 20 秒（CI 上 4.2 碰到过），最多隔 5 秒再查 5 次；延迟成员不扣延迟时每次都是 WARN
run('check: delayed member', function () {
  var out, row;
  for (var k = 0; k < 6; k++) {
    if (k) sleep(5000);
    out = capOut(function () { mt.check({ quick: true, table: true, thresholds: { lag: [20, 60] } }); });
    row = out.split('\n').filter(function (l) { return /^\| 复制延迟/.test(l); })[0] || '';
    if (/\| OK /.test(row)) break;
  }
  print(/\| OK /.test(row) ? 'lag ok' : row + '\n' + out);
  print(/（延迟成员只算超出设定延迟的部分）/.test(row) ? 'delayed note' : row);
}, ['lag ok', 'delayed note']);

finish();
