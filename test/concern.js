// MongoTab test of mt.concern() on a PSA replica set. Run with test/concern.sh.
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (PSA)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
var ver = db.version().split('.'), vmaj = Number(ver[0]), vmin = Number(ver[1]);
var v44 = vmaj > 4 || (vmaj === 4 && vmin >= 4), v50 = vmaj >= 5;
var cn = db.getMongo(), a = db.getSiblingDB('admin');
// 老 shell 不认连接串里的选项，这里设上，两种 shell 看到的一样
if (LEGACY) { cn.setWriteConcern({ w: 'majority' }); cn.setReadConcern('majority'); cn.setReadPref('secondaryPreferred'); }

// 各种写关注、读关注的操作；w 都写明，别等不存在的确认
var d = db.getSiblingDB('mtcn');
d.runCommand({ insert: 't', documents: [{ a: 1 }], writeConcern: { w: 'majority' } });
d.runCommand({ insert: 't', documents: [{ a: 2 }], writeConcern: { w: 1 } });
d.runCommand({ insert: 't', documents: [{ a: 3 }], writeConcern: { w: 0 } });
d.runCommand({ update: 't', updates: [{ q: { a: 1 }, u: { $set: { b: 1 } } }], writeConcern: { w: 'majority' } });
d.runCommand({ find: 't', readConcern: { level: 'majority' } });
d.runCommand({ find: 't', readConcern: { level: 'local' } });

run('concern: defaults (PSA)', function () {
  var out = capOut(function () { mt.concern({ showCmd: false, width: 300 }); });
  // 5.0 起有仲裁节点时隐含默认是 w: 1；之前是副本集配置里的 getLastErrorDefaults
  print((v50 ? /defaultWriteConcern: \{w: 1\} \(implicit\)\n/.test(out) && /defaultReadConcern: \{level: local\} \(implicit\)\n/.test(out) :
    /defaultWriteConcern: \{w: 1, wtimeout: 0\} \(getLastErrorDefaults\)\n/.test(out) && /defaultReadConcern: \{level: local\} \(内置默认\)\n/.test(out)) ? 'defaults' : out);
  print(/majorityJournalDefault: true/.test(out) ? 'journal default' : out);
  print(/注意：有 1 个仲裁节点，隐含的默认写关注是 w: 1/.test(out) === v50 ? 'implicit w:1 note right' : out);
}, ['defaults', 'journal default', 'implicit w:1 note right']);

run('concern: this connection', function () {
  var out = capOut(function () { mt.concern({ showCmd: false, width: 300 }); });
  print(/── 当前连接（这个 shell） ──\n +writeConcern: \{w: majority\}\n *readConcern: \{level: majority\}\n *readPreference: secondaryPreferred\n/.test(out) ? 'connection settings' : out);
}, ['connection settings']);

run('concern: counts', function () {
  var out = capOut(function () { mt.concern({ showCmd: false, width: 300 }); });
  if (v44) {
    var ins = /\| insert +\| +(\d+) \| +(\d+) \| +(\d+) \|/.exec(out);   // majority, w:0, w:1
    print(ins && Number(ins[1]) >= 1 && Number(ins[2]) >= 1 && Number(ins[3]) >= 1 ? 'insert counts' : out);
    print(/\| update +\| +[1-9]\d* \|/.test(out) ? 'update counts' : out);
    print(/注意：有 [1-9]\d* 次写入是 w: 0/.test(out) ? 'w:0 note' : out);
  } else print(/4\.4 之前没有写关注的计数/.test(out) ? 'insert counts\nupdate counts\nw:0 note' : out);
  var rd = new RegExp('\\| ' + (v50 ? 'outside txn' : 'all') + ' +\\| +\\d+ \\| +\\d+ \\| +([1-9]\\d*) \\|').exec(out);   // local, available, majority
  print(rd ? 'read counts' : out);
}, ['insert counts', 'update counts', 'w:0 note', 'read counts']);

// 4.4 起用 setDefaultRWConcern 显式设置：来源变成 global，隐含 w: 1 的提示没了
if (v44) {
  a.runCommand({ setDefaultRWConcern: 1, defaultWriteConcern: { w: 'majority' }, defaultReadConcern: { level: 'majority' }, writeConcern: { w: 'majority' } });
  run('concern: set explicitly', function () {
    var out = capOut(function () { mt.concern({ showCmd: false, width: 300 }); });
    print(/defaultWriteConcern: \{w: majority, wtimeout: 0\} \(global\)\n/.test(out) && /defaultReadConcern: \{level: majority\} \(global\)\n/.test(out) && /defaultsSetAt: \d{4}-/.test(out) ? 'global defaults' : out);
    print(/隐含的默认写关注/.test(out) ? out : 'no implicit note');
  }, ['global defaults', 'no implicit note']);
}

finish();
