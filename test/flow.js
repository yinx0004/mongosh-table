// MongoTab test of mt.flow() on a two-member replica set. Run with test/flow.sh,
// which sets MT_PHASE (and MT_SECONDARY) and drives the replica set between phases.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (flow control: ' + MT_PHASE + ')');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}

if (MT_PHASE === 'normal') {
  run('flow: normal', function () {
    var out = capOut(function () { mt.flow(); });
    print(/state: PRIMARY\n/.test(out) && /enabled: true\n/.test(out) && /isLagged: false\n/.test(out) && /targetLag: 10s\n/.test(out) && /threshold: 5s\n/.test(out) ? 'header' : out);
    print(/majorityLag: [\d.]+s\n/.test(out) && /waitMs\/s: 0\n/.test(out) && /laggedCount: 0\n/.test(out) && /waitingOps: 0/.test(out) && !/rateLimit/.test(out) ? 'not throttling' : out);
    print(/\| \S+-p:27017 +\| PRIMARY +\| +1 \| +0 \| \* +\|/.test(out) && /\| \S+-s:27017 +\| SECONDARY \| +1 \| +\d+ \| +\|/.test(out) ? 'members' : out);
    print(/被 flow control 拖住的操作|注意：/.test(out) ? out : 'no ops, no notes');
  }, ['header', 'not throttling', 'members', 'no ops, no notes']);
  run('flow: interval 0', function () {
    var out = capOut(function () { mt.flow({ interval: 0, showCmd: false }); });
    print(!/waitMs\/s/.test(out) && /waitTotal: /.test(out) ? 'totals only' : out);
  }, ['totals only']);
}

if (MT_PHASE === 'lagged') {
  run('flow: lagged', function () {
    var out = capOut(function () { mt.flow({ width: 300 }); });
    print(/isLagged: true\n/.test(out) && /rateLimit: \d+\/s\n/.test(out) && /waitMs\/s: [1-9]\d*\n/.test(out) && /threshold: 1s\n/.test(out) ? 'throttling' : out);
    var lag = /majorityLag: ([\d.]+)s/.exec(out);
    print(lag && Number(lag[1]) >= 1 ? 'majority lag' : out);
    print(new RegExp('注意：正在限流：多数派提交点落后 [\\d.]+s，超过了 1s；主节点每秒只发 \\d+ 张写入票据。落后的有投票权的成员：' + MT_SECONDARY.replace(/\./g, '\\.') + ' \\(\\d+s\\)。采样期间写入每秒一共等了 [1-9]\\d* ms 票据（几个写入的加起来）').test(out) ? 'lagged note' : out);
  }, ['throttling', 'majority lag', 'lagged note']);
  // 写入是一条接一条的，两条之间的瞬间 currentOp 里没有它：隔 200 毫秒取一次，最多 30 次（约 6 秒），看到等过票据的 insert 为止。
  // 没看到时再用 currentOp 命令查一次，分清是真没有这样的操作，还是 mt.flow() 漏看了
  run('flow: lagged, held-up insert', function () {
    var heldUp = /── 被 flow control 拖住的操作 ──[\s\S]*\| insert +\| mtflow\.t +\|[^\n]*\| +[1-9]\d* \| +\d+ \|/, out = '';
    for (var i = 0; i < 30 && !heldUp.test(out); i++) {
      if (i) sleep(200);
      out = capOut(function () { mt.flow({ interval: 0, showCmd: false, width: 300 }); });
    }
    if (heldUp.test(out)) { print('held-up insert'); return; }
    var raw = db.adminCommand({ currentOp: 1, active: true, ns: 'mtflow.t' }).inprog || [];
    print(out + '\ncurrentOp command on mtflow.t: ' + raw.length + ' ops, ' + raw.filter(function (op) { return op.flowControlStats && op.flowControlStats.acquireCount; }).length + ' with flowControlStats');
  }, ['held-up insert']);
}

// 写入已经停了，从节点还锁着：还在限流，但这 1 秒里没有写入等票据；interval: 0 时不说等没等
if (MT_PHASE === 'idle') {
  run('flow: lagged, no writes', function () {
    var out = capOut(function () { mt.flow({ showCmd: false, width: 300 }); });
    print(/isLagged: true\n/.test(out) && /waitMs\/s: 0\n/.test(out) ? 'throttling, no waits' : out);
    print(/注意：正在限流：[^\n]*。采样期间没有看到写入等票据/.test(out) ? 'no-wait note' : out);
    out = capOut(function () { mt.flow({ interval: 0, showCmd: false, width: 300 }); });
    print(/注意：正在限流：[^\n]*张写入票据。落后的有投票权的成员：[^\n]*\(\d+s\)(\n|$)/.test(out) ? 'no sample, no wait sentence' : out);
  }, ['throttling, no waits', 'no-wait note', 'no sample, no wait sentence']);
}

if (MT_PHASE === 'after') {
  run('flow: after', function () {
    var out = capOut(function () { mt.flow({ showCmd: false }); });
    print(/isLagged: false\n/.test(out) && /laggedCount: [1-9]\d*\n/.test(out) && !/rateLimit/.test(out) ? 'recovered' : out);
    print(/注意：启动以来进入过 [1-9]\d* 次限流（结束的几次共 \d/.test(out) && !/正在限流/.test(out) ? 'history note' : out);
  }, ['recovered', 'history note']);
}

if (MT_PHASE === 'secondary') {
  run('flow: on the secondary', function () { mt.flow({ showCmd: false }); }, ['state: SECONDARY', '注意：flow control 只在主节点上起作用，这里是 SECONDARY；到主节点上看']);
}

finish();
