// MongoTab (mongotab.js) — 在 mongosh 里把结果排成 MySQL 风格的表格 / \G 竖排
// 也能在老的 mongo shell（MongoDB 5.0 及更早版本自带的 mongo 命令）里用。
//
//   load('/path/to/mongotab.js')
//   t(db.orders.find({status: 'PAID'}))          // 表格（太宽自动竖排）
//   g(db.orders.findOne())                         // 竖排，相当于 MySQL 的 \G
//   t(rs.status().members, 'name,stateStr,health,optimeDate')
//   mt.ps() / mt.repl() / mt.colls() ...           // DBA 常用命令，mt.cmds() 列出全部
//   mt.help()
//
// 只新增三个全局函数 t、g、mt（名字已被占用就跳过，并提示改用 mongotab.xxx），
// 不改 shell 的任何对象、prototype 和配置；退出会话即失效。
(function () {
  'use strict';

  var VERSION = '0.3.0';
  var MARK = '__mongotab__';

  // mongosh 跑在 Node 上，有 globalThis / process / Intl；老的 mongo shell 都没有：
  // 全局对象用 Function('return this') 拿，环境变量只有 4.4 起的 _getEnv 能读，时区名（Intl）不支持。
  var root = typeof globalThis !== 'undefined' ? globalThis : Function('return this')();
  function getEnv(name) {
    var v = safe(function () { return process.env[name]; });
    if (v == null && typeof _getEnv === 'function') v = safe(function () { return _getEnv(name); });
    return v ? String(v) : '';
  }

  // ───────────────────────── 配置 ─────────────────────────
  var cfg = {
    limit: 50,          // 游标 / 数组最多显示多少行
    maxCol: 40,         // 表格单列最大显示宽度
    tz: 'UTC',          // 'UTC' | 'local' | '+08:00' | 'Asia/Shanghai'
    nullText: 'NULL',
    missingText: null,  // 字段不存在时的显示；null = 跟随语言：(无字段) / (missing)
    color: null,        // null = 终端里自动开启
    width: null,        // 终端宽度，null = 自动检测
    depth: null,        // 嵌套展开层数，null = 全部展开
    showCmd: true,      // mt.ps() 等 DBA 命令先打印等价的原生命令
    lang: detectLang()  // 'zh' | 'en'：MONGOTAB_LANG > LC_ALL / LC_MESSAGES / LANG > 系统区域
  };

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  // ───────────────────────── 提示信息（中 / 英） ─────────────────────────
  function normLang(l) { return /^zh/i.test(String(l || '')) ? 'zh' : 'en'; }
  function detectLang() {
    var v = getEnv('MONGOTAB_LANG') || getEnv('LC_ALL') || getEnv('LC_MESSAGES') || getEnv('LANG');
    if (!v) v = safe(function () { return Intl.DateTimeFormat().resolvedOptions().locale; }, '');
    return normLang(v);
  }
  function helpRow(label, desc) { var w = dw(label); return '  ' + (w < 29 ? label + ' '.repeat(29 - w) : label + '   ') + desc; }   // 按显示宽度对齐（中文占 2 列）
  var HELP_EXAMPLES = [
    "    t(db.orders.find({status: 'PAID'}).sort({_id: -1}))",
    "    t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost')",
    "    t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')",
    "    t(db.serverStatus(), 'connections,opcounters,mem')",
    '    t(db.adminCommand({listDatabases: 1}).databases)',
    '    t(db.orders.getIndexes())'
  ];
  var MSG = {
    zh: {
      badTz: function (s) { return "mongotab: 无法识别的时区 '" + s + "'，可用 'UTC'、'local'、'+08:00'、'Asia/Shanghai'"; },
      noIntl: function (s) { return "mongotab: 老的 mongo shell 不支持时区名 '" + s + "'，请用 'UTC'、'local' 或 '+08:00' 这样的偏移"; },
      more: function (n, next, fn) { return '(只显示前 ' + n + ' 行，还有更多；用 ' + fn + '(x, {limit: ' + next + '}) 看更多)'; },
      partial: function (n, total) { return '(共 ' + total + ' 行，只显示前 ' + n + ' 行)'; },
      missing: '(无字段)',
      noDb: '没有连接数据库',
      unauthorized: function (c) { return '没有执行 ' + c + ' 的权限，需要 clusterMonitor 角色（或 root）'; },
      cmdFailed: function (c, err) { return c + ' 执行失败：' + err; },
      onMongos: function (n) { return n + ' 要连到副本集成员上执行，当前连的是 mongos'; },
      notRs: function (n) { return n + ' 只适用于副本集，当前是单机（standalone）'; },
      needColl: "mt.idx() 需要集合名，例如 mt.idx('orders')、mt.idx('shop.orders') 或 mt.idx(db.orders)",
      noColl: function (ns) { return '集合 ' + ns + ' 不存在'; },
      noOplog: 'local.oplog.rs 是空的',
      total: function (s) { return '合计 ' + s; },
      sampled: function (n) { return '，间隔 ' + n + ' 秒采样两次算 ops/s'; },
      topSampled: function (n) { return '，间隔 ' + n + ' 秒采样两次，显示这段时间内的耗时（毫秒）'; },
      topTotals: '，启动以来累计（毫秒）',
      profOff: '没有开 profiler（level 0），可用 db.setProfilingLevel(1, {slowms: 100}) 打开',
      badSort: function (fn, ch, ex) { return fn + ' 的 sort 可以是 ' + ch + '，或排序文档如 ' + ex; },
      sortChoices: {
        slow: "'desc'（默认，最新的在前）、'asc'（最早的在前）、'ms'（最慢的在前）",
        ps: "'desc'（默认，运行最久的在前）、'asc'（最短的在前）、'opid'",
        txns: "'desc'（默认，开得最久的在前）、'asc'（最短的在前）"
      },
      noLockWait: '没有在等锁的操作',
      noTxn: '没有未提交的事务',
      badSev: "mt.log() 的 sev 可以是 'F'、'E'、'W'、'I'、'D'：只看这个级别及更严重的",
      logTail: function (n, total) { return '(共 ' + total + ' 行，只显示最后 ' + n + ' 行)'; },
      fragTotal: function (all, data, idx) { return '合计可回收 ' + all + '（数据 ' + data + '，索引 ' + idx + '）'; },
      cacheSum: function (sum, pct) { return '以上集合在缓存里合计 ' + sum + '，占已用缓存的 ' + pct; },
      noTtl: '没有 TTL 索引',
      noUnused: '没有没被用过的索引',
      noBuild: '没有正在建的索引',
      buildWaiting: '等待中',
      noDup: '没有冗余索引',
      needExplain: "mt.explain() 需要游标或 explain 的结果，例如 mt.explain(db.orders.find({status: 'PAID'}))；慢日志里的查询用 mt.explainLog(...)",
      useExplainLog: 'mt.explain() 只接受游标或 explain 的结果；慢日志里的行号、日志行、命令请用 mt.explainLog(...)，想转成查询语句用 mt.logQuery(...)',
      needLog: "mt.explainLog() / mt.logQuery() 需要慢日志里的东西：mt.slow() / mt.log() 的行号、日志里的整行、命令（从 { 开始）、profile 文档，或命令对象如 {find: 'orders', filter: {...}}",
      noRow: function (n) { return '没有第 ' + n + ' 行：行号用的是上一次 mt.slow() 或 mt.log() 列出的行'; },
      recLine: function (parts) { return '// 慢日志：' + parts.join('，'); },
      writeWarn: '// 注意：这是写操作，执行会修改数据',
      rowNoCmd: function (n) { return '第 ' + n + ' 行没有可以 explain 的命令（或者日志行太长被截断了；可以改用 mt.slow()）'; },
      notJson: "解析不了这段文字：mt.slow() / mt.log() 表格里显示的命令去掉了引号，不能直接粘贴；请用行号，或者传日志里的整行（4.4 起的 JSON 行、之前的文本行都可以）、命令文档",
      cantExplain: function (v) { return v + ' 命令不能 explain，支持 find、aggregate、count、distinct、update、delete、findAndModify'; },
      recTitle: '慢日志里记录的执行情况（当时实际跑的）：',
      planChanged: function (a, b) { return '注意：慢日志里用的是 ' + a + '，现在的计划是 ' + b + '（索引、数据分布或计划缓存可能变了）'; },
      exNote: { fullScan: '全表扫描', memSort: '内存排序', spilled: '用到了磁盘', postFilter: '取出后再过滤', multikey: '多键索引' },
      exNotes: function (list) { return '注意：' + list.join('；'); },
      cmdDesc: {
        ps: "正在执行的操作；secs 最短秒数，ns 库或集合，all 含空闲连接，sort: 'desc' 运行最久的在前（默认）/ 'asc' / 'opid'",
        slow: "慢查询（system.profile）；默认当前库，可传 'db'；ms 最短毫秒数，ns 集合，sort: 'desc' 新的在前（默认）/ 'asc' / 'ms' 最慢的在前",
        top: '各集合读写耗时，忙的在前；interval 采样秒数，0 = 启动以来累计；ns 库或集合',
        locks: '谁在等锁、锁被谁占着；all 显示所有被占用的锁',
        txns: "未提交的事务：开了多久、空闲多久、多久后自动中止；secs 最短秒数，sort: 'desc' / 'asc'",
        frag: '各集合删数据后可回收的磁盘空间，多的在前；默认当前库',
        cache: '各集合占用的 WiredTiger 缓存，多的在前；默认所有库',
        ttl: 'TTL 索引：过期时间、最早一条的时间、超期了多久，以及 TTL 线程的状态；默认所有库',
        unusedIdx: '没被用过的索引（ops = 0），大的在前；默认所有用户库',
        dupIdx: '冗余索引：键是另一个索引的前缀，如 {a: 1} 被 {a: 1, b: 1} 覆盖；默认所有用户库',
        builds: '正在建的索引：哪个集合、哪个索引、在哪个阶段、进度、已经跑了多久',
        explain: '执行计划排成表：每个阶段的索引、扫描和返回行数、耗时，标出全表扫描、内存排序；默认只看计划、不执行，analyze: true 执行一遍看扫描数和耗时',
        explainLog: '对慢日志里的查询做 explain：先列出日志里记下的实际执行情况，再看现在的计划，计划变了会提示；n 是 mt.slow() / mt.log() 的行号，也可以传整行日志、命令',
        logQuery: '把慢日志里的查询转成可以直接运行的 mongosh 语句（不执行），类型照原样保留',
        log: "最近的日志（getLog）；n 行数，grep 关键字或正则，sev: 'W' 只看警告及以上，startup 启动警告",
        repl: '副本集成员状态、复制延迟（秒）、同步源',
        dbs: '各库占用的磁盘空间',
        colls: '各集合文档数、数据和索引大小，大的在前；默认当前库',
        idx: '索引的键、大小、使用次数和选项',
        conns: '按客户端 IP 统计连接数',
        oplog: 'oplog 大小和能覆盖多长时间',
        status: '版本、角色、ops/s、连接、缓存等关键指标'
      },
      cmdsNote: '都可以加 t() 的选项，如 {cols: ...}、{vertical: true}；mt.config({showCmd: false}) 不打印原生命令',
      cmdsMore: "mt.help('ps') 看某个命令的详细用法、选项和输出的每一列",
      groups: { run: '运行状态', query: '慢查询和执行计划', store: '存储和索引', repl: '复制' },
      hd: { usage: '用法：', opts: '选项：', out: '输出：', notes: '说明：', see: '另见：', common: '都可以加 t() 的选项（cols、exclude、limit、vertical、table、tz...）；mt.config({showCmd: false}) 不打印原生命令' },
      noHelp: function (name, names) { return '没有叫 ' + name + ' 的命令。可以看：' + names.join('、'); },
      loaded: function (v, tz) { return 'MongoTab ' + v + ' 已加载：t(x) 表格 / g(x) 竖排 / mt.help()   时区 ' + tz; },
      skipped: function (names) {
        return '  注意：' + names.join('、') + ' 已被占用，未覆盖；请用 mongotab.table / mongotab.vertical / mongotab.help()';
      },
      help: function (v) {
        return [
          '  表格和竖排：',
          helpRow('t(x)', '表格；太宽自动改竖排。x 可以是游标、数组、单个文档'),
          helpRow('g(x)', '竖排（MySQL \\G），参数和 t() 一样'),
          helpRow('mt.csv(x, ...)', '输出 CSV（贴进 Excel），参数和 t() 一样'),
          '',
          '  选列：',
          helpRow("t(x, 'a,b,c')", "只看这些列，按写的顺序；也可以写数组 ['a', 'b']"),
          helpRow("t(x, 'customer')", '等于 customer 加上 customer.* 全部子字段'),
          helpRow("t(x, '*.name,item?')", '通配：* 任意多个字符，? 一个字符'),
          helpRow("t(x, {exclude: 'big,raw.*'})", '排除列；可以和 cols 一起用'),
          helpRow("t(rs.status(), 'set,members.name')", '单个文档里也能选子表的列'),
          '',
          '  选项（每次调用时传，或者用 mt.config() 改本会话默认值；括号里是当前值）：',
          helpRow('cols / exclude', '选列 / 排除列'),
          helpRow('limit (' + v.limit + ')', '游标、数组最多显示几行，0 = 不限'),
          helpRow('table (false)', '强制表格，不自动改竖排'),
          helpRow('vertical (false)', '强制竖排，g() 就是 vertical: true'),
          helpRow("tz ('" + v.tz + "')", "时区：'UTC'、'local'、'+08:00'、'Asia/Shanghai'"),
          helpRow('maxCol (' + v.maxCol + ')', '表格每格最多显示几个字符宽，0 = 不截断'),
          helpRow('width (' + (v.width || '自动') + ')', '终端宽度，表格超过就改竖排'),
          helpRow('depth (' + (v.depth == null ? '全部' : v.depth) + ')', '嵌套文档展开几层'),
          helpRow('color (' + (v.color == null ? '自动' : v.color) + ')', 'true / false：表头加粗、(无字段) 变暗等'),
          helpRow("nullText ('" + v.nullText + "')", '值为 null 时显示什么'),
          helpRow("missingText ('" + v.missingText + "')", '没有这个字段时显示什么'),
          helpRow("lang ('" + v.lang + "')", "提示和帮助的语言：'zh' / 'en'"),
          helpRow('showCmd (' + v.showCmd + ')', 'DBA 命令先打印等价的原生命令'),
          '',
          '  会话设置：',
          helpRow('mt.config()', '查看当前设置'),
          helpRow("mt.config({tz: '+08:00', limit: 100})", '修改，只影响本会话；重新 load() 会恢复默认'),
          helpRow('MONGOTAB_TZ / MONGOTAB_LANG', '环境变量：启动前设，每次都生效，如 MONGOTAB_TZ=+08:00'),
          '',
          '  DBA 常用命令：',
          helpRow('mt.cmds()', '按类别列出全部命令、对应的 MySQL 命令和说明'),
          helpRow("mt.help('ps')", '某个命令的详细用法、选项和输出的每一列，也可以写 mt.cmds("ps")'),
          '',
          '  示例：'
        ].concat(HELP_EXAMPLES, ['', '  显示约定：' + (v.nullText || '空白') + ' = 值为 null；空白 = 空字符串 ""；' +
          (v.missingText || '空白') + ' = 该文档没有这个字段（竖排里直接不显示）。CSV 相同']);
      }
    },
    en: {
      badTz: function (s) { return "mongotab: unknown time zone '" + s + "'; try 'UTC', 'local', '+08:00' or 'Asia/Shanghai'"; },
      noIntl: function (s) { return "mongotab: the legacy mongo shell does not support time zone names like '" + s + "'; use 'UTC', 'local' or an offset such as '+08:00'"; },
      more: function (n, next, fn) { return '(showing the first ' + n + ' rows, more available; use ' + fn + '(x, {limit: ' + next + '}) to see more)'; },
      partial: function (n, total) { return '(showing the first ' + n + ' of ' + total + ' rows)'; },
      missing: '(missing)',
      noDb: 'not connected to a database',
      unauthorized: function (c) { return 'not authorized to run ' + c + '; this needs the clusterMonitor role (or root)'; },
      cmdFailed: function (c, err) { return c + ' failed: ' + err; },
      onMongos: function (n) { return n + ' must run on a replica set member; this is a mongos'; },
      notRs: function (n) { return n + ' only works on a replica set; this is a standalone server'; },
      needColl: "mt.idx() needs a collection, e.g. mt.idx('orders'), mt.idx('shop.orders') or mt.idx(db.orders)",
      noColl: function (ns) { return 'collection ' + ns + ' does not exist'; },
      noOplog: 'local.oplog.rs is empty',
      total: function (s) { return 'Total ' + s; },
      sampled: function (n) { return ', sampled twice ' + n + 's apart for ops/s'; },
      topSampled: function (n) { return ', sampled twice ' + n + 's apart; time spent in between (ms)'; },
      topTotals: ', totals since startup (ms)',
      profOff: 'the profiler is off (level 0); turn it on with db.setProfilingLevel(1, {slowms: 100})',
      badSort: function (fn, ch, ex) { return fn + ' sort can be ' + ch + ' or a sort document such as ' + ex; },
      sortChoices: {
        slow: "'desc' (default, newest first), 'asc' (oldest first), 'ms' (slowest first)",
        ps: "'desc' (default, longest running first), 'asc' (shortest first), 'opid'",
        txns: "'desc' (default, open longest first), 'asc' (shortest first)"
      },
      noLockWait: 'no operation is waiting for a lock',
      noTxn: 'no open transactions',
      badSev: "mt.log() sev can be 'F', 'E', 'W', 'I' or 'D': this level and more severe",
      logTail: function (n, total) { return '(showing the last ' + n + ' of ' + total + ' rows)'; },
      fragTotal: function (all, data, idx) { return 'Total reusable ' + all + ' (data ' + data + ', indexes ' + idx + ')'; },
      cacheSum: function (sum, pct) { return 'These collections hold ' + sum + ' in the cache, ' + pct + ' of the cache in use'; },
      noTtl: 'no TTL indexes',
      noUnused: 'no unused indexes',
      noBuild: 'no index builds in progress',
      buildWaiting: 'waiting',
      noDup: 'no redundant indexes',
      needExplain: "mt.explain() needs a cursor or an explain result, e.g. mt.explain(db.orders.find({status: 'PAID'})); for queries from a slow log use mt.explainLog(...)",
      useExplainLog: 'mt.explain() takes only a cursor or an explain result; for row numbers, log lines and commands from a slow log use mt.explainLog(...), or mt.logQuery(...) to turn them into a query',
      needLog: "mt.explainLog() / mt.logQuery() need something from a slow log: a row number from mt.slow() / mt.log(), a whole log line, a command (from its {), a profile document, or a command object such as {find: 'orders', filter: {...}}",
      noRow: function (n) { return 'there is no row ' + n + ': row numbers refer to the last mt.slow() or mt.log()'; },
      recLine: function (parts) { return '// slow log: ' + parts.join(', '); },
      writeWarn: '// Note: this is a write; running it changes data',
      rowNoCmd: function (n) { return 'row ' + n + ' has no command that can be explained (or the log line was truncated for being too long; try mt.slow())'; },
      notJson: "cannot parse this text: the commands shown in mt.slow() / mt.log() tables drop the quotes and cannot be pasted back; use the row number, or pass a whole log line (a 4.4+ JSON line or an older text line) or a command document",
      cantExplain: function (v) { return 'a ' + v + ' command cannot be explained; find, aggregate, count, distinct, update, delete and findAndModify can'; },
      recTitle: 'Recorded in the slow log (what actually ran):',
      planChanged: function (a, b) { return 'Note: the slow log used ' + a + ', the current plan is ' + b + ' (indexes, data distribution or the plan cache may have changed)'; },
      exNote: { fullScan: 'full scan', memSort: 'in-memory sort', spilled: 'spilled to disk', postFilter: 'filtered after fetch', multikey: 'multikey' },
      exNotes: function (list) { return 'Note: ' + list.join('; '); },
      cmdDesc: {
        ps: "Running operations; secs = minimum seconds, ns = db or collection, all = include idle, sort: 'desc' longest running first (default) / 'asc' / 'opid'",
        slow: "Slow operations from system.profile; current db unless you pass 'db'; ms = minimum milliseconds, ns = collection, sort: 'desc' newest first (default) / 'asc' / 'ms' slowest first",
        top: 'Read/write time per collection, busiest first; interval = seconds to sample, 0 = totals since startup; ns = db or collection',
        locks: 'Who is waiting for a lock and who holds it; all = every lock that is held',
        txns: "Open transactions: how long open, how long idle, when they get aborted; secs = minimum seconds, sort: 'desc' / 'asc'",
        frag: 'Disk space each collection can reuse after deletes, most first; current db by default',
        cache: 'WiredTiger cache used by each collection, most first; all databases by default',
        ttl: 'TTL indexes: expiry, oldest document, how far past expiry, and the TTL thread; all databases by default',
        unusedIdx: 'Indexes never used (ops = 0), largest first; all user databases by default',
        dupIdx: 'Redundant indexes whose key is a prefix of another index, e.g. {a: 1} covered by {a: 1, b: 1}; all user databases by default',
        builds: 'Index builds in progress: collection, index, phase, progress and how long they have run',
        explain: 'Query plan as a table: index, rows scanned and returned, and time per stage; flags full scans and in-memory sorts; plan only by default, nothing runs; analyze: true runs it for rows scanned and time',
        explainLog: 'Explain a query from a slow log: first what the log recorded about the real run, then the current plan, noting if the plan changed; n is a row of mt.slow() / mt.log(), or pass a whole log line or a command',
        logQuery: 'Turn a query from a slow log into a mongosh statement you can run (nothing runs), keeping the types',
        log: "Recent log lines (getLog); n = lines, grep = text or regex, sev: 'W' = warnings and worse, startup = startup warnings",
        repl: 'Replica set members, replication lag (seconds), sync source',
        dbs: 'Disk space used by each database',
        colls: 'Documents, data and index size per collection, largest first; current db by default',
        idx: 'Index keys, size, usage count and options',
        conns: 'Connections per client IP',
        oplog: 'Oplog size and how much time it covers',
        status: 'Version, role, ops/s, connections, cache and other key metrics'
      },
      cmdsNote: 'All accept t() options such as {cols: ...} or {vertical: true}; mt.config({showCmd: false}) hides the native command',
      cmdsMore: "mt.help('ps') shows the detailed usage, options and output columns of one command",
      groups: { run: 'Server activity', query: 'Slow queries and plans', store: 'Storage and indexes', repl: 'Replication' },
      hd: { usage: 'Usage:', opts: 'Options:', out: 'Output:', notes: 'Notes:', see: 'See also:', common: 'All take t() options (cols, exclude, limit, vertical, table, tz...); mt.config({showCmd: false}) hides the native command' },
      noHelp: function (name, names) { return 'No command named ' + name + '. Available: ' + names.join(', '); },
      loaded: function (v, tz) { return 'MongoTab ' + v + ' loaded: t(x) table / g(x) vertical / mt.help()   time zone ' + tz; },
      skipped: function (names) {
        return '  Note: ' + names.join(', ') + ' already defined, left untouched; use mongotab.table / mongotab.vertical / mongotab.help()';
      },
      help: function (v) {
        return [
          '  Tables and vertical output:',
          helpRow('t(x)', 'Table; switches to vertical when too wide. x: cursor, array or a single document'),
          helpRow('g(x)', 'Vertical (like MySQL \\G); same arguments as t()'),
          helpRow('mt.csv(x, ...)', 'Print CSV (paste into Excel); same arguments as t()'),
          '',
          '  Columns:',
          helpRow("t(x, 'a,b,c')", "Only these columns, in this order; an array ['a', 'b'] works too"),
          helpRow("t(x, 'customer')", 'Means customer plus all of customer.*'),
          helpRow("t(x, '*.name,item?')", 'Wildcards: * any characters, ? one character'),
          helpRow("t(x, {exclude: 'big,raw.*'})", 'Exclude columns; works together with cols'),
          helpRow("t(rs.status(), 'set,members.name')", 'Columns of sub-tables in a single document'),
          '',
          '  Options (pass them per call, or change the session defaults with mt.config(); current values in parentheses):',
          helpRow('cols / exclude', 'Pick / exclude columns'),
          helpRow('limit (' + v.limit + ')', 'Max rows for cursors and arrays; 0 = no limit'),
          helpRow('table (false)', 'Always a table, never switch to vertical'),
          helpRow('vertical (false)', 'Always vertical; g() is vertical: true'),
          helpRow("tz ('" + v.tz + "')", "Time zone: 'UTC', 'local', '+08:00', 'Asia/Shanghai'"),
          helpRow('maxCol (' + v.maxCol + ')', 'Max width of a table cell; 0 = never cut'),
          helpRow('width (' + (v.width || 'auto') + ')', 'Terminal width; wider tables switch to vertical'),
          helpRow('depth (' + (v.depth == null ? 'all' : v.depth) + ')', 'How many levels of nested documents to expand'),
          helpRow('color (' + (v.color == null ? 'auto' : v.color) + ')', 'true / false: bold headers, dimmed (missing) and so on'),
          helpRow("nullText ('" + v.nullText + "')", 'What a null value shows as'),
          helpRow("missingText ('" + v.missingText + "')", 'What a missing field shows as'),
          helpRow("lang ('" + v.lang + "')", "Language of messages and help: 'en' / 'zh'"),
          helpRow('showCmd (' + v.showCmd + ')', 'DBA commands print the native command first'),
          '',
          '  Session settings:',
          helpRow('mt.config()', 'Show the current settings'),
          helpRow("mt.config({tz: '+08:00', limit: 100})", 'Change them for this session; load() again resets them'),
          helpRow('MONGOTAB_TZ / MONGOTAB_LANG', 'Environment variables read at load time, e.g. MONGOTAB_TZ=+08:00'),
          '',
          '  DBA commands:',
          helpRow('mt.cmds()', 'All commands by category, with the matching MySQL command and a description'),
          helpRow("mt.help('ps')", 'Detailed usage, options and output columns of one command; mt.cmds("ps") works too'),
          '',
          '  Examples:'
        ].concat(HELP_EXAMPLES, ['', '  Conventions: ' + (v.nullText || 'blank') + ' = value is null; blank = empty string ""; ' +
          (v.missingText || 'blank') + ' = the document has no such field (omitted in vertical output). Same in CSV']);
      }
    }
  };
  function L(lang) { return MSG[normLang(lang)]; }
  function missingText(o) { return o.missingText != null ? String(o.missingText) : L(o.lang).missing; }

  var envTz = getEnv('MONGOTAB_TZ');
  var envTzError = null;
  if (envTz) cfg.tz = envTz;
  try { cfg._tz = parseTz(cfg.tz, cfg.lang); } catch (e) {
    envTzError = e.message;          // MONGOTAB_TZ 写错不影响加载，回退 UTC
    cfg.tz = 'UTC';
    cfg._tz = parseTz('UTC', cfg.lang);
  }

  // ───────────────────────── 类型判断 ─────────────────────────
  var toStr = Object.prototype.toString;
  function isDate(v) { return toStr.call(v) === '[object Date]'; }
  function isRegExp(v) { return toStr.call(v) === '[object RegExp]'; }
  function isBytes(v) { return typeof Uint8Array !== 'undefined' && v instanceof Uint8Array; }
  // 老 mongo shell 的 BSON 值没有 _bsontype，按内部类型标签认，统一成 mongosh 的名字
  var LEGACY_TYPES = {
    NumberLong: 'Long', NumberInt: 'Int32', NumberDecimal: 'Decimal128', ObjectId: 'ObjectId',
    BinData: 'Binary', Timestamp: 'Timestamp', MinKey: 'MinKey', MaxKey: 'MaxKey',
    DBRef: 'DBRef', DBPointer: 'DBPointer', Code: 'Code'
  };
  function bsonType(v) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return null;
    var bt = safe(function () { return v._bsontype; });
    if (typeof bt === 'string') return bt;
    var tag = toStr.call(v).slice(8, -1);
    if (Object.prototype.hasOwnProperty.call(LEGACY_TYPES, tag)) return LEGACY_TYPES[tag];
    // 老 shell 4.2 起，库里读出来的 MinKey / MaxKey 就是这两个函数本身
    if (typeof v === 'function') {
      if (typeof MinKey !== 'undefined' && v === MinKey) return 'MinKey';
      if (typeof MaxKey !== 'undefined' && v === MaxKey) return 'MaxKey';
    }
    return null;
  }
  function isLeaf(v) {
    return v === null || v === undefined || typeof v !== 'object' ||
      isDate(v) || isRegExp(v) || isBytes(v) || bsonType(v) !== null;
  }
  function isDoc(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !isLeaf(v); }
  function isDocList(v) {
    if (!Array.isArray(v) || v.length === 0) return false;
    for (var i = 0; i < v.length; i++) if (!isDoc(v[i])) return false;
    return true;
  }
  function isCursor(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) &&
      typeof v.hasNext === 'function' && typeof v.next === 'function';
  }

  // ───────────────────────── 时区与日期 ─────────────────────────
  function parseTz(s, lang) {
    s = String(s == null ? 'UTC' : s).trim();
    if (/^(utc|gmt|z)$/i.test(s)) return { kind: 'offset', min: 0 };
    if (/^local$/i.test(s)) return { kind: 'local' };
    var m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(s);
    if (m) return { kind: 'offset', min: (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) };
    if (typeof Intl === 'undefined') throw new Error(L(lang).noIntl(s));
    try {
      return {
        kind: 'intl',
        fmt: new Intl.DateTimeFormat('en-US', {
          timeZone: s, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        })
      };
    } catch (e) {
      throw new Error(L(lang).badTz(s));
    }
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function p3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n); }
  function dateText(d, tz) {
    var ms = d.getTime();
    if (isNaN(ms)) return 'Invalid Date';
    var Y, M, D, h, mi, s;
    if (tz.kind === 'local') {
      Y = d.getFullYear(); M = d.getMonth() + 1; D = d.getDate();
      h = d.getHours(); mi = d.getMinutes(); s = d.getSeconds();
    } else if (tz.kind === 'offset') {
      var x = new Date(ms + tz.min * 60000);
      Y = x.getUTCFullYear(); M = x.getUTCMonth() + 1; D = x.getUTCDate();
      h = x.getUTCHours(); mi = x.getUTCMinutes(); s = x.getUTCSeconds();
    } else {
      var parts = {};
      var arr = tz.fmt.formatToParts(d);
      for (var i = 0; i < arr.length; i++) parts[arr[i].type] = arr[i].value;
      Y = Number(parts.year); M = Number(parts.month); D = Number(parts.day);
      h = Number(parts.hour) % 24; mi = Number(parts.minute); s = Number(parts.second);
    }
    var out = (Y < 1000 ? ('000' + Y).slice(-4) : Y) + '-' + p2(M) + '-' + p2(D) + ' ' + p2(h) + ':' + p2(mi) + ':' + p2(s);
    var frac = ((ms % 1000) + 1000) % 1000;
    return frac ? out + '.' + p3(frac) : out;
  }

  // ───────────────────────── 值 → 文本 ─────────────────────────
  function tsParts(v) {
    var t = safe(function () { return v.t; });
    var i = safe(function () { return v.i; });
    if (typeof t !== 'number') {
      t = safe(function () { return v.getHighBits() >>> 0; });
      i = safe(function () { return v.getLowBits() >>> 0; });
    }
    if (typeof t !== 'number' && typeof v.high === 'number') { t = v.high >>> 0; i = v.low >>> 0; }
    return [t, i];
  }
  function binText(v) {
    var legacy = typeof v.base64 === 'function';          // 老 shell 的 BinData
    var sub = legacy ? v.subtype() : v.sub_type;
    var hex = safe(function () { return legacy ? v.hex() : v.toString('hex'); }, '');
    if ((sub === 4 || sub === 3) && hex.length === 32) {
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    var b64 = safe(function () { return legacy ? v.base64() : v.toString('base64'); }, '');
    var n = hex.length / 2;
    return 'Binary(' + sub + ', ' + (b64.length > 24 ? b64.slice(0, 24) + '...' : b64) + ', ' + n + ' bytes)';
  }
  // 老 shell 的 NumberLong / NumberDecimal / NumberInt 只能从 NumberLong("123") 这样的文本里取数
  function numText(v) {
    var s = String(v.toString());
    var m = /^Number(?:Long|Decimal|Int)\("?(.*?)"?\)$/.exec(s);
    return m ? m[1] : s;
  }
  function bsonText(v, bt, o) {
    switch (bt) {
      case 'ObjectId': case 'ObjectID': return typeof v.str === 'string' ? v.str : v.toHexString();
      case 'Long': case 'Int32': case 'Double': case 'Decimal128': return numText(v);
      case 'Timestamp': {
        var p = tsParts(v);
        return dateText(new Date(p[0] * 1000), o._tz) + ' (' + p[0] + ':' + p[1] + ')';
      }
      case 'Binary': return binText(v);
      case 'MinKey': return 'MinKey';
      case 'MaxKey': return 'MaxKey';
      case 'BSONRegExp': return '/' + v.pattern + '/' + v.options;
      case 'BSONSymbol': return String(v.value);
      case 'Code': return 'Code(' + String(v.code) + ')';
      case 'DBRef': return 'DBRef(' + (v.collection || v.namespace || v.$ref) + ', ' + valText(v.oid !== undefined ? v.oid : v.$id, true, o) + ')';
      default: return safe(function () { return v.toString(); }, '[' + bt + ']');
    }
  }
  function isNumeric(v) {
    if (typeof v === 'number' || typeof v === 'bigint') return true;
    var bt = bsonType(v);
    return bt === 'Long' || bt === 'Int32' || bt === 'Double' || bt === 'Decimal128';
  }
  var NEED_QUOTE = /[,\[\]{}:"']|^\s|\s$|^$/;
  function valText(v, nested, o) {
    if (v === null || v === undefined) return nested ? 'null' : o.nullText;
    switch (typeof v) {
      case 'string': return nested && NEED_QUOTE.test(v) ? JSON.stringify(v) : v;
      case 'number': case 'bigint': case 'boolean': return String(v);
    }
    if (isDate(v)) return dateText(v, o._tz);
    if (isRegExp(v)) return String(v);
    var bt = bsonType(v);
    if (bt) return bsonText(v, bt, o);
    if (typeof v === 'function') return '[Function]';
    if (isBytes(v)) return 'Bytes(' + v.length + ')';
    var parts = [], i;
    if (Array.isArray(v)) {
      for (i = 0; i < v.length; i++) parts.push(valText(v[i], true, o));
      return '[' + parts.join(', ') + ']';
    }
    var ks = Object.keys(v);
    for (i = 0; i < ks.length; i++) parts.push(ks[i] + ': ' + valText(v[ks[i]], true, o));
    return '{' + parts.join(', ') + '}';
  }
  function escCtl(s) {
    return s.replace(/\r\n|[\x00-\x1f\x7f]/g, function (c) {
      if (c === '\n' || c === '\r\n') return '\\n';
      if (c === '\t') return '\\t';
      if (c === '\r') return '\\r';
      return '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2);
    });
  }
  function cellText(v, o) { return escCtl(valText(v, false, o)); }

  // ───────────────────────── 显示宽度（中文占 2 列） ─────────────────────────
  function charW(cp) {
    if (cp < 0x300) return 1;
    if (cp <= 0x36f || cp === 0x200b || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
        (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
    return 1;
  }
  var ASCII = /^[\x20-\x7e]*$/;
  function dw(s) {
    if (ASCII.test(s)) return s.length;
    var w = 0;
    for (var ch of s) w += charW(ch.codePointAt(0));
    return w;
  }
  function clip(s, max) {
    if (!max || dw(s) <= max) return s;
    var out = '', w = 0, lim = Math.max(1, max - 3);
    for (var ch of s) {
      var c = charW(ch.codePointAt(0));
      if (w + c > lim) break;
      out += ch; w += c;
    }
    return out + '...';
  }
  function padR(s, w) { var n = w - dw(s); return n > 0 ? s + ' '.repeat(n) : s; }
  function padL(s, w) { var n = w - dw(s); return n > 0 ? ' '.repeat(n) + s : s; }

  // ───────────────────────── 颜色 ─────────────────────────
  function colorOn(o) {
    if (o.color !== null && o.color !== undefined) return !!o.color;
    return !!safe(function () { return process.stdout.isTTY; }, false);
  }
  function paint(o, code, s) { return o._color ? '\x1b[' + code + 'm' + s + '\x1b[0m' : s; }
  var BOLD = '1', DIM = '2', YELLOW = '33', CYAN = '36';

  function termWidth(o) {
    if (o.width) return o.width;
    var c = safe(function () { return process.stdout.columns; });
    if (c > 0) return c;
    c = Number(getEnv('COLUMNS'));
    return c > 0 ? c : 160;
  }

  // ───────────────────────── 字符串键的 Map ─────────────────────────
  // 老 mongo shell 用自己的 Map 工具类覆盖了内置 Map（方法是 put，没有 set），
  // 所以这里用一个按插入顺序保存、只认字符串键的小实现，两种 shell 通用。
  function StrMap() { this._keys = []; this._vals = Object.create(null); }
  StrMap.prototype.has = function (k) { return k in this._vals; };
  StrMap.prototype.get = function (k) { return this._vals[k]; };
  StrMap.prototype.set = function (k, v) {
    if (!(k in this._vals)) this._keys.push(k);
    this._vals[k] = v;
    return this;
  };
  StrMap.prototype.forEach = function (fn) {
    for (var i = 0; i < this._keys.length; i++) fn(this._vals[this._keys[i]], this._keys[i]);
  };

  // ───────────────────────── 展开 / 选列 ─────────────────────────
  // 嵌套文档展开成 a.b.c；subs 不为空时，把“文档数组”单独收集起来做子表
  function flatten(doc, o, subs) {
    var out = new StrMap();
    (function walk(obj, prefix, depth) {
      var ks = Object.keys(obj);
      for (var i = 0; i < ks.length; i++) {
        var key = prefix + ks[i], v = obj[ks[i]];
        if (isDoc(v) && Object.keys(v).length && (o.depth == null || depth < o.depth)) walk(v, key + '.', depth + 1);
        else if (subs && isDocList(v)) subs.push([key, v]);
        else out.set(key, v);
      }
    })(doc, '', 0);
    return out;
  }
  function splitList(s) {
    if (s == null) return null;
    if (Array.isArray(s)) return s.map(String);
    return String(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  var reCache = new StrMap();
  function matchCol(col, pat) {
    if (col === pat || col.indexOf(pat + '.') === 0) return true;
    if (pat.indexOf('*') < 0 && pat.indexOf('?') < 0) return false;
    var re = reCache.get(pat);
    if (!re) {
      re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      reCache.set(pat, re);
    }
    return re.test(col);
  }
  function selectCols(cols, inc, exc) {
    if (inc && inc.length) {
      var out = [], seen = new StrMap();
      for (var i = 0; i < inc.length; i++) {
        for (var j = 0; j < cols.length; j++) {
          if (!seen.has(cols[j]) && matchCol(cols[j], inc[i])) { seen.set(cols[j], true); out.push(cols[j]); }
        }
      }
      cols = out;
    }
    if (exc && exc.length) {
      cols = cols.filter(function (c) { return !exc.some(function (p) { return matchCol(c, p); }); });
    }
    return cols;
  }
  // 子表 key 的选列：-c members.name → 子表里的 name
  function subPatterns(key, pats) {
    if (!pats || !pats.length) return { all: true, pats: null };
    if (pats.some(function (p) { return matchCol(key, p); })) return { all: true, pats: null };
    var sub = pats.filter(function (p) { return p.indexOf(key + '.') === 0; })
      .map(function (p) { return p.slice(key.length + 1); });
    return { all: false, pats: sub };
  }

  // ───────────────────────── 渲染 ─────────────────────────
  function tableLines(flats, cols, o) {
    var head = cols.map(function (c) { return clip(c, o.maxCol); });
    var widths = head.map(dw);
    var numeric = cols.map(function () { return true; });
    var hasNum = cols.map(function () { return false; });
    var body = flats.map(function (f) {
      return cols.map(function (c, j) {
        if (!f.has(c)) {                     // 字段不存在：显示 (无字段)，变暗
          var m = clip(missingText(o), o.maxCol);
          if (dw(m) > widths[j]) widths[j] = dw(m);
          return { s: m, dim: true };
        }
        var v = f.get(c);
        if (v !== null && v !== undefined) { if (isNumeric(v)) hasNum[j] = true; else numeric[j] = false; }
        var s = clip(cellText(v, o), o.maxCol);
        if (dw(s) > widths[j]) widths[j] = dw(s);
        return { s: s, dim: v === null || v === undefined };
      });
    });
    numeric = numeric.map(function (n, j) { return (n && hasNum[j]) || (o._right ? o._right.indexOf(cols[j]) >= 0 : false); });
    var sep = '+' + widths.map(function (w) { return '-'.repeat(w + 2); }).join('+') + '+';
    var lines = [sep, '| ' + head.map(function (h, j) { return paint(o, BOLD, padR(h, widths[j])); }).join(' | ') + ' |', sep];
    body.forEach(function (row) {
      lines.push('| ' + row.map(function (cell, j) {
        var p = numeric[j] ? padL(cell.s, widths[j]) : padR(cell.s, widths[j]);
        return cell.dim ? paint(o, DIM, p) : p;
      }).join(' | ') + ' |');
    });
    lines.push(sep);
    return { lines: lines, width: sep.length };
  }
  function kvLines(map, keys, o, out) {
    var kw = 0;
    keys.forEach(function (k) { kw = Math.max(kw, dw(k)); });
    kw = Math.min(kw, 32);   // 个别超长 key 不拖累整列对齐
    keys.forEach(function (k) {
      var v = map.get(k), s = cellText(v, o);
      if (v === null || v === undefined) s = paint(o, DIM, s);
      out.push(paint(o, BOLD, padL(k, kw)) + ': ' + s);
    });
  }
  // 提示里写用户能直接再敲一遍的函数名：g() 调的就提示 g(...)；短名被占用时提示 mongotab.xxx
  function callName(o) {
    var fn = o._fn === 'vertical' ? 'vertical' : 'table';
    var short = fn === 'vertical' ? 'g' : 't';
    return skipped.indexOf(short) < 0 ? short : 'mongotab.' + fn;
  }
  function footer(n, total, more, o, out) {
    var msg = n === 0 ? 'Empty set' : n + (n === 1 ? ' row' : ' rows') + ' in set';
    if (more) msg += paint(o, DIM, '  ' + L(o.lang).more(n, Math.max(n * 4, 200), callName(o)));
    else if (total > n) msg += paint(o, DIM, '  ' + L(o.lang).partial(n, total));
    out.push(msg);
  }
  function renderRows(rows, o, out, more, total) {
    var flats = [], cols = [], seen = new StrMap();
    rows.forEach(function (r) {
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      f.forEach(function (_, k) { if (!seen.has(k)) { seen.set(k, true); cols.push(k); } });
    });
    cols = selectCols(cols, o.cols, o.exclude);
    if (!rows.length) { footer(0, 0, false, o, out); return; }
    if (!o.vertical) {
      var tb = tableLines(flats, cols, o);
      if (o.table || tb.width <= termWidth(o)) {
        Array.prototype.push.apply(out, tb.lines);
        footer(rows.length, total, more, o, out);
        return;
      }
    }
    flats.forEach(function (f, i) {
      var stars = '***************************';
      out.push(paint(o, YELLOW, stars + ' ' + (i + 1) + '. row ' + stars));
      kvLines(f, cols.filter(function (c) { return f.has(c); }), o, out);
    });
    footer(rows.length, total, more, o, out);
  }
  function renderDoc(doc, o, out) {
    var subs = [];
    var f = flatten(doc, o, subs);
    var keys = [];
    f.forEach(function (_, k) { keys.push(k); });
    keys = selectCols(keys, o.cols, o.exclude);
    kvLines(f, keys, o, out);
    subs.forEach(function (sub) {
      var key = sub[0], list = sub[1];
      var inc = subPatterns(key, o.cols);
      if (!inc.all && !inc.pats.length) return;
      if (o.exclude && o.exclude.some(function (p) { return matchCol(key, p); })) return;
      var exc = (o.exclude || []).filter(function (p) { return p.indexOf(key + '.') === 0; })
        .map(function (p) { return p.slice(key.length + 1); });
      var so = Object.assign({}, o, { cols: inc.pats, exclude: exc });
      if (out.length) out.push('');
      out.push(paint(o, CYAN, '── ' + key + ' (' + list.length + ') ──'));
      var shown = limitOf(o) < list.length ? list.slice(0, limitOf(o)) : list;
      renderRows(shown, so, out, false, list.length);
    });
  }
  function limitOf(o) { return o.limit > 0 ? o.limit : Infinity; }

  function csvLines(x, o, out) {
    var rows = Array.isArray(x) ? x : [x];
    var flats = [], cols = [], seen = new StrMap();
    rows.forEach(function (r) {
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      f.forEach(function (_, k) { if (!seen.has(k)) { seen.set(k, true); cols.push(k); } });
    });
    cols = selectCols(cols, o.cols, o.exclude);
    var q = function (s) { return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    out.push(cols.map(q).join(','));
    flats.forEach(function (f) {
      out.push(cols.map(function (c) {
        if (!f.has(c)) return q(missingText(o));
        var v = f.get(c);
        return q(v === null || v === undefined ? String(o.nullText) : valText(v, false, o));
      }).join(','));
    });
  }

  // ───────────────────────── 入口 ─────────────────────────
  function makeOpts(arg, extra) {
    var o = Object.assign({}, cfg);
    if (typeof arg === 'string' || Array.isArray(arg)) o.cols = splitList(arg);
    else if (arg && typeof arg === 'object') Object.assign(o, arg);
    Object.assign(o, extra || {});
    o.cols = splitList(o.cols);
    o.exclude = splitList(o.exclude);
    o._tz = (arg && typeof arg === 'object' && !Array.isArray(arg) && arg.tz) ? parseTz(arg.tz, o.lang) : cfg._tz;
    o._color = colorOn(o);
    return o;
  }
  function unwrap(x) {
    // mongosh 部分 helper 返回 CommandResult { type, value }
    if (x && typeof x === 'object' && x.constructor && x.constructor.name === 'CommandResult' && 'value' in x) return x.value;
    return x;
  }
  function emit(lines) { var s = lines.join('\n'); if (typeof print === 'function') print(s); else console.log(s); }

  function render(x, o) {
    var out = [];
    x = unwrap(x);
    if (isCursor(x)) {
      var rows = [], lim = limitOf(o);
      while (rows.length < lim && x.hasNext()) rows.push(x.next());
      var more = rows.length >= lim && x.hasNext();
      renderRows(rows, o, out, more, rows.length);
    } else if (Array.isArray(x)) {
      var lim2 = limitOf(o);
      renderRows(x.length > lim2 ? x.slice(0, lim2) : x, o, out, false, x.length);
    } else if (isDoc(x)) {
      if (o.vertical === false && o.table) renderRows([x], o, out, false, 1);
      else renderDoc(x, o, out);
    } else {
      out.push(cellText(x, o));
    }
    emit(out);
  }

  function t(x, opts) {
    if (arguments.length === 0) return help();
    render(x, makeOpts(opts, { _fn: 'table' }));
  }
  function g(x, opts) {
    if (arguments.length === 0) return help();
    render(x, makeOpts(opts, { vertical: true, _fn: 'vertical' }));
  }
  function csv(x, opts) {
    var o = makeOpts(opts, { _color: false });
    o._color = false;
    x = unwrap(x);
    if (isCursor(x)) {
      var rows = [], lim = limitOf(o);
      while (rows.length < lim && x.hasNext()) rows.push(x.next());
      x = rows;
    }
    var out = [];
    csvLines(x, o, out);
    emit(out);
  }
  function config(c) {
    if (c && typeof c === 'object') {
      var next = Object.assign({}, cfg, c);
      next.lang = normLang(next.lang);
      next._tz = parseTz(next.tz, next.lang);
      cfg = next;
      return;
    }
    var shown = {};
    Object.keys(cfg).forEach(function (k) { if (k[0] !== '_') shown[k] = cfg[k]; });
    emit([JSON.stringify(shown)]);
  }
  function help(name) {
    if (name != null && name !== '') return cmdHelp(name);
    emit(['MongoTab ' + VERSION + ' — Make mongosh readable', ''].concat(L(cfg.lang).help({
      limit: cfg.limit, tz: cfg.tz, maxCol: cfg.maxCol, width: cfg.width, depth: cfg.depth, color: cfg.color,
      nullText: String(cfg.nullText), missingText: missingText(cfg), lang: cfg.lang, showCmd: cfg.showCmd !== false
    })));
  }

  // ───────────────────────── DBA 常用命令 ─────────────────────────
  // mt.ps() / mt.repl() / ...：只读，对应 MySQL 的 SHOW 系列。先打印等价的原生命令
  // （mt.config({showCmd: false}) 关掉），再出表格。选项和 t() 通用（cols、limit、vertical...）。
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (bsonType(v)) return Number(numText(v));
    return Number(v);
  }
  function sizeText(n) {
    n = toNum(n);
    if (n === null || isNaN(n)) return '';
    var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : String(Math.round(n))) + ' ' + u[i];
  }
  function durText(sec) {
    sec = Math.max(0, Math.round(toNum(sec) || 0));
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return d + 'd ' + h + 'h ' + m + 'm';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }
  function fail(msg) { var e = new Error(msg); e.mtFriendly = true; throw e; }
  function M() { return L(cfg.lang); }
  function isAuthErr(r) { return !!r && (r.code === 13 || r.codeName === 'Unauthorized' || /not authorized|requires authentication/i.test(String(r.errmsg || r.message || ''))); }
  function curDb() {
    var d = safe(function () { return db; });   // eslint-disable-line no-undef
    if (!d || typeof d.getSiblingDB !== 'function') fail(M().noDb);
    return d;
  }
  function admin() { return curDb().getSiblingDB('admin'); }
  function runCmd(d, cmd) {
    var r;
    try { r = unwrap(d.runCommand(cmd)); } catch (e) { r = { ok: 0, errmsg: e.message, code: e.code, codeName: e.codeName }; }
    if (!r || !r.ok) {
      var name = Object.keys(cmd)[0];
      if (isAuthErr(r)) fail(M().unauthorized(name));
      fail(M().cmdFailed(name, (r && r.codeName ? r.codeName + ': ' : '') + (r && r.errmsg || String(r))));
    }
    return r;
  }
  // 聚合失败时返回 null（权限不够除外），让调用方留空而不是整条命令失败
  function aggArr(coll, pipeline) {
    try { return coll.aggregate(pipeline).toArray(); } catch (e) {
      if (isAuthErr(e)) fail(M().unauthorized(Object.keys(pipeline[0])[0]));
      return null;
    }
  }
  function helloDoc(a) {
    var r = safe(function () { return unwrap(a.runCommand({ hello: 1 })); });
    if (!r || !r.ok) r = safe(function () { return unwrap(a.runCommand({ isMaster: 1 })); });
    return r || {};
  }
  function ensureRs(a, name) {
    var h = helloDoc(a);
    if (h.msg === 'isdbgrid') fail(M().onMongos(name));
    if (!h.setName) fail(M().notRs(name));
  }
  // $collStats.storageStats；经 mongos 时每个分片一条，加起来
  function collStats(d, name) {
    var docs = aggArr(d.getCollection(name), [{ $collStats: { storageStats: {} } }]);
    if (!docs || !docs.length) return null;
    var s = { count: 0, size: 0, storageSize: 0, totalIndexSize: 0, nindexes: 0, maxSize: null, indexSizes: {} };
    docs.forEach(function (x) {
      var st = x.storageStats || {};
      s.count += toNum(st.count) || 0;
      s.size += toNum(st.size) || 0;
      s.storageSize += toNum(st.storageSize) || 0;
      s.totalIndexSize += toNum(st.totalIndexSize) || 0;
      s.nindexes = Math.max(s.nindexes, toNum(st.nindexes) || 0);
      if (st.maxSize != null) s.maxSize = (s.maxSize || 0) + toNum(st.maxSize);
      Object.keys(st.indexSizes || {}).forEach(function (k) { s.indexSizes[k] = (s.indexSizes[k] || 0) + toNum(st.indexSizes[k]); });
    });
    return s;
  }
  function hostOf(client) {
    var m = /^\[?(.*?)\]?:(\d+)$/.exec(String(client || ''));
    return m ? m[1] : String(client || '');
  }
  // 去掉空值，免得竖排里出现一堆 NULL
  function prune(doc) {
    var out = {};
    Object.keys(doc).forEach(function (k) {
      var v = doc[k];
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) return;
      if (isDoc(v)) { v = prune(v); if (!Object.keys(v).length) return; }
      out[k] = v;
    });
    return out;
  }
  function dbaOpts(opts, right) { return makeOpts(opts, { _fn: 'table', _right: right || [] }); }
  function cmdLine(o, text, out) { if (o.showCmd !== false) out.push(paint(o, DIM, '-- ' + text)); }
  function rowsOut(rows, o, out) {
    var lim = limitOf(o);
    renderRows(rows.length > lim ? rows.slice(0, lim) : rows, o, out, false, rows.length);
  }
  function headOut(doc, o, out) {
    var f = flatten(prune(doc), o, null), keys = [];
    f.forEach(function (_, k) { keys.push(k); });
    kvLines(f, keys, o, out);
  }
  // 包一层：可预期的错误（没权限、不是副本集...）打印一行提示，不抛异常。
  // 直接调用 fn(a, b) 而不是 fn.apply：mongosh 会把调用数据库的函数改写成 async，
  // 只有直接调用才会被自动 await，catch 才接得住。
  function dba(fn) {
    return function (a, b) {
      try { fn(a, b); } catch (e) {
        if (e && e.mtFriendly) { emit(['mongotab: ' + e.message]); return; }
        if (e && /No connected database/i.test(String(e.message))) { emit(['mongotab: ' + M().noDb]); return; }   // mongosh --nodb
        throw e;
      }
    };
  }

  function isSelfOp(c) {
    return !!(c.currentOp || (Array.isArray(c.pipeline) && c.pipeline[0] && c.pipeline[0].$currentOp));
  }
  function cleanCmd(c) {
    var out = {};
    Object.keys(c).forEach(function (k) { if (k[0] !== '$' && k !== 'lsid' && k !== 'txnNumber') out[k] = c[k]; });
    return out;
  }
  // 按排序文档比较两行：{ns: 1, secs: -1}；数字按大小，其余按字符串
  function rowCmp(spec) {
    var ks = Object.keys(spec);
    return function (a, b) {
      for (var i = 0; i < ks.length; i++) {
        var x = a[ks[i]], y = b[ks[i]], d;
        if (typeof x === 'number' && typeof y === 'number') d = x - y;
        else { x = x == null ? '' : String(x); y = y == null ? '' : String(y); d = x < y ? -1 : x > y ? 1 : 0; }
        if (d) return toNum(spec[ks[i]]) < 0 ? -d : d;
      }
      return 0;
    };
  }
  // sort：'desc'（默认）/ 'asc' / 'opid'，或排序文档
  function psSort(s) {
    if (s == null || s === '' || s === 'desc') return null;
    if (s === 'asc') return { secs: 1 };
    if (s === 'opid') return { opid: 1 };
    if (isDoc(s) && Object.keys(s).length) return s;
    fail(M().badSort('mt.ps()', M().sortChoices.ps, '{ns: 1, secs: -1}'));
  }
  function ps(opts) {
    var o = dbaOpts(opts, ['opid', 'secs']), out = [];
    var spec = psSort(o.sort);
    var all = !!o.all;
    cmdLine(o, 'db.adminCommand({currentOp: 1, ' + (all ? '$all: true' : 'active: true') + '})', out);
    var ops = runCmd(admin(), all ? { currentOp: 1, $all: true } : { currentOp: 1, active: true }).inprog || [];
    var minSecs = toNum(o.secs) || 0, ns = o.ns ? String(o.ns) : '';
    var rows = [];
    ops.forEach(function (op, i) {
      var c = op.command || {};
      if (isSelfOp(c)) return;
      if (!all) {
        if (!(op.client || op.client_s)) return;                                         // 内部线程
        if ((c.hello || c.isMaster || c.ismaster) && c.maxAwaitTimeMS != null) return;  // 驱动的心跳长轮询
      }
      var secs = toNum(op.secs_running) || 0;
      if (secs < minSecs) return;
      if (ns && !(op.ns === ns || String(op.ns || '').indexOf(ns + '.') === 0)) return;
      var cc = cleanCmd(c);
      rows.push({ i: i, row: {
        opid: op.opid != null ? op.opid : '', secs: secs, op: op.active === false ? 'idle' : (op.op || ''),
        ns: op.ns || '', client: op.client || op.client_s || '',
        app: op.appName || '', lock: op.waitingForLock ? 'WAIT' : '', plan: op.planSummary || '',
        command: Object.keys(cc).length ? valText(cc, true, o) : (op.desc || '')
      } });
    });
    // 默认耗时长的在前；同耗时时有客户端的连接排在内部线程前面
    var byDefault = function (a, b) {
      return b.row.secs - a.row.secs || (a.row.client ? 0 : 1) - (b.row.client ? 0 : 1) || a.i - b.i;
    };
    var cmp = spec ? rowCmp(spec) : null;
    rows.sort(function (a, b) { return (cmp ? cmp(a.row, b.row) : 0) || byDefault(a, b); });
    rowsOut(rows.map(function (x) { return x.row; }), o, out);
    emit(out);
  }

  function repl(opts) {
    var o = dbaOpts(opts, ['lagSecs', 'pingMs']), out = [];
    var a = admin();
    ensureRs(a, 'mt.repl()');
    cmdLine(o, 'rs.status()', out);
    var st = runCmd(a, { replSetGetStatus: 1 });
    var ms = st.members || [];
    var opt = function (m) { return isDate(m.optimeDate) && m.optimeDate.getTime() > 0 ? m.optimeDate : null; };
    var ref = null;
    ms.forEach(function (m) { if (m.state === 1 && opt(m)) ref = opt(m).getTime(); });
    if (ref === null) ms.forEach(function (m) { if (opt(m) && (ref === null || opt(m).getTime() > ref)) ref = opt(m).getTime(); });
    headOut({ set: st.set, date: st.date }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = ms.map(function (m) {
      var od = opt(m);
      return {
        name: m.name, state: m.stateStr, health: m.health,
        lagSecs: od && ref !== null ? Math.max(0, Math.round((ref - od.getTime()) / 1000)) : '',
        optime: od || '', syncSource: m.syncSourceHost || m.syncingTo || '',
        pingMs: m.pingMs != null ? toNum(m.pingMs) : '',
        lastHeartbeat: isDate(m.lastHeartbeat) ? m.lastHeartbeat : '',
        self: m.self ? '*' : ''
      };
    });
    rowsOut(rows, o, out);
    emit(out);
  }

  function dbs(opts) {
    var o = dbaOpts(opts, ['disk']), out = [];
    cmdLine(o, 'db.adminCommand({listDatabases: 1})', out);
    var r = runCmd(admin(), { listDatabases: 1 });
    var rows = (r.databases || []).map(function (d) { return { name: d.name, disk: sizeText(d.sizeOnDisk), empty: !!d.empty }; });
    rows.sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
    rowsOut(rows, o, out);
    if (r.totalSize != null) out.push(M().total(sizeText(r.totalSize)));
    emit(out);
  }

  // 库里的集合名（跳过视图）
  function collNames(d) {
    var infos;
    try { infos = d.getCollectionInfos(); } catch (e) {
      if (isAuthErr(e)) fail(M().unauthorized('listCollections'));
      throw e;
    }
    return infos.filter(function (i) { return i.type !== 'view'; }).map(function (i) { return i.name; });
  }
  function isDbHandle(x) { return !!x && typeof x === 'object' && typeof x.getCollectionInfos === 'function' && typeof x.getSiblingDB === 'function'; }
  function colls(dbName, opts) {
    if (dbName && typeof dbName === 'object' && !isDbHandle(dbName)) { opts = dbName; dbName = null; }
    // logical = 未压缩的数据量（BSON），disk = 磁盘上占的（压缩后）
    var o = dbaOpts(opts, ['logical', 'disk', 'indexDisk']), out = [];
    var d = isDbHandle(dbName) ? dbName : dbName ? curDb().getSiblingDB(String(dbName)) : curDb();
    var dn = d.getName();
    cmdLine(o, "db.getSiblingDB('" + dn + "').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}])", out);
    var rows = [];
    collNames(d).forEach(function (name) {
      var info = { name: name };
      var s = collStats(d, info.name);
      rows.push({
        row: {
          name: info.name, count: s ? s.count : '', logical: s ? sizeText(s.size) : '', disk: s ? sizeText(s.storageSize) : '',
          indexes: s ? s.nindexes : '', indexDisk: s ? sizeText(s.totalIndexSize) : ''
        },
        w: s ? s.storageSize + s.totalIndexSize : -1
      });
    });
    rows.sort(function (x, y) { return y.w - x.w || (x.row.name < y.row.name ? -1 : 1); });
    rowsOut(rows.map(function (x) { return x.row; }), o, out);
    emit(out);
  }

  function collExists(d, n) { return d.getCollectionInfos({ name: n }).length > 0; }
  function resolveColl(x) {
    if (x && typeof x === 'object' && typeof x.getIndexes === 'function' && typeof x.getDB === 'function') {
      if (!collExists(x.getDB(), x.getName())) fail(M().noColl(x.getFullName()));
      return x;
    }
    if (typeof x !== 'string' || !x) fail(M().needColl);
    var cur = curDb();
    if (collExists(cur, x)) return cur.getCollection(x);
    var i = x.indexOf('.');
    if (i > 0) {
      var d2 = cur.getSiblingDB(x.slice(0, i)), n2 = x.slice(i + 1);
      if (collExists(d2, n2)) return d2.getCollection(n2);
    }
    fail(M().noColl(cur.getName() + '.' + x));
  }
  // $indexStats：每个索引自 since 以来被用了几次；经 mongos 时每个分片一条，加起来
  function indexUsage(c) {
    var usage = {};
    (aggArr(c, [{ $indexStats: {} }]) || []).forEach(function (x) {
      var u = usage[x.name] || (usage[x.name] = { ops: 0, since: null });
      u.ops += toNum(x.accesses && x.accesses.ops) || 0;
      var since = x.accesses && x.accesses.since;
      if (isDate(since) && (!u.since || since < u.since)) u.since = since;
    });
    return usage;
  }
  function indexFlags(ix, o) {
    var flags = [];
    if (ix.unique) flags.push('unique');
    if (ix.sparse) flags.push('sparse');
    if (ix.expireAfterSeconds != null) flags.push('ttl=' + toNum(ix.expireAfterSeconds) + 's');
    if (ix.partialFilterExpression) flags.push('partial=' + valText(ix.partialFilterExpression, true, o));
    if (ix.hidden) flags.push('hidden');
    if (ix.collation && ix.collation.locale) flags.push('collation=' + ix.collation.locale);
    return flags.join(', ');
  }
  function idx(coll, opts) {
    var o = dbaOpts(opts, ['disk']), out = [];
    var c = resolveColl(coll), d = c.getDB(), cn = c.getName();
    cmdLine(o, "db.getSiblingDB('" + d.getName() + "').getCollection('" + cn + "').getIndexes(); aggregate([{$indexStats: {}}])", out);
    var ixs = c.getIndexes();
    var usage = indexUsage(c);
    var cs = collStats(d, cn);
    var rows = ixs.map(function (ix) {
      var u = usage[ix.name];
      return {
        name: ix.name, key: valText(ix.key, true, o), disk: cs ? sizeText(cs.indexSizes[ix.name]) : '',
        ops: u ? u.ops : '', since: u && u.since ? u.since : '', options: indexFlags(ix, o)
      };
    });
    rowsOut(rows, o, out);
    emit(out);
  }

  function conns(opts) {
    var o = dbaOpts(opts), out = [];
    var a = admin();
    cmdLine(o, 'db.serverStatus().connections; db.adminCommand({currentOp: 1, $all: true})', out);
    var sc = runCmd(a, { serverStatus: 1 }).connections || {};
    headOut({ current: sc.current, available: sc.available, totalCreated: sc.totalCreated }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var ops = runCmd(a, { currentOp: 1, $all: true }).inprog || [];
    var by = new StrMap();
    ops.forEach(function (op) {
      var cl = op.client || op.client_s;
      if (!cl) return;
      var h = hostOf(cl);
      var r = by.get(h);
      if (!r) { r = { client: h, conns: 0, active: 0, apps: new StrMap(), ids: new StrMap() }; by.set(h, r); }
      // 同一个连接可能有多条（如事务），按 connectionId 去重
      var id = op.connectionId != null ? String(op.connectionId) : cl + '#' + r.conns;
      if (!r.ids.has(id)) { r.ids.set(id, true); r.conns++; }
      if (op.active && !isSelfOp(op.command || {})) r.active++;
      if (op.appName) r.apps.set(op.appName, true);
    });
    var rows = [];
    by.forEach(function (r) {
      var apps = [];
      r.apps.forEach(function (_, k) { apps.push(k); });
      rows.push({ client: r.client, conns: r.conns, active: r.active, apps: apps.join(', ') });
    });
    rows.sort(function (x, y) { return y.conns - x.conns || (x.client < y.client ? -1 : 1); });
    rowsOut(rows, o, out);
    emit(out);
  }

  function tsDate(ts) { var p = tsParts(ts); return typeof p[0] === 'number' ? new Date(p[0] * 1000) : null; }
  function oplog(opts) {
    var o = dbaOpts(opts), out = [];
    ensureRs(admin(), 'mt.oplog()');
    cmdLine(o, 'rs.printReplicationInfo()', out);
    var local = curDb().getSiblingDB('local'), oc = local.getCollection('oplog.rs');
    var edge = function (dir) {
      try { return oc.find({}, { ts: 1 }).sort({ $natural: dir }).limit(1).toArray()[0]; } catch (e) {
        if (isAuthErr(e)) fail(M().unauthorized('find local.oplog.rs'));
        throw e;
      }
    };
    var first = edge(1), last = edge(-1);
    if (!first || !last) fail(M().noOplog);
    var t1 = tsDate(first.ts), t2 = tsDate(last.ts);
    var secs = (t2.getTime() - t1.getTime()) / 1000;
    var cs = collStats(local, 'oplog.rs') || {};
    var doc = prune({
      maxLogical: sizeText(cs.maxSize), usedLogical: sizeText(cs.size), disk: sizeText(cs.storageSize),
      firstEvent: t1, lastEvent: t2, window: durText(secs) + ' (' + (secs / 3600).toFixed(2) + ' h)', now: new Date()
    });
    var f = flatten(doc, o, null), keys = [];
    f.forEach(function (_, k) { keys.push(k); });
    kvLines(f, selectCols(keys, o.cols, o.exclude), o, out);
    emit(out);
  }

  function status(opts) {
    var o = dbaOpts(opts), out = [];
    var a = admin();
    var iv = o.interval == null ? 1 : toNum(o.interval) || 0;
    var canSleep = typeof sleep === 'function';   // eslint-disable-line no-undef
    cmdLine(o, 'db.serverStatus()' + (iv > 0 && canSleep ? M().sampled(iv) : ''), out);
    var s1 = runCmd(a, { serverStatus: 1 }), s2 = null;
    if (iv > 0 && canSleep) { sleep(iv * 1000); s2 = runCmd(a, { serverStatus: 1 }); }   // eslint-disable-line no-undef
    var s = s2 || s1;
    var dt = s2 ? ((s2.localTime - s1.localTime) / 1000 || iv) : 0;
    var rate = function (a1, a2) { return Math.round((toNum(a2) - toNum(a1)) / dt * 10) / 10; };
    var r = s.repl;
    var role = s.process && /mongos/.test(s.process) ? 'mongos' : !r ? 'standalone' :
      (r.ismaster || r.isWritablePrimary) ? 'PRIMARY' : r.secondary ? 'SECONDARY' : r.arbiterOnly ? 'ARBITER' : 'OTHER';
    var doc = { host: s.host, version: s.version, role: role + (r && r.setName ? ' (' + r.setName + ')' : ''), uptime: durText(s.uptime) };
    var oc = s.opcounters || {};
    var names = ['insert', 'query', 'update', 'delete', 'getmore', 'command'];
    if (s2) {
      doc['ops/s'] = {};
      names.forEach(function (k) { doc['ops/s'][k] = rate((s1.opcounters || {})[k], oc[k]); });
    } else {
      doc.opcounters = {};
      names.forEach(function (k) { doc.opcounters[k] = toNum(oc[k]); });
    }
    var cn = s.connections || {};
    doc.connections = { current: toNum(cn.current), available: toNum(cn.available) };
    var gl = s.globalLock || {};
    if (gl.activeClients) doc.activeClients = { readers: toNum(gl.activeClients.readers), writers: toNum(gl.activeClients.writers) };
    if (gl.currentQueue) doc.queue = { readers: toNum(gl.currentQueue.readers), writers: toNum(gl.currentQueue.writers) };
    if (s2 && s.network && s1.network) {
      doc['network/s'] = { 'in': sizeText(rate(s1.network.bytesIn, s.network.bytesIn)), 'out': sizeText(rate(s1.network.bytesOut, s.network.bytesOut)) };
    }
    if (s.mem) doc.mem = { resident: sizeText(toNum(s.mem.resident) * 1048576), virtual: sizeText(toNum(s.mem.virtual) * 1048576) };
    var wc = s.wiredTiger && s.wiredTiger.cache;
    if (wc) {
      doc.cache = {
        used: sizeText(wc['bytes currently in the cache']), max: sizeText(wc['maximum bytes configured']),
        dirty: sizeText(wc['tracked dirty bytes in the cache'])
      };
    }
    var f = flatten(prune(doc), o, null), keys = [];
    f.forEach(function (_, k) { keys.push(k); });
    kvLines(f, selectCols(keys, o.cols, o.exclude), o, out);
    emit(out);
  }

  function notMongos(name) { if (helloDoc(admin()).msg === 'isdbgrid') fail(M().onMongos(name)); }
  function nsMatch(x, ns) { return !ns || x === ns || String(x || '').indexOf(ns + '.') === 0; }

  // sort：'desc'（默认）/ 'asc' / 'ms'，或直接给排序文档
  function slowSort(s) {
    if (s == null || s === '' || s === 'desc') return { ts: -1 };
    if (s === 'asc') return { ts: 1 };
    if (s === 'ms') return { millis: -1, ts: -1 };
    if (isDoc(s) && Object.keys(s).length) return s;
    fail(M().badSort('mt.slow()', M().sortChoices.slow, '{millis: -1}'));
  }
  // 慢查询：读 system.profile，不改 profiler 设置
  function slow(dbName, opts) {
    if (dbName && typeof dbName === 'object' && !isDbHandle(dbName)) { opts = dbName; dbName = null; }
    var o = dbaOpts(opts, ['#', 'ms', 'keysExamined', 'docsExamined', 'nreturned']), out = [];
    notMongos('mt.slow()');
    var d = isDbHandle(dbName) ? dbName : dbName ? curDb().getSiblingDB(String(dbName)) : curDb();
    var dn = d.getName();
    // 排除读 system.profile 自己和 profile 命令（level 2 时会被记下来）
    var filter = { ns: { $ne: dn + '.system.profile' }, 'command.profile': { $exists: false } };
    var user = {};
    if (toNum(o.ms)) user.millis = { $gte: toNum(o.ms) };
    if (o.ns) {
      var ns = String(o.ns);
      user.ns = ns.indexOf(dn + '.') === 0 ? ns : dn + '.' + ns;
    }
    var q = Object.keys(user).length ? { $and: [filter, user] } : filter;
    var sort = slowSort(o.sort);
    cmdLine(o, "db.getSiblingDB('" + dn + "').system.profile.find(" + valText(user, true, o) + ').sort(' + valText(sort, true, o) + ')', out);
    var st = runCmd(d, { profile: -1 });
    var total = toNum(runCmd(d, { count: 'system.profile', query: q }).n) || 0;
    var lim = limitOf(o), docs;
    try {
      var cur = d.getCollection('system.profile').find(q).sort(sort);
      docs = (lim < Infinity ? cur.limit(lim) : cur).toArray();
    } catch (e) {
      if (isAuthErr(e)) fail(M().unauthorized('find ' + dn + '.system.profile'));
      throw e;
    }
    headOut({ db: dn, level: st.was, slowms: st.slowms, sampleRate: st.sampleRate }, Object.assign({}, o, { cols: null, exclude: null }), out);
    lastRows = docs.map(function (p) { return { op: p.op, ns: p.ns, command: p.command, originatingCommand: p.originatingCommand, stats: statsFromProfile(p) }; });
    var rows = docs.map(function (p, i) {
      var cc = cleanCmd(p.command || p.query || {});
      return {
        '#': i + 1, ts: isDate(p.ts) ? p.ts : '', ms: toNum(p.millis), op: p.op || '', ns: p.ns || '', plan: p.planSummary || '',
        keysExamined: p.keysExamined != null ? toNum(p.keysExamined) : '',
        docsExamined: p.docsExamined != null ? toNum(p.docsExamined) : '',
        nreturned: p.nreturned != null ? toNum(p.nreturned) : '',
        client: p.client || '', user: p.user || '',
        command: Object.keys(cc).length ? valText(cc, true, o) : ''
      };
    });
    if (rows.every(function (r) { return !r.user; })) rows.forEach(function (r) { delete r.user; });   // 没开认证
    renderRows(rows, o, out, false, Math.max(total, rows.length));
    if (!rows.length && !st.was) out.push(M().profOff);
    emit(out);
  }

  // 按集合的读写耗时，相当于 mongotop；top 命令的时间单位是微秒
  function top(opts) {
    var o = dbaOpts(opts, ['totalMs', 'readMs', 'writeMs', 'ops']), out = [];
    var a = admin();
    notMongos('mt.top()');
    var iv = o.interval == null ? 1 : toNum(o.interval) || 0;
    var canSleep = typeof sleep === 'function';   // eslint-disable-line no-undef
    var sampled = iv > 0 && canSleep;
    cmdLine(o, 'db.adminCommand({top: 1})' + (sampled ? M().topSampled(iv) : M().topTotals), out);
    var t1 = runCmd(a, { top: 1 }).totals || {}, t2 = null;
    if (sampled) { sleep(iv * 1000); t2 = runCmd(a, { top: 1 }).totals || {}; }   // eslint-disable-line no-undef
    var cur = t2 || t1, base = t2 ? t1 : {};
    var ns = o.ns ? String(o.ns) : '';
    var f = function (x, k, sub) { return toNum(x && x[k] && x[k][sub]) || 0; };
    var ms = function (us) { return Math.round(us / 1000); };
    var rows = [];
    Object.keys(cur).forEach(function (k) {
      var c = cur[k], b = base[k];
      if (!k || !isDoc(c) || !c.total || !nsMatch(k, ns)) return;
      var tot = f(c, 'total', 'time') - f(b, 'total', 'time');
      var n = f(c, 'total', 'count') - f(b, 'total', 'count');
      if (tot <= 0 && n <= 0) return;
      rows.push({
        ns: k, totalMs: ms(tot),
        readMs: ms(f(c, 'readLock', 'time') - f(b, 'readLock', 'time')),
        writeMs: ms(f(c, 'writeLock', 'time') - f(b, 'writeLock', 'time')),
        ops: n, us: tot
      });
    });
    rows.sort(function (x, y) { return y.us - x.us || y.ops - x.ops || (x.ns < y.ns ? -1 : 1); });
    rowsOut(rows.map(function (r) { delete r.us; return r; }), o, out);
    emit(out);
  }

  // "{2305843009213693955: Global, 3}" → "Global 3"；
  // "{...: Collection, 1162035566390870678, shop.orders}" → "Collection shop.orders"（去掉中间的哈希）
  function resName(id) {
    var m = /^\{\d+: ([^,]+), (.*)\}$/.exec(String(id || ''));
    if (!m) return String(id || '');
    var rest = m[2].replace(/^\d+, (?=\S)/, '');
    return m[1] + ' ' + rest;
  }
  // 锁模式兼容表：IS / IX / S / X；currentOp 里的 r / w / R / W 分别对应 IS / IX / S / X
  var LOCK_MODE = { r: 'IS', w: 'IX', R: 'S', W: 'X' };
  var LOCK_OK = { IS: { IS: 1, IX: 1, S: 1 }, IX: { IS: 1, IX: 1 }, S: { IS: 1, S: 1 }, X: {} };
  function lockConflicts(a, b) {
    a = LOCK_MODE[a] || a; b = LOCK_MODE[b] || b;
    return !!(LOCK_OK[a] && LOCK_OK[b]) && !LOCK_OK[a][b];
  }
  // 等锁：lockInfo 列出每个锁资源的持有者（granted）和排队者（pending），按 opid 关联 currentOp 补上耗时、客户端、命令。
  // 默认只列有人排队的锁，以及和排队者冲突的持有者；all 列出所有被占用的锁
  function locks(opts) {
    var o = dbaOpts(opts, ['opid', 'secs']), out = [];
    var a = admin();
    notMongos('mt.locks()');
    var all = !!o.all;
    cmdLine(o, 'db.adminCommand({lockInfo: 1}); db.adminCommand({currentOp: 1, $all: true})', out);
    var info = runCmd(a, { lockInfo: 1 }).lockInfo || [];
    var byOp = {};
    (runCmd(a, { currentOp: 1, $all: true }).inprog || []).forEach(function (op) { if (op.opid != null) byOp[String(op.opid)] = op; });
    var rows = [], waiting = new StrMap();
    // ci：lockInfo 里的 clientInfo（3.6 / 4.0 / 4.2 直接放在条目上），或 currentOp 的一条
    var add = function (res, mode, ci, state) {
      var op = ci.opid != null ? byOp[String(ci.opid)] : null;
      if (op && isSelfOp(op.command || {})) return;
      if (state === 'WAIT') waiting.set(String(ci.opid != null ? ci.opid : ci.desc), true);
      var cc = op ? cleanCmd(op.command || {}) : {};
      rows.push({
        resource: res, mode: mode || '', state: state,
        opid: ci.opid != null ? ci.opid : '', secs: op && op.secs_running != null ? toNum(op.secs_running) : '',
        client: ci.client || ci.client_s || '', desc: ci.desc || '', op: op ? op.op || '' : '', ns: op ? op.ns || '' : '',
        command: Object.keys(cc).length ? valText(cc, true, o) : ''
      });
    };
    info.forEach(function (r) {
      var pending = r.pending || [], granted = r.granted || [];
      if (!pending.length && !(all && granted.length)) return;
      granted.forEach(function (x) {
        if (!all && !pending.some(function (p) { return lockConflicts(x.mode, p.mode); })) return;
        add(resName(r.resourceId), x.mode, x.clientInfo || x, 'HOLD');
      });
      pending.forEach(function (x) { add(resName(r.resourceId), x.mode, x.clientInfo || x, 'WAIT'); });
    });
    // 4.2 等版本的 Global 锁不在 lockInfo 里：用 currentOp 的 waitingForLock 补上。
    // 等的是 locks 里最后一项；占着它的是同一把锁上模式冲突的操作
    var extra = new StrMap();
    Object.keys(byOp).forEach(function (k) {
      var op = byOp[k];
      if (!op.waitingForLock || waiting.has(k) || !isDoc(op.locks)) return;
      var names = Object.keys(op.locks), n = names[names.length - 1];
      if (!n) return;
      if (!extra.has(n)) {
        extra.set(n, true);
        Object.keys(byOp).forEach(function (k2) {
          var h = byOp[k2];
          if (!h.waitingForLock && isDoc(h.locks) && h.locks[n] && lockConflicts(h.locks[n], op.locks[n])) add(n, h.locks[n], h, 'HOLD');
        });
      }
      add(n, op.locks[n], op, 'WAIT');
    });
    rowsOut(rows, o, out);
    if (!waiting._keys.length) out.push(M().noLockWait);
    emit(out);
  }

  // 未提交的事务：currentOp 里带 transaction 字段的（空闲的事务是 type: idleSession）
  function txnSort(s) {
    if (s == null || s === '' || s === 'desc') return null;
    if (s === 'asc') return { openSecs: 1 };
    if (isDoc(s) && Object.keys(s).length) return s;
    fail(M().badSort('mt.txns()', M().sortChoices.txns, '{client: 1}'));
  }
  function txns(opts) {
    var o = dbaOpts(opts, ['txnNumber', 'openSecs', 'activeSecs', 'idleSecs', 'expiresIn', 'opid']), out = [];
    var spec = txnSort(o.sort);
    cmdLine(o, 'db.adminCommand({currentOp: 1, $all: true}) → transaction', out);
    var ops = runCmd(admin(), { currentOp: 1, $all: true }).inprog || [];
    var now = Date.now(), minSecs = toNum(o.secs) || 0;
    var secs = function (us) { return Math.round((toNum(us) || 0) / 1e6); };
    // expiryTime / startWallClockTime 在有的版本里是 ISO 字符串
    var asDate = function (v) {
      if (isDate(v)) return v;
      var d = typeof v === 'string' ? new Date(v) : null;
      return d && !isNaN(d.getTime()) ? d : null;
    };
    var seen = new StrMap(), rows = [];
    ops.forEach(function (op) {
      var tx = op.transaction;
      if (!tx || !isDoc(tx)) return;
      var p = tx.parameters || {};
      var id = op.lsid && op.lsid.id != null ? valText(op.lsid.id, true, o) : '';
      var key = id + '#' + valText(p.txnNumber, true, o);
      var r = seen.get(key);
      var row = {
        lsid: id, txnNumber: p.txnNumber != null ? toNum(p.txnNumber) : '',
        state: op.active ? 'active' : 'idle', openSecs: secs(tx.timeOpenMicros),
        activeSecs: secs(tx.timeActiveMicros), idleSecs: secs(tx.timeInactiveMicros),
        start: asDate(tx.startWallClockTime) || '',
        expiresIn: asDate(tx.expiryTime) ? Math.max(0, Math.round((asDate(tx.expiryTime).getTime() - now) / 1000)) : '',
        opid: op.active && op.opid != null ? op.opid : '',
        client: op.client || op.client_s || '', app: op.appName || '', ns: op.active ? op.ns || '' : ''
      };
      if (r) { if (row.state === 'active') seen.set(key, row); return; }   // 同一事务有多条时，留正在执行的那条
      seen.set(key, row);
    });
    seen.forEach(function (row) { if (row.openSecs >= minSecs) rows.push(row); });
    var cmp = spec ? rowCmp(spec) : null;
    rows.sort(function (x, y) { return (cmp ? cmp(x, y) : 0) || y.openSecs - x.openSecs; });
    rowsOut(rows, o, out);
    if (!rows.length && !minSecs) out.push(M().noTxn);
    emit(out);
  }

  // ─── 磁盘碎片 / 缓存：都来自 $collStats.storageStats.wiredTiger；经 mongos 时每个分片一条，加起来
  function wtStats(d, name) {
    var docs = aggArr(d.getCollection(name), [{ $collStats: { storageStats: {} } }]);
    if (!docs || !docs.length) return null;
    var reuse = function (w) { return toNum(((w || {})['block-manager'] || {})['file bytes available for reuse']) || 0; };
    var cached = function (w) { return toNum(((w || {}).cache || {})['bytes currently in the cache']) || 0; };
    var s = { storage: 0, reuse: 0, idxSize: 0, idxReuse: 0, cache: 0, idxCache: 0 };
    docs.forEach(function (x) {
      var st = x.storageStats || {}, ix = st.indexDetails || {};
      s.storage += toNum(st.storageSize) || 0;
      s.idxSize += toNum(st.totalIndexSize) || 0;
      s.reuse += reuse(st.wiredTiger);
      s.cache += cached(st.wiredTiger);
      Object.keys(ix).forEach(function (k) { s.idxReuse += reuse(ix[k]); s.idxCache += cached(ix[k]); });
    });
    return s;
  }
  function pctText(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + '%' : ''; }
  function dbArg(dbName, opts) {
    if (dbName && typeof dbName === 'object' && !isDbHandle(dbName)) return { d: null, opts: dbName };
    return { d: isDbHandle(dbName) ? dbName : dbName ? curDb().getSiblingDB(String(dbName)) : null, opts: opts };
  }

  // 删数据后 WiredTiger 文件里能复用、但还没还给操作系统的空间（compact 能回收）
  function frag(dbName, opts) {
    var x = dbArg(dbName, opts), d = x.d || curDb();
    var o = dbaOpts(x.opts, ['disk', 'reusable', 'pct', 'indexDisk', 'indexReusable']), out = [];
    var dn = d.getName();
    cmdLine(o, "db.getSiblingDB('" + dn + "').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger['block-manager']", out);
    var rows = [], tData = 0, tIdx = 0;
    collNames(d).forEach(function (name) {
      var s = wtStats(d, name);
      if (!s) return;
      tData += s.reuse; tIdx += s.idxReuse;
      rows.push({
        row: {
          name: name, disk: sizeText(s.storage), reusable: sizeText(s.reuse), pct: pctText(s.reuse, s.storage),
          indexDisk: sizeText(s.idxSize), indexReusable: sizeText(s.idxReuse)
        },
        w: s.reuse + s.idxReuse
      });
    });
    rows.sort(function (a, b) { return b.w - a.w || (a.row.name < b.row.name ? -1 : 1); });
    rowsOut(rows.map(function (r) { return r.row; }), o, out);
    out.push(M().fragTotal(sizeText(tData + tIdx), sizeText(tData), sizeText(tIdx)));
    emit(out);
  }

  // 各集合在 WiredTiger 缓存里占了多少；默认扫所有库
  function cache(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['cached', 'dataCached', 'indexCached', 'share']), out = [];
    var a = admin();
    notMongos('mt.cache()');
    var dbsList = x.d ? [x.d] : (runCmd(a, { listDatabases: 1, nameOnly: true }).databases || [])
      .map(function (i) { return curDb().getSiblingDB(i.name); });
    cmdLine(o, 'db.serverStatus().wiredTiger.cache; ' + (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every db') +
      ': each collection aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger.cache', out);
    var wc = (runCmd(a, { serverStatus: 1 }).wiredTiger || {}).cache || {};
    var used = toNum(wc['bytes currently in the cache']) || 0, max = toNum(wc['maximum bytes configured']) || 0;
    var dirty = toNum(wc['tracked dirty bytes in the cache']) || 0;
    headOut({ used: sizeText(used) + (max ? ' (' + pctText(used, max) + ')' : ''), max: sizeText(max),
      dirty: sizeText(dirty) + (max ? ' (' + pctText(dirty, max) + ')' : '') }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = [], sum = 0;
    dbsList.forEach(function (d) {
      collNames(d).forEach(function (name) {
        var s = wtStats(d, name);
        if (!s || s.cache + s.idxCache <= 0) return;
        var c = s.cache + s.idxCache;
        sum += c;
        rows.push({ row: { ns: d.getName() + '.' + name, cached: sizeText(c), dataCached: sizeText(s.cache), indexCached: sizeText(s.idxCache), share: pctText(c, used) }, w: c });
      });
    });
    rows.sort(function (p, q) { return q.w - p.w || (p.row.ns < q.row.ns ? -1 : 1); });
    rowsOut(rows.map(function (r) { return r.row; }), o, out);
    if (rows.length) out.push(M().cacheSum(sizeText(sum), pctText(sum, used)));
    emit(out);
  }

  // TTL：索引上的 expireAfterSeconds，以及时间序列 / 聚簇集合上的 expireAfterSeconds（5.0 / 5.3 起）。
  // 对普通 TTL 索引顺着索引取最早的一条（{字段: {$type: 9}} 只看日期），算出它超期了多久：
  // 远超 TTL 线程的间隔（默认 60 秒）说明删不过来或线程没在跑
  function pathGet(doc, path) {
    var parts = path.split('.'), v = doc;
    for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function oldestDate(c, ix) {
    var f = Object.keys(ix.key || {})[0];
    if (!f || ix.partialFilterExpression) return null;
    var q = {}, proj = { _id: 0 }, sort = {};
    q[f] = { $type: 9 }; proj[f] = 1; sort[f] = 1;
    var doc = safe(function () { return c.find(q, proj).sort(sort).hint(ix.name).limit(1).toArray()[0]; });
    var v = doc ? pathGet(doc, f) : null;
    if (Array.isArray(v)) v = v.filter(isDate).sort(function (a, b) { return a - b; })[0];
    return isDate(v) ? v : null;
  }
  function ttl(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['expireAfterSeconds', 'overdueSecs']), out = [];
    var a = admin();
    var dbsList = x.d ? [x.d] : (runCmd(a, { listDatabases: 1, nameOnly: true }).databases || [])
      .map(function (i) { return curDb().getSiblingDB(i.name); });
    cmdLine(o, (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every db') +
      ': getCollectionInfos() + each getIndexes() → expireAfterSeconds; getParameter ttlMonitor*; serverStatus().metrics.ttl', out);
    var p = safe(function () { return unwrap(a.runCommand({ getParameter: 1, ttlMonitorEnabled: 1, ttlMonitorSleepSecs: 1 })); }) || {};
    var tm = safe(function () { return unwrap(a.runCommand({ serverStatus: 1 })).metrics.ttl; }) || {};
    headOut({ ttlMonitorEnabled: p.ok ? p.ttlMonitorEnabled : null, ttlMonitorSleepSecs: p.ok ? toNum(p.ttlMonitorSleepSecs) : null,
      passes: toNum(tm.passes), deletedDocuments: toNum(tm.deletedDocuments) }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var now = Date.now(), rows = [];
    var add = function (ns, index, field, secs, oldest, flags) {
      secs = toNum(secs);
      rows.push({
        ns: ns, index: index, field: field, expireAfterSeconds: secs, expire: isNaN(secs) ? '' : durText(secs),
        oldest: oldest || '', overdueSecs: oldest && !isNaN(secs) ? Math.max(0, Math.round((now - oldest.getTime()) / 1000 - secs)) : '',
        options: flags.join(', ')
      });
    };
    dbsList.forEach(function (d) {
      var infos;
      try { infos = d.getCollectionInfos(); } catch (e) {
        if (isAuthErr(e)) fail(M().unauthorized('listCollections'));
        throw e;
      }
      infos.forEach(function (info) {
        if (info.type === 'view' || /^system\.buckets\./.test(info.name)) return;
        var ns = d.getName() + '.' + info.name, op = info.options || {};
        if (op.expireAfterSeconds != null) {
          if (op.timeseries) add(ns, '(timeseries)', op.timeseries.timeField || '', op.expireAfterSeconds, null, []);
          else add(ns, '(clustered)', '_id', op.expireAfterSeconds, null, []);
        }
        if (info.type === 'timeseries') return;
        var c = d.getCollection(info.name);
        (safe(function () { return c.getIndexes(); }) || []).forEach(function (ix) {
          if (ix.expireAfterSeconds == null || ix.clustered) return;   // 聚簇索引上面已经算过
          var flags = [];
          if (ix.partialFilterExpression) flags.push('partial=' + valText(ix.partialFilterExpression, true, o));
          if (ix.hidden) flags.push('hidden');
          add(ns, ix.name, Object.keys(ix.key || {})[0] || '', ix.expireAfterSeconds, oldestDate(c, ix), flags);
        });
      });
    });
    rows.sort(function (p1, p2) {
      var a1 = p1.overdueSecs === '' ? -1 : p1.overdueSecs, a2 = p2.overdueSecs === '' ? -1 : p2.overdueSecs;
      return a2 - a1 || (p1.ns < p2.ns ? -1 : p1.ns > p2.ns ? 1 : 0);
    });
    rowsOut(rows, o, out);
    if (!rows.length) out.push(M().noTtl);
    emit(out);
  }

  // ─── 索引体检。默认扫所有用户库（跳过 admin / local / config），也可以只给一个库
  function userDbs(x) {
    if (x.d) return [x.d];
    return (runCmd(admin(), { listDatabases: 1, nameOnly: true }).databases || [])
      .map(function (i) { return i.name; })
      .filter(function (n) { return n !== 'admin' && n !== 'local' && n !== 'config'; })
      .sort()
      .map(function (n) { return curDb().getSiblingDB(n); });
  }
  function eachColl(dbsList, fn) {
    dbsList.forEach(function (d) {
      collNames(d).forEach(function (name) {
        if (/^system\./.test(name)) return;
        fn(d, name, d.getCollection(name));
      });
    });
  }

  // 没被用过的索引：$indexStats 的 accesses.ops 为 0。_id_ 删不掉，跳过；
  // unique / ttl 即使没被查询用过也在干活（唯一约束、过期删除），在 options 里标出来
  function unusedIdx(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['disk']), out = [];
    var dbsList = userDbs(x);
    cmdLine(o, (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every user db') +
      ': each collection getIndexes() + aggregate([{$indexStats: {}}]) → accesses.ops = 0', out);
    var st = safe(function () { return unwrap(admin().runCommand({ serverStatus: 1 })); }) || {};
    headOut({ uptime: st.uptime != null ? durText(st.uptime) : null }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = [];
    eachColl(dbsList, function (d, name, c) {
      var usage = indexUsage(c), cs = null, got = false;
      (safe(function () { return c.getIndexes(); }) || []).forEach(function (ix) {
        var u = usage[ix.name];
        if (ix.name === '_id_' || !u || u.ops > 0) return;
        if (!got) { cs = collStats(d, name); got = true; }
        var bytes = cs ? toNum(cs.indexSizes[ix.name]) || 0 : 0;
        rows.push({ row: { ns: d.getName() + '.' + name, index: ix.name, key: valText(ix.key, true, o), disk: cs ? sizeText(bytes) : '',
          since: u.since || '', options: indexFlags(ix, o) }, w: bytes });
      });
    });
    rows.sort(function (p, q) { return q.w - p.w || (p.row.ns < q.row.ns ? -1 : p.row.ns > q.row.ns ? 1 : 0); });
    rowsOut(rows.map(function (r) { return r.row; }), o, out);
    if (!rows.length) out.push(M().noUnused);
    emit(out);
  }

  // 冗余索引：A 的键是 B 的键的前缀（字段和方向都一样）。保守起见，A 是 unique / ttl / partial / sparse /
  // hidden 的不算（它们有额外作用），B 是 partial / sparse 的不算（覆盖不了全部文档），collation 要一样，
  // 特殊索引（text、2dsphere、hashed...）不算
  function plainKey(k) { return Object.keys(k).every(function (f) { var v = toNum(k[f]); return v === 1 || v === -1; }); }
  function keyPrefix(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length >= kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || toNum(a[ka[i]]) !== toNum(b[kb[i]])) return false;
    return true;
  }
  function sameCollation(a, b) { return JSON.stringify(a.collation || null) === JSON.stringify(b.collation || null); }
  function dupIdx(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['disk']), out = [];
    var dbsList = userDbs(x);
    cmdLine(o, (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every user db') +
      ': each collection getIndexes() → key is a prefix of another index', out);
    var rows = [];
    eachColl(dbsList, function (d, name, c) {
      var ixs = (safe(function () { return c.getIndexes(); }) || []).filter(function (ix) { return ix.key && plainKey(ix.key); });
      var cs = null, got = false;
      ixs.forEach(function (a) {
        if (a.name === '_id_' || a.unique || a.expireAfterSeconds != null || a.partialFilterExpression || a.sparse || a.hidden) return;
        var cover = null;
        ixs.forEach(function (b) {
          if (b === a || b.partialFilterExpression || b.sparse || b.hidden || !sameCollation(a, b) || !keyPrefix(a.key, b.key)) return;
          if (!cover || Object.keys(b.key).length < Object.keys(cover.key).length) cover = b;   // 取最短的那个
        });
        if (!cover) return;
        if (!got) { cs = collStats(d, name); got = true; }
        var bytes = cs ? toNum(cs.indexSizes[a.name]) || 0 : 0;
        rows.push({ row: { ns: d.getName() + '.' + name, index: a.name, key: valText(a.key, true, o), disk: cs ? sizeText(bytes) : '',
          coveredBy: cover.name, coveredKey: valText(cover.key, true, o) }, w: bytes });
      });
    });
    rows.sort(function (p, q) { return q.w - p.w || (p.row.ns < q.row.ns ? -1 : p.row.ns > q.row.ns ? 1 : 0); });
    rowsOut(rows.map(function (r) { return r.row; }), o, out);
    if (!rows.length) out.push(M().noDup);
    emit(out);
  }

  // ─── 执行计划。树从上往下：最上面是最后一步（结果），缩进最深的是最先执行的（读索引 / 读集合）。
  // 经典引擎：executionStats.executionStages 就是带统计的计划树。
  // SBE（explainVersion 2）：可读的树在 winningPlan.queryPlan，executionStages 是底层的 SBE 阶段，
  // 按 planNodeId 对回去，只拿得到每个节点的返回行数和耗时；扫描行数只有表头的合计
  function exChildren(n) {
    var out = [];
    if (Array.isArray(n.shards)) {   // 分片：每个分片一棵子树
      n.shards.forEach(function (sh) {
        var t = sh.executionStages || sh.winningPlan;
        if (t) out.push({ stage: 'shard ' + (sh.shardName || ''), _child: t.queryPlan || t });
      });
      return out;
    }
    Object.keys(n).forEach(function (k) {
      var v = n[k];
      if (isDoc(v) && typeof v.stage === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(function (x) { if (isDoc(x) && typeof x.stage === 'string') out.push(x); });
    });
    return out;
  }
  // indexBounds 的每个区间本来就是字符串，如 {status: ['["PAID", "PAID"]']}：直接拼起来，不再加引号
  function boundsText(b, o) {
    if (!isDoc(b)) return valText(b, true, o);
    return Object.keys(b).map(function (k) {
      var v = b[k];
      return k + ' ' + (Array.isArray(v) ? v.map(String).join(' or ') : valText(v, true, o));
    }).join(', ');
  }
  function sbeStats(root) {
    var by = {};
    (function walk(n) {
      if (!isDoc(n)) return;
      if (n.planNodeId != null && !by[n.planNodeId]) by[n.planNodeId] = n;   // 同一个节点取最上面那层
      exChildren(n).forEach(walk);
    })(root);
    return by;
  }
  // ─── 慢日志里的命令 → explain 命令
  var lastRows = null;   // 上一次 mt.slow() / mt.log() 列出的行，给 mt.explain(n) 用
  // JSON 日志里的扩展 JSON：{$date: ...}、{$oid: ...}、{$numberLong: ...} 等换回真正的类型
  function ejsonFix(v) {
    if (Array.isArray(v)) return v.map(ejsonFix);
    if (!isDoc(v)) return v;
    var ks = Object.keys(v), k = ks[0], w = v[k];
    if (ks.length === 1 || (ks.length === 2 && k === '$binary')) {
      var r = safe(function () {
        switch (k) {
          case '$oid': return ObjectId(w);   // eslint-disable-line no-undef
          case '$date': return new Date(isDoc(w) ? Number(w.$numberLong) : w);
          case '$numberLong': return NumberLong(w);   // eslint-disable-line no-undef
          case '$numberInt': return NumberInt(w);   // eslint-disable-line no-undef
          case '$numberDouble': return Number(w);
          case '$numberDecimal': return NumberDecimal(w);   // eslint-disable-line no-undef
          case '$uuid': return UUID(w);   // eslint-disable-line no-undef
          case '$regularExpression': return new RegExp(w.pattern, w.options);
          case '$timestamp': return safe(function () { return Timestamp(w.t, w.i); }) || Timestamp({ t: w.t, i: w.i });   // eslint-disable-line no-undef
          case '$minKey': return MinKey();   // eslint-disable-line no-undef
          case '$maxKey': return MaxKey();   // eslint-disable-line no-undef
          case '$binary': return typeof w === 'string' ? BinData(parseInt(v.$type, 16), w) : BinData(parseInt(w.subType, 16), w.base64);   // eslint-disable-line no-undef
        }
        return undefined;
      });
      if (r !== undefined && r !== null) return r;
    }
    var out = {};
    ks.forEach(function (key) { out[key] = ejsonFix(v[key]); });
    return out;
  }
  // ─── 4.4 之前的文本日志。命令部分是 shell 写法，不是 JSON：字段名不带引号（可以带点）、
  // ObjectId('...')、Timestamp(1, 2)、new Date(123)、BinData(0, 十六进制) 等。不用 eval，自己解析
  function hexToB64(hex) {
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [], out = '';
    for (var i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    for (var k = 0; k < bytes.length; k += 3) {
      var b0 = bytes[k], b1 = bytes[k + 1], b2 = bytes[k + 2];
      out += abc[b0 >> 2] + abc[((b0 & 3) << 4) | ((b1 || 0) >> 4)] +
        (b1 === undefined ? '=' : abc[((b1 & 15) << 2) | ((b2 || 0) >> 6)]) + (b2 === undefined ? '=' : abc[b2 & 63]);
    }
    return out;
  }
  function tsMake(t, i) { return safe(function () { return Timestamp(t, i); }) || Timestamp({ t: t, i: i }); }   // eslint-disable-line no-undef
  // 从 pos（应该是 '{' 或 '['）开始解析一个值，返回 {v, pos}；格式不对就抛异常
  function looseParse(text, pos) {
    var i = pos;
    var bad = function () { throw new Error('mongotab: cannot parse at ' + i + ': ' + text.substr(i, 30)); };
    var ws = function () { while (i < text.length && /\s/.test(text.charAt(i))) i++; };
    var str = function () {
      var q = text.charAt(i), j = i + 1;
      while (j < text.length && text.charAt(j) !== q) j += text.charAt(j) === '\\' ? 2 : 1;
      if (j >= text.length) bad();
      var inner = text.slice(i + 1, j);
      i = j + 1;
      if (q === "'") inner = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
      return JSON.parse('"' + inner + '"');
    };
    var args = function () {   // '(' 之后，按顶层逗号切开，到 ')' 为止
      var list = [], cur = '', depth = 0;
      i++;
      while (i < text.length) {
        var ch = text.charAt(i);
        if (ch === '"' || ch === "'") { var st = i; str(); cur += text.slice(st, i); continue; }
        if (ch === '(') depth++;
        if (ch === ')') { if (!depth) { i++; break; } depth--; }
        if (ch === ',' && !depth) { list.push(cur.trim()); cur = ''; i++; continue; }
        cur += ch; i++;
      }
      if (cur.trim() || list.length) list.push(cur.trim());
      return list;
    };
    var unq = function (a) { return /^["']/.test(a) ? looseParse(a, 0).v : a; };
    var call = function (name) {
      var a = args();
      switch (name) {
        case 'ObjectId': return ObjectId(unq(a[0]));   // eslint-disable-line no-undef
        case 'Timestamp': return tsMake(Number(a[0]), Number(a[1]));
        case 'Date': case 'ISODate': return /^["']/.test(a[0]) ? new Date(unq(a[0])) : new Date(Number(a[0]));
        case 'NumberLong': return NumberLong(String(unq(a[0])));   // eslint-disable-line no-undef
        case 'NumberInt': return NumberInt(Number(unq(a[0])));   // eslint-disable-line no-undef
        case 'NumberDecimal': return NumberDecimal(String(unq(a[0])));   // eslint-disable-line no-undef
        case 'UUID': return UUID(unq(a[0]));   // eslint-disable-line no-undef
        case 'BinData': return BinData(Number(a[0]), /^["']/.test(a[1]) ? unq(a[1]) : hexToB64(a[1]));   // eslint-disable-line no-undef
        case 'HexData': return BinData(Number(a[0]), hexToB64(unq(a[1])));   // eslint-disable-line no-undef
      }
      bad();
    };
    var val = function () {
      ws();
      var ch = text.charAt(i);
      if (ch === '{') {
        var o = {};
        i++; ws();
        if (text.charAt(i) === '}') { i++; return o; }
        for (;;) {
          ws();
          var key;
          if (text.charAt(i) === '"' || text.charAt(i) === "'") key = str();
          else { var c = text.indexOf(':', i); if (c < 0) bad(); key = text.slice(i, c).trim(); i = c; }
          ws();
          if (text.charAt(i) !== ':') bad();
          i++;
          o[key] = val();
          ws();
          if (text.charAt(i) === ',') { i++; continue; }
          if (text.charAt(i) === '}') { i++; return o; }
          bad();
        }
      }
      if (ch === '[') {
        var arr = [];
        i++; ws();
        if (text.charAt(i) === ']') { i++; return arr; }
        for (;;) {
          arr.push(val());
          ws();
          if (text.charAt(i) === ',') { i++; continue; }
          if (text.charAt(i) === ']') { i++; return arr; }
          bad();
        }
      }
      if (ch === '"' || ch === "'") return str();
      if (ch === '/') {
        var j = i + 1;
        while (j < text.length && text.charAt(j) !== '/') j += text.charAt(j) === '\\' ? 2 : 1;
        var pat = text.slice(i + 1, j), fl = /^[a-z]*/.exec(text.slice(j + 1))[0];
        i = j + 1 + fl.length;
        return new RegExp(pat, fl);
      }
      var num = /^-?(?:\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)/i.exec(text.slice(i));
      if (num) {
        i += num[0].length;
        var n = Number(num[0]);
        if (/^-?\d+$/.test(num[0]) && Math.abs(n) > 9007199254740991) return NumberLong(num[0]);   // eslint-disable-line no-undef
        return n;
      }
      var w = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
      if (!w) bad();
      i += w[0].length;
      var word = w[0];
      if (word === 'new') { ws(); var w2 = /^[A-Za-z_$][\w$]*/.exec(text.slice(i)); if (!w2) bad(); i += w2[0].length; word = w2[0]; }
      ws();
      if (text.charAt(i) === '(') return call(word);
      switch (word) {
        case 'true': return true;
        case 'false': return false;
        case 'null': return null;
        case 'undefined': return undefined;
        case 'NaN': case 'nan': return NaN;
        case 'Infinity': case 'inf': return Infinity;
        case 'MinKey': return MinKey();   // eslint-disable-line no-undef
        case 'MaxKey': return MaxKey();   // eslint-disable-line no-undef
      }
      bad();
    };
    var v = val();
    return { v: v, pos: i };
  }
  // 文本日志行 → {op, ns, command, originatingCommand}：
  //   ... [conn12] command shop.orders appName: "x" command: find { find: "orders", ... } planSummary: ...
  //   ... [conn12] update shop.orders command: { q: { ... }, u: { ... } } planSummary: ...
  function textLogEntry(line) {
    var m = /\]\s+(\w+)\s+(\S+)\s+(?:appName: "(?:[^"\\]|\\.)*"\s+)?command:\s+(?:\w+\s+)?(?=\{)/.exec(line);
    if (!m) return null;
    var cmd = looseParse(line, m.index + m[0].length);
    var e = { op: m[1], ns: m[2], command: cmd.v };
    var k = line.indexOf('originatingCommand: {', cmd.pos);
    if (k >= 0) e.originatingCommand = looseParse(line, line.indexOf('{', k)).v;
    e.stats = statsFromText(line, cmd.pos, e.command);
    return e;
  }
  // ─── 慢日志里记录的执行情况：当时实际跑了多久、扫了多少、用的什么计划。三种来源统一成一份
  function recClient(cmd, dflt) {   // 经 mongos 转发时，真正的客户端在 $client.mongos.client
    var mc = isDoc(cmd) && isDoc(cmd.$client) && isDoc(cmd.$client.mongos) ? cmd.$client.mongos.client : null;
    return mc || dflt || '';
  }
  function recStats(x) {
    var num = function (v) { return v == null ? null : toNum(v); };
    var r = {
      time: isDate(x.time) ? x.time : null, durationMillis: num(x.ms), planSummary: x.planSummary || null,
      keysExamined: num(x.keysExamined), docsExamined: num(x.docsExamined), nreturned: num(x.nreturned)
    };
    if (r.docsExamined > 0 && r.nreturned != null) r.docsExaminedPerReturned = r.nreturned > 0 ? Math.round(r.docsExamined / r.nreturned * 10) / 10 : 'Infinity';
    r.hasSortStage = x.hasSortStage && String(x.hasSortStage) !== '0' && String(x.hasSortStage) !== 'false' ? true : null;
    r.usedDisk = x.usedDisk && String(x.usedDisk) !== '0' && String(x.usedDisk) !== 'false' ? true : null;
    ['numYields', 'writeConflicts', 'nMatched', 'nModified', 'ndeleted', 'ninserted', 'reslen'].forEach(function (k) { r[k] = num(x[k]); });
    r.bytesRead = x.bytesRead != null ? sizeText(x.bytesRead) : null;
    r.readMs = x.readMicros != null ? Math.round(toNum(x.readMicros) / 100) / 10 : null;
    r.queryHash = x.queryHash || null; r.planCacheKey = x.planCacheKey || null;
    r.appName = x.appName || null; r.client = x.client || null;
    return r;
  }
  // 4.4 之前的文本行：命令后面是 planSummary: IXSCAN { a: 1 } keysExamined:0 docsExamined:5 ... 465ms
  function statsFromText(line, from, cmd) {
    var rest = line.slice(from), kv = {}, m, re = /\s(\w+):([^\s{]+)/g;
    while ((m = re.exec(rest))) if (!(m[1] in kv)) kv[m[1]] = m[2];
    var ps = /planSummary: (.*?)(?=\s\w+:\S|\s\d+ms\s*$|$)/.exec(rest);
    var ms = /\s(\d+)ms\s*$/.exec(rest);
    var app = /appName: "((?:[^"\\]|\\.)*)"/.exec(line);
    var t = safe(function () { return logLine(line).time; });
    return recStats({
      time: t, ms: ms ? ms[1] : null, planSummary: ps ? ps[1].trim() : null,
      keysExamined: kv.keysExamined, docsExamined: kv.docsExamined, nreturned: kv.nreturned, hasSortStage: kv.hasSortStage,
      usedDisk: kv.usedDisk, numYields: kv.numYields, writeConflicts: kv.writeConflicts, nMatched: kv.nMatched, nModified: kv.nModified,
      ndeleted: kv.ndeleted, ninserted: kv.ninserted, reslen: kv.reslen, queryHash: kv.queryHash, planCacheKey: kv.planCacheKey,
      appName: app ? app[1] : null, client: recClient(cmd, '')
    });
  }
  // 4.4 起的 JSON 行：attr 里的 durationMillis、planSummary、storage...
  function statsFromAttr(a, time) {
    var sd = isDoc(a.storage) && isDoc(a.storage.data) ? a.storage.data : {};
    return recStats({
      time: time, ms: a.durationMillis, planSummary: a.planSummary, keysExamined: a.keysExamined, docsExamined: a.docsExamined,
      nreturned: a.nreturned, hasSortStage: a.hasSortStage, usedDisk: a.usedDisk, numYields: a.numYields, writeConflicts: a.writeConflicts,
      nMatched: a.nMatched, nModified: a.nModified, ndeleted: a.ndeleted, ninserted: a.ninserted, reslen: a.reslen,
      bytesRead: sd.bytesRead, readMicros: sd.timeReadingMicros, queryHash: a.queryHash, planCacheKey: a.planCacheKey,
      appName: a.appName, client: recClient(a.command, a.remote)
    });
  }
  // system.profile 的文档
  function statsFromProfile(p) {
    var sd = isDoc(p.storage) && isDoc(p.storage.data) ? p.storage.data : {};
    return recStats({
      time: p.ts, ms: p.millis, planSummary: p.planSummary, keysExamined: p.keysExamined, docsExamined: p.docsExamined,
      nreturned: p.nreturned, hasSortStage: p.hasSortStage, usedDisk: p.usedDisk, numYields: p.numYield, writeConflicts: p.writeConflicts,
      nMatched: p.nMatched, nModified: p.nModified, ndeleted: p.ndeleted, ninserted: p.ninserted, reslen: p.responseLength,
      bytesRead: sd.bytesRead, readMicros: sd.timeReadingMicros, queryHash: p.queryHash, planCacheKey: p.planCacheKey,
      appName: p.appName, client: recClient(p.command, p.client)
    });
  }
  // 计划摘要比较：只看用了哪些扫描（COLLSCAN、IXSCAN { a: 1 } ...），忽略空格和引号
  function scanSet(summary) {
    var out = [], m, re = /([A-Z][A-Z_]*SCAN)(\{[^{}]*\})?/g, t = String(summary || '').replace(/[\s"']/g, '');
    while ((m = re.exec(t))) out.push(m[1] + (m[2] || ''));
    return out.sort().join(',');
  }
  function planSummaryOf(root) {
    var parts = [];
    (function walk(n) {
      if (!isDoc(n)) return;
      if (n._child) { walk(n._child); return; }
      if (/SCAN$/.test(String(n.stage))) {
        var kp = isDoc(n.keyPattern) ? ' { ' + Object.keys(n.keyPattern).map(function (k) { return k + ': ' + valText(n.keyPattern[k], true, {}); }).join(', ') + ' }' : '';
        parts.push(n.stage + kp);
      }
      exChildren(n).forEach(walk);
    })(root);
    return parts.join(', ');
  }
  // mongos、驱动、副本集内部加的字段，explain 时去掉
  var EXPLAIN_DROP = ['lsid', 'txnNumber', 'txnRetryCounter', 'autocommit', 'startTransaction', 'readConcern', 'writeConcern',
    'shardVersion', 'databaseVersion', 'clientOperationKey', 'apiVersion', 'apiStrict', 'apiDeprecationErrors',
    'mayBypassWriteBlocking', 'runtimeConstants', 'fromMongos', 'fromRouter', 'needsMerge', 'exchange', 'isMongosTopLevel', 'maxTimeMSOpOnly'];
  var EXPLAIN_VERBS = ['find', 'aggregate', 'count', 'distinct', 'update', 'delete', 'findAndModify', 'findandmodify'];
  // entry：{op, ns, command, originatingCommand}（来自 system.profile、日志的 attr，或者只有 command）
  function explainCmd(entry, o) {
    var c = entry.command || {}, ns = String(entry.ns || '');
    if ((entry.op === 'getmore' || c.getMore != null) && isDoc(entry.originatingCommand)) c = entry.originatingCommand;
    var coll = ns.indexOf('.') > 0 ? ns.slice(ns.indexOf('.') + 1) : '';
    // profile / 日志里单条的 update、remove 只记了语句本身
    if (c.q !== undefined && c.u !== undefined && c.update == null) c = { update: coll, updates: [c] };
    else if (c.q !== undefined && (entry.op === 'remove' || entry.op === 'delete') && c.delete == null) c = { delete: coll, deletes: [{ q: c.q, limit: c.limit || 0 }] };
    var verb = Object.keys(c)[0];
    if (EXPLAIN_VERBS.indexOf(verb) < 0) fail(M().cantExplain(verb || '?'));
    var cmd = {};
    Object.keys(c).forEach(function (k) {
      if (k.charAt(0) === '$' || EXPLAIN_DROP.indexOf(k) >= 0) return;
      cmd[k] = c[k];
    });
    // mongos 发给分片时加的 projection: {$sortKey: {$meta: 'sortKey'}}
    if (isDoc(cmd.projection)) {
      var pj = {};
      Object.keys(cmd.projection).forEach(function (k) {
        var v = cmd.projection[k];
        if (!(isDoc(v) && v.$meta === 'sortKey')) pj[k] = v;
      });
      if (Object.keys(pj).length) cmd.projection = pj; else delete cmd.projection;
    }
    if (verb === 'aggregate' && !cmd.cursor) cmd.cursor = {};
    var db0 = c.$db || (ns.indexOf('.') > 0 ? ns.slice(0, ns.indexOf('.')) : '') || o.db || curDb().getName();
    return { db: String(db0), cmd: cmd };
  }
  // 慢日志里的东西 → entry：{op, ns, command, originatingCommand, stats}；认不出来返回 null
  function logEntry(x, m) {
    if (typeof x === 'number') {
      if (!lastRows || x < 1 || x > lastRows.length || x !== Math.floor(x)) fail(m.noRow(x));
      if (!lastRows[x - 1]) fail(m.rowNoCmd(x));
      return lastRows[x - 1];
    }
    if (typeof x === 'string') {
      var j = safe(function () { return JSON.parse(x); });
      if (isDoc(j)) {
        j = ejsonFix(j);
        var jt = isDoc(j.t) && isDate(j.t.$date) ? j.t.$date : isDate(j.t) ? j.t : null;
        if (isDoc(j.attr) && isDoc(j.attr.command)) {
          return { op: j.attr.type, ns: j.attr.ns, command: j.attr.command, originatingCommand: j.attr.originatingCommand, stats: statsFromAttr(j.attr, jt) };
        }
        return isDoc(j.command) ? j : { command: j };
      }
      // 4.4 之前的文本日志行，或者 shell 写法的命令 { find: "c", filter: { ... } }
      var e = safe(function () { return textLogEntry(x); });
      if (!e && /^\s*\{/.test(x)) e = safe(function () { var c = looseParse(x, x.indexOf('{')).v; return isDoc(c) ? { command: c } : null; });
      if (!e) fail(m.notJson);
      return e;
    }
    var d0 = unwrap(x);
    if (!isDoc(d0) || d0.queryPlanner || d0.stages || typeof d0.explain === 'function') return null;
    if (isDoc(d0.command)) return d0.millis != null && !d0.stats ? Object.assign({}, d0, { stats: statsFromProfile(d0) }) : d0;   // profile 文档
    return { command: ejsonFix(d0) };   // 命令对象
  }
  function looksLikeLog(x) {
    if (typeof x === 'number' || typeof x === 'string') return true;
    var d = unwrap(x);
    return isDoc(d) && !d.queryPlanner && !d.stages && typeof d.explain !== 'function';
  }
  function recOf(entry) {
    var rec = entry && isDoc(entry.stats) ? prune(entry.stats) : null;
    return rec && Object.keys(rec).length ? rec : null;
  }
  // 游标或 explain 的结果
  function explain(x, opts) {
    var o = dbaOpts(opts, ['nReturned', 'keysExamined', 'docsExamined', 'ms']), out = [];
    // 默认只取计划（queryPlanner），不执行查询；{analyze: true} 才真的执行一遍拿统计（executionStats）
    var m = M(), verb = o.analyze === true ? 'executionStats' : 'queryPlanner', ex;
    if (x && typeof x.explain === 'function') {
      cmdLine(o, "cursor.explain('" + verb + "')", out);
      ex = unwrap(x.explain(verb));
    } else {
      if (looksLikeLog(x)) fail(m.useExplainLog);
      ex = unwrap(x);
    }
    showPlan(ex, o, out, null);
  }
  // 慢日志里的查询：先列出日志里记下的执行情况，再看现在的计划
  function explainLog(x, opts) {
    var o = dbaOpts(opts, ['nReturned', 'keysExamined', 'docsExamined', 'ms']), out = [];
    var m = M(), verb = o.analyze === true ? 'executionStats' : 'queryPlanner';
    var entry = x == null ? null : logEntry(x, m);
    if (!entry) fail(m.needLog);
    var rec = recOf(entry);
    if (rec) {
      out.push(m.recTitle);
      headOut(rec, Object.assign({}, o, { cols: null, exclude: null }), out);
      out.push('');
    }
    var ec = explainCmd(entry, o);
    cmdLine(o, "db.getSiblingDB('" + ec.db + "').runCommand({explain: " + valText(ec.cmd, true, o) + ", verbosity: '" + verb + "'})", out);
    showPlan(runCmd(curDb().getSiblingDB(ec.db), { explain: ec.cmd, verbosity: verb }), o, out, rec);
  }
  // ─── 慢日志 → mongosh 语句。值写成 JS 字面量，BSON 类型照原样：ISODate、ObjectId、NumberLong...
  function jsStr(v) { return "'" + JSON.stringify(String(v)).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'"; }
  function jsKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k); }
  function binParts(v) {
    var legacy = typeof v.base64 === 'function';
    return {
      sub: legacy ? v.subtype() : v.sub_type,
      hex: safe(function () { return legacy ? v.hex() : v.toString('hex'); }, ''),
      b64: safe(function () { return legacy ? v.base64() : v.toString('base64'); }, '')
    };
  }
  function jsLit(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return isFinite(v) ? String(v) : isNaN(v) ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity');
    if (typeof v === 'string') return jsStr(v);
    if (typeof v === 'bigint') return "NumberLong('" + String(v) + "')";
    if (isDate(v)) return isNaN(v.getTime()) ? 'new Date(NaN)' : "ISODate('" + v.toISOString() + "')";
    if (isRegExp(v)) return String(v);
    var bt = bsonType(v);
    switch (bt) {
      case 'ObjectId': case 'ObjectID': return "ObjectId('" + (typeof v.str === 'string' ? v.str : v.toHexString()) + "')";
      case 'Long': return "NumberLong('" + numText(v) + "')";
      case 'Int32': return 'NumberInt(' + numText(v) + ')';
      case 'Double': return numText(v);
      case 'Decimal128': return "NumberDecimal('" + numText(v) + "')";
      case 'Timestamp': { var tp = tsParts(v); return 'Timestamp({t: ' + tp[0] + ', i: ' + tp[1] + '})'; }
      case 'Binary': {
        var b = binParts(v);
        if (b.sub === 4 && b.hex.length === 32) return "UUID('" + b.hex.slice(0, 8) + '-' + b.hex.slice(8, 12) + '-' + b.hex.slice(12, 16) + '-' + b.hex.slice(16, 20) + '-' + b.hex.slice(20) + "')";
        return 'BinData(' + b.sub + ", '" + b.b64 + "')";
      }
      case 'MinKey': return 'MinKey()';
      case 'MaxKey': return 'MaxKey()';
      case 'BSONRegExp': return '/' + v.pattern + '/' + v.options;
    }
    if (Array.isArray(v)) return '[' + v.map(jsLit).join(', ') + ']';
    if (isDoc(v)) return '{' + Object.keys(v).map(function (k) { return jsKey(k) + ': ' + jsLit(v[k]); }).join(', ') + '}';
    return safe(function () { return String(v); }, '');
  }
  function pickOpts(c, keys) {
    var o = {}, n = 0;
    keys.forEach(function (k) { if (c[k] !== undefined && c[k] !== false) { o[k] = c[k]; n++; } });
    return n ? o : null;
  }
  function hasOperator(u) { return isDoc(u) && Object.keys(u).some(function (k) { return k.charAt(0) === '$'; }); }
  // explainCmd 清理过的命令 → 一行或几行 mongosh 语句；写操作返回 write: true
  function shellLines(db0, cmd) {
    var verb = Object.keys(cmd)[0], coll = String(cmd[verb]);
    var dbExpr = 'db.getSiblingDB(' + jsStr(db0) + ')';
    var useDot = /^[A-Za-z_][\w]*$/.test(coll) && !/^system\b/.test(coll) && typeof safe(function () { return curDb()[coll]; }) !== 'function';
    var c = dbExpr + (useDot ? '.' + coll : '.getCollection(' + jsStr(coll) + ')');
    var args = function (list) { while (list.length && list[list.length - 1] == null) list.pop(); return list.map(function (a) { return a == null ? '{}' : jsLit(a); }).join(', '); };
    switch (verb) {
      case 'find': {
        var q = c + '.find(' + args([cmd.filter || {}, cmd.projection || null]) + ')';
        ['sort', 'skip', 'limit', 'hint', 'collation', 'maxTimeMS', 'comment'].forEach(function (k) {
          if (cmd[k] !== undefined && !(k === 'skip' && !cmd[k]) && !(k === 'limit' && !cmd[k])) q += '.' + k + '(' + jsLit(cmd[k]) + ')';
        });
        if (cmd.allowDiskUse) q += '.allowDiskUse()';
        return { lines: [q] };
      }
      case 'aggregate':
        return { lines: [c + '.aggregate(' + args([cmd.pipeline || [], pickOpts(cmd, ['allowDiskUse', 'collation', 'hint', 'maxTimeMS', 'comment', 'let'])]) + ')'] };
      case 'count':
        return { lines: [c + '.count(' + args([cmd.query || {}, pickOpts(cmd, ['limit', 'skip', 'hint', 'collation', 'maxTimeMS'])]) + ')'] };
      case 'distinct':
        return { lines: [c + '.distinct(' + args([cmd.key, cmd.query || {}, pickOpts(cmd, ['collation'])]) + ')'] };
      case 'update':
        return { write: true, lines: (cmd.updates || []).map(function (st) {
          var fn = Array.isArray(st.u) || hasOperator(st.u) ? (st.multi ? 'updateMany' : 'updateOne') : 'replaceOne';
          return c + '.' + fn + '(' + args([st.q || {}, st.u, pickOpts(st, ['upsert', 'arrayFilters', 'hint', 'collation'])]) + ')';
        }) };
      case 'delete':
        return { write: true, lines: (cmd.deletes || []).map(function (st) {
          return c + '.' + (st.limit === 1 ? 'deleteOne' : 'deleteMany') + '(' + args([st.q || {}, pickOpts(st, ['hint', 'collation'])]) + ')';
        }) };
      case 'findAndModify': case 'findandmodify': {
        var fo = pickOpts(cmd, ['sort', 'collation', 'arrayFilters', 'hint']) || {};
        if (cmd.fields) fo.projection = cmd.fields;
        if (cmd.remove) return { write: true, lines: [c + '.findOneAndDelete(' + args([cmd.query || {}, Object.keys(fo).length ? fo : null]) + ')'] };
        if (cmd.upsert) fo.upsert = true;
        if (cmd['new']) fo.returnNewDocument = true;
        var fn2 = Array.isArray(cmd.update) || hasOperator(cmd.update) ? 'findOneAndUpdate' : 'findOneAndReplace';
        return { write: true, lines: [c + '.' + fn2 + '(' + args([cmd.query || {}, cmd.update, Object.keys(fo).length ? fo : null]) + ')'] };
      }
    }
    return { lines: [dbExpr + '.runCommand(' + jsLit(cmd) + ')'] };
  }
  function logQuery(x, opts) {
    var o = dbaOpts(opts), out = [], m = M();
    var entry = x == null ? null : logEntry(x, m);
    if (!entry) fail(m.needLog);
    var ec = explainCmd(entry, o), q = shellLines(ec.db, ec.cmd), rec = recOf(entry);
    if (rec) {
      var parts = [];
      if (rec.time) parts.push(valText(rec.time, true, o));
      if (rec.durationMillis != null) parts.push(rec.durationMillis + 'ms');
      if (rec.planSummary) parts.push(rec.planSummary);
      if (rec.docsExamined != null) parts.push('docsExamined ' + rec.docsExamined);
      if (rec.nreturned != null) parts.push('nreturned ' + rec.nreturned);
      if (rec.appName) parts.push(rec.appName);
      if (parts.length) out.push(m.recLine(parts));
    }
    if (q.write) out.push(m.writeWarn);
    Array.prototype.push.apply(out, q.lines);
    emit(out);
  }
  function showPlan(ex, o, out, rec) {
    var m = M();
    if (!isDoc(ex) || !(ex.queryPlanner || ex.stages)) fail(m.needExplain);
    // 聚合：$cursor 之后的阶段在树的上面，倒过来排
    var stages = Array.isArray(ex.stages) ? ex.stages : [];
    var cur = ex.queryPlanner ? ex : null, rest = [];
    stages.forEach(function (st) {
      var k = Object.keys(st).filter(function (key) { return key.charAt(0) === '$'; })[0];
      if (k === '$cursor') cur = st.$cursor;
      else if (k) rest.push({ name: k, st: st });
    });
    var qp = cur ? cur.queryPlanner || {} : {}, es = cur ? cur.executionStats || null : null;
    var sbe = String(ex.explainVersion) === '2' || !!(qp.winningPlan && qp.winningPlan.queryPlan);
    var wp = qp.winningPlan ? qp.winningPlan.queryPlan || qp.winningPlan : null;
    var root = sbe ? wp : (es && es.executionStages) || wp, sbeBy = sbe && es ? sbeStats(es.executionStages) : {};
    var rows = [], notes = new StrMap(), depth = 0;
    var note = function (row, key) { row.note = row.note ? row.note + ', ' + m.exNote[key] : m.exNote[key]; notes.set(key, true); };
    for (var i = rest.length - 1; i >= 0; i--) {
      var r = rest[i], spec = {};
      spec[r.name] = r.st[r.name];
      var row = { stage: '  '.repeat(depth) + r.name, index: '', nReturned: r.st.nReturned != null ? toNum(r.st.nReturned) : '',
        keysExamined: '', docsExamined: '', ms: r.st.executionTimeMillisEstimate != null ? toNum(r.st.executionTimeMillisEstimate) : '',
        detail: valText(r.st[r.name], true, o), note: '' };
      if (r.st.usedDisk) note(row, 'spilled');
      rows.push(row);
      depth++;
    }
    (function walk(n, d) {
      if (!isDoc(n)) return;
      if (n._child) { rows.push({ stage: '  '.repeat(d) + n.stage, index: '', nReturned: '', keysExamined: '', docsExamined: '', ms: '', detail: '', note: '' }); walk(n._child, d + 1); return; }
      var st = sbe && n.planNodeId != null ? sbeBy[n.planNodeId] || {} : n;
      var num = function (v) { return v != null ? toNum(v) : ''; };
      var row = { stage: '  '.repeat(d) + n.stage, index: n.indexName || '', nReturned: num(st.nReturned),
        keysExamined: sbe ? '' : num(n.keysExamined), docsExamined: sbe ? '' : num(n.docsExamined), ms: num(st.executionTimeMillisEstimate), detail: '', note: '' };
      if (n.indexBounds) row.detail = boundsText(n.indexBounds, o);
      else if (n.sortPattern) row.detail = 'sort ' + valText(n.sortPattern, true, o);
      else if (n.filter) row.detail = 'filter ' + valText(n.filter, true, o);
      else if (n.limitAmount != null) row.detail = 'limit ' + toNum(n.limitAmount);
      else if (n.skipAmount != null) row.detail = 'skip ' + toNum(n.skipAmount);
      else if (n.transformBy) row.detail = valText(n.transformBy, true, o);
      if (n.stage === 'COLLSCAN') note(row, 'fullScan');
      if (n.stage === 'SORT') note(row, 'memSort');
      if (n.usedDisk) note(row, 'spilled');
      if (n.isMultiKey) note(row, 'multikey');
      if (n.stage === 'FETCH' && n.filter) note(row, 'postFilter');
      rows.push(row);
      exChildren(n).forEach(function (c) { walk(c, d + 1); });
    })(root, depth);
    var h = { ns: qp.namespace, engine: sbe ? 'sbe' : 'classic' };
    if (es) {
      h.executionTimeMillis = toNum(es.executionTimeMillis); h.nReturned = toNum(es.nReturned);
      h.totalKeysExamined = toNum(es.totalKeysExamined); h.totalDocsExamined = toNum(es.totalDocsExamined);
      var nr = toNum(es.nReturned), de = toNum(es.totalDocsExamined);
      var isWrite = root && /^(UPDATE|DELETE)$/.test(String(root.stage));   // 写操作不返回文档，这个比例没意义
      if (de > 0 && !isWrite) h.docsExaminedPerReturned = nr > 0 ? Math.round(de / nr * 10) / 10 : 'Infinity';
    }
    if (qp.rejectedPlans) h.rejectedPlans = qp.rejectedPlans.length;
    if (qp.indexFilterSet) h.indexFilterSet = true;
    headOut(h, Object.assign({}, o, { cols: null, exclude: null }), out);
    // 只看计划时没有统计；SBE 没有每一步的扫描数：整列都是空的就不显示
    ['nReturned', 'keysExamined', 'docsExamined', 'ms'].forEach(function (k) {
      if (rows.every(function (r) { return r[k] === ''; })) rows.forEach(function (r) { delete r[k]; });
    });
    renderRows(rows, o, out, false, rows.length);
    var nl = [];
    notes.forEach(function (_, k) { nl.push(m.exNote[k]); });
    if (nl.length) out.push(m.exNotes(nl));
    if (rec && rec.planSummary) {
      var now = planSummaryOf(root);
      if (now && scanSet(now) !== scanSet(rec.planSummary)) out.push(m.planChanged(rec.planSummary, now));
    }
    emit(out);
  }

  // ─── 正在建的索引。3.6 ~ 4.2：建索引就在客户端连接上，msg 是 "Index Build ...: 2000/5000 40%"，带 progress。
  // 4.4 起：后台线程 IndexBuildsCoordinatorMongod-N 在建，msg 是当前阶段（扫描集合才有 progress），
  // 客户端连接上的 createIndexes 在旁边等；按 ns + 索引名把两条合成一行
  function buildNs(op) {
    var c = op.command || {};
    var ns = String(op.ns || '');
    if (c.createIndexes && (!ns || /\.\$cmd$/.test(ns))) ns = ns.replace(/\.\$cmd$/, '') + '.' + c.createIndexes;
    return ns;
  }
  function buildPhase(msg) {
    var p = String(msg || '').replace(/:?\s*\d+\/\d+\s+\d+%\s*$/, '').trim();
    var half = p.length / 2, a = p.slice(0, Math.floor(half)).trim(), b = p.slice(Math.ceil(half)).trim();
    if (p.length > 1 && a === b) p = a;   // 3.6 ~ 4.2 的 msg 会把阶段名写两遍
    return p.replace(/^Index Build:?\s*/i, '').replace(/^\((.*)\)$/, '$1') || p;
  }
  function builds(opts) {
    var o = dbaOpts(opts, ['done', 'total', 'pct', 'secs', 'opid']), out = [];
    cmdLine(o, "db.adminCommand({currentOp: 1, $all: true}) → msg /Index Build/ or command.createIndexes", out);
    var ops = runCmd(admin(), { currentOp: 1, $all: true }).inprog || [];
    var rows = [], byKey = {};
    var keyOf = function (op) {
      var ix = ((op.command || {}).indexes || []).map(function (i) { return i.name; }).sort().join(',');
      return buildNs(op) + '|' + ix;
    };
    ops.forEach(function (op) {
      if (!/index build/i.test(String(op.msg || ''))) return;
      var c = op.command || {}, ixs = c.indexes || [], p = op.progress || {};
      var done = p.done != null ? toNum(p.done) : '', total = p.total != null ? toNum(p.total) : '';
      var row = {
        ns: buildNs(op), index: ixs.map(function (i) { return i.name; }).join(', '),
        key: ixs.map(function (i) { return valText(i.key, true, o); }).join('; '),
        phase: buildPhase(op.msg), done: done, total: total, pct: total ? pctText(done, total) : '',
        secs: op.secs_running != null ? toNum(op.secs_running) : '', opid: op.opid != null ? op.opid : '',
        client: op.client || op.client_s || ''
      };
      byKey[keyOf(op)] = row;
      rows.push(row);
    });
    // 客户端连接上的 createIndexes：补上客户端和时长。找不到对应建索引线程的，可能还没开始（如在等锁），
    // 也可能已经建完、在等提交或写关注（4.4 起），从 currentOp 分不出来，统一显示“等待中”
    ops.forEach(function (op) {
      var c = op.command || {};
      if (!c.createIndexes || /index build/i.test(String(op.msg || ''))) return;
      var row = byKey[keyOf(op)], secs = op.secs_running != null ? toNum(op.secs_running) : '';
      if (row) {
        if (!row.client) row.client = op.client || op.client_s || '';
        if (secs !== '' && (row.secs === '' || secs > row.secs)) row.secs = secs;
        return;
      }
      var ixs = c.indexes || [];
      rows.push({
        ns: buildNs(op), index: ixs.map(function (i) { return i.name; }).join(', '),
        key: ixs.map(function (i) { return valText(i.key, true, o); }).join('; '),
        phase: M().buildWaiting, done: '', total: '', pct: '', secs: secs, opid: op.opid != null ? op.opid : '',
        client: op.client || op.client_s || ''
      });
    });
    rows.sort(function (a, b) { return (toNum(b.secs) || 0) - (toNum(a.secs) || 0); });
    rowsOut(rows, o, out);
    if (!rows.length) out.push(M().noBuild);
    emit(out);
  }

  // 日志：getLog 只保留内存里最近的 1024 行。4.4 起每行是 JSON，之前是文本：
  // 2024-01-01T08:30:00.123+0000 I NETWORK  [listener] connection accepted ...
  var SEV_RANK = { F: 0, E: 1, W: 2, I: 3, D: 4 };
  function logLine(line) {
    line = String(line).replace(/\s+$/, '');
    if (!line) return null;
    if (line.charAt(0) === '{') {
      var j = safe(function () { return JSON.parse(line); });
      if (j) {
        var t = j.t && j.t.$date != null ? new Date(j.t.$date) : null;
        return { time: t && !isNaN(t.getTime()) ? t : '', sev: j.s || '', comp: j.c || '', ctx: j.ctx || '', id: j.id != null ? j.id : '', msg: j.msg || '', attr: j.attr, json: true, raw: line };
      }
    }
    var m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)([+-]\d\d):?(\d\d)\s+([A-Z]\d?)\s+(\S+)\s+\[([^\]]*)\]\s?(.*)$/.exec(line);
    if (!m) return { time: '', sev: '', comp: '', ctx: '', id: '', msg: line, raw: line };
    var d = new Date(m[1] + m[2] + ':' + m[3]);
    return { time: isNaN(d.getTime()) ? '' : d, sev: m[4], comp: m[5] === '-' ? '' : m[5], ctx: m[6], id: '', msg: m[7], raw: line };
  }
  function log(a, b) {
    var opts = a;
    if (typeof a === 'number') opts = Object.assign({}, b, { n: a });
    else if (typeof a === 'string' || isRegExp(a)) opts = Object.assign({}, b, { grep: a });
    var grep = opts && opts.grep, sev = opts && opts.sev;
    var o = dbaOpts(opts && typeof opts === 'object' ? Object.assign({}, opts, { grep: null }) : opts, ['#', 'id']), out = [];
    var n = toNum(o.n) || 20;
    if (sev != null && !(String(sev).charAt(0).toUpperCase() in SEV_RANK)) fail(M().badSev);
    var maxRank = sev != null ? SEV_RANK[String(sev).charAt(0).toUpperCase()] : null;
    var which = o.startup ? 'startupWarnings' : 'global';
    cmdLine(o, "db.adminCommand({getLog: '" + which + "'})", out);
    var lines = runCmd(admin(), { getLog: which }).log || [];
    var re = grep == null || grep === '' ? null : isRegExp(grep) ? grep : null;
    var needle = re || grep == null ? null : String(grep).toLowerCase();
    var rows = [];
    lines.forEach(function (l) {
      var r = logLine(l);
      if (!r || (!r.msg && r.attr == null)) return;
      if (maxRank != null && !(SEV_RANK[String(r.sev).charAt(0)] <= maxRank)) return;
      if (re && !re.test(r.raw)) return;
      if (needle && r.raw.toLowerCase().indexOf(needle) < 0) return;
      var row = { '#': 0, time: r.time, sev: r.sev, comp: r.comp, ctx: r.ctx, id: r.id, msg: r.msg };
      if (r.json) row.attr = r.attr != null ? valText(r.attr, true, o) : '';
      row._attr = r.attr;
      row._raw = r.json ? null : r.raw;
      rows.push(row);
    });
    var total = rows.length;
    if (rows.length > n) rows = rows.slice(rows.length - n);
    // 4.4 起 Slow query 的 attr 里有 ns、command、type（update / remove 是单条语句）
    lastRows = rows.map(function (r, i) {
      r['#'] = i + 1;
      var a = r._attr, raw = r._raw;
      delete r._attr; delete r._raw;
      if (isDoc(a) && isDoc(a.command)) {
        a = ejsonFix(a);
        return { op: a.type, ns: a.ns, command: a.command, originatingCommand: a.originatingCommand, stats: statsFromAttr(a, isDate(r.time) ? r.time : null) };
      }
      return raw ? safe(function () { return textLogEntry(raw); }) || null : null;   // 4.4 之前的文本日志
    });
    if (rows.every(function (r) { return r.id === ''; })) rows.forEach(function (r) { delete r.id; });   // 4.4 之前没有 id
    renderRows(rows, o, out, false, rows.length);
    if (total > rows.length) out.push(paint(o, DIM, M().logTail(rows.length, total)));
    emit(out);
  }

  // 每个命令的详细帮助（mt.help('ps')）：t 标题，u 用法，o 选项，c 输出，n 说明，s 相关命令
  var HELP_DOC = {"ps": {"mysql": "SHOW PROCESSLIST", "zh": {"t": "正在执行的操作", "u": [["mt.ps()", "运行最久的在前"], ["mt.ps({secs: 5})", "只看运行超过 5 秒的"], ["mt.ps({ns: 'shop.orders'})", "只看某个集合；'shop' 匹配整个库"], ["mt.ps({all: true})", "包括空闲连接和内部线程"], ["mt.ps({sort: 'opid'})", "排序：'desc'（默认）、'asc'、'opid'，或 {ns: 1, secs: -1}"]], "o": [["secs", "只看运行超过这么多秒的"], ["ns", "库或 库.集合"], ["all", "true：用 $all，包括空闲连接和内部线程"], ["sort", "'desc' / 'asc' / 'opid' / 按列名的排序文档"]], "c": [["opid", "操作 ID，db.killOp(opid) 用它"], ["secs", "已经运行的秒数"], ["op", "query / getmore / insert / update / remove / command；空闲连接是 idle"], ["ns", "库.集合"], ["client / app", "客户端、appName"], ["lock", "在等锁时显示 WAIT"], ["plan", "计划摘要，COLLSCAN 是全表扫描"], ["command", "命令，去掉了驱动加的字段"]], "n": ["执行的是 db.adminCommand({currentOp: 1, active: true})", "默认不显示空闲连接、内部线程、驱动的心跳长轮询和 mt.ps() 自己"], "s": ["locks", "txns", "conns"]}, "en": {"t": "running operations", "u": [["mt.ps()", "longest running first"], ["mt.ps({secs: 5})", "only those running for 5+ seconds"], ["mt.ps({ns: 'shop.orders'})", "one collection; 'shop' matches the whole database"], ["mt.ps({all: true})", "include idle connections and internal threads"], ["mt.ps({sort: 'opid'})", "sort: 'desc' (default), 'asc', 'opid', or {ns: 1, secs: -1}"]], "o": [["secs", "only operations running at least this many seconds"], ["ns", "database or database.collection"], ["all", "true: use $all, including idle connections and internal threads"], ["sort", "'desc' / 'asc' / 'opid' / a sort document on column names"]], "c": [["opid", "operation ID, used by db.killOp(opid)"], ["secs", "seconds running"], ["op", "query / getmore / insert / update / remove / command; idle for idle connections"], ["ns", "database.collection"], ["client / app", "client, appName"], ["lock", "WAIT while waiting for a lock"], ["plan", "plan summary; COLLSCAN is a full scan"], ["command", "the command, without driver fields"]], "n": ["Runs db.adminCommand({currentOp: 1, active: true})", "Hidden by default: idle connections, internal threads, drivers' awaitable hello and mt.ps() itself"], "s": ["locks", "txns", "conns"]}}, "slow": {"mysql": "mysql.slow_log", "zh": {"t": "慢查询（profiler）", "u": [["mt.slow()", "当前库，最新的在前"], ["mt.slow('shop')", "指定库，也可以传 db 对象"], ["mt.slow({ms: 500, ns: 'orders'})", "超过 500 毫秒的、orders 集合的"], ["mt.slow({sort: 'ms'})", "最慢的在前；'asc' 最早的在前，或排序文档"], ["mt.explainLog(1)", "对第 1 行做 explain；mt.logQuery(1) 转成查询语句"]], "o": [["ms", "只看耗时不少于这么多毫秒的"], ["ns", "集合名或 库.集合"], ["sort", "'desc'（默认，最新的在前）/ 'asc' / 'ms'（最慢的在前）/ 排序文档"]], "c": [["#", "行号，mt.explainLog(n) / mt.logQuery(n) 用它"], ["ts / ms", "结束时间、耗时（毫秒）"], ["op / ns / plan", "操作类型、库.集合、计划摘要"], ["keysExamined / docsExamined", "扫了多少索引键、多少文档"], ["nreturned", "返回多少条"], ["client / user", "客户端、用户（没开认证时不显示 user）"], ["command", "命令"]], "n": ["读的是 system.profile，不改 profiler 设置", "profiler 默认关闭，每个库单独打开：db.setProfilingLevel(1, {slowms: 100})", "system.profile 是 1 MB 的 capped 集合，只有最近一段时间的"], "s": ["explainLog", "logQuery", "log"]}, "en": {"t": "slow queries (profiler)", "u": [["mt.slow()", "current database, newest first"], ["mt.slow('shop')", "another database; a db object works too"], ["mt.slow({ms: 500, ns: 'orders'})", "500 ms or more, orders collection only"], ["mt.slow({sort: 'ms'})", "slowest first; 'asc' oldest first, or a sort document"], ["mt.explainLog(1)", "explain row 1; mt.logQuery(1) turns it into a statement"]], "o": [["ms", "only operations that took at least this many milliseconds"], ["ns", "collection name or database.collection"], ["sort", "'desc' (default, newest first) / 'asc' / 'ms' (slowest first) / a sort document"]], "c": [["#", "row number, used by mt.explainLog(n) / mt.logQuery(n)"], ["ts / ms", "when it finished, duration (ms)"], ["op / ns / plan", "operation, database.collection, plan summary"], ["keysExamined / docsExamined", "index keys and documents scanned"], ["nreturned", "documents returned"], ["client / user", "client, user (user hidden without authentication)"], ["command", "the command"]], "n": ["Reads system.profile; never changes profiler settings", "The profiler is off by default; turn it on per database: db.setProfilingLevel(1, {slowms: 100})", "system.profile is a 1 MB capped collection, so it only covers recent activity"], "s": ["explainLog", "logQuery", "log"]}}, "top": {"mysql": "sys.schema_table_statistics", "zh": {"t": "各集合读写耗时（类似 mongotop）", "u": [["mt.top()", "间隔 1 秒采样两次，看这 1 秒内的耗时"], ["mt.top({interval: 5})", "间隔 5 秒"], ["mt.top({interval: 0})", "只取一次，看启动以来的累计值"], ["mt.top({ns: 'shop'})", "只看一个库；'shop.orders' 只看一个集合"]], "o": [["interval", "采样间隔秒数，默认 1；0 = 启动以来累计"], ["ns", "库或 库.集合"]], "c": [["ns", "库.集合"], ["totalMs", "这段时间里所有操作的耗时（毫秒）"], ["readMs / writeMs", "其中读锁、写锁的耗时"], ["ops", "操作次数"]], "n": ["执行的是 db.adminCommand({top: 1})，两次相减", "操作结束时才记时间，还在跑的长查询看 mt.ps()", "只能连 mongod"], "s": ["ps", "status"]}, "en": {"t": "time per collection (like mongotop)", "u": [["mt.top()", "two samples 1 second apart: time spent in that second"], ["mt.top({interval: 5})", "5 seconds apart"], ["mt.top({interval: 0})", "one sample: totals since startup"], ["mt.top({ns: 'shop'})", "one database; 'shop.orders' for one collection"]], "o": [["interval", "seconds between samples, 1 by default; 0 = totals since startup"], ["ns", "database or database.collection"]], "c": [["ns", "database.collection"], ["totalMs", "time spent by all operations in the interval (ms)"], ["readMs / writeMs", "of which under read / write locks"], ["ops", "number of operations"]], "n": ["Runs db.adminCommand({top: 1}) and subtracts two samples", "Time is recorded when an operation finishes; use mt.ps() for long ones still running", "Must run on a mongod"], "s": ["ps", "status"]}}, "locks": {"mysql": "sys.innodb_lock_waits", "zh": {"t": "谁在等锁、锁被谁占着", "u": [["mt.locks()", "有人排队的锁，以及挡住它们的持有者"], ["mt.locks({all: true})", "所有被占用的锁，包括没人排队的"]], "o": [["all", "true：列出所有被占用的锁"]], "c": [["resource", "锁资源，如 Collection shop.orders；全局锁显示 Global 3 这样的编号"], ["mode", "IS / IX 意向共享 / 意向排他，S 共享，X 排他"], ["state", "HOLD 占着，WAIT 在排队"], ["opid / secs", "操作 ID、已运行秒数"], ["client / desc", "客户端、连接名或内部线程名"], ["op / ns / command", "操作类型、库.集合、命令"]], "n": ["用 lockInfo 拿持有者和排队者，按 opid 关联 currentOp", "默认只列和排队者冲突的持有者", "普通读写之间的冲突是 WriteConflict 重试，不是等锁", "只能连 mongod"], "s": ["ps", "txns"]}, "en": {"t": "lock waits", "u": [["mt.locks()", "locks with waiters, and the holders blocking them"], ["mt.locks({all: true})", "every lock that is held, waiters or not"]], "o": [["all", "true: every lock that is held"]], "c": [["resource", "lock resource, e.g. Collection shop.orders; global locks show as a number such as Global 3"], ["mode", "IS / IX intent shared / intent exclusive, S shared, X exclusive"], ["state", "HOLD holds it, WAIT is queued"], ["opid / secs", "operation ID, seconds running"], ["client / desc", "client, connection or internal thread name"], ["op / ns / command", "operation, database.collection, command"]], "n": ["Uses lockInfo for holders and waiters, joined with currentOp by opid", "By default only holders that conflict with a waiter are listed", "Conflicts between ordinary reads and writes are retried (WriteConflict), not lock waits", "Must run on a mongod"], "s": ["ps", "txns"]}}, "txns": {"mysql": "INFORMATION_SCHEMA.INNODB_TRX", "zh": {"t": "未提交的事务", "u": [["mt.txns()", "开得最久的在前"], ["mt.txns({secs: 10})", "只看开了 10 秒以上的"], ["mt.txns({sort: 'asc'})", "最短的在前；也可以给排序文档"]], "o": [["secs", "只看开了这么多秒以上的"], ["sort", "'desc'（默认）/ 'asc' / 排序文档"]], "c": [["lsid / txnNumber", "会话 ID、会话里的事务编号"], ["state", "active 正在执行语句，idle 两条语句之间空闲"], ["openSecs", "已经开了多久"], ["activeSecs / idleSecs", "其中执行、空闲的时间"], ["start", "开始时间"], ["expiresIn", "再过多少秒自动中止（默认 60 秒）"], ["opid / ns", "执行中时的操作 ID、库.集合"], ["client / app", "客户端、appName"]], "n": ["4.0 起才有事务", "立刻结束一个事务：db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})", "idleSecs 很大的，通常是应用忘了 commit / abort"], "s": ["ps", "locks"]}, "en": {"t": "open transactions", "u": [["mt.txns()", "open longest first"], ["mt.txns({secs: 10})", "only those open for 10+ seconds"], ["mt.txns({sort: 'asc'})", "shortest first; or a sort document"]], "o": [["secs", "only transactions open at least this many seconds"], ["sort", "'desc' (default) / 'asc' / a sort document"]], "c": [["lsid / txnNumber", "session ID, transaction number in the session"], ["state", "active running a statement, idle between statements"], ["openSecs", "how long it has been open"], ["activeSecs / idleSecs", "of which running / idle"], ["start", "when it started"], ["expiresIn", "seconds until it is aborted automatically (60 by default)"], ["opid / ns", "operation ID and database.collection while running"], ["client / app", "client, appName"]], "n": ["Transactions exist since 4.0", "To end one now: db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})", "A large idleSecs usually means the application forgot to commit or abort"], "s": ["ps", "locks"]}}, "repl": {"mysql": "SHOW SLAVE STATUS", "zh": {"t": "副本集状态", "u": [["mt.repl()", "成员状态、复制延迟、同步源"]], "o": [], "c": [["name / state / health", "成员地址、PRIMARY / SECONDARY...、1 正常 0 连不上"], ["lagSecs", "复制延迟（秒），和主节点的 optime 比"], ["optime", "最后应用的操作时间"], ["syncSource", "从哪个成员同步"], ["pingMs / lastHeartbeat", "心跳往返时间、最后一次心跳"], ["self", "* 是当前连接的成员"]], "n": ["执行的是 rs.status()", "只能在副本集成员上执行"], "s": ["oplog", "status"]}, "en": {"t": "replica set status", "u": [["mt.repl()", "member state, replication lag, sync source"]], "o": [], "c": [["name / state / health", "member address, PRIMARY / SECONDARY..., 1 up 0 unreachable"], ["lagSecs", "replication lag in seconds, against the primary's optime"], ["optime", "time of the last operation applied"], ["syncSource", "the member it syncs from"], ["pingMs / lastHeartbeat", "heartbeat round trip, last heartbeat"], ["self", "* marks the member you are connected to"]], "n": ["Runs rs.status()", "Only works on a replica set member"], "s": ["oplog", "status"]}}, "dbs": {"mysql": "SHOW DATABASES", "zh": {"t": "各库大小", "u": [["mt.dbs()", "按库名排序，最后一行是合计"]], "o": [], "c": [["name", "库名"], ["disk", "磁盘占用（sizeOnDisk）"], ["empty", "是否为空"]], "n": ["执行的是 listDatabases"], "s": ["colls", "frag"]}, "en": {"t": "database sizes", "u": [["mt.dbs()", "sorted by name, total on the last line"]], "o": [], "c": [["name", "database name"], ["disk", "disk usage (sizeOnDisk)"], ["empty", "whether it is empty"]], "n": ["Runs listDatabases"], "s": ["colls", "frag"]}}, "colls": {"mysql": "SHOW TABLE STATUS", "zh": {"t": "各集合大小", "u": [["mt.colls()", "当前库，大的在前"], ["mt.colls('shop')", "指定库，也可以传 db 对象"]], "o": [], "c": [["count", "文档数"], ["logical", "数据的逻辑大小（未压缩）"], ["disk", "数据的磁盘占用（压缩后）"], ["indexes / indexDisk", "索引个数、索引的磁盘占用"]], "n": ["对每个集合执行 $collStats，视图跳过", "按 disk + indexDisk 从大到小排"], "s": ["frag", "idx", "cache"]}, "en": {"t": "collection sizes", "u": [["mt.colls()", "current database, largest first"], ["mt.colls('shop')", "another database; a db object works too"]], "o": [], "c": [["count", "documents"], ["logical", "logical data size (uncompressed)"], ["disk", "disk space used by the data (compressed)"], ["indexes / indexDisk", "number of indexes, disk space used by them"]], "n": ["Runs $collStats on each collection; views are skipped", "Sorted by disk + indexDisk, largest first"], "s": ["frag", "idx", "cache"]}}, "frag": {"mysql": "TABLES.DATA_FREE", "zh": {"t": "删数据后可回收的磁盘空间", "u": [["mt.frag()", "当前库"], ["mt.frag('shop')", "指定库，也可以传 db 对象"]], "o": [], "c": [["disk", "数据文件大小"], ["reusable / pct", "其中可复用的空间、占比"], ["indexDisk / indexReusable", "索引文件大小、其中可复用的空间"]], "n": ["读 $collStats 的 wiredTiger['block-manager']['file bytes available for reuse']", "要还给操作系统：对集合执行 compact，或者从节点全量同步", "数字是上次 checkpoint（默认 60 秒）时的值"], "s": ["colls", "dbs"]}, "en": {"t": "disk space reusable after deletes", "u": [["mt.frag()", "current database"], ["mt.frag('shop')", "another database; a db object works too"]], "o": [], "c": [["disk", "data file size"], ["reusable / pct", "reusable space in it, and its share"], ["indexDisk / indexReusable", "index file size, reusable space in it"]], "n": ["Reads wiredTiger['block-manager']['file bytes available for reuse'] from $collStats", "To give it back to the OS: run compact on the collection, or resync a secondary", "Numbers are as of the last checkpoint (every 60 seconds by default)"], "s": ["colls", "dbs"]}}, "idx": {"mysql": "SHOW INDEX FROM t", "zh": {"t": "索引", "u": [["mt.idx('orders')", "当前库的 orders"], ["mt.idx('shop.orders')", "指定库"], ["mt.idx(db.orders)", "集合对象"]], "o": [], "c": [["name / key", "索引名、索引键"], ["disk", "磁盘占用"], ["ops / since", "自 since 以来被用到的次数（重启后清零）"], ["options", "unique、sparse、ttl=秒、partial=条件、hidden、collation=语言"]], "n": ["getIndexes() + $indexStats + $collStats"], "s": ["unusedIdx", "dupIdx", "builds"]}, "en": {"t": "indexes", "u": [["mt.idx('orders')", "orders in the current database"], ["mt.idx('shop.orders')", "another database"], ["mt.idx(db.orders)", "a collection object"]], "o": [], "c": [["name / key", "index name, index key"], ["disk", "disk usage"], ["ops / since", "times used since `since` (reset on restart)"], ["options", "unique, sparse, ttl=seconds, partial=filter, hidden, collation=locale"]], "n": ["getIndexes() + $indexStats + $collStats"], "s": ["unusedIdx", "dupIdx", "builds"]}}, "unusedIdx": {"mysql": "sys.schema_unused_indexes", "zh": {"t": "没被用过的索引", "u": [["mt.unusedIdx()", "所有用户库（跳过 admin、local、config）"], ["mt.unusedIdx('shop')", "只看一个库"]], "o": [], "c": [["ns / index / key", "库.集合、索引名、索引键"], ["disk", "删掉能省下的磁盘空间"], ["since", "开始计数的时间"], ["options", "unique、ttl 等"]], "n": ["列出 $indexStats 的 accesses.ops 为 0 的索引，_id_ 不列", "计数在重启、索引重建后清零；表头 uptime 太短时不准", "计数是每个节点自己的，每个成员都要看", "unique、ttl 索引即使没被查询用过也在干活", "删之前可以先 db.c.hideIndex('名字') 观察"], "s": ["dupIdx", "idx"]}, "en": {"t": "unused indexes", "u": [["mt.unusedIdx()", "every user database (admin, local, config skipped)"], ["mt.unusedIdx('shop')", "one database"]], "o": [], "c": [["ns / index / key", "database.collection, index name, index key"], ["disk", "disk space dropping it would save"], ["since", "when counting started"], ["options", "unique, ttl and so on"]], "n": ["Lists indexes whose $indexStats accesses.ops is 0; _id_ is not listed", "Counts reset on restart and index rebuild; unreliable if uptime is short", "Counts are per node; check every member", "unique and ttl indexes do work even if no query uses them", "Hide one first with db.c.hideIndex('name') and watch"], "s": ["dupIdx", "idx"]}}, "dupIdx": {"mysql": "sys.schema_redundant_indexes", "zh": {"t": "冗余索引", "u": [["mt.dupIdx()", "所有用户库"], ["mt.dupIdx('shop')", "只看一个库"]], "o": [], "c": [["ns / index / key", "冗余的那个索引"], ["disk", "它占的磁盘空间"], ["coveredBy / coveredKey", "能代替它的索引（取键最短的）"]], "n": ["键是另一个索引键的前缀（字段和方向都一样）就算冗余，如 {a: 1} 被 {a: 1, b: 1} 覆盖", "这些不算：前缀索引是 unique / ttl / partial / sparse / hidden；长的是 partial / sparse；collation 不同；text、hashed 等特殊索引；方向不同"], "s": ["unusedIdx", "idx"]}, "en": {"t": "redundant indexes", "u": [["mt.dupIdx()", "every user database"], ["mt.dupIdx('shop')", "one database"]], "o": [], "c": [["ns / index / key", "the redundant index"], ["disk", "disk space it takes"], ["coveredBy / coveredKey", "the index that can replace it (shortest key)"]], "n": ["Redundant when its key is a prefix of another index's key (same fields and directions), e.g. {a: 1} covered by {a: 1, b: 1}", "Never reported: unique / ttl / partial / sparse / hidden prefix; partial / sparse longer index; different collation; text, hashed and other special indexes; different directions"], "s": ["unusedIdx", "idx"]}}, "builds": {"mysql": "ALTER TABLE progress", "zh": {"t": "正在建的索引", "u": [["mt.builds()", "每个正在建的索引一行"]], "o": [], "c": [["ns / index / key", "库.集合、索引名、索引键"], ["phase", "scanning collection、inserting keys from external sorter into index、draining writes...；等待中 = 还没开始或在等提交"], ["done / total / pct", "当前阶段的进度"], ["secs", "已经跑了多少秒"], ["opid / client", "操作 ID、发起的客户端"]], "n": ["来自 currentOp 的 $all: true", "停掉：4.4 起 db.c.dropIndex('名字')，之前 db.killOp(opid)", "只显示当前连接的节点；从节点的进度要连上去看"], "s": ["idx", "ps"]}, "en": {"t": "index builds in progress", "u": [["mt.builds()", "one row per index build"]], "o": [], "c": [["ns / index / key", "database.collection, index name, index key"], ["phase", "scanning collection, inserting keys from external sorter into index, draining writes...; waiting = not started yet or waiting to commit"], ["done / total / pct", "progress of the current phase"], ["secs", "seconds running"], ["opid / client", "operation ID, client that started it"]], "n": ["From currentOp with $all: true", "To stop one: db.c.dropIndex('name') since 4.4, db.killOp(opid) before", "Shows the node you are connected to; connect to a secondary for its progress"], "s": ["idx", "ps"]}}, "explain": {"mysql": "EXPLAIN [ANALYZE]", "zh": {"t": "执行计划", "u": [["mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))", "只看计划，不执行"], ["mt.explain(db.orders.find({...}), {analyze: true})", "真的执行一遍，看扫描数和耗时"], ["mt.explain(db.orders.explain('executionStats').aggregate([...]))", "聚合：传 explain 的结果"], ["mt.explain(db.orders.aggregate([...]))", "mongosh 里聚合游标也可以"]], "o": [["analyze", "true：explain('executionStats')，会执行查询；默认 queryPlanner，不执行"]], "c": [["表头", "ns、engine（classic / sbe）、rejectedPlans；analyze 时还有总耗时、扫描数、docsExaminedPerReturned"], ["stage", "IXSCAN / FETCH / COLLSCAN / SORT / LIMIT... 从上往下是从结果到数据源"], ["index / detail", "用的索引；索引范围、过滤条件、排序字段等"], ["nReturned / keysExamined / docsExamined / ms", "每一步的统计（analyze 时）"], ["note", "全表扫描、内存排序、用到了磁盘、取出后再过滤、多键索引"]], "n": ["慢日志里的查询用 mt.explainLog()"], "s": ["explainLog", "logQuery", "slow"]}, "en": {"t": "query plans", "u": [["mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))", "plan only, nothing runs"], ["mt.explain(db.orders.find({...}), {analyze: true})", "really runs it: rows scanned, time"], ["mt.explain(db.orders.explain('executionStats').aggregate([...]))", "aggregation: pass the explain result"], ["mt.explain(db.orders.aggregate([...]))", "an aggregation cursor works in mongosh"]], "o": [["analyze", "true: explain('executionStats'), runs the query; default queryPlanner, nothing runs"]], "c": [["header", "ns, engine (classic / sbe), rejectedPlans; with analyze also total time, rows scanned, docsExaminedPerReturned"], ["stage", "IXSCAN / FETCH / COLLSCAN / SORT / LIMIT...; top to bottom is result to data"], ["index / detail", "index used; index bounds, filter, sort fields and so on"], ["nReturned / keysExamined / docsExamined / ms", "per-step statistics (with analyze)"], ["note", "full scan, in-memory sort, spilled to disk, filtered after fetch, multikey"]], "n": ["For queries from a slow log use mt.explainLog()"], "s": ["explainLog", "logQuery", "slow"]}}, "explainLog": {"mysql": "EXPLAIN on a slow log query", "zh": {"t": "对慢日志里的查询做 explain", "u": [["mt.slow({sort: 'ms'}); mt.explainLog(1)", "profiler 里最慢的那条"], ["mt.log('Slow query'); mt.explainLog(2)", "日志里的第 2 条（4.4 之前找 'command: find'）"], ["mt.explainLog(`整行日志`)", "日志文件里复制的整行，用反引号包起来"], ["mt.explainLog(`{ find: \"orders\", ... }`)", "只复制命令那一段，从 { 开始"], ["mt.explainLog({find: 'orders', filter: {...}}, {db: 'shop'})", "自己写的命令"], ["mt.explainLog(1, {analyze: true})", "真的执行一遍"]], "o": [["analyze", "true：执行一遍拿统计；默认只看计划"], ["db", "命令里没有 $db、也没有 ns 时用哪个库"]], "c": [["慢日志里记录的执行情况", "time、durationMillis、planSummary、keysExamined、docsExamined、nreturned、hasSortStage、numYields、reslen、appName、client..."], ["之后", "和 mt.explain() 一样的计划；计划和慢日志里的不一样时会提示"]], "n": ["去掉 shardVersion、lsid、$clusterTime、$sortKey 等 mongos / 驱动加的字段", "库名取命令的 $db 或日志里的 ns", "4.2 及之前 mt.log() 每行只有前 512 个字符，长命令会被截断；从日志文件复制没有这个问题", "表格里显示的命令去掉了引号，不能粘贴回来，用行号"], "s": ["logQuery", "slow", "log", "explain"]}, "en": {"t": "explain a query from a slow log", "u": [["mt.slow({sort: 'ms'}); mt.explainLog(1)", "the slowest one in the profiler"], ["mt.log('Slow query'); mt.explainLog(2)", "row 2 of the log (before 4.4 search 'command: find')"], ["mt.explainLog(`whole log line`)", "a whole line copied from the log file, in backticks"], ["mt.explainLog(`{ find: \"orders\", ... }`)", "just the command, from its {"], ["mt.explainLog({find: 'orders', filter: {...}}, {db: 'shop'})", "a command you write yourself"], ["mt.explainLog(1, {analyze: true})", "really run it"]], "o": [["analyze", "true: run it for statistics; plan only by default"], ["db", "database to use when the command has no $db and there is no ns"]], "c": [["What the slow log recorded", "time, durationMillis, planSummary, keysExamined, docsExamined, nreturned, hasSortStage, numYields, reslen, appName, client..."], ["Then", "the plan, as in mt.explain(); a note if it differs from the logged plan"]], "n": ["Drops shardVersion, lsid, $clusterTime, $sortKey and other fields added by mongos and drivers", "The database comes from the command's $db or the log's ns", "On 4.2 and earlier mt.log() keeps only the first 512 characters of a line; lines copied from the log file are complete", "Commands shown in tables lost their quotes and cannot be pasted back; use the row number"], "s": ["logQuery", "slow", "log", "explain"]}}, "logQuery": {"mysql": "slow log → SQL", "zh": {"t": "把慢日志转成查询语句", "u": [["mt.logQuery(1)", "上一次 mt.slow() / mt.log() 的第 1 行"], ["mt.logQuery(`整行日志`)", "日志文件里复制的整行"], ["mt.logQuery({find: 'orders', filter: {...}}, {db: 'shop'})", "命令对象"]], "o": [["db", "命令里没有 $db、也没有 ns 时用哪个库"]], "c": [["// 慢日志：...", "来自慢日志时，当时的时间、耗时、计划、扫描数、返回数"], ["db.getSiblingDB(...)....", "可以直接运行的语句"]], "n": ["只打印，不执行", "类型照原样：ISODate、ObjectId、NumberLong、NumberDecimal、UUID、正则...", "update / delete 写成 updateOne / updateMany / deleteOne...，前面有一行注释提醒会修改数据", "输入和 mt.explainLog() 一样"], "s": ["explainLog", "slow", "log"]}, "en": {"t": "turn a slow-log query into a statement", "u": [["mt.logQuery(1)", "row 1 of the last mt.slow() / mt.log()"], ["mt.logQuery(`whole log line`)", "a whole line copied from the log file"], ["mt.logQuery({find: 'orders', filter: {...}}, {db: 'shop'})", "a command object"]], "o": [["db", "database to use when the command has no $db and there is no ns"]], "c": [["// slow log: ...", "for slow-log input: when it ran, duration, plan, rows scanned and returned"], ["db.getSiblingDB(...)....", "a statement you can run"]], "n": ["Prints only; nothing runs", "Types are kept: ISODate, ObjectId, NumberLong, NumberDecimal, UUID, regexes...", "update / delete become updateOne / updateMany / deleteOne..., with a comment line warning they change data", "Takes the same input as mt.explainLog()"], "s": ["explainLog", "slow", "log"]}}, "conns": {"mysql": "PROCESSLIST GROUP BY host", "zh": {"t": "连接来源", "u": [["mt.conns()", "按客户端 IP 统计连接数"]], "o": [], "c": [["表头", "current 当前连接数、available 还能建多少、totalCreated 启动以来一共建过多少"], ["client", "客户端 IP"], ["conns / active", "连接数、其中正在执行操作的"], ["apps", "这些连接的 appName"]], "n": ["serverStatus().connections + currentOp 的 $all: true"], "s": ["ps", "status"]}, "en": {"t": "where connections come from", "u": [["mt.conns()", "connections per client IP"]], "o": [], "c": [["header", "current open connections, available how many more, totalCreated since startup"], ["client", "client IP"], ["conns / active", "connections, of which running an operation"], ["apps", "their appNames"]], "n": ["serverStatus().connections + currentOp with $all: true"], "s": ["ps", "status"]}}, "oplog": {"mysql": "SHOW BINARY LOGS", "zh": {"t": "oplog 窗口", "u": [["mt.oplog()", "oplog 能覆盖多长时间"]], "o": [], "c": [["maxLogical / usedLogical", "上限、已用（逻辑大小，即 --oplogSize）"], ["disk", "磁盘上占的空间"], ["firstEvent / lastEvent", "最早、最晚一条的时间"], ["window", "两者之差"], ["now", "当前时间"]], "n": ["从节点停机或延迟超过 window，就要全量重新同步", "只能在副本集成员上执行"], "s": ["repl"]}, "en": {"t": "oplog window", "u": [["mt.oplog()", "how much time the oplog covers"]], "o": [], "c": [["maxLogical / usedLogical", "limit, used (logical size, i.e. --oplogSize)"], ["disk", "disk space it takes"], ["firstEvent / lastEvent", "times of the oldest and newest entries"], ["window", "the difference"], ["now", "current time"]], "n": ["A secondary down or behind for longer than the window needs a full resync", "Only works on a replica set member"], "s": ["repl"]}}, "status": {"mysql": "SHOW GLOBAL STATUS", "zh": {"t": "关键指标", "u": [["mt.status()", "间隔 1 秒采样两次，ops/s 是每秒的量"], ["mt.status({interval: 5})", "间隔 5 秒"], ["mt.status({interval: 0})", "只取一次，显示 opcounters 累计值"]], "o": [["interval", "采样间隔秒数，默认 1；0 = 只取一次"]], "c": [["host / version / role / uptime", "主机、版本、角色、运行时长"], ["ops/s.*", "每秒 insert / query / update / delete / getmore / command"], ["connections.* / activeClients.*", "连接数、正在读写的客户端"], ["queue.*", "排队等锁的读写，持续不为 0 说明有压力"], ["network/s.* / mem.*", "每秒流量、内存"], ["cache.*", "WiredTiger 缓存已用、上限、脏数据"]], "n": ["从 serverStatus 里挑出常看的指标"], "s": ["cache", "top", "conns"]}, "en": {"t": "key metrics", "u": [["mt.status()", "two samples 1 second apart; ops/s per second"], ["mt.status({interval: 5})", "5 seconds apart"], ["mt.status({interval: 0})", "one sample, opcounters totals"]], "o": [["interval", "seconds between samples, 1 by default; 0 = one sample"]], "c": [["host / version / role / uptime", "host, version, role, uptime"], ["ops/s.*", "insert / query / update / delete / getmore / command per second"], ["connections.* / activeClients.*", "connections, clients reading / writing now"], ["queue.*", "reads / writes waiting for a lock; staying above 0 means pressure"], ["network/s.* / mem.*", "traffic per second, memory"], ["cache.*", "WiredTiger cache used, maximum, dirty"]], "n": ["The serverStatus metrics people look at most"], "s": ["cache", "top", "conns"]}}, "cache": {"mysql": "sys.innodb_buffer_stats_by_table", "zh": {"t": "谁占着 WiredTiger 缓存", "u": [["mt.cache()", "所有库"], ["mt.cache('shop')", "只看一个库"]], "o": [], "c": [["表头", "used 已用、max 上限、dirty 脏数据"], ["ns", "库.集合"], ["cached", "数据加索引在缓存里占了多少"], ["dataCached / indexCached", "其中数据、索引各占多少"], ["share", "占已用缓存的比例"]], "n": ["缓存里是解压后的数据，可能比磁盘文件还大", "每个集合一次 $collStats，集合很多时慢", "只能连 mongod"], "s": ["status", "colls"]}, "en": {"t": "what is in the WiredTiger cache", "u": [["mt.cache()", "every database"], ["mt.cache('shop')", "one database"]], "o": [], "c": [["header", "used, max, dirty"], ["ns", "database.collection"], ["cached", "data plus indexes in the cache"], ["dataCached / indexCached", "of which data / indexes"], ["share", "share of the cache in use"]], "n": ["The cache holds uncompressed data, so it can exceed the file size", "One $collStats per collection; slow with thousands of collections", "Must run on a mongod"], "s": ["status", "colls"]}}, "ttl": {"mysql": "information_schema.EVENTS", "zh": {"t": "TTL 索引", "u": [["mt.ttl()", "所有库"], ["mt.ttl('shop')", "只看一个库"]], "o": [], "c": [["表头", "ttlMonitorEnabled、ttlMonitorSleepSecs、passes、deletedDocuments"], ["ns / index / field", "库.集合、TTL 索引名（或 (timeseries) / (clustered)）、日期字段"], ["expireAfterSeconds / expire", "过期时间"], ["oldest / overdueSecs", "最早一条的时间、超期了多少秒"], ["options", "partial、hidden"]], "n": ["overdueSecs 正常是 0 或 60 秒左右；明显更大说明删不过来或 TTL 线程没在跑", "从节点不自己删，跟着主节点复制"], "s": ["idx"]}, "en": {"t": "TTL indexes", "u": [["mt.ttl()", "every database"], ["mt.ttl('shop')", "one database"]], "o": [], "c": [["header", "ttlMonitorEnabled, ttlMonitorSleepSecs, passes, deletedDocuments"], ["ns / index / field", "database.collection, TTL index (or (timeseries) / (clustered)), date field"], ["expireAfterSeconds / expire", "expiry"], ["oldest / overdueSecs", "oldest document, seconds past expiry"], ["options", "partial, hidden"]], "n": ["overdueSecs is normally 0 or about 60; much more means deletes cannot keep up or the TTL thread is off", "Secondaries do not delete on their own; deletes replicate"], "s": ["idx"]}}, "log": {"mysql": "performance_schema.error_log", "zh": {"t": "最近的日志", "u": [["mt.log()", "最近 20 行"], ["mt.log(100)", "最近 100 行"], ["mt.log('Slow query')", "包含这段文字的（不分大小写）"], ["mt.log(/COLLSCAN|IXSCAN/)", "正则"], ["mt.log({sev: 'W'})", "只看警告、错误、致命"], ["mt.log({startup: true})", "启动警告"]], "o": [["n", "显示最后几行，默认 20"], ["grep", "文字或正则；第一个参数是字符串或正则时就是 grep"], ["sev", "'F' / 'E' / 'W' / 'I' / 'D'：这个级别及更严重的"], ["startup", "true：看启动警告"]], "c": [["#", "行号，mt.explainLog(n) / mt.logQuery(n) 用它"], ["time / sev / comp / ctx", "时间、级别、组件、线程"], ["id / attr", "4.4 起才有：消息编号、详细内容"], ["msg", "消息"]], "n": ["执行的是 getLog，只保留内存里最近 1024 行", "4.2 及之前每行最多 512 个字符", "attr 在表格里会截断，用 {vertical: true} 看全"], "s": ["slow", "explainLog"]}, "en": {"t": "recent log lines", "u": [["mt.log()", "last 20 lines"], ["mt.log(100)", "last 100 lines"], ["mt.log('Slow query')", "lines containing this text (case-insensitive)"], ["mt.log(/COLLSCAN|IXSCAN/)", "a regex"], ["mt.log({sev: 'W'})", "warnings, errors and fatal only"], ["mt.log({startup: true})", "startup warnings"]], "o": [["n", "how many of the last lines, 20 by default"], ["grep", "text or regex; a string or regex first argument is grep"], ["sev", "'F' / 'E' / 'W' / 'I' / 'D': this level and more severe"], ["startup", "true: startup warnings"]], "c": [["#", "row number, used by mt.explainLog(n) / mt.logQuery(n)"], ["time / sev / comp / ctx", "time, severity, component, thread"], ["id / attr", "4.4+ only: message ID, details"], ["msg", "message"]], "n": ["Runs getLog, which keeps only the last 1024 lines in memory", "On 4.2 and earlier each line holds at most 512 characters", "attr is cut in tables; use {vertical: true} to see it all"], "s": ["slow", "explainLog"]}}};

  var CMDS = [
    ['mt.ps({secs, ns, all, sort})', 'SHOW PROCESSLIST', 'ps'],
    ['mt.slow({ms, ns, sort})', 'mysql.slow_log', 'slow'],
    ['mt.top({interval, ns})', 'sys.schema_table_statistics', 'top'],
    ['mt.locks({all})', 'sys.innodb_lock_waits', 'locks'],
    ['mt.txns({secs, sort})', 'INFORMATION_SCHEMA.INNODB_TRX', 'txns'],
    ['mt.repl()', 'SHOW SLAVE STATUS', 'repl'],
    ['mt.dbs()', 'SHOW DATABASES', 'dbs'],
    ["mt.colls('db')", 'SHOW TABLE STATUS', 'colls'],
    ["mt.frag('db')", 'TABLES.DATA_FREE', 'frag'],
    ["mt.idx('coll')", 'SHOW INDEX FROM t', 'idx'],
    ['mt.explain(cursor)', 'EXPLAIN [ANALYZE]', 'explain'],
    ['mt.explainLog(n | line)', 'EXPLAIN on a slow log query', 'explainLog'],
    ['mt.logQuery(n | line)', 'slow log → SQL', 'logQuery'],
    ['mt.builds()', 'ALTER TABLE progress', 'builds'],
    ["mt.unusedIdx('db')", 'sys.schema_unused_indexes', 'unusedIdx'],
    ["mt.dupIdx('db')", 'sys.schema_redundant_indexes', 'dupIdx'],
    ['mt.conns()', 'PROCESSLIST GROUP BY host', 'conns'],
    ['mt.oplog()', 'SHOW BINARY LOGS', 'oplog'],
    ['mt.status({interval})', 'SHOW GLOBAL STATUS', 'status'],
    ["mt.cache('db')", 'sys.innodb_buffer_stats_by_table', 'cache'],
    ["mt.ttl('db')", 'information_schema.EVENTS', 'ttl'],
    ['mt.log({n, grep, sev})', 'performance_schema.error_log', 'log']
  ];
  // mt.cmds()：按类别分组；mt.cmds('ps') 和 mt.help('ps') 一样，看一个命令的详细帮助
  var CMD_GROUPS = [
    ['run', ['status', 'ps', 'conns', 'locks', 'txns', 'top', 'builds']],
    ['query', ['slow', 'log', 'explain', 'explainLog', 'logQuery']],
    ['store', ['dbs', 'colls', 'frag', 'cache', 'idx', 'unusedIdx', 'dupIdx', 'ttl']],
    ['repl', ['repl', 'oplog']]
  ];
  function cmds(name) {
    if (name != null && name !== '') return cmdHelp(name);
    var m = M(), out = [], o = makeOpts({ table: true, maxCol: 0 });
    var sig = {};
    CMDS.forEach(function (c) { sig[c[2]] = c; });
    CMD_GROUPS.forEach(function (g, gi) {
      if (gi) out.push('');
      out.push(paint(o, CYAN, '── ' + m.groups[g[0]] + ' ──'));
      var rows = g[1].map(function (k) { return { command: sig[k][0], mysql: sig[k][1], description: m.cmdDesc[k] }; });
      renderRows(rows, o, out, false, rows.length);
      out.pop();   // 去掉 "N rows in set"
    });
    out.push('', m.cmdsNote, m.cmdsMore);
    emit(out);
  }
  function cmdHelp(name) {
    var m = M(), lang = normLang(cfg.lang), o = makeOpts({});
    var key = String(name).replace(/^\s*(mongotab|mt)\./, '').replace(/\(.*$/, '').trim();
    var names = Object.keys(HELP_DOC);
    var hit = names.filter(function (k) { return k.toLowerCase() === key.toLowerCase(); })[0];
    if (!hit) { emit([m.noHelp(String(name), names.map(function (k) { return "'" + k + "'"; }))]); return; }
    var d = HELP_DOC[hit], h = d[lang], out = [];
    var pad = function (rows, sep) {
      var w = 0;
      rows.forEach(function (r) { if (dw(r[0]) <= 46) w = Math.max(w, dw(r[0])); });
      rows.forEach(function (r) {
        if (dw(r[0]) > 46) { out.push('  ' + r[0]); out.push('  ' + ' '.repeat(w) + '  ' + sep + r[1]); }
        else out.push('  ' + padR(r[0], w) + '  ' + sep + r[1]);
      });
    };
    out.push(paint(o, BOLD, 'mt.' + hit + '() — ' + h.t) + '    MySQL: ' + d.mysql, '');
    out.push(paint(o, CYAN, m.hd.usage));
    pad(h.u, '// ');
    if (h.o.length) { out.push('', paint(o, CYAN, m.hd.opts)); pad(h.o, ''); }
    if (h.c.length) { out.push('', paint(o, CYAN, m.hd.out)); pad(h.c, ''); }
    if (h.n.length) { out.push('', paint(o, CYAN, m.hd.notes)); h.n.forEach(function (x) { out.push('  - ' + x); }); }
    out.push('', m.hd.common);
    if (h.s.length) out.push(m.hd.see + (lang === 'zh' ? '' : ' ') + h.s.map(function (k) { return 'mt.' + k + '()'; }).join(lang === 'zh' ? '、' : ', '));
    emit(out);
  }

  var api = {
    table: t, vertical: g, csv: csv, config: config, help: help, version: VERSION,
    cmds: cmds, ps: dba(ps), slow: dba(slow), top: dba(top), locks: dba(locks), txns: dba(txns), repl: dba(repl), dbs: dba(dbs), colls: dba(colls), idx: dba(idx),
    conns: dba(conns), oplog: dba(oplog), status: dba(status), frag: dba(frag), cache: dba(cache), ttl: dba(ttl), log: dba(log),
    unusedIdx: dba(unusedIdx), dupIdx: dba(dupIdx), explain: dba(explain), explainLog: dba(explainLog), logQuery: dba(logQuery), builds: dba(builds)
  };
  t[MARK] = g[MARK] = api[MARK] = true;

  var skipped = [];
  function define(name, val) {
    var cur = safe(function () { return root[name]; });
    if (cur !== undefined && !(cur && cur[MARK])) { skipped.push(name); return; }
    root[name] = val;
  }
  root.mongotab = api;
  define('t', t);
  define('g', g);
  define('mt', api);

  var msg = L(cfg.lang).loaded(VERSION, cfg.tz);
  if (skipped.length) msg += '\n' + L(cfg.lang).skipped(skipped);
  if (envTzError) msg += '\n  MONGOTAB_TZ: ' + envTzError + ' → UTC';
  emit([msg]);
})();
