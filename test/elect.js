// MongoTab test of mt.elections() after a failover. Run by test/concern.sh after test/lag.js: the primary
// (priority 2) was stepped down, the other data member took over, and once the old primary could stand
// again it took the primary back (priority takeover). Connected to it, the newest primary.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (failover)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
var me = rs.status().members.filter(function (x) { return x.self; })[0].name;
var other = rs.conf().members.filter(function (x) { return !x.arbiterOnly && !x.hidden && x.host !== me; })[0].host;

// 最近一次选举是这个成员抢回主节点；前任是另一个数据成员
// 抢主次数至少 1：副本集建好时如果是另一个数据成员先当选，这个成员当时就已经抢过一次主了
run('elections: priority takeover', function () {
  var out = capOut(function () { mt.elections({ showCmd: false }); });
  print(out);
  var pt = /\| priorityTakeover \| +(\d+) \| +(\d+) \|/.exec(out), n = pt ? +pt[2] : 0;
  print(pt && n >= 1 && +pt[1] === n && out.indexOf('注意：优先级高的成员追上后又抢了 ' + n + ' 次主') >= 0 ? 'takeovers counted' : 'priorityTakeover row: ' + (pt && pt[0]));
}, ['primary: ' + me, 'reason: priorityTakeover — 优先级比主节点高，追上数据后抢主', 'priorPrimary: ' + other, 'takeovers counted']);

// 换主记录（默认最近 24 小时）：新的在前，最新一任是这个成员（现在的主节点），前一任是另一个数据成员（主节点记得的前任）
run('elections: history', function () {
  var out = capOut(function () { mt.elections({ history: true, showCmd: false }); });
  var rows = out.split('\n').filter(function (l) { return /^\| \d{4}-/.test(l); });
  print(rows.length >= 3 && rows[0].indexOf(' ' + me + ' ') > 0 && /（至今）/.test(rows[0]) ? 'newest is me' : out);
  print(rows.length >= 3 && rows[1].indexOf(' ' + other + ' ') > 0 ? 'before me: other' : out);
}, ['newest is me', 'before me: other']);

finish();
