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
//
// 写法约定：mongosh 加载脚本时要改写其中每个函数（让数据库调用能同步地写），这一步的耗时
// 随文件里函数个数的平方增长（680 个函数约 5 秒，410 个约 2.4 秒；老 mongo shell 不受影响）。
// 所以尽量少写函数：遍历用 for 循环而不是 forEach / map 回调；提示信息写成带 {0} 的字符串；
// 常用操作用 pluck、attempt、matchAny、dropBlank 这些现成的小工具。
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
    checkThresholds: null,   // mt.check() 改过的阈值（只存改过的键），见 CHECK_TH
    lang: detectLang()  // 'zh' | 'en'：MONGOTAB_LANG > LC_ALL / LC_MESSAGES / LANG > 系统区域
  };

  // mongosh 的异步改写下，try 里直接 return 一个调用的结果，失败时 catch 接不住（返回的是还没完成的 Promise），
  // 所以先赋值再 return：改写后赋值处会 await，错误在 try 里抛出
  function safe(fn, dflt) { try { var r = fn(); return r; } catch (e) { return dflt; } }
  // safe 的不用写回调的版本：attempt(runCmd, a, cmd)、attempt(JSON.parse, s)、attempt(getProp, v, '_bsontype')
  function attempt(fn, a, b) { try { var r = fn(a, b); return r; } catch (e) { return undefined; } }
  function getProp(o, k) { return o[k]; }
  // 常用的几个数组操作写成循环，省掉回调（mongosh 加载时每个函数都要改写，函数越少越快）
  function pluck(arr, k) { var out = []; for (var i = 0; i < arr.length; i++) out.push(arr[i][k]); return out; }
  function fill(n, v) { var out = []; for (var i = 0; i < n; i++) out.push(v); return out; }
  function matchAny(key, pats) { for (var i = 0; pats && i < pats.length; i++) if (matchCol(key, pats[i])) return true; return false; }
  // 子表 key 下的列：['members.name', 'x'] → ['name']
  function childPats(key, pats) {
    var out = [];
    for (var i = 0; pats && i < pats.length; i++) if (pats[i].indexOf(key + '.') === 0) out.push(pats[i].slice(key.length + 1));
    return out;
  }
  // 某一列在所有行里都是 ''（这个版本没有这项）就去掉
  function dropBlank(rows, keys) {
    for (var i = 0; i < keys.length; i++) {
      var blank = true;
      for (var j = 0; j < rows.length && blank; j++) if (rows[j][keys[i]] !== '') blank = false;
      if (blank) for (j = 0; j < rows.length; j++) delete rows[j][keys[i]];
    }
  }

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
      badTz: "mongotab: 无法识别的时区 '{0}'，可用 'UTC'、'local'、'+08:00'、'Asia/Shanghai'",
      noIntl: "mongotab: 老的 mongo shell 不支持时区名 '{0}'，请用 'UTC'、'local' 或 '+08:00' 这样的偏移",
      more: '(只显示前 {0} 行，还有更多；用 {2}(x, {limit: {1}}) 看更多)',
      partial: '(共 {1} 行，只显示前 {0} 行)',
      missing: '(无字段)',
      noDb: '没有连接数据库',
      unauthorized: '没有执行 {0} 的权限，需要 clusterMonitor 角色（或 root）',
      cmdFailed: '{0} 执行失败：{1}',
      onMongos: '{0} 要连到副本集成员上执行，当前连的是 mongos',
      notRs: '{0} 只适用于副本集，当前是单机（standalone）',
      needColl: "mt.idx() 需要集合名，例如 mt.idx('orders')、mt.idx('shop.orders') 或 mt.idx(db.orders)",
      noColl: '集合 {0} 不存在',
      noOplog: 'local.oplog.rs 是空的',
      total: '合计 {0}',
      sampled: '，间隔 {0} 秒采样两次算 ops/s',
      topSampled: '，间隔 {0} 秒采样两次，显示这段时间内的耗时（毫秒）',
      topTotals: '，启动以来累计（毫秒）',
      profOff: '没有开 profiler（level 0），可用 db.setProfilingLevel(1, {slowms: 100}) 打开',
      badSort: '{0} 的 sort 可以是 {1}，或排序文档如 {2}',
      sortChoices: {
        slow: "'desc'（默认，最新的在前）、'asc'（最早的在前）、'ms'（最慢的在前）",
        ps: "'desc'（默认，运行最久的在前）、'asc'（最短的在前）、'opid'",
        txns: "'desc'（默认，开得最久的在前）、'asc'（最短的在前）"
      },
      noLockWait: '没有在等锁的操作',
      noTxn: '没有未提交的事务',
      badSev: "mt.log() 的 sev 可以是 'F'、'E'、'W'、'I'、'D'：只看这个级别及更严重的",
      logTail: '(共 {1} 行，只显示最后 {0} 行)',
      fragTotal: '合计可回收 {0}（数据 {1}，索引 {2}）',
      cacheSum: '以上集合在缓存里合计 {0}，占已用缓存的 {1}',
      noTtl: '没有 TTL 索引',
      noUnused: '没有没被用过的索引',
      unusedYoung: '另有 {0} 个索引计数开始不到 {1} 天（since 太近），没列出；{days: 0} 全部列出',
      unusedNode: '计数只是本节点 {0} 的：只被从节点读用到的索引在这里也是 0 次，副本集每个成员都要各查一次',
      unusedMongos: '经 mongos 时是各分片接到请求的那个节点（通常是主节点）的计数，从节点上的使用看不到',
      unusedHide: function (hide) { return hide ? "确认各成员都没用后，先 db.集合.hideIndex('名字') 观察一段时间，再 dropIndex" : '确认各成员都没用后再 dropIndex（4.4 起可以先 hideIndex 观察）'; },
      noDocs: '集合是空的，没有可以抽样的文档',
      noVar: '没有名字里含 {0} 的参数',
      lowFiles: '{0}（建议至少 64000）',
      plat: { container: '容器', vm: '虚拟机', onVm: '，运行在虚拟机上', physical: '可能是物理机', unknown: '物理机或无法判断',
        memLimit: '内存限制 {0}', cpu: 'CPU 可用 {0} / {1}', pid1: 'mongod 是 1 号进程',
        hyper: 'CPU 标志 hypervisor', kernel: '内核 {0}', sockets: '{0} 路 CPU', numa: '{0} 个 NUMA 节点',
        join: '，', open: '（', close: '）' },
      bigCache: '{0}（超过可用内存的 80%，容易 OOM）',
      oldCache: '{0}（4.4 之前看不到容器的内存限制，缓存按宿主机内存算，请确认没有超过容器内存）',
      latSampled: '，间隔 {0} 秒采样两次，显示这段时间内的平均延迟（毫秒）',
      latTotals: '，启动以来累计（平均延迟，毫秒）',
      noPlanCache: '计划缓存是空的（重启、建删索引后会清空；查询跑过才会缓存）',
      sbePlan: '(SBE 计划)',
      ck: {
        names: { startup: '启动警告', fsync: '写入被锁（fsyncLock）', fcv: 'FCV 版本', members: '副本集成员', lag: '复制延迟', oplog: 'oplog 窗口',
          cacheUsed: '缓存使用率', cacheDirty: '缓存脏数据', tickets: '读写并发票据', queue: '等锁队列', conns: '连接数', longOps: '长时间运行的操作',
          lockWait: '等锁的操作', txns: '长事务', builds: '正在建的索引', ttlMon: 'TTL 线程', profiler: 'profiler', ttlOverdue: 'TTL 超期',
          dupIdx: '冗余索引', unusedIdx: '没被用过的索引', frag: '可回收的磁盘空间' },
        n: '{0} 条',
        count: '{0} 个',
        sizeOf: '{0} 个，共 {1}',
        notRs: '不是副本集', locked: '已锁', unlocked: '未锁', running: '运行中', stopped: '已停止', none: '没有',
        fcv: 'FCV {0}，二进制 {1}',
        members: function (n, bad) { return n + ' 个成员' + (bad.length ? '，异常：' + bad.join('、') : '，都正常'); },
        longOps: function (n, max, lim) { return n ? n + ' 个超过 ' + lim + '，最长 ' + max : '没有超过 ' + lim + '的'; },
        txns: function (n, max, lim) { return n ? n + ' 个开了 ' + lim + '以上，最长 ' + max : '没有开了 ' + lim + '以上的'; },
        ttlOverdue: function (n, max, lim) { return n ? n + ' 个超期 ' + lim + '以上，最多 ' + max : '没有超期 ' + lim + '以上的'; },
        level2: function (dbs) { return dbs.length ? 'level 2：' + dbs.join('、') : '没有库是 level 2'; },
        young: '只运行了 {0}，统计不够，满 7 天再看',
        unusedYoung: '没有；另有 {0} 个计数不满 7 天',
        frag: '{0} / {1}（{2}）',
        adv: { fsync: 'db.fsyncUnlock()', fcv: "升级完成后提升 FCV：db.adminCommand({setFeatureCompatibilityVersion: '版本'})", oplog: '调大 oplog：replSetResizeOplog；mt.oplog()',
          ttlMon: 'db.adminCommand({setParameter: 1, ttlMonitorEnabled: true})', profiler: 'level 2 记录所有操作，影响性能：db.setProfilingLevel(1, {slowms: 100})',
          frag: 'mt.frag()；compact 回收', unused: function (hide) { return 'mt.unusedIdx()；各成员都确认没用后' + (hide ? '先 hideIndex 观察再删' : '再删'); }, limited: "调大 maxColls / budgetMs（0 = 不限），或用 mt.dupIdx('库') 等单独查" },
        partial: function (ok, n, f, dbf, dbUnit) {
          var x = '查了 ' + ok + '/' + n + (dbUnit ? ' 个库' : ' 个集合');
          if (f) x += '，' + f + ' 个失败';
          if (dbf) x += '，' + dbf + ' 个库列不出集合';
          return x;
        },
        noWt: '不是 WiredTiger',
        limited: '只查了前 {0}/{1} 个集合（{2}）',
        scanned: '（逐个集合的检查：{0}/{1} 个集合）',
        summary: '{0|，}',
        noIssue: '没有发现问题',
        quick: '（quick: true，没有检查索引、TTL 和磁盘空间）',
        th: {
          units: { s: '秒', h: '小时', n: '个', '%': '%', GB: 'GB' },
          desc: { oplog: 'oplog 窗口（越低越坏）', longOps: '操作运行了多久', txns: '事务开了多久', ttlOverdue: 'TTL 超期多久',
            frag: '可回收空间占比', fragMinGB: '可回收空间至少这么大才报' },
          head: '阈值（WARN / CRIT；只有一个数的只报 WARN）：',
          was: '（默认 {0}）',
          notObj: '{0} 要写成对象，如 {lag: [30, 300], oplog: [48, 6]}',
          unknown: '没有叫 {0} 的阈值，可以用：{1|、}',
          pair: '{0} 要写成 [WARN, CRIT]，如 [{1|, }]',
          one: '{0} 只有 WARN 一档，写一个数，如 {1|, }',
          num: '{0} 的值要是 ≥ 0 的数字',
          pct: '{0} 是百分比，不能超过 100',
          order: function (k, low) { return k + (low ? ' 越低越坏，WARN 要大于等于 CRIT' : ' 的 WARN 不能大于 CRIT'); },
          custom: '改过的阈值：{0|，}'
        }
      },
      noBuild: '没有正在建的索引',
      buildWaiting: '等待中',
      noDup: '没有冗余索引',
      needExplain: "mt.explain() 需要游标或 explain 的结果，例如 mt.explain(db.orders.find({status: 'PAID'}))；慢日志里的查询用 mt.explainLog(...)",
      useExplainLog: 'mt.explain() 只接受游标或 explain 的结果；慢日志里的行号、日志行、命令请用 mt.explainLog(...)，想转成查询语句用 mt.logQuery(...)',
      needLog: "mt.explainLog() / mt.logQuery() 需要慢日志里的东西：mt.slow() / mt.log() 的行号、日志里的整行、命令（从 { 开始）、profile 文档，或命令对象如 {find: 'orders', filter: {...}}",
      noRow: '没有第 {0} 行：行号用的是上一次 mt.slow() 或 mt.log() 列出的行',
      recLine: '// 慢日志：{0|，}',
      writeWarn: '// 注意：这是写操作，执行会修改数据',
      rowNoCmd: '第 {0} 行没有可以 explain 的命令（或者日志行太长被截断了；可以改用 mt.slow()）',
      notJson: "解析不了这段文字：mt.slow() / mt.log() 表格里显示的命令去掉了引号，不能直接粘贴；请用行号，或者传日志里的整行（4.4 起的 JSON 行、之前的文本行都可以）、命令文档",
      cantExplain: '{0} 命令不能 explain，支持 find、aggregate、count、distinct、update、delete、findAndModify',
      recTitle: '慢日志里记录的执行情况（当时实际跑的）：',
      planChanged: '注意：慢日志里用的是 {0}，现在的计划是 {1}（索引、数据分布或计划缓存可能变了）',
      exNote: { fullScan: '全表扫描', memSort: '内存排序', spilled: '用到了磁盘', postFilter: '取出后再过滤', multikey: '多键索引' },
      exNotes: '注意：{0|；}',
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
        vars: "运行参数（getParameter）：名字、当前值、能不能在运行时改（4.2 起）；可传关键字、通配符或正则过滤，如 mt.vars('ttl')",
        host: '机器和进程：CPU、内存、操作系统、文件句柄数、mongod 版本和编译信息、存储引擎、启动参数；all 列出全部启动参数',
        latency: '读 / 写 / 命令的平均延迟（毫秒），整台和各集合；interval 采样秒数，0 = 启动以来；默认所有用户库',
        desc: '集合的字段结构：抽样文档，列出每个字段的类型、出现比例和示例，加上集合选项、校验规则和索引；sample 抽样条数',
        planCache: '集合的计划缓存：每种查询形状缓存了哪个计划、是否生效、works；hash 按 queryHash / planCacheKey 过滤',
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
        status: '版本、角色、ops/s、连接、缓存等关键指标',
        check: '一键体检：复制、oplog、缓存、连接、长操作、长事务、TTL、冗余 / 没用的索引等，每项给 OK / WARN / CRIT / UNKNOWN 和建议；quick 跳过逐个集合的检查，issues 只看有问题的'
      },
      cmdsNote: '都可以加 t() 的选项，如 {cols: ...}、{vertical: true}；mt.config({showCmd: false}) 不打印原生命令',
      cmdsMore: "mt.help('ps') 看某个命令的详细用法、选项和输出的每一列",
      groups: { run: '运行状态', query: '慢查询和执行计划', store: '存储和索引', repl: '复制' },
      hd: { usage: '用法：', opts: '选项：', out: '输出：', notes: '说明：', see: '另见：', common: '都可以加 t() 的选项（cols、exclude、limit、vertical、table、tz...）；mt.config({showCmd: false}) 不打印原生命令' },
      noHelp: '没有叫 {0} 的命令。可以看：{1|、}',
      loaded: 'MongoTab {0} 已加载：t(x) 表格 / g(x) 竖排 / mt.help()   时区 {1}',
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
      badTz: "mongotab: unknown time zone '{0}'; try 'UTC', 'local', '+08:00' or 'Asia/Shanghai'",
      noIntl: "mongotab: the legacy mongo shell does not support time zone names like '{0}'; use 'UTC', 'local' or an offset such as '+08:00'",
      more: '(showing the first {0} rows, more available; use {2}(x, {limit: {1}}) to see more)',
      partial: '(showing the first {0} of {1} rows)',
      missing: '(missing)',
      noDb: 'not connected to a database',
      unauthorized: 'not authorized to run {0}; this needs the clusterMonitor role (or root)',
      cmdFailed: '{0} failed: {1}',
      onMongos: '{0} must run on a replica set member; this is a mongos',
      notRs: '{0} only works on a replica set; this is a standalone server',
      needColl: "mt.idx() needs a collection, e.g. mt.idx('orders'), mt.idx('shop.orders') or mt.idx(db.orders)",
      noColl: 'collection {0} does not exist',
      noOplog: 'local.oplog.rs is empty',
      total: 'Total {0}',
      sampled: ', sampled twice {0}s apart for ops/s',
      topSampled: ', sampled twice {0}s apart; time spent in between (ms)',
      topTotals: ', totals since startup (ms)',
      profOff: 'the profiler is off (level 0); turn it on with db.setProfilingLevel(1, {slowms: 100})',
      badSort: '{0} sort can be {1} or a sort document such as {2}',
      sortChoices: {
        slow: "'desc' (default, newest first), 'asc' (oldest first), 'ms' (slowest first)",
        ps: "'desc' (default, longest running first), 'asc' (shortest first), 'opid'",
        txns: "'desc' (default, open longest first), 'asc' (shortest first)"
      },
      noLockWait: 'no operation is waiting for a lock',
      noTxn: 'no open transactions',
      badSev: "mt.log() sev can be 'F', 'E', 'W', 'I' or 'D': this level and more severe",
      logTail: '(showing the last {0} of {1} rows)',
      fragTotal: 'Total reusable {0} (data {1}, indexes {2})',
      cacheSum: 'These collections hold {0} in the cache, {1} of the cache in use',
      noTtl: 'no TTL indexes',
      noUnused: 'no unused indexes',
      unusedYoung: function (n, days) { return n + (n === 1 ? ' more index has' : ' more indexes have') + ' been counted for less than ' + days + ' days (recent since) and ' + (n === 1 ? 'is' : 'are') + ' not listed; {days: 0} lists all'; },
      unusedNode: 'counts are from this node {0} only: an index used only by secondary reads shows 0 here too; check every replica set member',
      unusedMongos: 'through mongos the counts come from the node each shard routed to (usually the primary); use on secondaries is not visible',
      unusedHide: function (hide) { return hide ? "once no member uses it, db.coll.hideIndex('name') and watch for a while before dropIndex" : 'once no member uses it, dropIndex (from 4.4 you can hideIndex first and watch)'; },
      noDocs: 'the collection is empty; nothing to sample',
      noVar: 'no parameter matching {0}',
      lowFiles: '{0} (64000 or more recommended)',
      plat: { container: 'container', vm: 'virtual machine', onVm: ', on a virtual machine', physical: 'probably physical', unknown: 'physical or unknown',
        memLimit: 'memory limit {0}', cpu: 'CPUs available {0} / {1}', pid1: 'mongod is pid 1',
        hyper: 'CPU flag hypervisor', kernel: 'kernel {0}', sockets: '{0} CPU sockets', numa: '{0} NUMA nodes',
        join: ', ', open: ' (', close: ')' },
      bigCache: '{0} (over 80% of available memory; OOM risk)',
      oldCache: '{0} (before 4.4 the container memory limit is not visible and the cache is sized from host memory; check it fits the container)',
      latSampled: ', sampled twice {0}s apart; average latency in between (ms)',
      latTotals: ', totals since startup (average latency, ms)',
      noPlanCache: 'the plan cache is empty (cleared on restart and index changes; filled as queries run)',
      sbePlan: '(SBE plan)',
      ck: {
        names: { startup: 'Startup warnings', fsync: 'Writes locked (fsyncLock)', fcv: 'FCV', members: 'Replica set members', lag: 'Replication lag', oplog: 'Oplog window',
          cacheUsed: 'Cache used', cacheDirty: 'Cache dirty', tickets: 'Read/write tickets', queue: 'Lock queue', conns: 'Connections', longOps: 'Long-running operations',
          lockWait: 'Lock waits', txns: 'Long transactions', builds: 'Index builds', ttlMon: 'TTL thread', profiler: 'Profiler', ttlOverdue: 'TTL overdue',
          dupIdx: 'Redundant indexes', unusedIdx: 'Unused indexes', frag: 'Reusable disk space' },
        n: function (k) { return k + (k === 1 ? ' line' : ' lines'); },
        count: '{0}',
        sizeOf: '{0}, {1} in total',
        notRs: 'not a replica set', locked: 'locked', unlocked: 'not locked', running: 'running', stopped: 'stopped', none: 'none',
        fcv: 'FCV {0}, binary {1}',
        members: function (n, bad) { return n + (n === 1 ? ' member' : ' members') + (bad.length ? ', unhealthy: ' + bad.join(', ') : ', all healthy'); },
        longOps: function (n, max, lim) { return n ? n + ' over ' + lim + ', longest ' + max : 'none over ' + lim; },
        txns: function (n, max, lim) { return n ? n + ' open ' + lim + ' or more, longest ' + max : 'none open ' + lim + ' or more'; },
        ttlOverdue: function (n, max, lim) { return n ? n + ' overdue by over ' + lim + ', worst ' + max : 'none overdue by over ' + lim; },
        level2: function (dbs) { return dbs.length ? 'level 2: ' + dbs.join(', ') : 'no database at level 2'; },
        young: 'up only {0}; check again after 7 days',
        unusedYoung: 'none; {0} more counted for under 7 days',
        frag: '{0} / {1} ({2})',
        adv: { fsync: 'db.fsyncUnlock()', fcv: "after upgrading, raise FCV: db.adminCommand({setFeatureCompatibilityVersion: 'version'})", oplog: 'grow the oplog: replSetResizeOplog; mt.oplog()',
          ttlMon: 'db.adminCommand({setParameter: 1, ttlMonitorEnabled: true})', profiler: 'level 2 records every operation and costs performance: db.setProfilingLevel(1, {slowms: 100})',
          frag: 'mt.frag(); compact reclaims it', unused: function (hide) { return 'mt.unusedIdx(); once no member uses it, ' + (hide ? 'hideIndex and watch before dropping' : 'drop it'); }, limited: "raise maxColls / budgetMs (0 = no limit), or run mt.dupIdx('db') etc. per database" },
        partial: function (ok, n, f, dbf, dbUnit) {
          var x = ok + '/' + n + (dbUnit ? ' databases' : ' collections') + ' checked';
          if (f) x += ', ' + f + ' failed';
          if (dbf) x += ', ' + dbf + (dbf === 1 ? ' database' : ' databases') + ' could not be listed';
          return x;
        },
        noWt: 'not WiredTiger',
        limited: 'only the first {0}/{1} collections checked ({2})',
        scanned: '(per-collection checks: {0}/{1} collections)',
        summary: '{0|, }',
        noIssue: 'no issues found',
        quick: '(quick: true, indexes, TTL and disk space not checked)',
        th: {
          units: { s: 's', h: 'h', n: '', '%': '%', GB: 'GB' },
          desc: { oplog: 'Oplog window (lower is worse)', longOps: 'how long an operation has run', txns: 'how long a transaction has been open',
            ttlOverdue: 'how long TTL deletes are overdue', frag: 'share of reusable space', fragMinGB: 'reusable space must be at least this big' },
          head: 'Thresholds (WARN / CRIT; keys with one number only WARN):',
          was: ' (default {0})',
          notObj: '{0} must be an object, e.g. {lag: [30, 300], oplog: [48, 6]}',
          unknown: 'no threshold named {0}; valid keys: {1|, }',
          pair: '{0} takes [WARN, CRIT], e.g. [{1|, }]',
          one: '{0} has only a WARN level; give one number, e.g. {1|, }',
          num: '{0} takes numbers >= 0',
          pct: '{0} is a percentage and cannot exceed 100',
          order: function (k, low) { return k + (low ? ': lower is worse, so WARN must be >= CRIT' : ': WARN cannot exceed CRIT'); },
          custom: 'Changed thresholds: {0|, }'
        }
      },
      noBuild: 'no index builds in progress',
      buildWaiting: 'waiting',
      noDup: 'no redundant indexes',
      needExplain: "mt.explain() needs a cursor or an explain result, e.g. mt.explain(db.orders.find({status: 'PAID'})); for queries from a slow log use mt.explainLog(...)",
      useExplainLog: 'mt.explain() takes only a cursor or an explain result; for row numbers, log lines and commands from a slow log use mt.explainLog(...), or mt.logQuery(...) to turn them into a query',
      needLog: "mt.explainLog() / mt.logQuery() need something from a slow log: a row number from mt.slow() / mt.log(), a whole log line, a command (from its {), a profile document, or a command object such as {find: 'orders', filter: {...}}",
      noRow: 'there is no row {0}: row numbers refer to the last mt.slow() or mt.log()',
      recLine: '// slow log: {0|, }',
      writeWarn: '// Note: this is a write; running it changes data',
      rowNoCmd: 'row {0} has no command that can be explained (or the log line was truncated for being too long; try mt.slow())',
      notJson: "cannot parse this text: the commands shown in mt.slow() / mt.log() tables drop the quotes and cannot be pasted back; use the row number, or pass a whole log line (a 4.4+ JSON line or an older text line) or a command document",
      cantExplain: 'a {0} command cannot be explained; find, aggregate, count, distinct, update, delete and findAndModify can',
      recTitle: 'Recorded in the slow log (what actually ran):',
      planChanged: 'Note: the slow log used {0}, the current plan is {1} (indexes, data distribution or the plan cache may have changed)',
      exNote: { fullScan: 'full scan', memSort: 'in-memory sort', spilled: 'spilled to disk', postFilter: 'filtered after fetch', multikey: 'multikey' },
      exNotes: 'Note: {0|; }',
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
        vars: "Runtime parameters (getParameter): name, current value, whether it can be changed at runtime (4.2+); filter with text, a wildcard or a regex, e.g. mt.vars('ttl')",
        host: 'Machine and process: CPU, memory, OS, open files limit, mongod version and build, storage engine, startup options; all lists every startup option',
        latency: 'Average latency (ms) of reads / writes / commands, server-wide and per collection; interval = seconds to sample, 0 = since startup; all user databases by default',
        desc: 'Field structure of a collection: samples documents and lists each field with its types, presence and an example, plus options, validator and indexes; sample = documents to sample',
        planCache: 'Plan cache of a collection: the cached plan per query shape, whether it is active, works; hash filters by queryHash / planCacheKey',
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
        status: 'Version, role, ops/s, connections, cache and other key metrics',
        check: 'Health check: replication, oplog, cache, connections, long operations and transactions, TTL, redundant / unused indexes and more, each with OK / WARN / CRIT / UNKNOWN and advice; quick skips per-collection checks, issues shows only problems'
      },
      cmdsNote: 'All accept t() options such as {cols: ...} or {vertical: true}; mt.config({showCmd: false}) hides the native command',
      cmdsMore: "mt.help('ps') shows the detailed usage, options and output columns of one command",
      groups: { run: 'Server activity', query: 'Slow queries and plans', store: 'Storage and indexes', repl: 'Replication' },
      hd: { usage: 'Usage:', opts: 'Options:', out: 'Output:', notes: 'Notes:', see: 'See also:', common: 'All take t() options (cols, exclude, limit, vertical, table, tz...); mt.config({showCmd: false}) hides the native command' },
      noHelp: 'No command named {0}. Available: {1|, }',
      loaded: 'MongoTab {0} loaded: t(x) table / g(x) vertical / mt.help()   time zone {1}',
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
  // 提示信息里带 {0}、{1} 的字符串，加载时变成函数，用法不变：m.noColl(ns)。{1|、} 表示数组用“、”连起来。
  // 少写函数是为了 mongosh 加载快：它要改写每个函数，开销随函数个数的平方增长（680 个函数要 5 秒左右）
  function tplFn(s) {
    return function () {
      var a = arguments;
      return s.replace(/\{(\d)(?:\|([^}]*))?\}/g, function (_, i, sep) { var v = a[i]; return sep != null && Array.isArray(v) ? v.join(sep) : v; });
    };
  }
  function compileMsg(o) {
    for (var ks = Object.keys(o), i = 0; i < ks.length; i++) {
      var k = ks[i];
      var v = o[k];
      if (typeof v === 'string' && /\{\d[}|]/.test(v)) o[k] = tplFn(v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) compileMsg(v);
    }
  }
  compileMsg(MSG);
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
    var bt = attempt(getProp, v, '_bsontype');
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
    var t = attempt(getProp, v, 't');
    var i = attempt(getProp, v, 'i');
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
  StrMap.prototype.keys = function () { return this._keys.slice(); };

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
      for (var n = 0, keep = []; n < cols.length; n++) if (!matchAny(cols[n], exc)) keep.push(cols[n]);
      cols = keep;
    }
    return cols;
  }
  // 子表 key 的选列：-c members.name → 子表里的 name
  function subPatterns(key, pats) {
    if (!pats || !pats.length) return { all: true, pats: null };
    if (matchAny(key, pats)) return { all: true, pats: null };
    return { all: false, pats: childPats(key, pats) };
  }

  // ───────────────────────── 渲染 ─────────────────────────
  function tableLines(flats, cols, o) {
    var head = cols.map(function (c) { return clip(c, o.maxCol); });
    var widths = head.map(dw);
    var numeric = fill(cols.length, true);
    var hasNum = fill(cols.length, false);
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
    for (var i = 0; i < body.length; i++) {
      var row = body[i];
      lines.push('| ' + row.map(function (cell, j) {
        var p = numeric[j] ? padL(cell.s, widths[j]) : padR(cell.s, widths[j]);
        return cell.dim ? paint(o, DIM, p) : p;
      }).join(' | ') + ' |');
    }
    lines.push(sep);
    return { lines: lines, width: sep.length };
  }
  function kvLines(map, keys, o, out) {
    var kw = 0;
    for (var i = 0; i < keys.length; i++) { var k = keys[i]; kw = Math.max(kw, dw(k)); }
    kw = Math.min(kw, 32);   // 个别超长 key 不拖累整列对齐
    for (var j = 0; j < keys.length; j++) {
      var k2 = keys[j];
      var v = map.get(k2), s = cellText(v, o);
      if (v === null || v === undefined) s = paint(o, DIM, s);
      out.push(paint(o, BOLD, padL(k2, kw)) + ': ' + s);
    }
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
    for (var k2 = 0; k2 < rows.length; k2++) {
      var r = rows[k2];
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      for (var fk = f.keys(), j = 0; j < fk.length; j++) if (!seen.has(fk[j])) { seen.set(fk[j], true); cols.push(fk[j]); }
    }
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
    for (var n2 = 0; n2 < flats.length; n2++) {
      var f2 = flats[n2], i = n2;
      var stars = '***************************';
      out.push(paint(o, YELLOW, stars + ' ' + (i + 1) + '. row ' + stars));
      kvLines(f2, cols.filter(function (c) { return f2.has(c); }), o, out);
    }
    footer(rows.length, total, more, o, out);
  }
  function renderDoc(doc, o, out) {
    var subs = [];
    var f = flatten(doc, o, subs);
    var keys = f.keys();
    keys = selectCols(keys, o.cols, o.exclude);
    kvLines(f, keys, o, out);
    for (var i = 0; i < subs.length; i++) {
      var sub = subs[i];
      var key = sub[0], list = sub[1];
      var inc = subPatterns(key, o.cols);
      if (!inc.all && !inc.pats.length) continue;
      if (matchAny(key, o.exclude)) continue;
      var exc = childPats(key, o.exclude);
      var so = Object.assign({}, o, { cols: inc.pats, exclude: exc });
      if (out.length) out.push('');
      out.push(paint(o, CYAN, '── ' + key + ' (' + list.length + ') ──'));
      var shown = limitOf(o) < list.length ? list.slice(0, limitOf(o)) : list;
      renderRows(shown, so, out, false, list.length);
    }
  }
  function limitOf(o) { return o.limit > 0 ? o.limit : Infinity; }

  function csvLines(x, o, out) {
    var rows = Array.isArray(x) ? x : [x];
    var flats = [], cols = [], seen = new StrMap();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      for (var fk = f.keys(), j = 0; j < fk.length; j++) if (!seen.has(fk[j])) { seen.set(fk[j], true); cols.push(fk[j]); }
    }
    cols = selectCols(cols, o.cols, o.exclude);
    var q = function (s) { return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    out.push(cols.map(q).join(','));
    for (var k2 = 0; k2 < flats.length; k2++) {
      var f2 = flats[k2];
      out.push(cols.map(function (c) {
        if (!f2.has(c)) return q(missingText(o));
        var v = f2.get(c);
        return q(v === null || v === undefined ? String(o.nullText) : valText(v, false, o));
      }).join(','));
    }
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
      // 阈值按键合并：mt.config({checkThresholds: {lag: [30, 300]}}) 只改 lag；某个键给 null 恢复默认，整个给 null 全部恢复
      if ('checkThresholds' in c) {
        var ct = c.checkThresholds === null ? {} : Object.assign({}, cfg.checkThresholds || {}, thParse(c.checkThresholds, 'checkThresholds', next.lang, true));
        for (var ks = Object.keys(ct), i = 0; i < ks.length; i++) { var k = ks[i]; if (ct[k] === null) delete ct[k]; }
        next.checkThresholds = Object.keys(ct).length ? ct : null;
      }
      cfg = next;
      return;
    }
    var shown = {};
    for (var list = Object.keys(cfg), j = 0; j < list.length; j++) { var k2 = list[j]; if (k2[0] !== '_') shown[k2] = cfg[k2]; }
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
  function rawCmd(d, cmd) { var r = unwrap(d.runCommand(cmd)); return r; }   // 不检查 ok，失败由调用方看
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
  function aggArr(coll, pipeline, o, kind) {
    try { var r = coll.aggregate(pipeline).toArray(); return r; } catch (e) {
      if (isAuthErr(e)) fail(M().unauthorized(Object.keys(pipeline[0])[0]));
      missed(o, kind, coll.getFullName(), e);
      return null;
    }
  }
  // mt.check() 要知道逐库 / 逐集合的检查有没有查全：o.track.bad[种类][ns] = 错误。
  // 种类：list（库列不出集合）、ix（getIndexes）、use（$indexStats）、cs（$collStats）、ttl（TTL 最老文档）、prof（profile）。
  // 几项检查共用一次遍历，各自看自己依赖的种类。没有 o.track 时（单独运行 mt.unusedIdx() 等）出错的跳过
  function errText(e) { return String(e && e.message ? e.message : e).replace(/^mongotab: /, ''); }
  function missed(o, kind, ns, e) {
    if (!o || !o.track) return;
    var b = o.track.bad[kind || 'x'] || (o.track.bad[kind || 'x'] = {});
    b[ns] = errText(e);
  }
  function tracked(o, kind, ns, fn) {   // 出错时记下来并返回 null；mongotab 自己报的错（没权限等）照常抛出
    try { var r = fn(); return r; } catch (e) { if (e && e.mtFriendly) throw e; missed(o, kind, ns, e); return null; }
  }
  function helloDoc(a) {
    var r = attempt(rawCmd, a, { hello: 1 });
    if (!r || !r.ok) r = attempt(rawCmd, a, { isMaster: 1 });
    return r || {};
  }
  function ensureRs(a, name) {
    var h = helloDoc(a);
    if (h.msg === 'isdbgrid') fail(M().onMongos(name));
    if (!h.setName) fail(M().notRs(name));
  }
  // $collStats.storageStats；经 mongos 时每个分片一条，加起来
  function collStats(d, name) { return collStatsOf(aggArr(d.getCollection(name), [{ $collStats: { storageStats: {} } }])); }
  function collStatsOf(docs) {   // $collStats 的结果（经 mongos 时每个分片一条）加起来
    if (!docs || !docs.length) return null;
    var s = { count: 0, size: 0, storageSize: 0, totalIndexSize: 0, nindexes: 0, maxSize: null, indexSizes: {} };
    for (var i = 0; i < docs.length; i++) {
      var x = docs[i];
      var st = x.storageStats || {};
      s.count += toNum(st.count) || 0;
      s.size += toNum(st.size) || 0;
      s.storageSize += toNum(st.storageSize) || 0;
      s.totalIndexSize += toNum(st.totalIndexSize) || 0;
      s.nindexes = Math.max(s.nindexes, toNum(st.nindexes) || 0);
      if (st.maxSize != null) s.maxSize = (s.maxSize || 0) + toNum(st.maxSize);
      for (var ks = Object.keys(st.indexSizes || {}), j = 0; j < ks.length; j++) { var k = ks[j]; s.indexSizes[k] = (s.indexSizes[k] || 0) + toNum(st.indexSizes[k]); }
    }
    return s;
  }
  function hostOf(client) {
    var m = /^\[?(.*?)\]?:(\d+)$/.exec(String(client || ''));
    return m ? m[1] : String(client || '');
  }
  // 去掉空值，免得竖排里出现一堆 NULL
  function prune(doc) {
    var out = {};
    for (var ks = Object.keys(doc), i = 0; i < ks.length; i++) {
      var k = ks[i];
      var v = doc[k];
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) continue;
      if (isDoc(v)) { v = prune(v); if (!Object.keys(v).length) continue; }
      out[k] = v;
    }
    return out;
  }
  function dbaOpts(opts, right) { return makeOpts(opts, { _fn: 'table', _right: right || [] }); }
  function cmdLine(o, text, out) { if (o.showCmd !== false) out.push(paint(o, DIM, '-- ' + text)); }
  function rowsOut(rows, o, out) {
    var lim = limitOf(o);
    renderRows(rows.length > lim ? rows.slice(0, lim) : rows, o, out, false, rows.length);
  }
  function headOut(doc, o, out) {
    var f = flatten(prune(doc), o, null), keys = f.keys();
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
    for (var ks = Object.keys(c), i = 0; i < ks.length; i++) { var k = ks[i]; if (k[0] !== '$' && k !== 'lsid' && k !== 'txnNumber') out[k] = c[k]; }
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
    for (var j = 0; j < ops.length; j++) {
      var op = ops[j], i = j;
      var c = op.command || {};
      if (isSelfOp(c)) continue;
      if (!all) {
        if (!(op.client || op.client_s)) continue;                                         // 内部线程
        if ((c.hello || c.isMaster || c.ismaster) && c.maxAwaitTimeMS != null) continue;  // 驱动的心跳长轮询
      }
      var secs = toNum(op.secs_running) || 0;
      if (secs < minSecs) continue;
      if (ns && !(op.ns === ns || String(op.ns || '').indexOf(ns + '.') === 0)) continue;
      var cc = cleanCmd(c);
      rows.push({ i: i, row: {
        opid: op.opid != null ? op.opid : '', secs: secs, op: op.active === false ? 'idle' : (op.op || ''),
        ns: op.ns || '', client: op.client || op.client_s || '',
        app: op.appName || '', lock: op.waitingForLock ? 'WAIT' : '', plan: op.planSummary || '',
        command: Object.keys(cc).length ? valText(cc, true, o) : (op.desc || '')
      } });
    }
    // 默认耗时长的在前；同耗时时有客户端的连接排在内部线程前面
    var byDefault = function (a, b) {
      return b.row.secs - a.row.secs || (a.row.client ? 0 : 1) - (b.row.client ? 0 : 1) || a.i - b.i;
    };
    var cmp = spec ? rowCmp(spec) : null;
    rows.sort(function (a, b) { return (cmp ? cmp(a.row, b.row) : 0) || byDefault(a, b); });
    rowsOut(pluck(rows, 'row'), o, out);
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
    for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.state === 1 && opt(m)) ref = opt(m).getTime(); }
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
    return pluck(infos.filter(function (i) { return i.type !== 'view'; }), 'name');
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
    for (var ks = collNames(d), i = 0; i < ks.length; i++) {
      var name = ks[i];
      var info = { name: name };
      var s = collStats(d, info.name);
      rows.push({
        row: {
          name: info.name, count: s ? s.count : '', logical: s ? sizeText(s.size) : '', disk: s ? sizeText(s.storageSize) : '',
          indexes: s ? s.nindexes : '', indexDisk: s ? sizeText(s.totalIndexSize) : ''
        },
        w: s ? s.storageSize + s.totalIndexSize : -1
      });
    }
    rows.sort(function (x, y) { return y.w - x.w || (x.row.name < y.row.name ? -1 : 1); });
    rowsOut(pluck(rows, 'row'), o, out);
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
  function indexUsage(c, o) {
    var usage = {};
    for (var ks = (aggArr(c, [{ $indexStats: {} }], o, 'use') || []), i = 0; i < ks.length; i++) {
      var x = ks[i];
      var u = usage[x.name] || (usage[x.name] = { ops: 0, since: null });
      u.ops += toNum(x.accesses && x.accesses.ops) || 0;
      var since = x.accesses && x.accesses.since;
      if (isDate(since) && (!u.since || since < u.since)) u.since = since;
    }
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
    for (var bk = by.keys(), i = 0; i < bk.length; i++) {
      var r = by.get(bk[i]);
      rows.push({ client: r.client, conns: r.conns, active: r.active, apps: r.apps.keys().join(', ') });
    }
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
      try { var r = oc.find({}, { ts: 1 }).sort({ $natural: dir }).limit(1).toArray(); return r[0]; } catch (e) {
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
    var f = flatten(doc, o, null), keys = f.keys();
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
      for (var i = 0; i < names.length; i++) { var k = names[i]; doc['ops/s'][k] = rate((s1.opcounters || {})[k], oc[k]); }
    } else {
      doc.opcounters = {};
      for (var j = 0; j < names.length; j++) { var k2 = names[j]; doc.opcounters[k2] = toNum(oc[k2]); }
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
    var f = flatten(prune(doc), o, null), keys = f.keys();
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
    dropBlank(rows, ['user']);   // 没开认证
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
    for (var ks = Object.keys(cur), i = 0; i < ks.length; i++) {
      var k = ks[i];
      var c = cur[k], b = base[k];
      if (!k || !isDoc(c) || !c.total || !nsMatch(k, ns)) continue;
      var tot = f(c, 'total', 'time') - f(b, 'total', 'time');
      var n = f(c, 'total', 'count') - f(b, 'total', 'count');
      if (tot <= 0 && n <= 0) continue;
      rows.push({
        ns: k, totalMs: ms(tot),
        readMs: ms(f(c, 'readLock', 'time') - f(b, 'readLock', 'time')),
        writeMs: ms(f(c, 'writeLock', 'time') - f(b, 'writeLock', 'time')),
        ops: n, us: tot
      });
    }
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
    for (var ks = (runCmd(a, { currentOp: 1, $all: true }).inprog || []), i = 0; i < ks.length; i++) { var op = ks[i]; if (op.opid != null) byOp[String(op.opid)] = op; }
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
    for (var j = 0; j < info.length; j++) {
      var r = info[j];
      var pending = r.pending || [], granted = r.granted || [];
      if (!pending.length && !(all && granted.length)) continue;
      for (var n2 = 0; n2 < granted.length; n2++) {
        var x = granted[n2];
        if (!all && !pending.some(function (p) { return lockConflicts(x.mode, p.mode); })) continue;
        add(resName(r.resourceId), x.mode, x.clientInfo || x, 'HOLD');
      }
      for (var i2 = 0; i2 < pending.length; i2++) { var x2 = pending[i2]; add(resName(r.resourceId), x2.mode, x2.clientInfo || x2, 'WAIT'); }
    }
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
        for (var ks = Object.keys(byOp), i = 0; i < ks.length; i++) {
          var k2 = ks[i];
          var h = byOp[k2];
          if (!h.waitingForLock && isDoc(h.locks) && h.locks[n] && lockConflicts(h.locks[n], op.locks[n])) add(n, h.locks[n], h, 'HOLD');
        }
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
    for (var j = 0; j < ops.length; j++) {
      var op = ops[j];
      var tx = op.transaction;
      if (!tx || !isDoc(tx)) continue;
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
      if (r) { if (row.state === 'active') seen.set(key, row); continue; }   // 同一事务有多条时，留正在执行的那条
      seen.set(key, row);
    }
    for (var sk = seen.keys(), i = 0; i < sk.length; i++) if (seen.get(sk[i]).openSecs >= minSecs) rows.push(seen.get(sk[i]));
    var cmp = spec ? rowCmp(spec) : null;
    rows.sort(function (x, y) { return (cmp ? cmp(x, y) : 0) || y.openSecs - x.openSecs; });
    rowsOut(rows, o, out);
    if (!rows.length && !minSecs) out.push(M().noTxn);
    emit(out);
  }

  // ─── 磁盘碎片 / 缓存：都来自 $collStats.storageStats.wiredTiger；经 mongos 时每个分片一条，加起来
  function wtStats(d, name) { return wtStatsOf(aggArr(d.getCollection(name), [{ $collStats: { storageStats: {} } }])); }
  function wtStatsOf(docs) {
    if (!docs || !docs.length) return null;
    var reuse = function (w) { return toNum(((w || {})['block-manager'] || {})['file bytes available for reuse']) || 0; };
    var cached = function (w) { return toNum(((w || {}).cache || {})['bytes currently in the cache']) || 0; };
    var s = { storage: 0, reuse: 0, idxSize: 0, idxReuse: 0, cache: 0, idxCache: 0 };
    for (var i = 0; i < docs.length; i++) {
      var x = docs[i];
      var st = x.storageStats || {}, ix = st.indexDetails || {};
      s.storage += toNum(st.storageSize) || 0;
      s.idxSize += toNum(st.totalIndexSize) || 0;
      s.reuse += reuse(st.wiredTiger);
      s.cache += cached(st.wiredTiger);
      for (var ks = Object.keys(ix), j = 0; j < ks.length; j++) { var k = ks[j]; s.idxReuse += reuse(ix[k]); s.idxCache += cached(ix[k]); }
    }
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
    for (var ks = collNames(d), i = 0; i < ks.length; i++) {
      var name = ks[i];
      var s = wtStats(d, name);
      if (!s) continue;
      tData += s.reuse; tIdx += s.idxReuse;
      rows.push({
        row: {
          name: name, disk: sizeText(s.storage), reusable: sizeText(s.reuse), pct: pctText(s.reuse, s.storage),
          indexDisk: sizeText(s.idxSize), indexReusable: sizeText(s.idxReuse)
        },
        w: s.reuse + s.idxReuse
      });
    }
    rows.sort(function (a, b) { return b.w - a.w || (a.row.name < b.row.name ? -1 : 1); });
    rowsOut(pluck(rows, 'row'), o, out);
    out.push(M().fragTotal(sizeText(tData + tIdx), sizeText(tData), sizeText(tIdx)));
    emit(out);
  }

  // 各集合在 WiredTiger 缓存里占了多少；默认扫所有库
  function cache(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['cached', 'dataCached', 'indexCached', 'share']), out = [];
    var a = admin();
    notMongos('mt.cache()');
    var dbsList = x.d ? [x.d] : dbsOf(dbNames());
    cmdLine(o, 'db.serverStatus().wiredTiger.cache; ' + (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every db') +
      ': each collection aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger.cache', out);
    var wc = (runCmd(a, { serverStatus: 1 }).wiredTiger || {}).cache || {};
    var used = toNum(wc['bytes currently in the cache']) || 0, max = toNum(wc['maximum bytes configured']) || 0;
    var dirty = toNum(wc['tracked dirty bytes in the cache']) || 0;
    headOut({ used: sizeText(used) + (max ? ' (' + pctText(used, max) + ')' : ''), max: sizeText(max),
      dirty: sizeText(dirty) + (max ? ' (' + pctText(dirty, max) + ')' : '') }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = [], sum = 0;
    for (var j = 0; j < dbsList.length; j++) {
      var d = dbsList[j];
      for (var ks = collNames(d), k2 = 0; k2 < ks.length; k2++) {
        var name = ks[k2];
        var s = wtStats(d, name);
        if (!s || s.cache + s.idxCache <= 0) continue;
        var c = s.cache + s.idxCache;
        sum += c;
        rows.push({ row: { ns: d.getName() + '.' + name, cached: sizeText(c), dataCached: sizeText(s.cache), indexCached: sizeText(s.idxCache), share: pctText(c, used) }, w: c });
      }
    }
    rows.sort(function (p, q) { return q.w - p.w || (p.row.ns < q.row.ns ? -1 : 1); });
    rowsOut(pluck(rows, 'row'), o, out);
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
  function oldestDate(c, ix, o) {
    var f = Object.keys(ix.key || {})[0];
    if (!f || ix.partialFilterExpression) return null;
    var q = {}, proj = { _id: 0 }, sort = {};
    q[f] = { $type: 9 }; proj[f] = 1; sort[f] = 1;
    var doc = tracked(o, 'ttl', c.getFullName(), function () { return c.find(q, proj).sort(sort).hint(ix.name).limit(1).toArray()[0]; });
    var v = doc ? pathGet(doc, f) : null;
    if (Array.isArray(v)) v = v.filter(isDate).sort(function (a, b) { return a - b; })[0];
    return isDate(v) ? v : null;
  }
  function ttl(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['expireAfterSeconds', 'overdueSecs']), out = [];
    var a = admin();
    var dbsList = x.d ? [x.d] : dbsOf(dbNames());
    cmdLine(o, (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every db') +
      ': getCollectionInfos() + each getIndexes() → expireAfterSeconds; getParameter ttlMonitor*; serverStatus().metrics.ttl', out);
    var p = attempt(rawCmd, a, { getParameter: 1, ttlMonitorEnabled: 1, ttlMonitorSleepSecs: 1 }) || {};
    var tm = safe(function () { return unwrap(a.runCommand({ serverStatus: 1 })).metrics.ttl; }) || {};
    headOut({ ttlMonitorEnabled: p.ok ? p.ttlMonitorEnabled : null, ttlMonitorSleepSecs: p.ok ? toNum(p.ttlMonitorSleepSecs) : null,
      passes: toNum(tm.passes), deletedDocuments: toNum(tm.deletedDocuments) }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = ttlList(dbsList, o);
    rowsOut(rows, o, out);
    if (!rows.length) out.push(M().noTtl);
    emit(out);
  }
  // TTL 索引（含聚簇集合、时序集合的 expireAfterSeconds）：add(ns, index, field, 秒, 最老的时间, 标记)
  function ttlRows(cc, add, o) {
    var op = cc.info.options || {};
    if (op.expireAfterSeconds != null) {
      if (op.timeseries) add(cc.ns, '(timeseries)', op.timeseries.timeField || '', op.expireAfterSeconds, null, []);
      else add(cc.ns, '(clustered)', '_id', op.expireAfterSeconds, null, []);
    }
    if (cc.info.type === 'timeseries') return;
    for (var ks = cc.indexes(), i = 0; i < ks.length; i++) {
      var ix = ks[i];
      if (ix.expireAfterSeconds == null || ix.clustered) continue;   // 聚簇索引上面已经算过
      var flags = [];
      if (ix.partialFilterExpression) flags.push('partial=' + valText(ix.partialFilterExpression, true, o));
      if (ix.hidden) flags.push('hidden');
      add(cc.ns, ix.name, Object.keys(ix.key || {})[0] || '', ix.expireAfterSeconds, oldestDate(cc.c, ix, o), flags);
    }
  }
  function ttlAdder(rows) {
    var now = Date.now();
    return function (ns, index, field, secs, oldest, flags) {
      secs = toNum(secs);
      rows.push({
        ns: ns, index: index, field: field, expireAfterSeconds: secs, expire: isNaN(secs) ? '' : durText(secs),
        oldest: oldest || '', overdueSecs: oldest && !isNaN(secs) ? Math.max(0, Math.round((now - oldest.getTime()) / 1000 - secs)) : '',
        options: flags.join(', ')
      });
    };
  }
  function byOverdue(p1, p2) {
    var a1 = p1.overdueSecs === '' ? -1 : p1.overdueSecs, a2 = p2.overdueSecs === '' ? -1 : p2.overdueSecs;
    return a2 - a1 || (p1.ns < p2.ns ? -1 : p1.ns > p2.ns ? 1 : 0);
  }
  function ttlScope(cc) { return !/^system\.buckets\./.test(cc.name); }
  function ttlList(dbsList, o) {
    var rows = [], add = ttlAdder(rows);
    for (var ks = inventory(dbsList, o), i = 0; i < ks.length; i++) { var x = ks[i]; var cc = collCtx(x, o); if (ttlScope(cc)) ttlRows(cc, add, o); }
    return rows.sort(byOverdue);
  }

  // ─── 索引体检。默认扫所有用户库（跳过 admin / local / config），也可以只给一个库
  function dbNames() { return pluck(runCmd(admin(), { listDatabases: 1, nameOnly: true }).databases || [], 'name'); }
  function dbsOf(names) { var out = []; for (var i = 0; i < names.length; i++) out.push(curDb().getSiblingDB(names[i])); return out; }
  function userDbs(x) {
    if (x.d) return [x.d];
    var names = dbNames(), user = [];
    for (var i = 0; i < names.length; i++) if (names[i] !== 'admin' && names[i] !== 'local' && names[i] !== 'config') user.push(names[i]);
    return dbsOf(user.sort());
  }
  // 各库的集合（不含视图）：[{d, info}]，每个库一次 listCollections。o.track 存在时列不出的库记下来跳过
  function inventory(dbsList, o) {
    var list = [];
    dbsList.forEach(function (d) {
      var infos;
      try { infos = d.getCollectionInfos(); } catch (e) {
        if (isAuthErr(e)) fail(M().unauthorized('listCollections'));
        if (!(o && o.track)) throw e;
        missed(o, 'list', d.getName(), e);
        return;
      }
      for (var i = 0; i < infos.length; i++) { var info = infos[i]; if (info.type !== 'view') list.push({ d: d, info: info }); }
    });
    return list;
  }
  // 一个集合要用到的数据：用到时才查，查过的不再查。mt.check() 一次遍历里几项检查共用
  function collCtx(x, o) {
    var d = x.d, name = x.info.name, c = d.getCollection(name), ns = d.getName() + '.' + name, memo = {};
    var once = function (k, fn) { if (!(k in memo)) memo[k] = fn(); return memo[k]; };
    var stats = function () { return once('stats', function () { return aggArr(c, [{ $collStats: { storageStats: {} } }], o, 'cs'); }); };
    return {
      d: d, name: name, c: c, ns: ns, info: x.info,
      indexes: function () { return once('ix', function () { return tracked(o, 'ix', ns, function () { return c.getIndexes(); }) || []; }); },
      usage: function () { return once('use', function () { return indexUsage(c, o); }); },
      cs: function () { return once('cs', function () { return collStatsOf(stats()); }); },
      wt: function () { return once('wt', function () { return wtStatsOf(stats()); }); }
    };
  }
  function idxScope(cc) { return !/^system\./.test(cc.name); }   // 索引体检不看 system.*

  // 没被用过的索引：$indexStats 的 accesses.ops 为 0。_id_ 删不掉，跳过；
  // unique / ttl 即使没被查询用过也在干活（唯一约束、过期删除），在 options 里标出来
  // 计算部分单独拿出来，mt.check() 也用：[{row, w: 字节数, ix}]，大的在前
  function bySize(p, q) { return q.w - p.w || (p.row.ns < q.row.ns ? -1 : p.row.ns > q.row.ns ? 1 : 0); }
  // 分片键：经 mongos 时读 config.collections，在分片的 mongod 上读它缓存的路由表 config.cache.collections；都没有就是空的
  function shardKeyMap() {
    var cfgDb = curDb().getSiblingDB('config'), map = {};
    var name = helloDoc(admin()).msg === 'isdbgrid' ? 'collections' : 'cache.collections';
    var docs = safe(function () { return cfgDb.getCollection(name).find({ dropped: { $ne: true } }, { key: 1 }).toArray(); }) || [];
    for (var i = 0; i < docs.length; i++) { var d = docs[i]; if (d && d._id != null && isDoc(d.key)) map[String(d._id)] = d.key; }
    return map;
  }
  // 索引键以分片键开头（字段、顺序一样，hashed 对 hashed）：分片需要它，不能删
  function onShardKey(ix, sk) {
    if (!isDoc(sk) || !isDoc(ix.key)) return false;
    var sf = Object.keys(sk), kf = Object.keys(ix.key);
    return sf.length > 0 && sf.length <= kf.length && sf.every(function (f, i) {
      return kf[i] === f && (String(sk[f]) === 'hashed') === (String(ix.key[f]) === 'hashed');
    });
  }
  function verAtLeast(v, major, minor) {
    var p = String(v || '').split('.').map(Number);
    return p[0] > major || (p[0] === major && (p[1] || 0) >= minor);
  }
  // o.days：计数开始（since）不到这么多天的不算没用（标 young），默认 7；o.shardKeys：shardKeyMap() 的结果
  function unusedRows(cc, rows, o) {
    var usage = cc.usage(), now = Date.now(), days = o.days == null ? 7 : toNum(o.days) || 0, sk = (o.shardKeys || {})[cc.ns];
    for (var ks = cc.indexes(), i = 0; i < ks.length; i++) {
      var ix = ks[i];
      var u = usage[ix.name];
      if (ix.name === '_id_' || !u || u.ops > 0) continue;
      var cs = cc.cs(), bytes = cs ? toNum(cs.indexSizes[ix.name]) || 0 : 0, shard = onShardKey(ix, sk);
      var flags = indexFlags(ix, o);
      if (shard) flags = flags ? flags + ', shardKey' : 'shardKey';
      rows.push({ row: { ns: cc.ns, index: ix.name, key: valText(ix.key, true, o), disk: cs ? sizeText(bytes) : '',
        since: u.since || '', options: flags }, w: bytes, ix: ix, shard: shard,
        young: days > 0 && isDate(u.since) && now - u.since.getTime() < days * 86400000 });
    }
  }
  function unusedList(dbsList, o) {
    var rows = [];
    for (var ks = inventory(dbsList, o), i = 0; i < ks.length; i++) { var x = ks[i]; var cc = collCtx(x, o); if (idxScope(cc)) unusedRows(cc, rows, o); }
    return rows.sort(bySize);
  }
  function dupRows(cc, rows, o) {
    var ixs = cc.indexes().filter(function (ix) { return ix.key && plainKey(ix.key); });
    for (var i = 0; i < ixs.length; i++) {
      var a = ixs[i];
      if (a.name === '_id_' || a.unique || a.expireAfterSeconds != null || a.partialFilterExpression || a.sparse || a.hidden) continue;
      var cover = null;
      for (var j = 0; j < ixs.length; j++) {
        var b = ixs[j];
        if (b === a || b.partialFilterExpression || b.sparse || b.hidden || !sameCollation(a, b) || !keyPrefix(a.key, b.key)) continue;
        if (!cover || Object.keys(b.key).length < Object.keys(cover.key).length) cover = b;   // 取最短的那个
      }
      if (!cover) continue;
      var cs = cc.cs(), bytes = cs ? toNum(cs.indexSizes[a.name]) || 0 : 0;
      rows.push({ row: { ns: cc.ns, index: a.name, key: valText(a.key, true, o), disk: cs ? sizeText(bytes) : '',
        coveredBy: cover.name, coveredKey: valText(cover.key, true, o) }, w: bytes });
    }
  }
  function dupList(dbsList, o) {
    var rows = [];
    for (var ks = inventory(dbsList, o), i = 0; i < ks.length; i++) { var x = ks[i]; var cc = collCtx(x, o); if (idxScope(cc)) dupRows(cc, rows, o); }
    return rows.sort(bySize);
  }
  function unusedIdx(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['disk']), out = [];
    var dbsList = userDbs(x);
    var days = o.days == null ? 7 : toNum(o.days) || 0;
    cmdLine(o, (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every user db') +
      ': each collection getIndexes() + aggregate([{$indexStats: {}}]) → accesses.ops = 0' + (days ? ', accesses.since ≥ ' + days + ' days ago' : ''), out);
    var st = attempt(rawCmd, admin(), { serverStatus: 1 }) || {}, h = helloDoc(admin()), m = M();
    headOut({ node: st.host || null, uptime: st.uptime != null ? durText(st.uptime) : null }, Object.assign({}, o, { cols: null, exclude: null }), out);
    var all = unusedList(dbsList, Object.assign({}, o, { shardKeys: shardKeyMap() }));
    var rows = all.filter(function (r) { return !r.young; }), young = all.length - rows.length;
    rowsOut(pluck(rows, 'row'), o, out);
    if (!rows.length) out.push(m.noUnused);
    if (young) out.push(m.unusedYoung(young, days));
    if (h.msg === 'isdbgrid') out.push(m.unusedMongos);
    else if (h.setName) out.push(m.unusedNode(st.host || ''));
    if (rows.length) out.push(m.unusedHide(verAtLeast(st.version, 4, 4)));
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
    var rows = dupList(dbsList, o);
    rowsOut(pluck(rows, 'row'), o, out);
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
      for (var i = 0; i < n.shards.length; i++) {
        var sh = n.shards[i];
        var t = sh.executionStages || sh.winningPlan;
        if (t) out.push({ stage: 'shard ' + (sh.shardName || ''), _child: t.queryPlan || t });
      }
      return out;
    }
    for (var ks = Object.keys(n), j = 0; j < ks.length; j++) {
      var k = ks[j];
      var v = n[k];
      if (isDoc(v) && typeof v.stage === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(function (x) { if (isDoc(x) && typeof x.stage === 'string') out.push(x); });
    }
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
          case '$timestamp': return attempt(Timestamp, w.t, w.i) || Timestamp({ t: w.t, i: w.i });   // eslint-disable-line no-undef
          case '$minKey': return MinKey();   // eslint-disable-line no-undef
          case '$maxKey': return MaxKey();   // eslint-disable-line no-undef
          case '$binary': return typeof w === 'string' ? BinData(parseInt(v.$type, 16), w) : BinData(parseInt(w.subType, 16), w.base64);   // eslint-disable-line no-undef
        }
        return undefined;
      });
      if (r !== undefined && r !== null) return r;
    }
    var out = {};
    for (var i = 0; i < ks.length; i++) { var key = ks[i]; out[key] = ejsonFix(v[key]); }
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
  function tsMake(t, i) { return attempt(Timestamp, t, i) || Timestamp({ t: t, i: i }); }   // eslint-disable-line no-undef
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
    for (var ks = ['numYields', 'writeConflicts', 'nMatched', 'nModified', 'ndeleted', 'ninserted', 'reslen'], i = 0; i < ks.length; i++) { var k = ks[i]; r[k] = num(x[k]); }
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
      ndeleted: kv.ndeleted, ninserted: kv.ninserted, reslen: kv.reslen, queryHash: kv.queryHash || kv.planCacheShapeHash, planCacheKey: kv.planCacheKey,
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
      bytesRead: sd.bytesRead, readMicros: sd.timeReadingMicros, queryHash: a.queryHash || a.planCacheShapeHash, planCacheKey: a.planCacheKey,
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
      bytesRead: sd.bytesRead, readMicros: sd.timeReadingMicros, queryHash: p.queryHash || p.planCacheShapeHash, planCacheKey: p.planCacheKey,
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
    for (var ks = Object.keys(c), i = 0; i < ks.length; i++) {
      var k = ks[i];
      if (k.charAt(0) === '$' || EXPLAIN_DROP.indexOf(k) >= 0) continue;
      cmd[k] = c[k];
    }
    // mongos 发给分片时加的 projection: {$sortKey: {$meta: 'sortKey'}}
    if (isDoc(cmd.projection)) {
      var pj = {};
      for (var list = Object.keys(cmd.projection), j = 0; j < list.length; j++) {
        var k2 = list[j];
        var v = cmd.projection[k2];
        if (!(isDoc(v) && v.$meta === 'sortKey')) pj[k2] = v;
      }
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
      var j = attempt(JSON.parse, x);
      if (isDoc(j)) {
        j = ejsonFix(j);
        var jt = isDoc(j.t) && isDate(j.t.$date) ? j.t.$date : isDate(j.t) ? j.t : null;
        if (isDoc(j.attr) && isDoc(j.attr.command)) {
          return { op: j.attr.type, ns: j.attr.ns, command: j.attr.command, originatingCommand: j.attr.originatingCommand, stats: statsFromAttr(j.attr, jt) };
        }
        return isDoc(j.command) ? j : { command: j };
      }
      // 4.4 之前的文本日志行，或者 shell 写法的命令 { find: "c", filter: { ... } }
      var e = attempt(textLogEntry, x);
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
    for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (c[k] !== undefined && c[k] !== false) { o[k] = c[k]; n++; } }
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
        for (var ks = ['sort', 'skip', 'limit', 'hint', 'collation', 'maxTimeMS', 'comment'], i = 0; i < ks.length; i++) {
          var k = ks[i];
          if (cmd[k] !== undefined && !(k === 'skip' && !cmd[k]) && !(k === 'limit' && !cmd[k])) q += '.' + k + '(' + jsLit(cmd[k]) + ')';
        }
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
    for (var j = 0; j < stages.length; j++) {
      var st = stages[j];
      var k = Object.keys(st).filter(function (key) { return key.charAt(0) === '$'; })[0];
      if (k === '$cursor') cur = st.$cursor;
      else if (k) rest.push({ name: k, st: st });
    }
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
      for (var ks = exChildren(n), i = 0; i < ks.length; i++) { var c = ks[i]; walk(c, d + 1); }
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
    dropBlank(rows, ['nReturned', 'keysExamined', 'docsExamined', 'ms']);
    renderRows(rows, o, out, false, rows.length);
    var nl = [];
    for (var nk = notes.keys(), i = 0; i < nk.length; i++) nl.push(m.exNote[nk[i]]);
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
      var ix = pluck(((op.command || {}).indexes || []), 'name').sort().join(',');
      return buildNs(op) + '|' + ix;
    };
    for (var j = 0; j < ops.length; j++) {
      var op = ops[j];
      if (!/index build/i.test(String(op.msg || ''))) continue;
      var c = op.command || {}, ixs = c.indexes || [], p = op.progress || {};
      var done = p.done != null ? toNum(p.done) : '', total = p.total != null ? toNum(p.total) : '';
      var row = {
        ns: buildNs(op), index: pluck(ixs, 'name').join(', '),
        key: ixs.map(function (i) { return valText(i.key, true, o); }).join('; '),
        phase: buildPhase(op.msg), done: done, total: total, pct: total ? pctText(done, total) : '',
        secs: op.secs_running != null ? toNum(op.secs_running) : '', opid: op.opid != null ? op.opid : '',
        client: op.client || op.client_s || ''
      };
      byKey[keyOf(op)] = row;
      rows.push(row);
    }
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
        ns: buildNs(op), index: pluck(ixs, 'name').join(', '),
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
      var j = attempt(JSON.parse, line);
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
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      var r = logLine(l);
      if (!r || (!r.msg && r.attr == null)) continue;
      if (maxRank != null && !(SEV_RANK[String(r.sev).charAt(0)] <= maxRank)) continue;
      if (re && !re.test(r.raw)) continue;
      if (needle && r.raw.toLowerCase().indexOf(needle) < 0) continue;
      var row = { '#': 0, time: r.time, sev: r.sev, comp: r.comp, ctx: r.ctx, id: r.id, msg: r.msg };
      if (r.json) row.attr = r.attr != null ? valText(r.attr, true, o) : '';
      row._attr = r.attr;
      row._raw = r.json ? null : r.raw;
      rows.push(row);
    }
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
      return raw ? attempt(textLogEntry, raw) || null : null;   // 4.4 之前的文本日志
    });
    dropBlank(rows, ['id']);   // 4.4 之前没有 id
    renderRows(rows, o, out, false, rows.length);
    if (total > rows.length) out.push(paint(o, DIM, M().logTail(rows.length, total)));
    emit(out);
  }

  // ─── 部署方式只能推断：容器看内存 / CPU 限制和 1 号进程；虚拟机看 CPU 标志 hypervisor（x86）和内核名
  //     （云厂商、桌面虚拟机的内核带 -aws、-azure、orbstack 等）；都没有迹象时，多路 CPU / 多个 NUMA 节点像物理机
  var VM_KERNEL = /-(aws|azure|gcp|gke|oracle|kvm|cloud|virtual)\b|amzn|orbstack|linuxkit|microsoft-standard|\.el\d+uek/i;
  function platformOf(sy, ex, pid, m) {
    var p = m.plat, cont = [], vm = [];
    var mem = toNum(sy.memSizeMB), lim = toNum(sy.memLimitMB), cores = toNum(sy.numCores), avail = toNum(sy.numCoresAvailableToProcess);
    if (lim && mem && lim < mem) cont.push(p.memLimit(sizeText(lim * 1048576)));
    if (avail && cores && avail < cores) cont.push(p.cpu(avail, cores));
    if (pid === 1) cont.push(p.pid1);
    if (/\bhypervisor\b/.test(String(ex.cpuFeatures || ''))) vm.push(p.hyper);
    if (ex.kernelVersion && VM_KERNEL.test(String(ex.kernelVersion))) vm.push(p.kernel(ex.kernelVersion));
    var why = function (list) { return p.open + list.join(p.join) + p.close; };
    if (cont.length) return p.container + why(cont) + (vm.length ? p.onVm + why(vm) : '');
    if (vm.length) return p.vm + why(vm);
    var phys = [], sockets = toNum(sy.numCpuSockets), nodes = toNum(sy.numNumaNodes);
    if (sockets > 1) phys.push(p.sockets(sockets));
    if (nodes > 1) phys.push(p.numa(nodes));
    return phys.length ? p.physical + why(phys) : p.unknown;
  }

  // ─── 机器和进程：hostInfo + buildInfo + getCmdLineOpts + serverStatus，按 host / os / mongod / startup 分组
  function host(opts) {
    var o = dbaOpts(opts), out = [], m = M(), a = admin();
    cmdLine(o, 'db.hostInfo(); db.serverBuildInfo(); db.adminCommand({getCmdLineOpts: 1}); db.serverStatus()', out);
    var hi = attempt(runCmd, a, { hostInfo: 1 }) || {};
    var bi = attempt(runCmd, a, { buildInfo: 1 }) || {};
    var co = attempt(runCmd, a, { getCmdLineOpts: 1 }) || {};
    var ss = attempt(runCmd, a, { serverStatus: 1 }) || {};
    var fcv = safe(function () { var p = runCmd(a, { getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion; return isDoc(p) ? p.version : p; });
    var sy = hi.system || {}, osi = hi.os || {}, ex = hi.extra || {}, pa = co.parsed || {};
    var get = function (obj, path) { return pathGet(obj, path); };
    var mb = function (v) { return v != null && v !== '' ? sizeText(toNum(v) * 1048576) : null; };
    var files = toNum(ex.maxOpenFiles);
    var wc = (ss.wiredTiger || {}).cache || {};
    // 缓存上限超过可用内存（容器限制或机器内存）的 80% 时提示：老版本不认容器的内存限制，按宿主机内存算缓存
    var cacheBytes = toNum(wc['maximum bytes configured']), memAvail = toNum(sy.memLimitMB || sy.memSizeMB) * 1048576;
    var cacheMax = cacheBytes ? (memAvail && cacheBytes > memAvail * 0.8 ? m.bigCache(sizeText(cacheBytes)) : sizeText(cacheBytes)) : null;
    // 看着像容器（1 号进程或 CPU 受限），却看不到内存限制，又是 4.4 之前的版本：缓存很可能按宿主机内存算了
    var ver = String(bi.version || '').split('.').map(Number);
    var looksContainer = toNum(ss.pid) === 1 || (sy.numCoresAvailableToProcess != null && toNum(sy.numCoresAvailableToProcess) < toNum(sy.numCores));
    var limitSeen = sy.memLimitMB != null && toNum(sy.memLimitMB) < toNum(sy.memSizeMB);
    if (cacheMax && looksContainer && !limitSeen && (ver[0] < 4 || (ver[0] === 4 && ver[1] < 4))) cacheMax = m.oldCache(sizeText(cacheBytes));
    var doc = {
      host: {
        hostname: sy.hostname, platform: hi.system ? platformOf(sy, ex, ss.pid != null ? toNum(ss.pid) : null, m) : null,
        cpuArch: sy.cpuArch, cpuCores: toNum(sy.numCores),
        cpuAvailable: sy.numCoresAvailableToProcess != null && toNum(sy.numCoresAvailableToProcess) < toNum(sy.numCores) ? toNum(sy.numCoresAvailableToProcess) : null,
        physicalCores: toNum(sy.numPhysicalCores != null ? sy.numPhysicalCores : ex.physicalCores), cpuSockets: toNum(sy.numCpuSockets),
        cpuMHz: ex.cpuFrequencyMHz || null, memory: mb(sy.memSizeMB),
        memLimit: sy.memLimitMB != null && toNum(sy.memLimitMB) !== toNum(sy.memSizeMB) ? mb(sy.memLimitMB) : null,   // 容器 / cgroup 的限制
        numa: sy.numaEnabled != null ? !!sy.numaEnabled : null, numaNodes: sy.numNumaNodes != null ? toNum(sy.numNumaNodes) : null,
        time: isDate(sy.currentTime) ? sy.currentTime : null
      },
      os: {
        type: osi.type, name: osi.name, version: osi.version, kernel: ex.kernelVersion, libc: ex.libcVersion,
        maxOpenFiles: files == null || isNaN(files) ? null : files < 64000 ? m.lowFiles(files) : files
      },
      mongod: {
        version: bi.version, edition: Array.isArray(bi.modules) ? (bi.modules.indexOf('enterprise') >= 0 ? 'enterprise' : 'community') : null,
        gitVersion: bi.gitVersion ? String(bi.gitVersion).slice(0, 12) : null, allocator: bi.allocator, jsEngine: bi.javascriptEngine,
        openssl: bi.openssl && bi.openssl.running ? bi.openssl.running : null, fcv: fcv || null,
        storageEngine: ss.storageEngine && ss.storageEngine.name, process: ss.process, pid: ss.pid != null ? toNum(ss.pid) : null,
        uptime: ss.uptime != null ? durText(ss.uptime) : null, cacheMax: cacheMax
      },
      startup: {
        argv: Array.isArray(co.argv) ? co.argv.join(' ') : null, config: pa.config || null,
        dbPath: get(pa, 'storage.dbPath'), port: get(pa, 'net.port'), bindIp: get(pa, 'net.bindIp') || (get(pa, 'net.bindIpAll') ? '*' : null),
        replSet: get(pa, 'replication.replSetName') || get(pa, 'replication.replSet'), oplogSizeMB: get(pa, 'replication.oplogSizeMB'),
        authorization: get(pa, 'security.authorization'), keyFile: get(pa, 'security.keyFile'), logPath: get(pa, 'systemLog.path'),
        cacheSizeGB: get(pa, 'storage.wiredTiger.engineConfig.cacheSizeGB')
      }
    };
    if (o.all) doc.parsed = pa;   // 全部启动参数（配置文件 + 命令行）
    var f = flatten(prune(doc), o, null), keys = f.keys();
    kvLines(f, selectCols(keys, o.cols, o.exclude), o, out);
    emit(out);
  }

  // ─── 运行参数：getParameter。4.2 起加 showDetails，能看出哪些可以在运行时用 setParameter 改；之前只有名字和值
  function vars(pat, opts) {
    if (pat && typeof pat === 'object' && !isRegExp(pat)) { opts = pat; pat = null; }
    var o = dbaOpts(opts), out = [], a = admin(), m = M();
    if (!(opts && typeof opts === 'object' && opts.maxCol != null)) o.maxCol = 60;   // 值可能是文档，默认放宽
    var det = attempt(rawCmd, a, { getParameter: { allParameters: true, showDetails: true } }), useDet = !!(det && det.ok);
    cmdLine(o, useDet ? 'db.adminCommand({getParameter: {allParameters: true, showDetails: true}})' : "db.adminCommand({getParameter: '*'})", out);
    var r = useDet ? det : runCmd(a, { getParameter: '*' });
    // 过滤：正则；带 * ? 的按通配符；其余按包含。都不分大小写
    var re = isRegExp(pat) ? pat : pat != null && /[*?]/.test(String(pat))
      ? new RegExp('^' + String(pat).replace(/[.+^$\{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
    var needle = !re && pat != null ? String(pat).toLowerCase() : '';
    var names = Object.keys(r).sort(function (x, y) { var lx = x.toLowerCase(), ly = y.toLowerCase(); return lx < ly ? -1 : lx > ly ? 1 : 0; });
    var rows = [];
    for (var i = 0; i < names.length; i++) {
      var k = names[i], v = r[k];
      if (k === 'ok' || k === 'operationTime' || k.charAt(0) === '$') continue;
      if (re ? !re.test(k) : needle && k.toLowerCase().indexOf(needle) < 0) continue;
      var d = useDet && isDoc(v) && 'value' in v ? v : null;
      if (d) v = d.value;
      rows.push({ name: k, value: isDoc(v) || Array.isArray(v) ? valText(v, true, o) : v, runtime: d ? !!d.settableAtRuntime : '' });
    }
    dropBlank(rows, ['runtime']);
    if (!rows.length) { out.push(m.noVar(String(pat))); emit(out); return; }
    rowsOut(rows, o, out);
    emit(out);
  }

  // ─── 延迟：serverStatus.opLatencies（整台）和 $collStats.latencyStats（各集合）都是启动以来累计的
  //     latency（微秒）和 ops；采样两次相减就是这段时间内的平均延迟
  var LAT_KINDS = ['reads', 'writes', 'commands', 'transactions'];
  function latPick(doc) {
    var r = {};
    for (var i = 0; i < LAT_KINDS.length; i++) {
      var k = LAT_KINDS[i];
      var x = isDoc(doc) ? doc[k] : null;
      if (isDoc(x)) r[k] = { lat: toNum(x.latency) || 0, ops: toNum(x.ops) || 0 };
    }
    return r;
  }
  function latColl(d, name) {
    var docs = aggArr(d.getCollection(name), [{ $collStats: { latencyStats: {} } }]);
    if (!docs || !docs.length) return null;
    var sum = {};
    for (var i = 0; i < docs.length; i++) {
      var x = docs[i];
      // 经 mongos 时每个分片一条
      var p = latPick(x.latencyStats);
      for (var ks = Object.keys(p), j = 0; j < ks.length; j++) { var k = ks[j]; var s0 = sum[k] || (sum[k] = { lat: 0, ops: 0 }); s0.lat += p[k].lat; s0.ops += p[k].ops; }
    }
    return sum;
  }
  function latency(dbName, opts) {
    var x = dbArg(dbName, opts);
    var o = dbaOpts(x.opts, ['readOps', 'readMs', 'writeOps', 'writeMs', 'cmdOps', 'cmdMs', 'totalMs']), out = [], m = M(), a = admin();
    var iv = o.interval == null ? 1 : toNum(o.interval) || 0;
    var canSleep = typeof sleep === 'function';   // eslint-disable-line no-undef
    var sampled = iv > 0 && canSleep;
    var dbsList = userDbs(x);
    cmdLine(o, 'db.serverStatus().opLatencies; ' + (x.d ? "db.getSiblingDB('" + x.d.getName() + "')" : 'every user db') +
      ': each collection aggregate([{$collStats: {latencyStats: {}}}])' + (sampled ? m.latSampled(iv) : m.latTotals), out);
    // 自己的探测也会被算进去：采样模式下，第一次每个集合连着探两次、serverStatus 也连着取两次，
    // 两次之差就是一次探测的次数和延迟，第二次采样时把它减掉（$collStats 算读，serverStatus 算命令）
    var collsSnap = function (twice) {
      var colls = {}, probes = {};
      for (var i = 0; i < dbsList.length; i++) {
        var d = dbsList[i];
        for (var ks = collNames(d), j = 0; j < ks.length; j++) {
          var name = ks[j];
          if (/^system\./.test(name)) continue;
          var ns = d.getName() + '.' + name, a1 = latColl(d, name);
          if (!a1) continue;
          if (twice) {
            var b1 = latColl(d, name) || a1, pr = { lat: (b1.reads || {}).lat - (a1.reads || {}).lat, ops: (b1.reads || {}).ops - (a1.reads || {}).ops };
            probes[ns] = pr.ops > 0 ? { lat: pr.lat / pr.ops, ops: 1 } : { lat: 0, ops: 1 };
            a1 = b1;
          }
          colls[ns] = a1;
        }
      }
      return { colls: colls, probes: probes };
    };
    var srv = function () { return latPick(runCmd(a, { serverStatus: 1 }).opLatencies); };
    var s1, s2 = null, srvProbe = { lat: 0, ops: 0 }, collProbes = {};
    if (sampled) {
      var c1 = collsSnap(true);
      var x1 = srv(), y1 = srv();
      var pc = { lat: ((y1.commands || {}).lat || 0) - ((x1.commands || {}).lat || 0), ops: ((y1.commands || {}).ops || 0) - ((x1.commands || {}).ops || 0) };
      srvProbe = pc.ops > 0 ? { lat: pc.lat / pc.ops, ops: 1 } : { lat: 0, ops: 1 };
      collProbes = c1.probes;
      s1 = { server: y1, colls: c1.colls };
      sleep(iv * 1000);   // eslint-disable-line no-undef
      var y2 = srv();     // 先取整台，再探各集合：整台的读次数里就没有自己的 $collStats
      s2 = { server: y2, colls: collsSnap(false).colls };
    } else {
      s1 = { server: srv(), colls: collsSnap(false).colls };
    }
    var cur = s2 || s1, base = s2 ? s1 : null;
    var diff = function (c, b, k, probe) {
      var cc = c[k] || { lat: 0, ops: 0 }, bb = b && b[k] ? b[k] : { lat: 0, ops: 0 };
      var d0 = { lat: cc.lat - bb.lat, ops: cc.ops - bb.ops };
      if (probe && d0.ops >= probe.ops) { d0.ops -= probe.ops; d0.lat = Math.max(0, d0.lat - probe.lat); }
      return d0;
    };
    var avg = function (dd) { return dd.ops > 0 ? Math.round(dd.lat / dd.ops / 10) / 100 : ''; };   // 微秒 → 毫秒，两位小数
    var h = {};
    for (var n2 = 0; n2 < LAT_KINDS.length; n2++) {
      var k = LAT_KINDS[n2];
      if (!cur.server[k]) continue;
      var dd = diff(cur.server, base && base.server, k, sampled && k === 'commands' ? srvProbe : null);
      h[k] = sampled ? { avgMs: avg(dd), 'ops/s': Math.round(dd.ops / iv * 10) / 10 } : { avgMs: avg(dd), ops: dd.ops };
    }
    headOut(h, Object.assign({}, o, { cols: null, exclude: null }), out);
    var rows = [];
    for (var list = Object.keys(cur.colls), k2 = 0; k2 < list.length; k2++) {
      var ns = list[k2];
      var c = cur.colls[ns], b = base ? base.colls[ns] : null;
      var r = diff(c, b, 'reads', sampled ? collProbes[ns] : null), w = diff(c, b, 'writes'), cm = diff(c, b, 'commands');
      var total = r.lat + w.lat + cm.lat;
      if (r.ops + w.ops + cm.ops <= 0) continue;
      rows.push({ row: { ns: ns, readOps: r.ops, readMs: avg(r), writeOps: w.ops, writeMs: avg(w), cmdOps: cm.ops, cmdMs: avg(cm), totalMs: Math.round(total / 1000) }, w: total });
    }
    rows.sort(function (p1, p2) { return p2.w - p1.w || (p1.row.ns < p2.row.ns ? -1 : 1); });
    rowsOut(pluck(rows, 'row'), o, out);
    emit(out);
  }

  // ─── 字段结构：$sample 抽样，按字段路径统计类型、出现比例、示例。文档数组里的字段按 MongoDB 的点号写法算（items.sku）
  function typeName(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (isDate(v)) return 'date';
    if (isRegExp(v)) return 'regex';
    if (Array.isArray(v)) return 'array';
    switch (bsonType(v)) {
      case 'ObjectId': case 'ObjectID': return 'objectId';
      case 'Long': return 'long';
      case 'Int32': return 'int';
      case 'Double': return 'number';
      case 'Decimal128': return 'decimal';
      case 'Timestamp': return 'timestamp';
      case 'Binary': return binParts(v).sub === 4 ? 'uuid' : 'binData';
      case 'MinKey': return 'minKey';
      case 'MaxKey': return 'maxKey';
      case 'BSONRegExp': return 'regex';
      case 'Code': return 'javascript';
      case 'DBRef': return 'dbref';
    }
    return isDoc(v) ? 'object' : typeof v;
  }
  function desc(coll, opts) {
    var o = dbaOpts(opts, ['present']), out = [], m = M();
    var c = resolveColl(coll), d = c.getDB(), cn = c.getName();
    var n = o.sample == null ? 1000 : Math.max(1, toNum(o.sample) || 1000);
    cmdLine(o, "db.getSiblingDB('" + d.getName() + "').getCollection('" + cn + "').aggregate([{$sample: {size: " + n + "}}]); getCollectionInfos; getIndexes", out);
    var info = (safe(function () { return d.getCollectionInfos({ name: cn }); }) || [])[0] || {}, op = info.options || {};
    var cs = collStats(d, cn);
    var docs;
    try { docs = c.aggregate([{ $sample: { size: n } }]).toArray(); } catch (e) {
      if (isAuthErr(e)) fail(m.unauthorized('$sample'));
      throw e;
    }
    var v = op.validator;
    var h = {
      ns: d.getName() + '.' + cn, type: info.type === 'view' ? 'view (' + op.viewOn + ')' : op.timeseries ? 'timeseries' : op.capped ? 'capped (' + sizeText(op.size) + ')' : op.clusteredIndex ? 'clustered' : 'collection',
      count: cs ? cs.count : null, sampled: docs.length,
      validator: isDoc(v) ? valText(v, true, o).slice(0, 120) + (op.validationLevel ? ' (' + op.validationLevel + '/' + (op.validationAction || 'error') + ')' : '') : null,
      collation: op.collation && op.collation.locale ? op.collation.locale : null,
      indexes: pluck((safe(function () { return c.getIndexes(); }) || []), 'name').join(', ') || null
    };
    headOut(h, Object.assign({}, o, { cols: null, exclude: null }), out);
    if (!docs.length) { out.push(m.noDocs); emit(out); return; }
    var fields = new StrMap();
    var hit = function (path) {
      var f = fields.get(path);
      if (!f) { f = { docs: 0, types: new StrMap(), elem: new StrMap(), example: undefined, seen: null, pos: 0, posN: 0 }; fields.set(path, f); }
      return f;
    };
    docs.forEach(function (doc, di) {
      (function walk(obj, prefix, depth) {
        for (var ks = Object.keys(obj), i = 0; i < ks.length; i++) {
          var k = ks[i], ki = i;
          var path = prefix + k, val = obj[k], f = hit(path), t = typeName(val);
          f.pos += ki; f.posN++;   // 在父文档里的位置，用来排序：抽样顺序是随机的
          if (f.seen !== di) { f.seen = di; f.docs++; }
          f.types.set(t, (f.types.get(t) || 0) + 1);
          if (f.example === undefined && val !== null && t !== 'object' && t !== 'array') f.example = val;
          if (o.depth != null && depth + 1 >= o.depth) continue;
          if (t === 'object' && Object.keys(val).length) walk(val, path + '.', depth + 1);
          if (t === 'array') {
            for (var j = 0; j < val.length; j++) {
              var e = val[j];
              var et = typeName(e);
              f.elem.set(et, (f.elem.get(et) || 0) + 1);
              if (et === 'object') walk(e, path + '.', depth + 1);
              else if (f.example === undefined && e !== null && et !== 'array') f.example = val;
            }
          }
        }
      })(doc, '', 0);
    });
    // 按字段在父文档里的平均位置排，子字段紧跟在父字段后面（像 DESC t 按定义顺序）
    var kids = {};
    for (var paths = fields.keys(), pi = 0; pi < paths.length; pi++) {
      var path = paths[pi], dot = path.lastIndexOf('.'), parent = dot < 0 ? '' : path.slice(0, dot);
      if (dot >= 0 && !fields.has(parent)) parent = '';
      (kids[parent] = kids[parent] || []).push(path);
    }
    var order = [];
    (function dfs(parent) {
      (kids[parent] || []).sort(function (a, b) {
        var fa = fields.get(a), fb = fields.get(b);
        return fa.pos / fa.posN - fb.pos / fb.posN || (a < b ? -1 : 1);
      }).forEach(function (p) { order.push(p); dfs(p); });
    })('');
    var rows = order.map(function (path) {
      var f = fields.get(path), total = 0, parts = [], ts = [];
      for (var tk = f.types.keys(), j = 0; j < tk.length; j++) { total += f.types.get(tk[j]); ts.push([tk[j], f.types.get(tk[j])]); }
      ts.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });   // 占比高的在前
      for (var i = 0; i < ts.length; i++) {
        var x = ts[i];
        var et = [];
        if (x[0] === 'array') et = f.elem.keys();
        parts.push(x[0] + (et.length ? '<' + et.sort().join('|') + '>' : '') + (ts.length > 1 ? ' ' + Math.round(x[1] / total * 100) + '%' : ''));
      }
      return { field: path, types: parts.join(', '), present: pctText(f.docs, docs.length), example: f.example === undefined ? '' : valText(f.example, true, o) };
    });
    rowsOut(rows, o, out);
    emit(out);
  }

  // ─── 计划缓存。4.2 起用 $planCacheStats；3.6 / 4.0 用 planCacheListQueryShapes + planCacheListPlans（第一个是胜出的计划）
  function planCache(coll, opts) {
    var o = dbaOpts(opts, ['works']), out = [], m = M();
    if (!(opts && typeof opts === 'object' && opts.maxCol != null)) o.maxCol = 60;   // 查询形状比较长
    var c = resolveColl(coll), d = c.getDB(), cn = c.getName();
    var hash = o.hash ? String(o.hash).toUpperCase() : '';
    var shape = function (q) {
      if (!isDoc(q)) return '';
      var parts = [valText(q.query || {}, true, o)];
      if (isDoc(q.sort) && Object.keys(q.sort).length) parts.push('sort ' + valText(q.sort, true, o));
      if (isDoc(q.projection) && Object.keys(q.projection).length) parts.push('proj ' + valText(q.projection, true, o));
      return parts.join(' ');
    };
    var rows = [];
    var stats = null;
    try { stats = c.aggregate([{ $planCacheStats: {} }]).toArray(); } catch (e) {
      if (isAuthErr(e)) fail(m.unauthorized('$planCacheStats'));
      if (!/planCacheStats|Unrecognized pipeline stage/i.test(String(e.message))) throw e;
    }
    if (stats) {
      cmdLine(o, "db.getSiblingDB('" + d.getName() + "').getCollection('" + cn + "').aggregate([{$planCacheStats: {}}])", out);
      for (var j = 0; j < stats.length; j++) {
        var x = stats[j];
        var plan = isDoc(x.cachedPlan) && typeof x.cachedPlan.stage === 'string' ? planSummaryOf(x.cachedPlan) : m.sbePlan;
        rows.push({
          hash: x.queryHash || x.planCacheShapeHash || '', planCacheKey: x.planCacheKey || '', active: x.isActive != null ? !!x.isActive : '',
          works: x.works != null ? toNum(x.works) : '', shape: shape(x.createdFromQuery), plan: plan || '',
          created: isDate(x.timeOfCreation) ? x.timeOfCreation : ''
        });
      }
    } else {
      cmdLine(o, "db.getSiblingDB('" + d.getName() + "').runCommand({planCacheListQueryShapes: '" + cn + "'}); each: planCacheListPlans", out);
      for (var ks = (runCmd(d, { planCacheListQueryShapes: cn }).shapes || []), k2 = 0; k2 < ks.length; k2++) {
        var sh = ks[k2];
        var pl = attempt(rawCmd, d, { planCacheListPlans: cn, query: sh.query, sort: sh.sort, projection: sh.projection }) || {};
        var best = (pl.plans || [])[0] || {}, st = isDoc(best.reason) ? best.reason.stats : null;
        rows.push({
          hash: sh.queryHash || '', planCacheKey: '', active: '', works: st && st.works != null ? toNum(st.works) : '',
          shape: shape(sh), plan: st ? planSummaryOf(st) : '', created: ''
        });
      }
    }
    if (hash) rows = rows.filter(function (r) { return String(r.hash).toUpperCase() === hash || String(r.planCacheKey).toUpperCase() === hash; });
    dropBlank(rows, ['hash', 'planCacheKey', 'active', 'created']);   // 3.6 / 4.0 没有这些（4.0 之前也没有 queryHash）
    rowsOut(rows, o, out);
    if (!rows.length && !hash) out.push(m.noPlanCache);
    emit(out);
  }

  // ─── 一键体检：把常见问题汇成一张表。每一项单独 try，查不了（如没权限）只把这一项标成 UNKNOWN；不适用的标 SKIP
  // mt.check() 的阈值：d 是默认值 [WARN, CRIT]，只有 WARN 的写 [WARN]；u 单位；low 越低越坏（其余越高越坏）
  var CHECK_TH = {
    lag: { d: [10, 60], u: 's' },
    oplog: { d: [24, 3], u: 'h', low: true },
    cacheUsed: { d: [90, 95], u: '%' },
    cacheDirty: { d: [10, 20], u: '%' },
    tickets: { d: [80, 95], u: '%' },
    queue: { d: [5, 50], u: 'n' },
    conns: { d: [80, 95], u: '%' },
    longOps: { d: [60, 600], u: 's' },
    txns: { d: [30], u: 's' },
    ttlOverdue: { d: [3600], u: 's' },
    frag: { d: [30], u: '%' },
    fragMinGB: { d: [1], u: 'GB' }
  };
  // 检查用户给的阈值，返回 {键: [数字...]}；不对就抛出说明。keepNull：mt.config 里 null 表示恢复默认
  function thParse(src, name, lang, keepNull) {
    var th = L(lang).ck.th, out = {}, keys = Object.keys(CHECK_TH);
    if (src == null) return out;
    if (typeof src !== 'object' || Array.isArray(src)) throw new Error('mongotab: ' + th.notObj(name));
    for (var ks = Object.keys(src), i = 0; i < ks.length; i++) {
      var k = ks[i];
      var spec = CHECK_TH[k], v = src[k];
      if (!spec) throw new Error('mongotab: ' + th.unknown(k, keys));
      if (v === null || v === undefined) { if (keepNull) out[k] = null; continue; }
      var arr = Array.isArray(v) ? v : [v];
      if (arr.length !== spec.d.length) throw new Error('mongotab: ' + (spec.d.length === 2 ? th.pair(k, spec.d) : th.one(k, spec.d)));
      arr = arr.map(function (x) {
        var n = typeof x === 'number' ? x : toNum(x);
        if (typeof n !== 'number' || !isFinite(n) || n < 0 || typeof x === 'string' || typeof x === 'boolean') throw new Error('mongotab: ' + th.num(k));
        if (spec.u === '%' && n > 100) throw new Error('mongotab: ' + th.pct(k));
        return n;
      });
      if (arr.length === 2 && (spec.low ? arr[0] < arr[1] : arr[0] > arr[1])) throw new Error('mongotab: ' + th.order(k, spec.low));
      out[k] = arr;
    }
    return out;
  }
  // 生效的阈值：默认值 ← mt.config 的 checkThresholds ← 这次的 thresholds
  function thEffective(callTh) {
    var eff = {};
    for (var ks = Object.keys(CHECK_TH), i = 0; i < ks.length; i++) { var k = ks[i]; eff[k] = CHECK_TH[k].d.slice(); }
    Object.assign(eff, cfg.checkThresholds || {}, thParse(callTh, 'thresholds', cfg.lang, false));
    return eff;
  }
  function thText(k, v, lang) {
    var u = L(lang).ck.th.units[CHECK_TH[k].u];
    return v.join(' / ') + (u === '%' || !u ? u : ' ' + u);
  }
  // 秒数写成文字：整小时写小时，其余写秒（60 → 60 秒，3600 → 1 小时）
  function secText(sec, lang) {
    var u = L(lang).ck.th.units, zh = normLang(lang) === 'zh';
    return sec >= 3600 && sec % 3600 === 0 ? sec / 3600 + ' ' + (zh ? u.h : sec === 3600 ? 'hour' : 'hours') : sec + ' ' + (zh ? u.s : sec === 1 ? 'second' : 'seconds');
  }
  function check(opts) {
    var o = dbaOpts(opts), out = [], m = M(), ck = m.ck, a = admin();
    if (!(opts && typeof opts === 'object' && opts.maxCol != null)) o.maxCol = 64;   // 建议和测到的值比较长，默认放宽
    var th;
    try { th = thEffective(o.thresholds); } catch (e) { fail(String(e.message).replace(/^mongotab: /, '')); }
    var thChanged = Object.keys(CHECK_TH).filter(function (k) { return th[k].join() !== CHECK_TH[k].d.join(); })
      .map(function (k) { return k + ' ' + thText(k, th[k], cfg.lang); });
    notMongos('mt.check()');
    var maxColls = o.maxColls == null ? 2000 : toNum(o.maxColls) || 0, budgetMs = o.budgetMs == null ? 60000 : toNum(o.budgetMs) || 0;   // 0 = 不限
    cmdLine(o, 'serverStatus, currentOp, replSetGetStatus, getLog, getParameter' + (o.quick ? '' : '; per collection (maxColls ' + maxColls + ', budgetMs ' + budgetMs + '): getIndexes, $collStats, $indexStats'), out);
    var rows = [], counts = {};
    var add = function (key, status, value, advice) { rows.push({ check: ck.names[key], status: status, value: value == null ? '' : String(value), advice: advice || '' }); };
    // 每一项单独 try：查不了只把这一项标成 UNKNOWN（不适用的是 SKIP），其他项照常
    var ckFail = function (key, e) { add(key, e && e.mtSkip ? 'SKIP' : 'UNKNOWN', errText(e).slice(0, 80), ''); };
    var na = function (msg) { var e = new Error(msg); e.mtSkip = true; throw e; };   // 这一项不适用
    // 逐库 / 逐集合的检查：没查全时，有发现照常报并附上覆盖情况；什么都没发现就是 UNKNOWN，不能说 OK
    // spec：kinds 依赖哪些种类的数据（见 missed），n 应该查几个，scope 只算哪些 ns 的失败，dbUnit 单位是库
    var newTrack = function () { return { bad: {}, limited: null }; };
    var withTrack = function (tk) { return Object.assign({}, o, { track: tk }); };
    var finish = function (key, tk, spec, status, value, advice) {
      var badNs = {}, sep = normLang(cfg.lang) === 'zh' ? '；' : '; ';
      for (var i = 0; i < spec.kinds.length; i++) {
        var k = spec.kinds[i];
        if (k === 'list') continue;
        var b = tk.bad[k] || {};
        for (var ks = Object.keys(b), j = 0; j < ks.length; j++) { var ns = ks[j]; if ((!spec.scope || spec.scope(ns)) && !(ns in badNs)) badNs[ns] = b[ns]; }
      }
      var bad = Object.keys(badNs), lb = tk.bad.list || {}, dbs = spec.kinds.indexOf('list') >= 0 ? Object.keys(lb) : [], notes = [];
      if (bad.length || dbs.length) notes.push(ck.partial(spec.n - bad.length, spec.n, bad.length, dbs.length, spec.dbUnit));
      if (tk.limited) notes.push(ck.limited(tk.limited.seen, tk.limited.total, tk.limited.why));
      if (!notes.length) return add(key, status, value, advice);
      var first = bad.length ? bad[0] + ': ' + badNs[bad[0]] : dbs.length ? dbs[0] + ': ' + lb[dbs[0]] : ck.adv.limited;
      if (status === 'OK') add(key, 'UNKNOWN', notes.join(sep), first.slice(0, 80));
      else add(key, status, value + sep + notes.join(sep), advice);
    };
    var level = function (v, warn, crit, higherWorse) {
      if (higherWorse === false) return v <= crit ? 'CRIT' : v <= warn ? 'WARN' : 'OK';
      return v >= crit ? 'CRIT' : v >= warn ? 'WARN' : 'OK';
    };
    var ss = runCmd(a, { serverStatus: 1 });
    var hello = helloDoc(a), isRs = !!hello.setName;
    var ops = attempt(runCmd, a, { currentOp: 1, $all: true }) || {};
    var inprog = ops.inprog || [];
    var needOps = function () { if (!Array.isArray(ops.inprog)) throw new Error(m.unauthorized('currentOp')); };   // currentOp 失败时，依赖它的几项标 UNKNOWN
    var r = ss.repl;
    headOut({ host: ss.host, version: ss.version,
      role: (!r ? 'standalone' : (r.ismaster || r.isWritablePrimary) ? 'PRIMARY' : r.secondary ? 'SECONDARY' : 'OTHER') + (r && r.setName ? ' (' + r.setName + ')' : ''),
      uptime: durText(ss.uptime) }, Object.assign({}, o, { cols: null, exclude: null }), out);

    try {
      var lines = runCmd(a, { getLog: 'startupWarnings' }).log || [], warns = [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var x = logLine(l);
        if (!x) continue;
        if (x.json ? /^[WEF]/.test(String(x.sev)) : /WARNING/.test(x.msg)) warns.push(x.msg.replace(/^\*+\s*WARNING:\s*/, ''));
      }
      add('startup', warns.length ? 'WARN' : 'OK', warns.length ? ck.n(warns.length) + (normLang(cfg.lang) === 'zh' ? '：' : ': ') + (warns[0].length > 60 ? warns[0].slice(0, 57) + '...' : warns[0]) : ck.none, warns.length ? 'mt.log({startup: true})' : '');
    } catch (e) { ckFail('startup', e); }
    try { needOps(); add('fsync', ops.fsyncLock ? 'CRIT' : 'OK', ops.fsyncLock ? ck.locked : ck.unlocked, ops.fsyncLock ? ck.adv.fsync : ''); } catch (e) { ckFail('fsync', e); }
    try {
      var p = runCmd(a, { getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion;
      var f = String(isDoc(p) ? p.version : p), v = String(ss.version).split('.').slice(0, 2).join('.');
      add('fcv', f === v ? 'OK' : 'WARN', ck.fcv(f, v), f === v ? '' : ck.adv.fcv);
    } catch (e) { ckFail('fcv', e); }
    if (isRs) {
      var st = attempt(runCmd, a, { replSetGetStatus: 1 });
      try {
        if (!st) throw new Error('replSetGetStatus');
        var bad = (st.members || []).filter(function (x) { return x.health !== 1 || !/^(PRIMARY|SECONDARY|ARBITER)$/.test(x.stateStr); })
          .map(function (x) { return x.name + ' (' + x.stateStr + ')'; });
        add('members', bad.length ? 'CRIT' : 'OK', ck.members((st.members || []).length, bad), 'mt.repl()');
      } catch (e) { ckFail('members', e); }
      try {
        if (!st) throw new Error('replSetGetStatus');
        var ms = st.members || [], opt = function (x) { return isDate(x.optimeDate) && x.optimeDate.getTime() > 0 ? x.optimeDate.getTime() : null; };
        var ref = null, worst = 0, who = '';
        for (var i = 0; i < ms.length; i++) { var x = ms[i]; if (x.state === 1 && opt(x)) ref = opt(x); }
        if (ref === null) ms.forEach(function (x) { if (opt(x) && (ref === null || opt(x) > ref)) ref = opt(x); });
        for (var j = 0; j < ms.length; j++) { var x2 = ms[j]; if (x2.state === 2 && opt(x2) !== null && ref - opt(x2) > worst) { worst = ref - opt(x2); who = x2.name; } }
        var secs = Math.round(worst / 1000);
        add('lag', level(secs, th.lag[0], th.lag[1]), durText(secs) + (who ? ' (' + who + ')' : ''), 'mt.repl()');
      } catch (e) { ckFail('lag', e); }
      try {
        var oc = curDb().getSiblingDB('local').getCollection('oplog.rs');
        var first = oc.find({}, { ts: 1 }).sort({ $natural: 1 }).limit(1).toArray()[0], last = oc.find({}, { ts: 1 }).sort({ $natural: -1 }).limit(1).toArray()[0];
        if (!first || !last) throw new Error(m.noOplog);
        var hours = (tsDate(last.ts).getTime() - tsDate(first.ts).getTime()) / 3600000;
        var lv = level(hours, th.oplog[0], th.oplog[1], false);
        add('oplog', lv, durText(hours * 3600) + ' (' + hours.toFixed(2) + ' h)', lv === 'OK' ? 'mt.oplog()' : ck.adv.oplog);
      } catch (e) { ckFail('oplog', e); }
    } else {
      for (var list = ['members', 'lag', 'oplog'], k2 = 0; k2 < list.length; k2++) { var k = list[k2]; add(k, 'SKIP', ck.notRs, ''); }
    }
    try {
      var wc = (ss.wiredTiger || {}).cache || {}, used = toNum(wc['bytes currently in the cache']), max = toNum(wc['maximum bytes configured']);
      if (!max) na(ck.noWt);
      add('cacheUsed', level(used / max * 100, th.cacheUsed[0], th.cacheUsed[1]), pctText(used, max) + ' (' + sizeText(used) + ' / ' + sizeText(max) + ')', 'mt.cache()');
    } catch (e) { ckFail('cacheUsed', e); }
    try {
      var wc = (ss.wiredTiger || {}).cache || {}, dirty = toNum(wc['tracked dirty bytes in the cache']), max = toNum(wc['maximum bytes configured']);
      if (!max) na(ck.noWt);
      add('cacheDirty', level(dirty / max * 100, th.cacheDirty[0], th.cacheDirty[1]), pctText(dirty, max) + ' (' + sizeText(dirty) + ')', 'mt.status()');
    } catch (e) { ckFail('cacheDirty', e); }
    var ct = (ss.wiredTiger || {}).concurrentTransactions;   // 7.0 起改成动态的，可能没有
    if (isDoc(ct) && isDoc(ct.read) && isDoc(ct.write) && toNum(ct.read.totalTickets)) {
      try {
        var rp = toNum(ct.read.out) / toNum(ct.read.totalTickets) * 100, wp = toNum(ct.write.out) / toNum(ct.write.totalTickets) * 100;
        add('tickets', level(Math.max(rp, wp), th.tickets[0], th.tickets[1]), 'read ' + toNum(ct.read.out) + '/' + toNum(ct.read.totalTickets) + ', write ' + toNum(ct.write.out) + '/' + toNum(ct.write.totalTickets), 'mt.ps()');
      } catch (e) { ckFail('tickets', e); }
    }
    try {
      var q = (ss.globalLock || {}).currentQueue || {}, n = (toNum(q.readers) || 0) + (toNum(q.writers) || 0);
      add('queue', level(n, th.queue[0], th.queue[1]), 'readers ' + (toNum(q.readers) || 0) + ', writers ' + (toNum(q.writers) || 0), 'mt.locks()');
    } catch (e) { ckFail('queue', e); }
    try {
      var c = ss.connections || {}, cur = toNum(c.current) || 0, all = cur + (toNum(c.available) || 0);
      add('conns', level(all ? cur / all * 100 : 0, th.conns[0], th.conns[1]), cur + ' / ' + all + ' (' + pctText(cur, all) + ')', 'mt.conns()');
    } catch (e) { ckFail('conns', e); }
    var clientOps = inprog.filter(function (op) {
      var c = op.command || {};
      return (op.client || op.client_s) && !isSelfOp(c) && !((c.hello || c.isMaster || c.ismaster) && c.maxAwaitTimeMS != null);
    });
    try {
      needOps();
      var long = clientOps.filter(function (op) { return op.active && toNum(op.secs_running) >= th.longOps[0]; });
      var max = long.reduce(function (mx, op) { return Math.max(mx, toNum(op.secs_running)); }, 0);
      add('longOps', long.length ? (max >= th.longOps[1] ? 'CRIT' : 'WARN') : 'OK', ck.longOps(long.length, durText(max), secText(th.longOps[0], cfg.lang)), long.length ? 'mt.ps({secs: ' + th.longOps[0] + '})' : '');
    } catch (e) { ckFail('longOps', e); }
    try {
      needOps();
      var n = clientOps.filter(function (op) { return op.waitingForLock; }).length;
      add('lockWait', n ? 'WARN' : 'OK', ck.count(n), n ? 'mt.locks()' : '');
    } catch (e) { ckFail('lockWait', e); }
    try {
      needOps();
      var seen = {}, long = [];
      for (var i = 0; i < inprog.length; i++) {
        var op = inprog[i];
        var t = op.transaction;
        if (!isDoc(t)) continue;
        var key = (op.lsid && op.lsid.id != null ? valText(op.lsid.id, true, o) : '') + '#' + valText((t.parameters || {}).txnNumber, true, o);
        var secs = (toNum(t.timeOpenMicros) || 0) / 1e6;
        if (!seen[key] && secs >= th.txns[0]) long.push(secs);
        seen[key] = true;
      }
      var max = long.reduce(function (mx, x) { return Math.max(mx, x); }, 0);
      add('txns', long.length ? 'WARN' : 'OK', ck.txns(long.length, durText(max), secText(th.txns[0], cfg.lang)), long.length ? 'mt.txns({secs: ' + th.txns[0] + '})' : '');
    } catch (e) { ckFail('txns', e); }
    try {
      needOps();
      var keys = {};
      for (var j = 0; j < inprog.length; j++) { var op = inprog[j]; if (/index build/i.test(String(op.msg || ''))) keys[buildNs(op) + '|' + pluck(((op.command || {}).indexes || []), 'name').join(',')] = true; }
      var n = Object.keys(keys).length;
      add('builds', n ? 'INFO' : 'OK', ck.count(n), n ? 'mt.builds()' : '');
    } catch (e) { ckFail('builds', e); }
    try {
      var on = runCmd(a, { getParameter: 1, ttlMonitorEnabled: 1 }).ttlMonitorEnabled;
      add('ttlMon', on === false ? 'WARN' : 'OK', on === false ? ck.stopped : ck.running, on === false ? ck.adv.ttlMon : '');
    } catch (e) { ckFail('ttlMon', e); }
    // 列不出库时，逐库的检查都是 UNKNOWN，不能当成“没有用户库”
    var dbsList = [], dbsErr = null;
    try { dbsList = userDbs({ d: null }); } catch (e) { dbsErr = errText(e); }
    var needDbs = function () { if (dbsErr !== null) throw new Error(dbsErr); };
    try {
      needDbs();
      var tk = newTrack(), to = withTrack(tk), l2 = [];
      dbsList.forEach(function (d) {
        var p = tracked(to, 'prof', d.getName(), function () {
          var r = unwrap(d.runCommand({ profile: -1 }));
          if (!r || !r.ok) throw new Error(r && r.errmsg || 'profile');
          return r;
        });
        if (p && p.was === 2) l2.push(d.getName());
      });
      finish('profiler', tk, { kinds: ['prof'], n: dbsList.length, dbUnit: true }, l2.length ? 'WARN' : 'OK', ck.level2(l2), l2.length ? ck.adv.profiler : '');
    } catch (e) { ckFail('profiler', e); }
    var scanNote = '';
    if (!o.quick) {
      // 逐个集合的四项共用一次遍历：每个集合 getIndexes、$collStats 各查一次，$indexStats 只在运行满 7 天时查；
      // 超过 maxColls 个集合或 budgetMs 毫秒就停下，没查到的算没查全
      var young = toNum(ss.uptime) < 7 * 86400, perColl = ['ttlOverdue', 'dupIdx', 'unusedIdx', 'frag'];
      var tk = newTrack(), to = withTrack(tk), cnt = { ttl: 0, idx: 0, all: 0 };
      var ttlRowsAll = [], addTtl = ttlAdder(ttlRowsAll), dup = [], unused = [], reuse = 0, fragTotal = 0, inv = null;
      try {
        needDbs();
        inv = inventory(dbsList, to);
        if (!young) to.shardKeys = shardKeyMap();
        var t0 = Date.now();
        for (var i = 0; i < inv.length; i++) {
          var why = maxColls && i >= maxColls ? 'maxColls ' + maxColls : budgetMs && Date.now() - t0 > budgetMs ? 'budgetMs ' + budgetMs : '';
          if (why) { tk.limited = { seen: i, total: inv.length, why: why }; break; }
          var cc = collCtx(inv[i], to);
          cnt.all++;
          if (ttlScope(cc)) { cnt.ttl++; ttlRows(cc, addTtl, to); }
          if (idxScope(cc)) {
            cnt.idx++;
            dupRows(cc, dup, to);
            if (!young) unusedRows(cc, unused, to);
          }
          var w = cc.wt();
          if (w) { reuse += w.reuse + w.idxReuse; fragTotal += w.storage + w.idxSize; }
        }
        scanNote = ' ' + ck.scanned(cnt.all, inv.length);
      } catch (e) {
        for (var i2 = 0; i2 < perColl.length; i2++) {
          var k3 = perColl[i2];
          if (k3 === 'unusedIdx' && young) add(k3, 'INFO', ck.young(durText(ss.uptime)), 'mt.unusedIdx()');
          else add(k3, 'UNKNOWN', errText(e).slice(0, 80), '');
        }
        inv = null;
      }
      if (inv) {
        var notSys = function (ns) { return !/^[^.]*\.system\./.test(ns); };
        try {
          var od = ttlRowsAll.filter(function (x) { return x.overdueSecs !== '' && x.overdueSecs > th.ttlOverdue[0]; });
          var max = od.reduce(function (mx, x) { return Math.max(mx, x.overdueSecs); }, 0);
          finish('ttlOverdue', tk, { kinds: ['list', 'ix', 'ttl'], n: cnt.ttl }, od.length ? 'WARN' : 'OK', ck.ttlOverdue(od.length, durText(max), secText(th.ttlOverdue[0], cfg.lang)), od.length ? 'mt.ttl()' : '');
        } catch (e) { ckFail('ttlOverdue', e); }
        try {
          var bytes = dup.reduce(function (s0, x) { return s0 + x.w; }, 0);
          finish('dupIdx', tk, { kinds: ['list', 'ix'], n: cnt.idx, scope: notSys }, dup.length ? 'WARN' : 'OK', dup.length ? ck.sizeOf(dup.length, sizeText(bytes)) : ck.none, dup.length ? 'mt.dupIdx()' : '');
        } catch (e) { ckFail('dupIdx', e); }
        try {
          if (young) add('unusedIdx', 'INFO', ck.young(durText(ss.uptime)), 'mt.unusedIdx()');
          else {
            // unique / ttl 在干活，分片键索引删不掉，计数不满 7 天的还说不准：都不算
            var cand = unused.filter(function (x) { return !x.ix.unique && x.ix.expireAfterSeconds == null && !x.shard; });
            var u = cand.filter(function (x) { return !x.young; }), yn = cand.length - u.length;
            var ubytes = u.reduce(function (s0, x) { return s0 + x.w; }, 0);
            finish('unusedIdx', tk, { kinds: ['list', 'ix', 'use'], n: cnt.idx, scope: notSys }, u.length ? 'WARN' : 'OK',
              u.length ? ck.sizeOf(u.length, sizeText(ubytes)) : yn ? ck.unusedYoung(yn) : ck.none, u.length ? ck.adv.unused(verAtLeast(ss.version, 4, 4)) : '');
          }
        } catch (e) { ckFail('unusedIdx', e); }
        try {
          var bad = fragTotal > 0 && reuse / fragTotal * 100 > th.frag[0] && reuse > th.fragMinGB[0] * 1073741824;
          finish('frag', tk, { kinds: ['list', 'cs'], n: cnt.all }, bad ? 'WARN' : 'OK', ck.frag(sizeText(reuse), sizeText(fragTotal), pctText(reuse, fragTotal)), bad ? ck.adv.frag : '');
        } catch (e) { ckFail('frag', e); }
      }
    }
    for (var n2 = 0; n2 < rows.length; n2++) { var x = rows[n2]; counts[x.status] = (counts[x.status] || 0) + 1; }
    var shown = o.issues ? rows.filter(function (x) { return x.status === 'WARN' || x.status === 'CRIT' || x.status === 'UNKNOWN'; }) : rows;
    if (shown.length) {
      renderRows(shown, o, out, false, shown.length);
      out.pop();   // 去掉 "N rows in set"
    } else out.push(ck.noIssue);
    if (thChanged.length) out.push(ck.th.custom(thChanged));
    for (var stList = [], stOrder = ['CRIT', 'WARN', 'UNKNOWN', 'OK', 'INFO', 'SKIP'], si = 0; si < stOrder.length; si++) if (counts[stOrder[si]]) stList.push(stOrder[si] + ' ' + counts[stOrder[si]]);
    out.push(ck.summary(stList) + (o.quick ? ' ' + ck.quick : scanNote));
    emit(out);
  }

  // 每个命令的详细帮助（mt.help('ps')）：t 标题，u 用法，o 选项，c 输出，n 说明，s 相关命令
  var HELP_DOC = {"host": {"mysql": "SHOW VARIABLES LIKE 'version%'", "zh": {"t": "机器和进程信息", "u": [["mt.host()", "机器、操作系统、mongod、启动参数"], ["mt.host({all: true})", "再加上全部启动参数（parsed.*）"], ["mt.host('host,os')", "只看某几组；也可以 {cols: 'mongod.version,startup.*'}"]], "o": [["all", "true：列出 getCmdLineOpts 的全部 parsed 参数"]], "c": [["host.*", "hostname、platform（容器 / 虚拟机 / 物理机，带判断依据）、cpuArch、cpuCores、cpuAvailable（容器限制了 CPU 时）、physicalCores、cpuSockets、memory、memLimit（容器限制和内存不同时）、numa、numaNodes、time"], ["os.*", "type、name、version、kernel、libc、maxOpenFiles（低于 64000 会提示）"], ["mongod.*", "version、edition、gitVersion、allocator、jsEngine、openssl、fcv、storageEngine、process、pid、uptime、cacheMax（超过可用内存 80% 时提示）"], ["startup.*", "argv、config、dbPath、port、bindIp、replSet、oplogSizeMB、authorization、keyFile、logPath、cacheSizeGB（没设的不显示）"]], "n": ["hostInfo + buildInfo + getCmdLineOpts + serverStatus，需要 clusterMonitor 之类的权限", "platform 是推断的：容器看内存 / CPU 限制和 mongod 是不是 1 号进程；虚拟机看 CPU 标志 hypervisor（x86）和内核名（-aws、-azure、-gcp、orbstack...）；都没有迹象时，多路 CPU 或多个 NUMA 节点显示为“可能是物理机”，否则是“物理机或无法判断”", "容器里看到的 CPU 和内存通常是宿主机的，memLimit / cpuAvailable 才是容器的限制；4.4 之前看不到容器的内存限制，缓存会按宿主机内存算", "物理机多 NUMA 节点时用 numactl --interleave=all 启动；虚拟机上的 CPU 争抢、内存气球在 mongod 里看不到，要看虚拟化平台的监控"], "s": ["status", "check", "vars"]}, "en": {"t": "machine and process information", "u": [["mt.host()", "machine, OS, mongod, startup options"], ["mt.host({all: true})", "plus every startup option (parsed.*)"], ["mt.host('host,os')", "only some groups; or {cols: 'mongod.version,startup.*'}"]], "o": [["all", "true: every parsed option from getCmdLineOpts"]], "c": [["host.*", "hostname, platform (container / virtual machine / physical, with the clues), cpuArch, cpuCores, cpuAvailable (when a container limits CPUs), physicalCores, cpuSockets, memory, memLimit (when a container limit differs), numa, numaNodes, time"], ["os.*", "type, name, version, kernel, libc, maxOpenFiles (flagged below 64000)"], ["mongod.*", "version, edition, gitVersion, allocator, jsEngine, openssl, fcv, storageEngine, process, pid, uptime, cacheMax (flagged above 80% of available memory)"], ["startup.*", "argv, config, dbPath, port, bindIp, replSet, oplogSizeMB, authorization, keyFile, logPath, cacheSizeGB (unset ones are hidden)"]], "n": ["hostInfo + buildInfo + getCmdLineOpts + serverStatus; needs privileges such as clusterMonitor", "platform is inferred: container from memory / CPU limits and mongod being pid 1; virtual machine from the hypervisor CPU flag (x86) and the kernel name (-aws, -azure, -gcp, orbstack...); with no clues, several sockets or NUMA nodes show as 'probably physical', otherwise 'physical or unknown'", "Inside a container, CPU and memory are usually the host's; memLimit / cpuAvailable are the container's limits. Before 4.4 the container memory limit is not visible and the cache is sized from host memory", "On physical machines with several NUMA nodes start mongod with numactl --interleave=all; CPU steal and memory ballooning on VMs are not visible from mongod, so check the hypervisor's monitoring"], "s": ["status", "check", "vars"]}}, "vars": {"mysql": "SHOW VARIABLES", "zh": {"t": "运行参数", "u": [["mt.vars()", "全部参数，按名字排"], ["mt.vars('ttl')", "名字里含 ttl 的（不分大小写）"], ["mt.vars('wiredTiger*')", "通配符：* 任意多个字符，? 一个字符"], ["mt.vars(/^ttl|^diag/i)", "正则"], ["mt.vars({limit: 0})", "全部列出，不只前 50 行"]], "o": [["pattern", "第一个参数：关键字、通配符或正则，过滤参数名"]], "c": [["name", "参数名，setParameter 时用"], ["value", "当前值；文档写成一行"], ["runtime", "true：可以在运行时用 db.adminCommand({setParameter: 1, 名字: 值}) 改；false：只能启动时设（4.2 起才有这一列）"]], "n": ["执行的是 getParameter；4.2 起加 showDetails，多出 runtime 一列", "参数很多（7.0 有 600 多个），默认只显示前 50 行，用关键字过滤，或者 {limit: 0} 全部列出", "启动时的配置文件和命令行参数用 mt.host({all: true}) 看"], "s": ["host", "status"]}, "en": {"t": "runtime parameters", "u": [["mt.vars()", "every parameter, by name"], ["mt.vars('ttl')", "names containing ttl (case-insensitive)"], ["mt.vars('wiredTiger*')", "wildcards: * any characters, ? one character"], ["mt.vars(/^ttl|^diag/i)", "a regex"], ["mt.vars({limit: 0})", "list them all, not just the first 50"]], "o": [["pattern", "first argument: text, a wildcard or a regex to filter names"]], "c": [["name", "parameter name, as used by setParameter"], ["value", "current value; documents on one line"], ["runtime", "true: can be changed at runtime with db.adminCommand({setParameter: 1, name: value}); false: startup only (4.2+ only)"]], "n": ["Runs getParameter; on 4.2+ with showDetails, which adds the runtime column", "There are many parameters (600+ on 7.0), so only the first 50 rows show by default; filter by name, or pass {limit: 0} for all", "For the config file and command line options it started with, use mt.host({all: true})"], "s": ["host", "status"]}}, "latency": {"mysql": "sys.statement_analysis", "zh": {"t": "读写延迟", "u": [["mt.latency()", "间隔 1 秒采样两次：整台和各集合的平均延迟"], ["mt.latency('shop')", "只看一个库"], ["mt.latency({interval: 0})", "只取一次，启动以来的平均值"], ["mt.latency({interval: 5})", "间隔 5 秒"]], "o": [["interval", "采样间隔秒数，默认 1；0 = 启动以来"]], "c": [["表头", "reads / writes / commands / transactions 的 avgMs（平均延迟）和 ops/s（采样时）或 ops（累计时）"], ["ns", "库.集合"], ["readOps / readMs", "读的次数、平均延迟（毫秒）"], ["writeOps / writeMs", "写的次数、平均延迟"], ["cmdOps / cmdMs", "其他命令（如 aggregate、count）的次数、平均延迟"], ["totalMs", "这段时间里花的总时间，按它排"]], "n": ["整台来自 serverStatus().opLatencies，各集合来自 $collStats 的 latencyStats", "延迟是 mongod 处理请求的时间，不含网络", "这段时间里没有操作的集合不显示；默认跳过 admin、local、config", "mt.top() 看总耗时，mt.latency() 看平均每次多慢"], "s": ["top", "slow", "status"]}, "en": {"t": "read / write latency", "u": [["mt.latency()", "two samples 1 second apart: average latency, server-wide and per collection"], ["mt.latency('shop')", "one database"], ["mt.latency({interval: 0})", "one sample: averages since startup"], ["mt.latency({interval: 5})", "5 seconds apart"]], "o": [["interval", "seconds between samples, 1 by default; 0 = since startup"]], "c": [["header", "avgMs (average latency) and ops/s (sampled) or ops (totals) of reads / writes / commands / transactions"], ["ns", "database.collection"], ["readOps / readMs", "reads and their average latency (ms)"], ["writeOps / writeMs", "writes and their average latency"], ["cmdOps / cmdMs", "other commands (aggregate, count...) and their average latency"], ["totalMs", "total time spent in the interval; rows are sorted by it"]], "n": ["Server-wide from serverStatus().opLatencies, per collection from $collStats latencyStats", "Latency is mongod's processing time, without the network", "Collections with no operations in the interval are hidden; admin, local and config are skipped by default", "mt.top() shows total time, mt.latency() how slow each operation is on average"], "s": ["top", "slow", "status"]}}, "desc": {"mysql": "DESC t", "zh": {"t": "集合的字段结构", "u": [["mt.desc('orders')", "抽样 1000 条，列出每个字段"], ["mt.desc('shop.orders', {sample: 10000})", "多抽一些，少见的字段也能看到"], ["mt.desc(db.orders, {depth: 1})", "只看第一层字段"]], "o": [["sample", "抽样条数，默认 1000"], ["depth", "嵌套文档往下看几层"]], "c": [["表头", "ns、type（collection / view / timeseries / capped / clustered）、count、sampled、validator、collation、indexes"], ["field", "字段路径；文档数组里的字段写成 items.sku"], ["types", "类型，多种时带占比；数组写成 array<元素类型>"], ["present", "多少比例的抽样文档有这个字段"], ["example", "示例值"]], "n": ["用 $sample 随机抽样，少见的字段可能抽不到，调大 sample", "抽样条数超过集合的 5% 时，$sample 会扫描整个集合再排序，大集合上别设太大", "number 是 int 和 double（shell 里分不出来），long、decimal 单独列出"], "s": ["idx", "colls"]}, "en": {"t": "field structure of a collection", "u": [["mt.desc('orders')", "sample 1000 documents and list every field"], ["mt.desc('shop.orders', {sample: 10000})", "sample more to catch rare fields"], ["mt.desc(db.orders, {depth: 1})", "top-level fields only"]], "o": [["sample", "documents to sample, 1000 by default"], ["depth", "how many levels of nested documents to look into"]], "c": [["header", "ns, type (collection / view / timeseries / capped / clustered), count, sampled, validator, collation, indexes"], ["field", "field path; fields in arrays of documents as items.sku"], ["types", "types, with shares when there are several; arrays as array<element types>"], ["present", "share of sampled documents with the field"], ["example", "an example value"]], "n": ["Uses $sample, so rare fields may be missed; raise sample", "When sample exceeds 5% of the collection, $sample scans and sorts the whole collection; keep it modest on big collections", "number covers int and double (the shell cannot tell them apart); long and decimal are listed separately"], "s": ["idx", "colls"]}}, "planCache": {"mysql": "performance_schema digests", "zh": {"t": "计划缓存", "u": [["mt.planCache('orders')", "每种查询形状缓存的计划"], ["mt.planCache('orders', {hash: 'AF0F05C1'})", "按 queryHash 或 planCacheKey 找，可以拿 mt.explainLog() 里的 queryHash"]], "o": [["hash", "queryHash（8.0 叫 planCacheShapeHash）或 planCacheKey"]], "c": [["hash / planCacheKey", "查询形状的哈希、计划缓存的键"], ["active", "是否生效；不生效的还在试用期"], ["works", "评估这个计划时的工作量，越小越好"], ["shape", "查询形状：条件、sort、proj"], ["plan", "缓存的计划用了什么扫描，如 IXSCAN { status: 1 }；SBE 计划只显示 (SBE 计划)"], ["created", "缓存的时间"]], "n": ["4.2 起用 $planCacheStats；3.6 / 4.0 用 planCacheListQueryShapes / planCacheListPlans，没有 hash 等列", "计划缓存在内存里，每个节点各自一份，重启、建删索引后清空；只有多个候选计划时才会缓存", "线上选错索引时，先看这里缓存的计划；清掉缓存：db.orders.getPlanCache().clear()（会影响正在用的查询，慎用）"], "s": ["explainLog", "explain", "idx"]}, "en": {"t": "plan cache", "u": [["mt.planCache('orders')", "the cached plan per query shape"], ["mt.planCache('orders', {hash: 'AF0F05C1'})", "by queryHash or planCacheKey, e.g. the queryHash from mt.explainLog()"]], "o": [["hash", "queryHash (planCacheShapeHash in 8.0) or planCacheKey"]], "c": [["hash / planCacheKey", "query shape hash, plan cache key"], ["active", "whether it is active; inactive entries are still on probation"], ["works", "work done evaluating the plan; lower is better"], ["shape", "query shape: filter, sort, proj"], ["plan", "scans the cached plan uses, e.g. IXSCAN { status: 1 }; SBE plans show (SBE plan)"], ["created", "when it was cached"]], "n": ["$planCacheStats since 4.2; 3.6 / 4.0 use planCacheListQueryShapes / planCacheListPlans, without hash and similar columns", "The plan cache is in memory, per node, and cleared on restart and index changes; only queries with several candidate plans are cached", "When production picks the wrong index, check the cached plan here; to clear it: db.orders.getPlanCache().clear() (affects running queries; use with care)"], "s": ["explainLog", "explain", "idx"]}}, "check": {"mysql": "mysqltuner / pt-summary", "zh": {"t": "一键体检", "u": [["mt.check()", "全部检查"], ["mt.check({issues: true})", "只看 WARN / CRIT / UNKNOWN"], ["mt.check({quick: true})", "跳过逐个集合的检查（索引、TTL、磁盘空间），集合很多时用"], ["mt.check({maxColls: 5000, budgetMs: 120000})", "逐个集合的检查最多查 5000 个集合、2 分钟"], ["mt.check({thresholds: {lag: [30, 300], oplog: [48, 6]}})", "这一次用别的阈值"], ["mt.config({checkThresholds: {longOps: [600, 3600]}})", "改本会话的默认阈值"]], "o": [["quick", "true：不扫每个集合"], ["issues", "true：只显示有问题和没查全的项"], ["maxColls", "逐个集合的检查最多查几个集合，默认 2000，0 = 不限"], ["budgetMs", "逐个集合的检查最多花多少毫秒，默认 60000，0 = 不限"], ["thresholds", "这一次的阈值，如 {lag: [30, 300]}；键和默认值见下面的阈值表"]], "c": [["表头", "host、version、role、uptime"], ["check / status", "检查项、OK / WARN / CRIT / UNKNOWN / INFO / SKIP"], ["value", "测到的值"], ["advice", "建议，或者进一步看的 mt 命令"], ["最后一行", "各状态的个数；逐个集合的检查查了几个集合"]], "n": ["启动警告（有 W/E 就 WARN）、fsyncLock（CRIT）、FCV 低于二进制版本（WARN）", "副本集：成员不是 PRIMARY / SECONDARY / ARBITER 或 health 不是 1（CRIT）；复制延迟 ≥10 秒 WARN、≥60 秒 CRIT；oplog 窗口 <24 小时 WARN、<3 小时 CRIT", "缓存使用率 ≥90% WARN、≥95% CRIT；脏数据 ≥10% WARN、≥20% CRIT；读写票据用掉 ≥80% WARN、≥95% CRIT（7.0 之前）", "等锁队列 ≥5 WARN、≥50 CRIT；连接数 ≥80% WARN、≥95% CRIT；运行超过 60 秒的操作 WARN（超过 600 秒 CRIT）；等锁的操作、开了 30 秒以上的事务 WARN", "TTL 线程停了、有库是 profiler level 2：WARN；正在建索引：INFO", "逐个集合：TTL 超期 1 小时以上、冗余索引、没被用过的索引（运行满 7 天才判断，不算 unique / ttl / 分片键，计数不满 7 天的也不算）、可回收空间超过 30% 且超过 1 GB：WARN", "上面的数字是默认阈值。mt.check({thresholds: {...}}) 只改这一次；mt.config({checkThresholds: {...}}) 改本会话默认值，按键合并，某个键给 null 恢复默认，checkThresholds: null 全部恢复；改过的阈值列在结果最后。值不对（键名、个数、顺序、百分比超过 100）时直接报错，不跑检查", "某一项查不了（比如没有权限）只把这一项标成 UNKNOWN，写上原因；逐库 / 逐集合的检查有一部分失败时，没发现问题也不报 OK，而是 UNKNOWN 加上“查了 40/42 个集合，2 个失败”；有发现时照常 WARN，并附上覆盖情况", "逐个集合的四项共用一次遍历：每个集合一次 getIndexes、一次 $collStats，运行满 7 天才查 $indexStats；超过 maxColls / budgetMs 就停下，没发现问题时是 UNKNOWN（只查了前 N/M 个集合），有发现时照常 WARN", "SKIP 只表示不适用：单机上副本集相关的几项、不是 WiredTiger 时的缓存两项；只能连 mongod"], "s": ["status", "repl", "cache", "dupIdx", "unusedIdx"]}, "en": {"t": "health check", "u": [["mt.check()", "every check"], ["mt.check({issues: true})", "only WARN / CRIT / UNKNOWN"], ["mt.check({quick: true})", "skip per-collection checks (indexes, TTL, disk space); for many collections"], ["mt.check({maxColls: 5000, budgetMs: 120000})", "per-collection checks stop after 5000 collections or 2 minutes"], ["mt.check({thresholds: {lag: [30, 300], oplog: [48, 6]}})", "other thresholds for this run"], ["mt.config({checkThresholds: {longOps: [600, 3600]}})", "change the session's default thresholds"]], "o": [["quick", "true: do not scan every collection"], ["issues", "true: show only problems and incomplete checks"], ["maxColls", "most collections the per-collection checks look at, default 2000, 0 = no limit"], ["budgetMs", "most milliseconds the per-collection checks spend, default 60000, 0 = no limit"], ["thresholds", "thresholds for this run, e.g. {lag: [30, 300]}; keys and defaults in the table below"]], "c": [["header", "host, version, role, uptime"], ["check / status", "check, OK / WARN / CRIT / UNKNOWN / INFO / SKIP"], ["value", "what was measured"], ["advice", "advice, or the mt command to look closer"], ["last line", "count per status; how many collections the per-collection checks covered"]], "n": ["Startup warnings (any W/E: WARN), fsyncLock (CRIT), FCV below the binary version (WARN)", "Replica set: a member not PRIMARY / SECONDARY / ARBITER or with health != 1 (CRIT); lag >= 10 s WARN, >= 60 s CRIT; oplog window < 24 h WARN, < 3 h CRIT", "Cache used >= 90% WARN, >= 95% CRIT; dirty >= 10% WARN, >= 20% CRIT; read/write tickets >= 80% in use WARN, >= 95% CRIT (before 7.0)", "Lock queue >= 5 WARN, >= 50 CRIT; connections >= 80% WARN, >= 95% CRIT; operations over 60 s WARN (over 600 s CRIT); lock waits and transactions open 30+ s WARN", "TTL thread stopped or a database at profiler level 2: WARN; index builds in progress: INFO", "Per collection: TTL overdue by over 1 hour, redundant indexes, unused indexes (only after 7 days of uptime, not unique / ttl / shard key, nor indexes counted for under 7 days), reusable space over 30% and over 1 GB: WARN", "The numbers above are defaults. mt.check({thresholds: {...}}) changes them for one run; mt.config({checkThresholds: {...}}) changes the session defaults, merged by key, a key set to null goes back to its default and checkThresholds: null resets all; changed thresholds are listed at the end of the output. Bad values (key name, count, order, a percentage over 100) are an error and no check runs", "A check that cannot run (e.g. no privilege) becomes UNKNOWN on its own, with the reason; when part of a per-database / per-collection check fails, it is UNKNOWN with \"40/42 collections checked, 2 failed\" instead of OK, or WARN with that note if it found problems", "The four per-collection checks share one pass: one getIndexes and one $collStats per collection, $indexStats only after 7 days of uptime; past maxColls / budgetMs the pass stops, and checks that found nothing are UNKNOWN (only the first N/M collections checked), those that found problems stay WARN", "SKIP only means not applicable: replica set checks on a standalone, the two cache checks when the engine is not WiredTiger; must run on a mongod"], "s": ["status", "repl", "cache", "dupIdx", "unusedIdx"]}}, "ps": {"mysql": "SHOW PROCESSLIST", "zh": {"t": "正在执行的操作", "u": [["mt.ps()", "运行最久的在前"], ["mt.ps({secs: 5})", "只看运行超过 5 秒的"], ["mt.ps({ns: 'shop.orders'})", "只看某个集合；'shop' 匹配整个库"], ["mt.ps({all: true})", "包括空闲连接和内部线程"], ["mt.ps({sort: 'opid'})", "排序：'desc'（默认）、'asc'、'opid'，或 {ns: 1, secs: -1}"]], "o": [["secs", "只看运行超过这么多秒的"], ["ns", "库或 库.集合"], ["all", "true：用 $all，包括空闲连接和内部线程"], ["sort", "'desc' / 'asc' / 'opid' / 按列名的排序文档"]], "c": [["opid", "操作 ID，db.killOp(opid) 用它"], ["secs", "已经运行的秒数"], ["op", "query / getmore / insert / update / remove / command；空闲连接是 idle"], ["ns", "库.集合"], ["client / app", "客户端、appName"], ["lock", "在等锁时显示 WAIT"], ["plan", "计划摘要，COLLSCAN 是全表扫描"], ["command", "命令，去掉了驱动加的字段"]], "n": ["执行的是 db.adminCommand({currentOp: 1, active: true})", "默认不显示空闲连接、内部线程、驱动的心跳长轮询和 mt.ps() 自己"], "s": ["locks", "txns", "conns"]}, "en": {"t": "running operations", "u": [["mt.ps()", "longest running first"], ["mt.ps({secs: 5})", "only those running for 5+ seconds"], ["mt.ps({ns: 'shop.orders'})", "one collection; 'shop' matches the whole database"], ["mt.ps({all: true})", "include idle connections and internal threads"], ["mt.ps({sort: 'opid'})", "sort: 'desc' (default), 'asc', 'opid', or {ns: 1, secs: -1}"]], "o": [["secs", "only operations running at least this many seconds"], ["ns", "database or database.collection"], ["all", "true: use $all, including idle connections and internal threads"], ["sort", "'desc' / 'asc' / 'opid' / a sort document on column names"]], "c": [["opid", "operation ID, used by db.killOp(opid)"], ["secs", "seconds running"], ["op", "query / getmore / insert / update / remove / command; idle for idle connections"], ["ns", "database.collection"], ["client / app", "client, appName"], ["lock", "WAIT while waiting for a lock"], ["plan", "plan summary; COLLSCAN is a full scan"], ["command", "the command, without driver fields"]], "n": ["Runs db.adminCommand({currentOp: 1, active: true})", "Hidden by default: idle connections, internal threads, drivers' awaitable hello and mt.ps() itself"], "s": ["locks", "txns", "conns"]}}, "slow": {"mysql": "mysql.slow_log", "zh": {"t": "慢查询（profiler）", "u": [["mt.slow()", "当前库，最新的在前"], ["mt.slow('shop')", "指定库，也可以传 db 对象"], ["mt.slow({ms: 500, ns: 'orders'})", "超过 500 毫秒的、orders 集合的"], ["mt.slow({sort: 'ms'})", "最慢的在前；'asc' 最早的在前，或排序文档"], ["mt.explainLog(1)", "对第 1 行做 explain；mt.logQuery(1) 转成查询语句"]], "o": [["ms", "只看耗时不少于这么多毫秒的"], ["ns", "集合名或 库.集合"], ["sort", "'desc'（默认，最新的在前）/ 'asc' / 'ms'（最慢的在前）/ 排序文档"]], "c": [["#", "行号，mt.explainLog(n) / mt.logQuery(n) 用它"], ["ts / ms", "结束时间、耗时（毫秒）"], ["op / ns / plan", "操作类型、库.集合、计划摘要"], ["keysExamined / docsExamined", "扫了多少索引键、多少文档"], ["nreturned", "返回多少条"], ["client / user", "客户端、用户（没开认证时不显示 user）"], ["command", "命令"]], "n": ["读的是 system.profile，不改 profiler 设置", "profiler 默认关闭，每个库单独打开：db.setProfilingLevel(1, {slowms: 100})", "system.profile 是 1 MB 的 capped 集合，只有最近一段时间的"], "s": ["explainLog", "logQuery", "log"]}, "en": {"t": "slow queries (profiler)", "u": [["mt.slow()", "current database, newest first"], ["mt.slow('shop')", "another database; a db object works too"], ["mt.slow({ms: 500, ns: 'orders'})", "500 ms or more, orders collection only"], ["mt.slow({sort: 'ms'})", "slowest first; 'asc' oldest first, or a sort document"], ["mt.explainLog(1)", "explain row 1; mt.logQuery(1) turns it into a statement"]], "o": [["ms", "only operations that took at least this many milliseconds"], ["ns", "collection name or database.collection"], ["sort", "'desc' (default, newest first) / 'asc' / 'ms' (slowest first) / a sort document"]], "c": [["#", "row number, used by mt.explainLog(n) / mt.logQuery(n)"], ["ts / ms", "when it finished, duration (ms)"], ["op / ns / plan", "operation, database.collection, plan summary"], ["keysExamined / docsExamined", "index keys and documents scanned"], ["nreturned", "documents returned"], ["client / user", "client, user (user hidden without authentication)"], ["command", "the command"]], "n": ["Reads system.profile; never changes profiler settings", "The profiler is off by default; turn it on per database: db.setProfilingLevel(1, {slowms: 100})", "system.profile is a 1 MB capped collection, so it only covers recent activity"], "s": ["explainLog", "logQuery", "log"]}}, "top": {"mysql": "sys.schema_table_statistics", "zh": {"t": "各集合读写耗时（类似 mongotop）", "u": [["mt.top()", "间隔 1 秒采样两次，看这 1 秒内的耗时"], ["mt.top({interval: 5})", "间隔 5 秒"], ["mt.top({interval: 0})", "只取一次，看启动以来的累计值"], ["mt.top({ns: 'shop'})", "只看一个库；'shop.orders' 只看一个集合"]], "o": [["interval", "采样间隔秒数，默认 1；0 = 启动以来累计"], ["ns", "库或 库.集合"]], "c": [["ns", "库.集合"], ["totalMs", "这段时间里所有操作的耗时（毫秒）"], ["readMs / writeMs", "其中读锁、写锁的耗时"], ["ops", "操作次数"]], "n": ["执行的是 db.adminCommand({top: 1})，两次相减", "操作结束时才记时间，还在跑的长查询看 mt.ps()", "只能连 mongod"], "s": ["ps", "status"]}, "en": {"t": "time per collection (like mongotop)", "u": [["mt.top()", "two samples 1 second apart: time spent in that second"], ["mt.top({interval: 5})", "5 seconds apart"], ["mt.top({interval: 0})", "one sample: totals since startup"], ["mt.top({ns: 'shop'})", "one database; 'shop.orders' for one collection"]], "o": [["interval", "seconds between samples, 1 by default; 0 = totals since startup"], ["ns", "database or database.collection"]], "c": [["ns", "database.collection"], ["totalMs", "time spent by all operations in the interval (ms)"], ["readMs / writeMs", "of which under read / write locks"], ["ops", "number of operations"]], "n": ["Runs db.adminCommand({top: 1}) and subtracts two samples", "Time is recorded when an operation finishes; use mt.ps() for long ones still running", "Must run on a mongod"], "s": ["ps", "status"]}}, "locks": {"mysql": "sys.innodb_lock_waits", "zh": {"t": "谁在等锁、锁被谁占着", "u": [["mt.locks()", "有人排队的锁，以及挡住它们的持有者"], ["mt.locks({all: true})", "所有被占用的锁，包括没人排队的"]], "o": [["all", "true：列出所有被占用的锁"]], "c": [["resource", "锁资源，如 Collection shop.orders；全局锁显示 Global 3 这样的编号"], ["mode", "IS / IX 意向共享 / 意向排他，S 共享，X 排他"], ["state", "HOLD 占着，WAIT 在排队"], ["opid / secs", "操作 ID、已运行秒数"], ["client / desc", "客户端、连接名或内部线程名"], ["op / ns / command", "操作类型、库.集合、命令"]], "n": ["用 lockInfo 拿持有者和排队者，按 opid 关联 currentOp", "默认只列和排队者冲突的持有者", "普通读写之间的冲突是 WriteConflict 重试，不是等锁", "只能连 mongod"], "s": ["ps", "txns"]}, "en": {"t": "lock waits", "u": [["mt.locks()", "locks with waiters, and the holders blocking them"], ["mt.locks({all: true})", "every lock that is held, waiters or not"]], "o": [["all", "true: every lock that is held"]], "c": [["resource", "lock resource, e.g. Collection shop.orders; global locks show as a number such as Global 3"], ["mode", "IS / IX intent shared / intent exclusive, S shared, X exclusive"], ["state", "HOLD holds it, WAIT is queued"], ["opid / secs", "operation ID, seconds running"], ["client / desc", "client, connection or internal thread name"], ["op / ns / command", "operation, database.collection, command"]], "n": ["Uses lockInfo for holders and waiters, joined with currentOp by opid", "By default only holders that conflict with a waiter are listed", "Conflicts between ordinary reads and writes are retried (WriteConflict), not lock waits", "Must run on a mongod"], "s": ["ps", "txns"]}}, "txns": {"mysql": "INFORMATION_SCHEMA.INNODB_TRX", "zh": {"t": "未提交的事务", "u": [["mt.txns()", "开得最久的在前"], ["mt.txns({secs: 10})", "只看开了 10 秒以上的"], ["mt.txns({sort: 'asc'})", "最短的在前；也可以给排序文档"]], "o": [["secs", "只看开了这么多秒以上的"], ["sort", "'desc'（默认）/ 'asc' / 排序文档"]], "c": [["lsid / txnNumber", "会话 ID、会话里的事务编号"], ["state", "active 正在执行语句，idle 两条语句之间空闲"], ["openSecs", "已经开了多久"], ["activeSecs / idleSecs", "其中执行、空闲的时间"], ["start", "开始时间"], ["expiresIn", "再过多少秒自动中止（默认 60 秒）"], ["opid / ns", "执行中时的操作 ID、库.集合"], ["client / app", "客户端、appName"]], "n": ["4.0 起才有事务", "立刻结束一个事务：db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})", "idleSecs 很大的，通常是应用忘了 commit / abort"], "s": ["ps", "locks"]}, "en": {"t": "open transactions", "u": [["mt.txns()", "open longest first"], ["mt.txns({secs: 10})", "only those open for 10+ seconds"], ["mt.txns({sort: 'asc'})", "shortest first; or a sort document"]], "o": [["secs", "only transactions open at least this many seconds"], ["sort", "'desc' (default) / 'asc' / a sort document"]], "c": [["lsid / txnNumber", "session ID, transaction number in the session"], ["state", "active running a statement, idle between statements"], ["openSecs", "how long it has been open"], ["activeSecs / idleSecs", "of which running / idle"], ["start", "when it started"], ["expiresIn", "seconds until it is aborted automatically (60 by default)"], ["opid / ns", "operation ID and database.collection while running"], ["client / app", "client, appName"]], "n": ["Transactions exist since 4.0", "To end one now: db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})", "A large idleSecs usually means the application forgot to commit or abort"], "s": ["ps", "locks"]}}, "repl": {"mysql": "SHOW SLAVE STATUS", "zh": {"t": "副本集状态", "u": [["mt.repl()", "成员状态、复制延迟、同步源"]], "o": [], "c": [["name / state / health", "成员地址、PRIMARY / SECONDARY...、1 正常 0 连不上"], ["lagSecs", "复制延迟（秒），和主节点的 optime 比"], ["optime", "最后应用的操作时间"], ["syncSource", "从哪个成员同步"], ["pingMs / lastHeartbeat", "心跳往返时间、最后一次心跳"], ["self", "* 是当前连接的成员"]], "n": ["执行的是 rs.status()", "只能在副本集成员上执行"], "s": ["oplog", "status"]}, "en": {"t": "replica set status", "u": [["mt.repl()", "member state, replication lag, sync source"]], "o": [], "c": [["name / state / health", "member address, PRIMARY / SECONDARY..., 1 up 0 unreachable"], ["lagSecs", "replication lag in seconds, against the primary's optime"], ["optime", "time of the last operation applied"], ["syncSource", "the member it syncs from"], ["pingMs / lastHeartbeat", "heartbeat round trip, last heartbeat"], ["self", "* marks the member you are connected to"]], "n": ["Runs rs.status()", "Only works on a replica set member"], "s": ["oplog", "status"]}}, "dbs": {"mysql": "SHOW DATABASES", "zh": {"t": "各库大小", "u": [["mt.dbs()", "按库名排序，最后一行是合计"]], "o": [], "c": [["name", "库名"], ["disk", "磁盘占用（sizeOnDisk）"], ["empty", "是否为空"]], "n": ["执行的是 listDatabases"], "s": ["colls", "frag"]}, "en": {"t": "database sizes", "u": [["mt.dbs()", "sorted by name, total on the last line"]], "o": [], "c": [["name", "database name"], ["disk", "disk usage (sizeOnDisk)"], ["empty", "whether it is empty"]], "n": ["Runs listDatabases"], "s": ["colls", "frag"]}}, "colls": {"mysql": "SHOW TABLE STATUS", "zh": {"t": "各集合大小", "u": [["mt.colls()", "当前库，大的在前"], ["mt.colls('shop')", "指定库，也可以传 db 对象"]], "o": [], "c": [["count", "文档数"], ["logical", "数据的逻辑大小（未压缩）"], ["disk", "数据的磁盘占用（压缩后）"], ["indexes / indexDisk", "索引个数、索引的磁盘占用"]], "n": ["对每个集合执行 $collStats，视图跳过", "按 disk + indexDisk 从大到小排"], "s": ["frag", "idx", "cache"]}, "en": {"t": "collection sizes", "u": [["mt.colls()", "current database, largest first"], ["mt.colls('shop')", "another database; a db object works too"]], "o": [], "c": [["count", "documents"], ["logical", "logical data size (uncompressed)"], ["disk", "disk space used by the data (compressed)"], ["indexes / indexDisk", "number of indexes, disk space used by them"]], "n": ["Runs $collStats on each collection; views are skipped", "Sorted by disk + indexDisk, largest first"], "s": ["frag", "idx", "cache"]}}, "frag": {"mysql": "TABLES.DATA_FREE", "zh": {"t": "删数据后可回收的磁盘空间", "u": [["mt.frag()", "当前库"], ["mt.frag('shop')", "指定库，也可以传 db 对象"]], "o": [], "c": [["disk", "数据文件大小"], ["reusable / pct", "其中可复用的空间、占比"], ["indexDisk / indexReusable", "索引文件大小、其中可复用的空间"]], "n": ["读 $collStats 的 wiredTiger['block-manager']['file bytes available for reuse']", "要还给操作系统：对集合执行 compact，或者从节点全量同步", "数字是上次 checkpoint（默认 60 秒）时的值"], "s": ["colls", "dbs"]}, "en": {"t": "disk space reusable after deletes", "u": [["mt.frag()", "current database"], ["mt.frag('shop')", "another database; a db object works too"]], "o": [], "c": [["disk", "data file size"], ["reusable / pct", "reusable space in it, and its share"], ["indexDisk / indexReusable", "index file size, reusable space in it"]], "n": ["Reads wiredTiger['block-manager']['file bytes available for reuse'] from $collStats", "To give it back to the OS: run compact on the collection, or resync a secondary", "Numbers are as of the last checkpoint (every 60 seconds by default)"], "s": ["colls", "dbs"]}}, "idx": {"mysql": "SHOW INDEX FROM t", "zh": {"t": "索引", "u": [["mt.idx('orders')", "当前库的 orders"], ["mt.idx('shop.orders')", "指定库"], ["mt.idx(db.orders)", "集合对象"]], "o": [], "c": [["name / key", "索引名、索引键"], ["disk", "磁盘占用"], ["ops / since", "自 since 以来被用到的次数（重启后清零）"], ["options", "unique、sparse、ttl=秒、partial=条件、hidden、collation=语言"]], "n": ["getIndexes() + $indexStats + $collStats"], "s": ["unusedIdx", "dupIdx", "builds"]}, "en": {"t": "indexes", "u": [["mt.idx('orders')", "orders in the current database"], ["mt.idx('shop.orders')", "another database"], ["mt.idx(db.orders)", "a collection object"]], "o": [], "c": [["name / key", "index name, index key"], ["disk", "disk usage"], ["ops / since", "times used since `since` (reset on restart)"], ["options", "unique, sparse, ttl=seconds, partial=filter, hidden, collation=locale"]], "n": ["getIndexes() + $indexStats + $collStats"], "s": ["unusedIdx", "dupIdx", "builds"]}}, "unusedIdx": {"mysql": "sys.schema_unused_indexes", "zh": {"t": "没被用过的索引", "u": [["mt.unusedIdx()", "所有用户库（跳过 admin、local、config）"], ["mt.unusedIdx('shop')", "只看一个库"], ["mt.unusedIdx({days: 30})", "计数开始满 30 天的才算"]], "o": [["days", "计数开始（since）满这么多天才算没用，默认 7；0 = 刚建的也列"]], "c": [["表头", "node（计数来自哪个节点）、uptime"], ["ns / index / key", "库.集合、索引名、索引键"], ["disk", "删掉能省下的磁盘空间"], ["since", "开始计数的时间"], ["options", "unique、ttl、shardKey（以分片键开头，删不掉）等"], ["表下面", "没列出的计数不满 days 天的个数；计数来自哪个节点；hideIndex / dropIndex 的建议"]], "n": ["列出 $indexStats 的 accesses.ops 为 0、并且 since 满 days 天的索引，_id_ 不列", "计数在重启、索引重建后清零，所以按每个索引自己的 since 判断", "计数是每个节点自己的：只被从节点读用到的索引在主节点上也是 0，每个成员都要看；经 mongos 时是各分片接到请求的节点（通常是主节点）的计数", "unique、ttl 索引即使没被查询用过也在干活；分片键索引删不掉（经 mongos 读 config.collections，在分片上读 config.cache.collections）", "删之前可以先 db.c.hideIndex('名字') 观察（4.4 起）"], "s": ["dupIdx", "idx"]}, "en": {"t": "unused indexes", "u": [["mt.unusedIdx()", "every user database (admin, local, config skipped)"], ["mt.unusedIdx('shop')", "one database"], ["mt.unusedIdx({days: 30})", "only indexes counted for 30+ days"]], "o": [["days", "an index counts as unused only once since is this many days old, default 7; 0 lists new ones too"]], "c": [["header", "node (where the counts come from), uptime"], ["ns / index / key", "database.collection, index name, index key"], ["disk", "disk space dropping it would save"], ["since", "when counting started"], ["options", "unique, ttl, shardKey (starts with the shard key, cannot be dropped) and so on"], ["below the table", "how many indexes were skipped for being counted under days; which node the counts come from; hideIndex / dropIndex advice"]], "n": ["Lists indexes whose $indexStats accesses.ops is 0 and whose since is at least days old; _id_ is not listed", "Counts reset on restart and index rebuild, so each index is judged by its own since", "Counts are per node: an index used only by secondary reads is 0 on the primary; check every member. Through mongos the counts come from the node each shard routed to (usually the primary)", "unique and ttl indexes do work even if no query uses them; shard key indexes cannot be dropped (read from config.collections through mongos, config.cache.collections on a shard)", "Hide one first with db.c.hideIndex('name') and watch (4.4+)"], "s": ["dupIdx", "idx"]}}, "dupIdx": {"mysql": "sys.schema_redundant_indexes", "zh": {"t": "冗余索引", "u": [["mt.dupIdx()", "所有用户库"], ["mt.dupIdx('shop')", "只看一个库"]], "o": [], "c": [["ns / index / key", "冗余的那个索引"], ["disk", "它占的磁盘空间"], ["coveredBy / coveredKey", "能代替它的索引（取键最短的）"]], "n": ["键是另一个索引键的前缀（字段和方向都一样）就算冗余，如 {a: 1} 被 {a: 1, b: 1} 覆盖", "这些不算：前缀索引是 unique / ttl / partial / sparse / hidden；长的是 partial / sparse；collation 不同；text、hashed 等特殊索引；方向不同"], "s": ["unusedIdx", "idx"]}, "en": {"t": "redundant indexes", "u": [["mt.dupIdx()", "every user database"], ["mt.dupIdx('shop')", "one database"]], "o": [], "c": [["ns / index / key", "the redundant index"], ["disk", "disk space it takes"], ["coveredBy / coveredKey", "the index that can replace it (shortest key)"]], "n": ["Redundant when its key is a prefix of another index's key (same fields and directions), e.g. {a: 1} covered by {a: 1, b: 1}", "Never reported: unique / ttl / partial / sparse / hidden prefix; partial / sparse longer index; different collation; text, hashed and other special indexes; different directions"], "s": ["unusedIdx", "idx"]}}, "builds": {"mysql": "ALTER TABLE progress", "zh": {"t": "正在建的索引", "u": [["mt.builds()", "每个正在建的索引一行"]], "o": [], "c": [["ns / index / key", "库.集合、索引名、索引键"], ["phase", "scanning collection、inserting keys from external sorter into index、draining writes...；等待中 = 还没开始或在等提交"], ["done / total / pct", "当前阶段的进度"], ["secs", "已经跑了多少秒"], ["opid / client", "操作 ID、发起的客户端"]], "n": ["来自 currentOp 的 $all: true", "停掉：4.4 起 db.c.dropIndex('名字')，之前 db.killOp(opid)", "只显示当前连接的节点；从节点的进度要连上去看"], "s": ["idx", "ps"]}, "en": {"t": "index builds in progress", "u": [["mt.builds()", "one row per index build"]], "o": [], "c": [["ns / index / key", "database.collection, index name, index key"], ["phase", "scanning collection, inserting keys from external sorter into index, draining writes...; waiting = not started yet or waiting to commit"], ["done / total / pct", "progress of the current phase"], ["secs", "seconds running"], ["opid / client", "operation ID, client that started it"]], "n": ["From currentOp with $all: true", "To stop one: db.c.dropIndex('name') since 4.4, db.killOp(opid) before", "Shows the node you are connected to; connect to a secondary for its progress"], "s": ["idx", "ps"]}}, "explain": {"mysql": "EXPLAIN [ANALYZE]", "zh": {"t": "执行计划", "u": [["mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))", "只看计划，不执行"], ["mt.explain(db.orders.find({...}), {analyze: true})", "真的执行一遍，看扫描数和耗时"], ["mt.explain(db.orders.explain('executionStats').aggregate([...]))", "聚合：传 explain 的结果"], ["mt.explain(db.orders.aggregate([...]))", "mongosh 里聚合游标也可以"]], "o": [["analyze", "true：explain('executionStats')，会执行查询；默认 queryPlanner，不执行"]], "c": [["表头", "ns、engine（classic / sbe）、rejectedPlans；analyze 时还有总耗时、扫描数、docsExaminedPerReturned"], ["stage", "IXSCAN / FETCH / COLLSCAN / SORT / LIMIT... 从上往下是从结果到数据源"], ["index / detail", "用的索引；索引范围、过滤条件、排序字段等"], ["nReturned / keysExamined / docsExamined / ms", "每一步的统计（analyze 时）"], ["note", "全表扫描、内存排序、用到了磁盘、取出后再过滤、多键索引"]], "n": ["慢日志里的查询用 mt.explainLog()"], "s": ["explainLog", "logQuery", "slow"]}, "en": {"t": "query plans", "u": [["mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))", "plan only, nothing runs"], ["mt.explain(db.orders.find({...}), {analyze: true})", "really runs it: rows scanned, time"], ["mt.explain(db.orders.explain('executionStats').aggregate([...]))", "aggregation: pass the explain result"], ["mt.explain(db.orders.aggregate([...]))", "an aggregation cursor works in mongosh"]], "o": [["analyze", "true: explain('executionStats'), runs the query; default queryPlanner, nothing runs"]], "c": [["header", "ns, engine (classic / sbe), rejectedPlans; with analyze also total time, rows scanned, docsExaminedPerReturned"], ["stage", "IXSCAN / FETCH / COLLSCAN / SORT / LIMIT...; top to bottom is result to data"], ["index / detail", "index used; index bounds, filter, sort fields and so on"], ["nReturned / keysExamined / docsExamined / ms", "per-step statistics (with analyze)"], ["note", "full scan, in-memory sort, spilled to disk, filtered after fetch, multikey"]], "n": ["For queries from a slow log use mt.explainLog()"], "s": ["explainLog", "logQuery", "slow"]}}, "explainLog": {"mysql": "EXPLAIN on a slow log query", "zh": {"t": "对慢日志里的查询做 explain", "u": [["mt.slow({sort: 'ms'}); mt.explainLog(1)", "profiler 里最慢的那条"], ["mt.log('Slow query'); mt.explainLog(2)", "日志里的第 2 条（4.4 之前找 'command: find'）"], ["mt.explainLog(`整行日志`)", "日志文件里复制的整行，用反引号包起来"], ["mt.explainLog(`{ find: \"orders\", ... }`)", "只复制命令那一段，从 { 开始"], ["mt.explainLog({find: 'orders', filter: {...}}, {db: 'shop'})", "自己写的命令"], ["mt.explainLog(1, {analyze: true})", "真的执行一遍"]], "o": [["analyze", "true：执行一遍拿统计；默认只看计划"], ["db", "命令里没有 $db、也没有 ns 时用哪个库"]], "c": [["慢日志里记录的执行情况", "time、durationMillis、planSummary、keysExamined、docsExamined、nreturned、hasSortStage、numYields、reslen、appName、client..."], ["之后", "和 mt.explain() 一样的计划；计划和慢日志里的不一样时会提示"]], "n": ["去掉 shardVersion、lsid、$clusterTime、$sortKey 等 mongos / 驱动加的字段", "库名取命令的 $db 或日志里的 ns", "4.2 及之前 mt.log() 每行只有前 512 个字符，长命令会被截断；从日志文件复制没有这个问题", "表格里显示的命令去掉了引号，不能粘贴回来，用行号"], "s": ["logQuery", "slow", "log", "explain"]}, "en": {"t": "explain a query from a slow log", "u": [["mt.slow({sort: 'ms'}); mt.explainLog(1)", "the slowest one in the profiler"], ["mt.log('Slow query'); mt.explainLog(2)", "row 2 of the log (before 4.4 search 'command: find')"], ["mt.explainLog(`whole log line`)", "a whole line copied from the log file, in backticks"], ["mt.explainLog(`{ find: \"orders\", ... }`)", "just the command, from its {"], ["mt.explainLog({find: 'orders', filter: {...}}, {db: 'shop'})", "a command you write yourself"], ["mt.explainLog(1, {analyze: true})", "really run it"]], "o": [["analyze", "true: run it for statistics; plan only by default"], ["db", "database to use when the command has no $db and there is no ns"]], "c": [["What the slow log recorded", "time, durationMillis, planSummary, keysExamined, docsExamined, nreturned, hasSortStage, numYields, reslen, appName, client..."], ["Then", "the plan, as in mt.explain(); a note if it differs from the logged plan"]], "n": ["Drops shardVersion, lsid, $clusterTime, $sortKey and other fields added by mongos and drivers", "The database comes from the command's $db or the log's ns", "On 4.2 and earlier mt.log() keeps only the first 512 characters of a line; lines copied from the log file are complete", "Commands shown in tables lost their quotes and cannot be pasted back; use the row number"], "s": ["logQuery", "slow", "log", "explain"]}}, "logQuery": {"mysql": "slow log → SQL", "zh": {"t": "把慢日志转成查询语句", "u": [["mt.logQuery(1)", "上一次 mt.slow() / mt.log() 的第 1 行"], ["mt.logQuery(`整行日志`)", "日志文件里复制的整行"], ["mt.logQuery({find: 'orders', filter: {...}}, {db: 'shop'})", "命令对象"]], "o": [["db", "命令里没有 $db、也没有 ns 时用哪个库"]], "c": [["// 慢日志：...", "来自慢日志时，当时的时间、耗时、计划、扫描数、返回数"], ["db.getSiblingDB(...)....", "可以直接运行的语句"]], "n": ["只打印，不执行", "类型照原样：ISODate、ObjectId、NumberLong、NumberDecimal、UUID、正则...", "update / delete 写成 updateOne / updateMany / deleteOne...，前面有一行注释提醒会修改数据", "输入和 mt.explainLog() 一样"], "s": ["explainLog", "slow", "log"]}, "en": {"t": "turn a slow-log query into a statement", "u": [["mt.logQuery(1)", "row 1 of the last mt.slow() / mt.log()"], ["mt.logQuery(`whole log line`)", "a whole line copied from the log file"], ["mt.logQuery({find: 'orders', filter: {...}}, {db: 'shop'})", "a command object"]], "o": [["db", "database to use when the command has no $db and there is no ns"]], "c": [["// slow log: ...", "for slow-log input: when it ran, duration, plan, rows scanned and returned"], ["db.getSiblingDB(...)....", "a statement you can run"]], "n": ["Prints only; nothing runs", "Types are kept: ISODate, ObjectId, NumberLong, NumberDecimal, UUID, regexes...", "update / delete become updateOne / updateMany / deleteOne..., with a comment line warning they change data", "Takes the same input as mt.explainLog()"], "s": ["explainLog", "slow", "log"]}}, "conns": {"mysql": "PROCESSLIST GROUP BY host", "zh": {"t": "连接来源", "u": [["mt.conns()", "按客户端 IP 统计连接数"]], "o": [], "c": [["表头", "current 当前连接数、available 还能建多少、totalCreated 启动以来一共建过多少"], ["client", "客户端 IP"], ["conns / active", "连接数、其中正在执行操作的"], ["apps", "这些连接的 appName"]], "n": ["serverStatus().connections + currentOp 的 $all: true"], "s": ["ps", "status"]}, "en": {"t": "where connections come from", "u": [["mt.conns()", "connections per client IP"]], "o": [], "c": [["header", "current open connections, available how many more, totalCreated since startup"], ["client", "client IP"], ["conns / active", "connections, of which running an operation"], ["apps", "their appNames"]], "n": ["serverStatus().connections + currentOp with $all: true"], "s": ["ps", "status"]}}, "oplog": {"mysql": "SHOW BINARY LOGS", "zh": {"t": "oplog 窗口", "u": [["mt.oplog()", "oplog 能覆盖多长时间"]], "o": [], "c": [["maxLogical / usedLogical", "上限、已用（逻辑大小，即 --oplogSize）"], ["disk", "磁盘上占的空间"], ["firstEvent / lastEvent", "最早、最晚一条的时间"], ["window", "两者之差"], ["now", "当前时间"]], "n": ["从节点停机或延迟超过 window，就要全量重新同步", "只能在副本集成员上执行"], "s": ["repl"]}, "en": {"t": "oplog window", "u": [["mt.oplog()", "how much time the oplog covers"]], "o": [], "c": [["maxLogical / usedLogical", "limit, used (logical size, i.e. --oplogSize)"], ["disk", "disk space it takes"], ["firstEvent / lastEvent", "times of the oldest and newest entries"], ["window", "the difference"], ["now", "current time"]], "n": ["A secondary down or behind for longer than the window needs a full resync", "Only works on a replica set member"], "s": ["repl"]}}, "status": {"mysql": "SHOW GLOBAL STATUS", "zh": {"t": "关键指标", "u": [["mt.status()", "间隔 1 秒采样两次，ops/s 是每秒的量"], ["mt.status({interval: 5})", "间隔 5 秒"], ["mt.status({interval: 0})", "只取一次，显示 opcounters 累计值"]], "o": [["interval", "采样间隔秒数，默认 1；0 = 只取一次"]], "c": [["host / version / role / uptime", "主机、版本、角色、运行时长"], ["ops/s.*", "每秒 insert / query / update / delete / getmore / command"], ["connections.* / activeClients.*", "连接数、正在读写的客户端"], ["queue.*", "排队等锁的读写，持续不为 0 说明有压力"], ["network/s.* / mem.*", "每秒流量、内存"], ["cache.*", "WiredTiger 缓存已用、上限、脏数据"]], "n": ["从 serverStatus 里挑出常看的指标"], "s": ["cache", "top", "conns"]}, "en": {"t": "key metrics", "u": [["mt.status()", "two samples 1 second apart; ops/s per second"], ["mt.status({interval: 5})", "5 seconds apart"], ["mt.status({interval: 0})", "one sample, opcounters totals"]], "o": [["interval", "seconds between samples, 1 by default; 0 = one sample"]], "c": [["host / version / role / uptime", "host, version, role, uptime"], ["ops/s.*", "insert / query / update / delete / getmore / command per second"], ["connections.* / activeClients.*", "connections, clients reading / writing now"], ["queue.*", "reads / writes waiting for a lock; staying above 0 means pressure"], ["network/s.* / mem.*", "traffic per second, memory"], ["cache.*", "WiredTiger cache used, maximum, dirty"]], "n": ["The serverStatus metrics people look at most"], "s": ["cache", "top", "conns"]}}, "cache": {"mysql": "sys.innodb_buffer_stats_by_table", "zh": {"t": "谁占着 WiredTiger 缓存", "u": [["mt.cache()", "所有库"], ["mt.cache('shop')", "只看一个库"]], "o": [], "c": [["表头", "used 已用、max 上限、dirty 脏数据"], ["ns", "库.集合"], ["cached", "数据加索引在缓存里占了多少"], ["dataCached / indexCached", "其中数据、索引各占多少"], ["share", "占已用缓存的比例"]], "n": ["缓存里是解压后的数据，可能比磁盘文件还大", "每个集合一次 $collStats，集合很多时慢", "只能连 mongod"], "s": ["status", "colls"]}, "en": {"t": "what is in the WiredTiger cache", "u": [["mt.cache()", "every database"], ["mt.cache('shop')", "one database"]], "o": [], "c": [["header", "used, max, dirty"], ["ns", "database.collection"], ["cached", "data plus indexes in the cache"], ["dataCached / indexCached", "of which data / indexes"], ["share", "share of the cache in use"]], "n": ["The cache holds uncompressed data, so it can exceed the file size", "One $collStats per collection; slow with thousands of collections", "Must run on a mongod"], "s": ["status", "colls"]}}, "ttl": {"mysql": "information_schema.EVENTS", "zh": {"t": "TTL 索引", "u": [["mt.ttl()", "所有库"], ["mt.ttl('shop')", "只看一个库"]], "o": [], "c": [["表头", "ttlMonitorEnabled、ttlMonitorSleepSecs、passes、deletedDocuments"], ["ns / index / field", "库.集合、TTL 索引名（或 (timeseries) / (clustered)）、日期字段"], ["expireAfterSeconds / expire", "过期时间"], ["oldest / overdueSecs", "最早一条的时间、超期了多少秒"], ["options", "partial、hidden"]], "n": ["overdueSecs 正常是 0 或 60 秒左右；明显更大说明删不过来或 TTL 线程没在跑", "从节点不自己删，跟着主节点复制"], "s": ["idx"]}, "en": {"t": "TTL indexes", "u": [["mt.ttl()", "every database"], ["mt.ttl('shop')", "one database"]], "o": [], "c": [["header", "ttlMonitorEnabled, ttlMonitorSleepSecs, passes, deletedDocuments"], ["ns / index / field", "database.collection, TTL index (or (timeseries) / (clustered)), date field"], ["expireAfterSeconds / expire", "expiry"], ["oldest / overdueSecs", "oldest document, seconds past expiry"], ["options", "partial, hidden"]], "n": ["overdueSecs is normally 0 or about 60; much more means deletes cannot keep up or the TTL thread is off", "Secondaries do not delete on their own; deletes replicate"], "s": ["idx"]}}, "log": {"mysql": "performance_schema.error_log", "zh": {"t": "最近的日志", "u": [["mt.log()", "最近 20 行"], ["mt.log(100)", "最近 100 行"], ["mt.log('Slow query')", "包含这段文字的（不分大小写）"], ["mt.log(/COLLSCAN|IXSCAN/)", "正则"], ["mt.log({sev: 'W'})", "只看警告、错误、致命"], ["mt.log({startup: true})", "启动警告"]], "o": [["n", "显示最后几行，默认 20"], ["grep", "文字或正则；第一个参数是字符串或正则时就是 grep"], ["sev", "'F' / 'E' / 'W' / 'I' / 'D'：这个级别及更严重的"], ["startup", "true：看启动警告"]], "c": [["#", "行号，mt.explainLog(n) / mt.logQuery(n) 用它"], ["time / sev / comp / ctx", "时间、级别、组件、线程"], ["id / attr", "4.4 起才有：消息编号、详细内容"], ["msg", "消息"]], "n": ["执行的是 getLog，只保留内存里最近 1024 行", "4.2 及之前每行最多 512 个字符", "attr 在表格里会截断，用 {vertical: true} 看全"], "s": ["slow", "explainLog"]}, "en": {"t": "recent log lines", "u": [["mt.log()", "last 20 lines"], ["mt.log(100)", "last 100 lines"], ["mt.log('Slow query')", "lines containing this text (case-insensitive)"], ["mt.log(/COLLSCAN|IXSCAN/)", "a regex"], ["mt.log({sev: 'W'})", "warnings, errors and fatal only"], ["mt.log({startup: true})", "startup warnings"]], "o": [["n", "how many of the last lines, 20 by default"], ["grep", "text or regex; a string or regex first argument is grep"], ["sev", "'F' / 'E' / 'W' / 'I' / 'D': this level and more severe"], ["startup", "true: startup warnings"]], "c": [["#", "row number, used by mt.explainLog(n) / mt.logQuery(n)"], ["time / sev / comp / ctx", "time, severity, component, thread"], ["id / attr", "4.4+ only: message ID, details"], ["msg", "message"]], "n": ["Runs getLog, which keeps only the last 1024 lines in memory", "On 4.2 and earlier each line holds at most 512 characters", "attr is cut in tables; use {vertical: true} to see it all"], "s": ["slow", "explainLog"]}}};

  var CMDS = [
    ['mt.ps({secs, ns, all, sort})', 'SHOW PROCESSLIST', 'ps'],
    ['mt.slow({ms, ns, sort})', 'mysql.slow_log', 'slow'],
    ['mt.top({interval, ns})', 'sys.schema_table_statistics', 'top'],
    ["mt.latency('db', {interval})", 'sys.statement_analysis', 'latency'],
    ['mt.locks({all})', 'sys.innodb_lock_waits', 'locks'],
    ['mt.txns({secs, sort})', 'INFORMATION_SCHEMA.INNODB_TRX', 'txns'],
    ['mt.repl()', 'SHOW SLAVE STATUS', 'repl'],
    ["mt.vars('pattern')", 'SHOW VARIABLES', 'vars'],
    ['mt.dbs()', 'SHOW DATABASES', 'dbs'],
    ["mt.colls('db')", 'SHOW TABLE STATUS', 'colls'],
    ["mt.frag('db')", 'TABLES.DATA_FREE', 'frag'],
    ["mt.desc('coll')", 'DESC t', 'desc'],
    ["mt.idx('coll')", 'SHOW INDEX FROM t', 'idx'],
    ["mt.planCache('coll')", 'performance_schema digests', 'planCache'],
    ['mt.explain(cursor)', 'EXPLAIN [ANALYZE]', 'explain'],
    ['mt.explainLog(n | line)', 'EXPLAIN on a slow log query', 'explainLog'],
    ['mt.logQuery(n | line)', 'slow log → SQL', 'logQuery'],
    ['mt.builds()', 'ALTER TABLE progress', 'builds'],
    ["mt.unusedIdx('db')", 'sys.schema_unused_indexes', 'unusedIdx'],
    ["mt.dupIdx('db')", 'sys.schema_redundant_indexes', 'dupIdx'],
    ['mt.conns()', 'PROCESSLIST GROUP BY host', 'conns'],
    ['mt.oplog()', 'SHOW BINARY LOGS', 'oplog'],
    ['mt.status({interval})', 'SHOW GLOBAL STATUS', 'status'],
    ['mt.host({all})', 'SHOW VARIABLES LIKE \'version%\'', 'host'],
    ['mt.check({quick, issues})', 'mysqltuner / pt-summary', 'check'],
    ["mt.cache('db')", 'sys.innodb_buffer_stats_by_table', 'cache'],
    ["mt.ttl('db')", 'information_schema.EVENTS', 'ttl'],
    ['mt.log({n, grep, sev})', 'performance_schema.error_log', 'log']
  ];
  // mt.cmds()：按类别分组；mt.cmds('ps') 和 mt.help('ps') 一样，看一个命令的详细帮助
  var CMD_GROUPS = [
    ['run', ['check', 'status', 'host', 'vars', 'ps', 'conns', 'locks', 'txns', 'top', 'latency', 'builds']],
    ['query', ['slow', 'log', 'explain', 'explainLog', 'logQuery', 'planCache']],
    ['store', ['dbs', 'colls', 'desc', 'frag', 'cache', 'idx', 'unusedIdx', 'dupIdx', 'ttl']],
    ['repl', ['repl', 'oplog']]
  ];
  function cmds(name) {
    if (name != null && name !== '') return cmdHelp(name);
    var m = M(), out = [], o = makeOpts({ table: true, maxCol: 0 });
    var sig = {};
    for (var i = 0; i < CMDS.length; i++) { var c = CMDS[i]; sig[c[2]] = c; }
    for (var j = 0; j < CMD_GROUPS.length; j++) {
      var g = CMD_GROUPS[j], gi = j;
      if (gi) out.push('');
      out.push(paint(o, CYAN, '── ' + m.groups[g[0]] + ' ──'));
      var rows = g[1].map(function (k) { return { command: sig[k][0], mysql: sig[k][1], description: m.cmdDesc[k] }; });
      renderRows(rows, o, out, false, rows.length);
      out.pop();   // 去掉 "N rows in set"
    }
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
      for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (dw(r[0]) <= 46) w = Math.max(w, dw(r[0])); }
      for (var j = 0; j < rows.length; j++) {
        var r2 = rows[j];
        if (dw(r2[0]) > 46) { out.push('  ' + r2[0]); out.push('  ' + ' '.repeat(w) + '  ' + sep + r2[1]); }
        else out.push('  ' + padR(r2[0], w) + '  ' + sep + r2[1]);
      }
    };
    out.push(paint(o, BOLD, 'mt.' + hit + '() — ' + h.t) + '    MySQL: ' + d.mysql, '');
    out.push(paint(o, CYAN, m.hd.usage));
    pad(h.u, '// ');
    if (h.o.length) { out.push('', paint(o, CYAN, m.hd.opts)); pad(h.o, ''); }
    if (hit === 'check') {
      var th = m.ck.th, cur = cfg.checkThresholds || {};
      out.push('', paint(o, CYAN, th.head));
      var thRows = Object.keys(CHECK_TH).map(function (k) {
        var d = thText(k, CHECK_TH[k].d, lang);
        return [k, cur[k] ? thText(k, cur[k], lang) + th.was(d) : d, th.desc[k] || m.ck.names[k]];
      });
      var vw = thRows.reduce(function (w, r) { return Math.max(w, dw(r[1])); }, 0);
      pad(thRows.map(function (r) { return [r[0], padR(r[1], vw) + '  ' + r[2]]; }), '');
    }
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
    unusedIdx: dba(unusedIdx), dupIdx: dba(dupIdx), explain: dba(explain), explainLog: dba(explainLog), logQuery: dba(logQuery), builds: dba(builds), check: dba(check), desc: dba(desc), planCache: dba(planCache), latency: dba(latency), host: dba(host), vars: dba(vars)
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
