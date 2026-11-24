// MongoTab test against a mongod started with --auth. Run with test/auth.sh,
// which logs in as ops (root).
load('test/lib.js');
load('mongotab.js');

print('### env server=' + db.version() + ' shell=' + SHELL + ' (--auth)');
mt.config({ lang: 'zh', tz: 'UTC' });
function capOut(fn) {
  var lines = [], realPrint = G.print;
  G.print = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { G.print = realPrint; }
  return lines.join('\n');
}
var admin = db.getSiblingDB('admin');
db.getSiblingDB('mtusr').createUser({ user: 'app', pwd: 'apppw', roles: ['readWrite'] });

run('auth: mt.users as root', function () {
  var out = capOut(function () { mt.users({ showCmd: false }); });
  print(/authorization: enabled/.test(out) && /currentUser: ops@admin/.test(out) ? 'header' : out);
  print(/\| ops +\| admin \| root +\|/.test(out) && /\| app +\| mtusr \| readWrite \|/.test(out) ? 'users' : out);
  print(/注意：能给自己授予任何权限的用户：ops@admin/.test(out) && !/没开认证/.test(out) ? 'notes' : out);
}, ['header', 'users', 'notes']);

// 只有 readWrite 的用户：没有 viewUser，打印一行说明
run('auth: mt.users without viewUser', function () {
  var c = new Mongo(MT_HOST), d = c.getDB('mtusr');   // MT_HOST：test/auth.sh 传进来
  d.auth('app', 'apppw');
  var saved = db;
  db = d;   // eslint-disable-line no-global-assign
  try { mt.users(); } finally { db = saved; }   // eslint-disable-line no-global-assign
}, ['mongotab: 没有查看用户的权限（usersInfo）']);

finish();
