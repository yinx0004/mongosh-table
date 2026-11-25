// MongoTab test of mt.initialSync() while a new member goes through initial
// sync. Run with test/isync.sh, which sets MT_PHASE, MT_PRIMARY and MT_NEW and
// holds the sync at each phase with failpoints.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (initial sync: ' + MT_PHASE + ')');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
var ver = db.version().split('.'), v42 = Number(ver[0]) > 4 || (Number(ver[0]) === 4 && Number(ver[1]) >= 2);
var re = function (s) { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); };

if (MT_PHASE === 'clone') {
  run('isync: copying', function () {
    var out = capOut(function () { mt.initialSync({ width: 300 }); });
    print(/state: STARTUP2\n/.test(out) && /phase: 复制数据：shop\.orders\n/.test(out) && re('syncSource: ' + MT_PRIMARY + '\n').test(out) ? 'header' : out);
    print(/databases: \d+ \/ \d+\n/.test(out) && /collections: \d+ \/ \d+\n/.test(out) && /oplogStart: \d{4}-/.test(out) && /failedAttempts: 2 \/ 10\n/.test(out) ? 'counts' : out);
    print((/copied: [\d.]+ [KMG]?B \/ [\d.]+ [KMG]?B \([\d.]+%\)\n/.test(out) && /remaining: ~/.test(out)) === v42 ? 'estimates right' : out);
    print(/sinceStartup: completed 0, failedAttempts 2, failures 0/.test(out) ? 'since startup' : out);
    print(/── 正在复制的集合 ──/.test(out) && /\| shop\.orders \| copying \| +\d+ \/ 20000 \|/.test(out) ? 'copying shop.orders' : out);
    print(/── 之前的尝试 ──/.test(out) && (out.match(/\| +[12] \| +\d+ \| InvalidSyncSource/g) || []).length === 2 ? 'two failed attempts' : out);
    print(/注意：已经失败 2 次（最多 10 次，用完这次初始同步就失败了）；最近一次：InvalidSyncSource/.test(out) ? 'failed note' : out);
  }, ['header', 'counts', 'estimates right', 'since startup', 'copying shop.orders', 'two failed attempts', 'failed note']);
  run('isync: all collections', function () {
    var out = capOut(function () { mt.initialSync({ all: true, showCmd: false, width: 300, limit: 0 }); });
    print(/── 各集合 ──/.test(out) && /\| crm\.contacts +\| done +\| +3000 \/ 3000 \|/.test(out) && /\| shop\.orders +\| copying /.test(out) ? 'every collection' : out);
  }, ['every collection']);
}

if (MT_PHASE === 'primary') {
  run('isync: on the primary', function () {
    var out = capOut(function () { mt.initialSync({ showCmd: false }); });
    print(/state: PRIMARY\n/.test(out) && /这个节点没有在初始同步/.test(out) ? 'not syncing' : out);
    print(re('注意：正在初始同步的成员：' + MT_NEW + ' ← ' + MT_PRIMARY + '；进度要连到它上面看').test(out) ? 'points to the new member' : out);
  }, ['not syncing', 'points to the new member']);
}

if (MT_PHASE === 'finish') {
  run('isync: finishing', function () {
    var out = capOut(function () { mt.initialSync({ showCmd: false, width: 300 }); });
    print(/state: STARTUP2\n/.test(out) && /phase: 这一轮已经完成，正在收尾\n/.test(out) && /finished: \d{4}-/.test(out) && /oplogEnd: \d{4}-/.test(out) ? 'header' : out);
    print(!/remaining:/.test(out) && !/── 正在复制的集合 ──/.test(out) && /\| shop +\| done /.test(out) ? 'all copied' : out);
    print(/\| +3 \| +\d+ \| OK /.test(out) && !/注意：已经失败/.test(out) ? 'third attempt ok' : out);
  }, ['header', 'all copied', 'third attempt ok']);
}

if (MT_PHASE === 'after') {
  run('isync: after', function () {
    var out = capOut(function () { mt.initialSync({ showCmd: false }); });
    // 3.6 同步完了 initialSyncStatus 还留着；4.2 起清掉
    print(/state: SECONDARY\n/.test(out) && (/phase: 已完成\n/.test(out) || /这个节点没有在初始同步/.test(out)) ? 'done' : out);
    print(/sinceStartup: completed 1, failedAttempts 2, failures 0/.test(out) ? 'since startup' : out);
  }, ['done', 'since startup']);
}

finish();
