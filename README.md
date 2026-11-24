# MongoTab

[![release](https://img.shields.io/github/v/release/yinx0004/mongosh-table)](https://github.com/yinx0004/mongosh-table/releases/latest)
[![license](https://img.shields.io/github/license/yinx0004/mongosh-table)](LICENSE)
[![compat](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml/badge.svg)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![shell](https://img.shields.io/badge/shell-mongosh%201.x%20%7C%202.x%20%7C%20legacy%20mongo-47A248?logo=mongodb&logoColor=white)](#老的-mongo-shell)
[![MongoDB](https://img.shields.io/badge/MongoDB-3.6%20%7C%204.0%20%7C%204.2%20%7C%204.4%20%7C%205.0%20%7C%206.0%20%7C%207.0%20%7C%208.0-47A248?logo=mongodb&logoColor=white)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](#兼容性)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](mongotab.js)

**中文** | [English](README.en.md)

**Make mongosh readable.**

MongoTab 在 mongosh 里把查询结果排成 MySQL 风格的表格 / `\G` 竖排，不改变你写 MongoDB 命令的方式。单个 JS 文件，无依赖。
MongoDB 5.0 及更早版本自带的老 `mongo` shell 也能用（v0.2.0 起），见[老的 mongo shell](#老的-mongo-shell)。

**零侵入**：只新增 `t`、`g`、`mt` 三个全局函数（名字被占用就跳过，改用 `mongotab.xxx`）。
不改 mongosh 的对象、prototype、`.mongoshrc` 或任何配置，退出会话即失效。

## 下载

只有一个文件 `mongotab.js`，放到**运行 mongosh 的机器**上（你的电脑或跳板机），哪个目录都行。连接远程 MongoDB 时，服务器上不用放任何东西，见[连接远程 MongoDB](#连接远程-mongodb)。用老的 `mongo` shell 时同样放在运行 `mongo` 的机器上。

Linux / macOS：

```bash
curl -fLO https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js
```

```bash
# 没有 curl 时
wget https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js
```

Windows（PowerShell）：

```powershell
Invoke-WebRequest -Uri https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js -OutFile mongotab.js
```

PowerShell 里的 `curl` 其实是 `Invoke-WebRequest` 的别名，不认 `-fLO`；想用 curl 要写成 `curl.exe -fLO ...`。

```bash
# 或者克隆整个仓库（main 上的开发版）
git clone https://github.com/yinx0004/mongosh-table.git
```

mongosh 在跳板机上运行、而跳板机连不了外网时，先在自己电脑上下载，再拷到跳板机：

```bash
scp mongotab.js user@jumphost:~/
```

以上链接下载的是最新正式版，历史版本见 [Releases](https://github.com/yinx0004/mongosh-table/releases)。想用 `main` 上的开发版，把链接换成 `https://raw.githubusercontent.com/yinx0004/mongosh-table/main/mongotab.js`。

## 加载

```js
// 已连上后
load('/path/to/mongotab.js')
```

`load()` 不认 `~`，要写完整路径，例如 `load('/home/dba/mongotab.js')`；写相对路径时按启动 mongosh 时所在的目录算。
Windows 路径用正斜杠最省事：`load('C:/Users/dba/mongotab.js')`；用反斜杠要写两遍：`load('C:\\Users\\dba\\mongotab.js')`。

```bash
# 连接时一起加载
mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

```bash
# 想省事可以在自己的 ~/.bashrc 里加个函数（改的是 bash，不是 mongosh），之后 msh "mongodb://..." 就会自动加载
msh() { mongosh "$@" /path/to/mongotab.js --shell; }
```

```powershell
# Windows：加到 PowerShell 的 $PROFILE 里
function msh { mongosh @args C:/tools/mongotab.js --shell }
```

连接地址要写在 `.js` 文件前面；写在后面时 mongosh 不会把它当连接地址，而是去连本机。

Windows 上建议用 Windows Terminal；中文列对不齐时，先换到 Windows Terminal 试试。

### 连接远程 MongoDB

`load()` 读的是运行 mongosh 那台机器上的文件，`t` / `g` / `mt` 也只在这个 mongosh 会话里生效：查询照常发给远程服务器，结果回来后在本地排成表格。所以 MongoDB 服务器上不用放任何文件，也不需要额外权限或配置。

| mongosh 在哪运行 | mongotab.js 放在哪 |
|---|---|
| 自己电脑，直连远程或走 SSH 隧道 | 自己电脑 |
| 先 SSH 登录跳板机，在跳板机上运行 | 跳板机 |
| 直接在数据库服务器上运行 | 数据库服务器 |

```bash
# 自己电脑直连远程
mongosh "mongodb://user@db.example.com:27017/admin" ~/mongotab.js --shell
```

命令行参数里的 `~` 由 shell 展开，可以这样写；`load()` 里的 `~` 不会展开。

## 用法

先看速查，细节见后面各节。

```js
t(db.orders.find({status: 'PAID'}))          // 表格，太宽自动改竖排
g(db.orders.findOne())                       // 竖排，相当于 \G
t(db.orders.find(), 'orderNo,customer,amount')   // 选列；customer = customer.* 全部
t(db.orders.find(), {exclude: 'items,raw.*'})    // 排除列
t(db.orders.find(), {limit: 200})                // 默认最多 50 行
t(db.orders.find(), {tz: '+08:00'})              // 本次按东八区显示时间
mt.csv(db.orders.find(), 'orderNo,amount')      // 输出 CSV，贴进 Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})    // 改本会话默认值
mt.ps() / mt.slow() / mt.colls() ...            // DBA 常用命令，见下一节
mt.help()                                       // 帮助：用法、选项（显示当前值）、会话设置；t() / g() 不带参数也是帮助
mt.cmds()                                       // 按类别列出全部 DBA 命令
mt.check()                                      // 一键体检：常见问题汇成一张表
mt.help('ps')                                   // 某个命令的详细用法、选项和输出的每一列
```

下面的示例都来自一个 3 节点副本集（`db1` / `db2` / `db3`），`shop.orders` 里有 2 万条订单，输出是真实跑出来的。

### 表格和竖排：t() / g()

```js
t(x)                 // 表格
t(x, 'a,b,c')        // 第二个参数是字符串：选列
t(x, {limit: 200})   // 第二个参数是对象：选项，见“选项一览”
g(x)                 // 竖排，参数和 t() 一样
```

`x` 可以是：

| 传入 | 例子 | 怎么显示 |
|---|---|---|
| 游标 | `find()`、`aggregate()`，可以接 `.sort()` / `.limit()` | 每个文档一行，最多 `limit` 行（默认 50） |
| 数组 | `toArray()`、`getIndexes()`、`currentOp().inprog`、`rs.status().members` | 每个元素一行 |
| 单个文档 | `findOne()`、`rs.status()`、`serverStatus()`、`db.stats()` | 竖排 `字段: 值`；里面的文档数组单独成子表 |
| 其他值 | 数字、字符串 | 原样打印 |

- **表格还是竖排**：`t()` 先排成表格，比终端宽就自动改成竖排；`{table: true}` 强制表格（太宽时终端会折行）。`g()` 总是竖排，和 `t(x, {vertical: true})` 一样。
- **嵌套文档**展开成 `a.b` 形式的列，例如 `customer.name`；`{depth: 1}` 只展开一层，更深的整个放进一格，显示成 `{city: 上海, zip: 200000}` 这样。
- **普通数组**显示成 `[a, b]`，文档数组显示成 `[{...}, {...}]`；单个文档里的文档数组（如 `rs.status()` 的 `members`）会单独排成子表。
- **列的顺序**按字段第一次出现的顺序；有的文档没有某个字段时显示 `(无字段)`，见[显示约定](#显示约定)。
- 数字右对齐；中文按 2 列宽对齐；超过 `maxCol`（默认 40）的单元格截断成 `...`，竖排不截断。

```
> t(db.orders.find({status: 'PAID'}).sort({_id: 1}).limit(3), 'orderNo,customer,amount,createdAt')
+---------------+---------------+--------------+--------+---------------------+
| orderNo       | customer.name | customer.vip | amount | createdAt           |
+---------------+---------------+--------------+--------+---------------------+
| SO20240101001 | Alice         | false        |    1.5 | 2024-01-01 08:31:00 |
| SO20240101002 | Bob           | false        |    2.5 | 2024-01-01 08:32:00 |
| SO20240101004 | 张三          | false        |    4.5 | 2024-01-01 08:34:00 |
+---------------+---------------+--------------+--------+---------------------+
3 rows in set
```

```
> g(db.orders.findOne({orderNo: 'SO20240101001'}))
          _id: 6b02a25049e5a32e9040733f
      orderNo: SO20240101001
       status: PAID
       amount: 1.5
customer.name: Alice
 customer.vip: false
    createdAt: 2024-01-01 08:31:00
       coupon: 
       remark: NULL

── items (1) ──
*************************** 1. row ***************************
sku: A1
  n: 2
1 row in set
```

```
> t(db.orders.aggregate([{$group: {_id: '$status', n: {$sum: 1}, total: {$sum: '$amount'}}}, {$sort: {_id: 1}}]))
+------+-------+-----------+
| _id  | n     | total     |
+------+-------+-----------+
| NEW  |  6667 | 1666666.5 |
| PAID | 13333 | 3333333.5 |
+------+-------+-----------+
2 rows in set
```

### 选列和排除列

```js
t(x, 'orderNo,customer,amount')            // 字符串，逗号分隔
t(x, ['orderNo', 'customer', 'amount'])    // 数组也行
t(x, {cols: 'orderNo,amount', limit: 10})  // 和其他选项一起时写在 cols 里
t(x, {exclude: '_id,items,raw.*'})         // 排除列
```

- 列按你写的顺序显示。
- 写 `customer` 等于 `customer` 加上 `customer.*` 全部子字段。
- 支持通配：`*` 任意多个字符，`?` 一个字符，例如 `'*.name'`、`'customer.*'`、`'item?'`。
- `cols` 和 `exclude` 可以一起用：先选，再排除。
- 单个文档里，选列也能指到子表：`'members.name'` 只显示子表 `members` 的 `name` 列；不写 `members` 相关的列，子表就不显示。

```
> t(db.orders.find().sort({_id: 1}).limit(2), {exclude: '_id,items'})
+---------------+--------+--------+---------------+--------------+---------------------+----------+----------+----------+
| orderNo       | status | amount | customer.name | customer.vip | createdAt           | level    | coupon   | remark   |
+---------------+--------+--------+---------------+--------------+---------------------+----------+----------+----------+
| SO20240101000 | NEW    |    0.5 | 张三          | true         | 2024-01-01 08:30:00 | gold     | (无字段) | (无字段) |
| SO20240101001 | PAID   |    1.5 | Alice         | false        | 2024-01-01 08:31:00 | (无字段) |          | NULL     |
+---------------+--------+--------+---------------+--------------+---------------------+----------+----------+----------+
2 rows in set
```

```
> t(rs.status(), 'set,myState,members.name,members.stateStr,members.health')
    set: rs0
myState: 1

── members (3) ──
+-----------+-----------+--------+
| name      | stateStr  | health |
+-----------+-----------+--------+
| db1:27017 | PRIMARY   |      1 |
| db2:27017 | SECONDARY |      1 |
| db3:27017 | SECONDARY |      1 |
+-----------+-----------+--------+
3 rows in set
```

### 行数：limit

- 游标默认最多显示 50 行。还有更多时，页脚会提示怎么看更多：

```
> t(db.orders.find().sort({_id: 1}), {cols: 'orderNo,status', limit: 3})
+---------------+--------+
| orderNo       | status |
+---------------+--------+
| SO20240101000 | NEW    |
| SO20240101001 | PAID   |
| SO20240101002 | PAID   |
+---------------+--------+
3 rows in set  (只显示前 3 行，还有更多；用 t(x, {limit: 200}) 看更多)
```

- `{limit: 0}` 不限行数；`mt.config({limit: 200})` 改本会话默认值。
- 数组也按 `limit` 截断，页脚显示“共 N 行，只显示前 M 行”。
- 想在数据库端就少取，直接在游标上 `.limit(n)`，比 `{limit: n}` 省流量。

### 时间和时区

日期默认按 UTC 显示成 `2024-01-01 08:30:00`，有毫秒时显示 `.123`。

```js
t(x, {tz: '+08:00'})          // 本次用东八区
t(x, {tz: 'Asia/Shanghai'})   // IANA 时区名（老的 mongo shell 不支持，用偏移）
t(x, {tz: 'local'})           // 运行 mongosh 那台机器的时区
mt.config({tz: '+08:00'})     // 本会话默认
```

也可以在启动前设环境变量 `MONGOTAB_TZ=+08:00`，见[配置项](#配置项)。

```
> t(db.orders.find().sort({_id: 1}).limit(2), {cols: 'orderNo,createdAt', tz: '+08:00'})
+---------------+---------------------+
| orderNo       | createdAt           |
+---------------+---------------------+
| SO20240101000 | 2024-01-01 16:30:00 |
| SO20240101001 | 2024-01-01 16:31:00 |
+---------------+---------------------+
2 rows in set
```

### 导出 CSV：mt.csv()

```js
mt.csv(db.orders.find({status: 'PAID'}), 'orderNo,customer.name,amount')
```

- 参数和 `t()` 一样：选列、排除列、`limit`、`tz` 都能用。游标最多取 `limit` 行，数组全部输出。
- 含逗号、引号、换行的值按 CSV 规则加引号；不输出颜色和页脚，可以直接复制进 Excel。
- `NULL`、空字符串、`(无字段)` 的约定和表格相同。

```
> mt.csv(db.orders.find().sort({_id: 1}).limit(3), 'orderNo,customer.name,amount,remark')
orderNo,customer.name,amount,remark
SO20240101000,张三,0.5,(无字段)
SO20240101001,Alice,1.5,NULL
SO20240101002,Bob,2.5,(无字段)
```

### 选项一览

每个选项都可以在单次调用时传（`t(x, {maxCol: 80})`），也可以用 `mt.config()` 改成本会话默认值。

| 选项 | 默认 | 说明 |
|---|---|---|
| `cols` | 全部 | 只看这些列，见“选列和排除列” |
| `exclude` | 无 | 排除这些列 |
| `limit` | `50` | 游标 / 数组最多显示几行，`0` 不限 |
| `table` | `false` | 强制表格，不自动改竖排 |
| `vertical` | `false` | 强制竖排，`g()` 就是 `vertical: true` |
| `tz` | `'UTC'` | 时区：`'UTC'`、`'local'`、`'+08:00'`、`'Asia/Shanghai'` |
| `maxCol` | `40` | 表格每列最多显示几个字符宽，超出截断成 `...`；`0` 不截断 |
| `width` | 自动 | 终端宽度，超过就改竖排；检测不到时按 160 |
| `depth` | 全部 | 嵌套文档展开几层 |
| `color` | 自动 | `true` / `false`：表头加粗、`(无字段)` 变暗等；不是终端时自动关闭 |
| `nullText` | `'NULL'` | 值为 null 时显示什么 |
| `missingText` | 跟随语言 | 没有这个字段时显示什么，默认 `(无字段)` / `(missing)` |
| `lang` | 自动 | `'zh'` / `'en'`：提示和帮助的语言 |
| `showCmd` | `true` | DBA 命令先打印等价的原生命令 |
| `checkThresholds` | `null` | `mt.check()` 的阈值，如 `{lag: [30, 300]}`，按键合并，见 [mt.check()](#mtcheck一键体检) |

DBA 命令另有自己的选项（`secs`、`ns`、`sort`、`interval`...），见下一节各命令。

### 会话默认值：mt.config()

```js
mt.config()                                  // 查看当前设置
mt.config({tz: '+08:00', limit: 100})        // 修改，只影响本会话
```

```
> mt.config()
{"limit":50,"maxCol":40,"tz":"UTC","nullText":"NULL","missingText":null,"color":null,"width":200,"depth":null,"showCmd":true,"checkThresholds":null,"lang":"zh"}
```

- 设置只在当前 mongosh 会话里有效，退出就没了；重新 `load()` 也会回到默认值。
- 想每次都生效，用环境变量 `MONGOTAB_TZ`、`MONGOTAB_LANG`，见[配置项](#配置项)。
- `t`、`g`、`mt` 这几个名字已经被别的脚本占用时，MongoTab 不会覆盖，加载时会提示；这时用 `mongotab.table()`、`mongotab.vertical()`、`mongotab.ps()` 等，用法完全一样。

## DBA 常用命令

`mt` 下面带了一组只读的快捷命令，对应 MySQL 的 `SHOW ...`。`mt.cmds()` 按类别列出全部（运行状态、慢查询和执行计划、存储和索引、复制），每条都有对应的 MySQL 命令和说明；`mt.help('ps')`（也可以写 `mt.cmds('ps')`、`mt.help('mt.ps()')`）看某个命令的详细用法、选项、输出的每一列和注意事项：

```
> mt.cmds()
── 运行状态 ──
+------------------------------+------------------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| command                      | mysql                                    | description                                                                                                                                                          |
+------------------------------+------------------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| mt.check({quick, issues})    | mysqltuner / pt-summary                  | 一键体检：复制、oplog、缓存、连接、长操作、长事务、TTL、冗余 / 没用的索引等，每项给 OK / WARN / CRIT / UNKNOWN 和建议；quick 跳过逐个集合的检查，issues 只看有问题的 |
| mt.status({interval})        | SHOW GLOBAL STATUS                       | 版本、角色、ops/s、连接、缓存等关键指标                                                                                                                              |
| mt.engine({interval})        | SHOW ENGINE INNODB STATUS                | 存储引擎（WiredTiger）：缓存用量、脏数据、驱逐、检查点、读写票据、日志和磁盘读写；interval 采样秒数，0 = 启动以来累计                                                |
| mt.host({all})               | SHOW VARIABLES LIKE 'version%'           | 机器和进程：CPU、内存、操作系统、文件句柄数、mongod 版本和编译信息、存储引擎、启动参数；all 列出全部启动参数                                                         |
| mt.mem()                     | sys.memory_global_by_current_bytes       | 内存都花在哪：常驻内存分成 WiredTiger 缓存、缓存以外的分配、tcmalloc 留着的空闲和 tcmalloc 以外；提示内存快满、缓存设得太大、脏数据多、空闲内存没还给系统            |
| mt.vars('pattern')           | SHOW VARIABLES                           | 运行参数（getParameter）：名字、当前值、能不能在运行时改（4.2 起）；可传关键字、通配符或正则过滤，如 mt.vars('ttl')                                                  |
| mt.ps({secs, ns, all, sort}) | SHOW PROCESSLIST                         | 正在执行的操作；secs 最短秒数，ns 库或集合，all 含空闲连接，sort: 'desc' 运行最久的在前（默认）/ 'asc' / 'opid'                                                      |
| mt.cursors({secs, ns})       | SHOW PROCESSLIST WHERE Command = 'Sleep' | 打开着的游标：总数、noTimeout、超时回收的；每个空闲游标的集合、空闲多久、读了多少、原始查询（4.2 起）；可传 secs、ns                                                 |
| mt.conns()                   | PROCESSLIST GROUP BY host                | 按客户端 IP 统计连接数                                                                                                                                               |
| mt.pool({all})               | ProxySQL stats_mysql_connection_pool     | 连出去的连接池（mongos 到各分片、成员之间），按目标主机汇总；all 再按连接池列出                                                                                      |
| mt.users('db')               | SELECT * FROM mysql.user                 | 用户和自定义角色：每个用户的库、角色、登录方式，自定义角色的权限和被几个用户直接用到；提示没开认证、权限过大、只能用 SHA-1、没有角色的用户；可传 'db'                |
| mt.locks({all})              | sys.innodb_lock_waits                    | 谁在等锁、锁被谁占着；all 显示所有被占用的锁                                                                                                                         |
| mt.txns({secs, sort})        | INFORMATION_SCHEMA.INNODB_TRX            | 未提交的事务：开了多久、空闲多久、多久后自动中止；secs 最短秒数，sort: 'desc' / 'asc'                                                                                |
| mt.top({interval, ns})       | sys.schema_table_statistics              | 各集合读写耗时，忙的在前；interval 采样秒数，0 = 启动以来累计；ns 库或集合                                                                                           |
| mt.latency('db', {interval}) | sys.statement_analysis                   | 读 / 写 / 命令的平均延迟（毫秒），整台和各集合；interval 采样秒数，0 = 启动以来；默认所有用户库                                                                      |
| mt.builds()                  | ALTER TABLE progress                     | 正在建的索引：哪个集合、哪个索引、在哪个阶段、进度、已经跑了多久                                                                                                     |
+------------------------------+------------------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------+

── 慢查询和执行计划 ──
+-------------------------+-----------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------+
| command                 | mysql                             | description                                                                                                                                          |
+-------------------------+-----------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------+
| mt.slow({ms, ns, sort}) | mysql.slow_log                    | 慢查询（system.profile）；默认当前库，可传 'db'；ms 最短毫秒数，ns 集合，sort: 'desc' 新的在前（默认）/ 'asc' / 'ms' 最慢的在前                      |
| mt.profile('db')        | SHOW VARIABLES LIKE 'slow_query%' | profiler 设置：每个库的级别、过滤条件，system.profile 存了多少、最早一条是什么时候；slowms、sampleRate 是整个实例共用的；默认所有库，可传 'db'       |
| mt.qstats({interval})   | SHOW STATUS LIKE 'Handler%'       | 查询效率：扫描的键和文档、返回的文档、每返回 1 条扫了几条、全表扫描、内存排序、写冲突、计划缓存命中；interval 采样秒数，0 = 启动以来累计             |
| mt.log({n, grep, sev})  | performance_schema.error_log      | 最近的日志（getLog）；n 行数，grep 关键字或正则，sev: 'W' 只看警告及以上，startup 启动警告                                                           |
| mt.explain(cursor)      | EXPLAIN [ANALYZE]                 | 执行计划排成表：每个阶段的索引、扫描和返回行数、耗时，标出全表扫描、内存排序；默认只看计划、不执行，analyze: true 执行一遍看扫描数和耗时             |
| mt.explainLog(n | line) | EXPLAIN on a slow log query       | 对慢日志里的查询做 explain：先列出日志里记下的实际执行情况，再看现在的计划，计划变了会提示；n 是 mt.slow() / mt.log() 的行号，也可以传整行日志、命令 |
| mt.logQuery(n | line)   | slow log → SQL                    | 把慢日志里的查询转成可以直接运行的 mongosh 语句（不执行），类型照原样保留                                                                            |
| mt.planCache('coll')    | performance_schema digests        | 集合的计划缓存：每种查询形状缓存了哪个计划、是否生效、works；hash 按 queryHash / planCacheKey 过滤                                                   |
+-------------------------+-----------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------+

── 存储和索引 ──
+--------------------+----------------------------------+-------------------------------------------------------------------------------------------------------------+
| command            | mysql                            | description                                                                                                 |
+--------------------+----------------------------------+-------------------------------------------------------------------------------------------------------------+
| mt.dbs()           | SHOW DATABASES                   | 各库占用的磁盘空间                                                                                          |
| mt.colls('db')     | SHOW TABLE STATUS                | 各集合文档数、数据和索引大小，大的在前；默认当前库                                                          |
| mt.desc('coll')    | DESC t                           | 集合的字段结构：抽样文档，列出每个字段的类型、出现比例和示例，加上集合选项、校验规则和索引；sample 抽样条数 |
| mt.frag('db')      | TABLES.DATA_FREE                 | 各集合删数据后可回收的磁盘空间，多的在前；默认当前库                                                        |
| mt.cache('db')     | sys.innodb_buffer_stats_by_table | 各集合占用的 WiredTiger 缓存，多的在前；默认所有库                                                          |
| mt.idx('coll')     | SHOW INDEX FROM t                | 索引的键、大小、使用次数和选项                                                                              |
| mt.unusedIdx('db') | sys.schema_unused_indexes        | 没被用过的索引（ops = 0），大的在前；默认所有用户库                                                         |
| mt.dupIdx('db')    | sys.schema_redundant_indexes     | 冗余索引：键是另一个索引的前缀，如 {a: 1} 被 {a: 1, b: 1} 覆盖；默认所有用户库                              |
| mt.ttl('db')       | information_schema.EVENTS        | TTL 索引：过期时间、最早一条的时间、超期了多久，以及 TTL 线程的状态；默认所有库                             |
+--------------------+----------------------------------+-------------------------------------------------------------------------------------------------------------+

── 复制 ──
+-------------------------------+-------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| command                       | mysql                         | description                                                                                                                                                       |
+-------------------------------+-------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| mt.repl()                     | SHOW SLAVE STATUS             | 副本集成员状态、复制延迟（秒）、同步源                                                                                                                            |
| mt.rsconf()                   | SHOW SLAVE HOSTS              | 副本集配置（rs.conf()）：每个成员的优先级、投票、隐藏、延迟、标签和现在的状态，选举设置、默认读写关注；提示偶数个投票成员、仲裁节点、有投票权的延迟成员           |
| mt.oplog()                    | SHOW BINARY LOGS              | oplog 大小和能覆盖多长时间                                                                                                                                        |
| mt.shards('db')               | sh.status()                   | 分片集群（要连 mongos）：均衡器、各分片的排空、区域、块数、数据量、哪些库的主分片，各分片集合的分片键和块分布；可传 'db' 只看一个库的集合                         |
| mt.balancer('ns', {hours, n}) | sh.status() migration results | 均衡器和最近的块迁移：每次迁移的集合、从哪到哪、范围、文档数、耗时、结果，正在进行的迁移，均衡轮次；hours 看多久（默认 24），n 最多几条，ns 库或集合；要连 mongos |
+-------------------------------+-------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------+

都可以加 t() 的选项，如 {cols: ...}、{vertical: true}；mt.config({showCmd: false}) 不打印原生命令
mt.help('ps') 看某个命令的详细用法、选项和输出的每一列
```

```
> mt.help('ps')
mt.ps() — 正在执行的操作    MySQL: SHOW PROCESSLIST

用法：
  mt.ps()                     // 运行最久的在前
  mt.ps({secs: 5})            // 只看运行超过 5 秒的
  mt.ps({ns: 'shop.orders'})  // 只看某个集合；'shop' 匹配整个库
  mt.ps({all: true})          // 包括空闲连接和内部线程
  mt.ps({sort: 'opid'})       // 排序：'desc'（默认）、'asc'、'opid'，或 {ns: 1, secs: -1}

选项：
  secs  只看运行超过这么多秒的
  ns    库或 库.集合
  all   true：用 $all，包括空闲连接和内部线程
  sort  'desc' / 'asc' / 'opid' / 按列名的排序文档

输出：
  opid          操作 ID，db.killOp(opid) 用它
  secs          已经运行的秒数
  op            query / getmore / insert / update / remove / command；空闲连接是 idle
  ns            库.集合
  client / app  客户端、appName
  lock          在等锁时显示 WAIT
  plan          计划摘要，COLLSCAN 是全表扫描
  command       命令，去掉了驱动加的字段

说明：
  - 执行的是 db.adminCommand({currentOp: 1, active: true})
  - 默认不显示空闲连接、内部线程、驱动的心跳长轮询和 mt.ps() 自己

都可以加 t() 的选项（cols、exclude、limit、vertical、table、tz...）；mt.config({showCmd: false}) 不打印原生命令
另见：mt.locks()、mt.txns()、mt.conns()
```

所有命令的共同点：

- **先打印原生命令**：第一行 `-- ...`（终端里是灰色）是它实际执行的 MongoDB 命令，方便复制、核对；`mt.config({showCmd: false})` 关掉。
- **选项和 `t()` 通用**：`cols`、`exclude`、`limit`、`vertical`、`table`、`tz` 都能用，例如 `mt.ps({secs: 5, cols: 'opid,secs,ns,command'})`、`mt.idx('orders', {vertical: true})`。
- **只读**：不会改任何设置，`mt.slow()` 也不会打开 profiler。
- **大小分逻辑和磁盘**：列名里带 `logical` 的是未压缩的数据量（BSON 大小），带 `disk` 的是磁盘上实际占的（WiredTiger 压缩后），带 `cached` 的是在内存缓存里占的（解压后）。同一份数据三者可以差好几倍。
- **权限**：需要监控类权限，如 `clusterMonitor` 角色。权限不够、在单机上执行 `mt.repl()` / `mt.oplog()`、在 mongos 上执行 `mt.slow()` / `mt.top()` / `mt.locks()` / `mt.cache()` 时，只打印一行说明，不抛异常。
- **版本**：老的 mongo shell 和 mongosh 都能用，CI 里在副本集上逐个版本测过。经 mongos 测过的有 `mt.shards()`、`mt.balancer()`、`mt.pool()`（包括有分片连不上时），以及 `mt.status()`、`mt.vars()`、`mt.mem()`、`mt.cursors()`（能用）和 `mt.check()`、`mt.engine()`、`mt.qstats()`、`mt.profile()`、`mt.rsconf()`（打印一行说明）；其余命令经 mongos 还没测过。

### mt.check()：一键体检

把常见问题汇成一张表，每一项给出 OK / WARN / CRIT / UNKNOWN / INFO / SKIP、测到的值，以及建议或进一步看的命令。接手一个不熟悉的实例、排查问题时，先跑一遍它。

```js
mt.check()                  // 全部检查
mt.check({issues: true})    // 只看 WARN / CRIT / UNKNOWN
mt.check({quick: true})     // 跳过逐个集合的检查（索引、TTL、磁盘空间）
mt.check({maxColls: 5000, budgetMs: 120000})   // 逐个集合的检查最多查 5000 个集合、2 分钟；0 = 不限
mt.check({thresholds: {lag: [30, 300], oplog: [48, 6]}})   // 这一次用别的阈值
mt.config({checkThresholds: {longOps: [600, 3600]}})      // 改本会话的默认阈值
```

| 检查项 | 依据 | WARN | CRIT | 阈值键 |
|---|---|---|---|---|
| 启动警告 | `getLog: 'startupWarnings'` | 有警告 | | |
| 写入被锁（fsyncLock） | `currentOp` | | 被锁着 | |
| FCV 版本 | `featureCompatibilityVersion` 和二进制版本 | 低于二进制版本（升级后忘了提升） | | |
| 副本集成员 | `rs.status()` | | 有成员不是 PRIMARY / SECONDARY / ARBITER，或 health 不是 1 | |
| 复制延迟 | 最大的 lagSecs | ≥ 10 秒 | ≥ 60 秒 | `lag` |
| oplog 窗口 | 最早到最晚一条 | < 24 小时 | < 3 小时 | `oplog`（小时，越低越坏） |
| 缓存使用率 / 缓存脏数据 | WiredTiger 缓存 | ≥ 90% / ≥ 10% | ≥ 95% / ≥ 20% | `cacheUsed` / `cacheDirty` |
| 读写并发票据 | 已用 / 总数（7.0 之前） | ≥ 80% | ≥ 95% | `tickets` |
| 等锁队列 | `globalLock.currentQueue` 读 + 写 | ≥ 5 | ≥ 50 | `queue` |
| 连接数 | current / (current + available) | ≥ 80% | ≥ 95% | `conns` |
| 长时间运行的操作 | 客户端的操作 | 超过 60 秒 | 超过 600 秒 | `longOps`（秒） |
| 等锁的操作 / 长事务 | `waitingForLock` / 开了 30 秒以上 | 有 | | 长事务：`txns`（秒） |
| TTL 线程 / profiler | `ttlMonitorEnabled` / 有库是 level 2 | 停了 / 有 | | |
| 正在建的索引 | `currentOp` | INFO | | |
| TTL 超期 | 同 `mt.ttl()` | 超期 1 小时以上 | | `ttlOverdue`（秒） |
| 冗余索引 | 同 `mt.dupIdx()` | 有 | | |
| 没被用过的索引 | 同 `mt.unusedIdx()`，不算 unique / ttl / 分片键，计数不满 7 天的也不算 | 有（运行不满 7 天只给 INFO） | | |
| 可回收的磁盘空间 | 同 `mt.frag()`，所有用户库合计 | 超过 30% 且超过 1 GB | | `frag`（%）、`fragMinGB` |

下面是一个有问题的实例：fsyncLock 了没解锁（写入在排队），TTL 线程停了（`sessions` 超期了 5 个多小时），还有一个冗余索引。

```
> mt.check()
-- serverStatus, currentOp, replSetGetStatus, getLog, getParameter; per collection (maxColls 2000, budgetMs 60000): getIndexes, $collStats, $indexStats
   host: db1
version: 7.0.48
   role: PRIMARY (rs0)
 uptime: 20s
+-----------------------+--------+------------------------------------------------------------------+-------------------------------------------------------------+
| check                 | status | value                                                            | advice                                                      |
+-----------------------+--------+------------------------------------------------------------------+-------------------------------------------------------------+
| 启动警告              | WARN   | 2 条：Access control is not enabled for the database. Read an... | mt.log({startup: true})                                     |
| 写入被锁（fsyncLock） | CRIT   | 已锁                                                             | db.fsyncUnlock()                                            |
| FCV 版本              | OK     | FCV 7.0，二进制 7.0                                              |                                                             |
| 副本集成员            | OK     | 1 个成员，都正常                                                 | mt.repl()                                                   |
| 复制延迟              | OK     | 0s                                                               | mt.repl()                                                   |
| oplog 窗口            | CRIT   | 7s (0.00 h)                                                      | 调大 oplog：replSetResizeOplog；mt.oplog()                  |
| 缓存使用率            | OK     | 0.2% (15.1 MB / 7.3 GB)                                          | mt.cache()                                                  |
| 缓存脏数据            | OK     | 0.0% (0 B)                                                       | mt.status()                                                 |
| 读写并发票据          | OK     | read 1/10, write 1/10                                            | mt.ps()                                                     |
| 等锁队列              | OK     | readers 0, writers 3                                             | mt.locks()                                                  |
| 连接数                | OK     | 11 / 8192 (0.1%)                                                 | mt.conns()                                                  |
| 长时间运行的操作      | OK     | 没有超过 60 秒的                                                 |                                                             |
| 等锁的操作            | WARN   | 1 个                                                             | mt.locks()                                                  |
| 长事务                | OK     | 没有开了 30 秒以上的                                             |                                                             |
| 正在建的索引          | OK     | 0 个                                                             |                                                             |
| TTL 线程              | WARN   | 已停止                                                           | db.adminCommand({setParameter: 1, ttlMonitorEnabled: true}) |
| profiler              | OK     | 没有库是 level 2                                                 |                                                             |
| TTL 超期              | WARN   | 1 个超期 1 小时以上，最多 5h 30m                                 | mt.ttl()                                                    |
| 冗余索引              | WARN   | 1 个，共 116.0 KB                                                | mt.dupIdx()                                                 |
| 没被用过的索引        | INFO   | 只运行了 20s，统计不够，满 7 天再看                              | mt.unusedIdx()                                              |
| 可回收的磁盘空间      | OK     | 0 B / 1.4 MB（0.0%）                                             |                                                             |
+-----------------------+--------+------------------------------------------------------------------+-------------------------------------------------------------+
CRIT 2，WARN 5，OK 13，INFO 1 （逐个集合的检查：2/2 个集合）
```

- 某一项查不了（比如没有权限）只把这一项标成 UNKNOWN，写上原因，其他项照常检查。
- 逐库 / 逐集合的检查（profiler、TTL 超期、冗余索引、没被用过的索引、可回收空间）有一部分失败时：没发现问题也不报 OK，而是 UNKNOWN，value 写“查了 40/42 个集合，2 个失败”，advice 写第一个失败的集合和原因；有发现时照常 WARN，value 后面附上覆盖情况。列不出库（`listDatabases` 失败）时这几项都是 UNKNOWN。
- SKIP 只表示不适用：单机上副本集相关的几项、存储引擎不是 WiredTiger 时的缓存两项。只能连 mongod，在 mongos 上只打印一行说明。
- `{issues: true}` 显示 WARN、CRIT 和 UNKNOWN。
- 逐个集合的四项（TTL 超期、冗余索引、没被用过的索引、可回收空间）共用一次遍历：每个库一次 `listCollections`，每个集合一次 `getIndexes`、一次 `$collStats`；运行满 7 天才查 `$indexStats`；每个 TTL 索引再查一次最老的文档。
- 默认最多查 2000 个集合（`maxColls`）、60 秒（`budgetMs`），按库名、集合名的顺序，到了就停下。没查到的集合不能算没问题：这几项没发现问题时是 UNKNOWN，value 写“只查了前 2000/15000 个集合（maxColls 2000）”；有发现时照常 WARN 并附上这句。最后一行写实际查了几个集合。
- 集合很多时可以先 `{quick: true}`，再用 `mt.dupIdx('库')`、`mt.unusedIdx('库')`、`mt.ttl('库')`、`mt.frag('库')` 逐个库看。
- 表里的阈值是默认值，是常见的经验值，不一定适合每个场景（比如离线分析库的长操作、跨机房副本的复制延迟）；WARN 不代表一定有问题，按建议列的命令再细看。
- 阈值可以改：`mt.check({thresholds: {...}})` 只改这一次；`mt.config({checkThresholds: {...}})` 改本会话的默认值，重新 `load()` 会恢复。键见上表的“阈值键”，有 CRIT 的写 `[WARN, CRIT]`，只有 WARN 的写一个数；`oplog` 越低越坏，WARN 要大于等于 CRIT，其余 WARN 不能大于 CRIT；百分比不能超过 100。`mt.help('check')` 列出全部键、默认值和本会话改过的值。
- `mt.config({checkThresholds: ...})` 按键合并：再设一次只改给出的键，某个键给 `null` 恢复默认，`checkThresholds: null` 全部恢复。改过的阈值会列在结果最后一行之前，比如 `改过的阈值：lag 30 / 300 秒，oplog 48 / 6 小时`。
- 值不对（没有这个键、个数不对、顺序反了、不是数字）时只打印一行说明，不跑检查。

### mt.ps()：正在执行的操作

相当于 `SHOW PROCESSLIST`，执行的是 `db.adminCommand({currentOp: 1, active: true})`。

| 选项 | 说明 |
|---|---|
| `secs` | 只看运行超过这么多秒的，例如 `{secs: 5}` |
| `ns` | 只看某个库或集合：`'shop'` 匹配 `shop` 下所有集合，`'shop.orders'` 只看这一个 |
| `all` | `true` 时改用 `$all: true`，包括空闲连接和内部线程 |
| `sort` | `'desc'`（默认，运行最久的在前）、`'asc'`（最短的在前）、`'opid'`，或按列名写的排序文档如 `{ns: 1, secs: -1}`；相同时再按运行时间从长到短 |

| 列 | 说明 |
|---|---|
| `opid` | 操作 ID，`db.killOp(opid)` 用的就是它 |
| `secs` | 已经运行的秒数 |
| `op` | `query`、`getmore`、`insert`、`update`、`remove`、`command`；空闲连接显示 `idle` |
| `ns` | 库.集合 |
| `client` | 客户端 IP:端口 |
| `app` | 客户端的 appName，如 `mongosh 2.14.2`、`OplogFetcher` |
| `lock` | 在等锁时显示 `WAIT` |
| `plan` | 执行计划摘要，`COLLSCAN` 是全表扫描 |
| `command` | 命令内容，去掉了 `lsid`、`$clusterTime` 这类驱动加的字段 |

默认不显示：空闲连接、没有客户端的内部线程、驱动的心跳长轮询（awaitable `hello`），以及 `mt.ps()` 自己这条查询。

```
> mt.ps()
-- db.adminCommand({currentOp: 1, active: true})
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| opid | secs | op      | ns             | client              | app            | lock | plan                                | command                                  |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| 1852 |    9 | query   | shop.orders    | 192.168.117.5:45392 | mongosh 2.14.2 |      | IXSCAN { status: 1, createdAt: -1 } | {find: orders, filter: {$where: sleep... |
| 2026 |    0 | getmore | local.oplog.rs | 192.168.117.4:38358 | OplogFetcher   |      | COLLSCAN                            | {getMore: 4128049805525302686, collec... |
| 2027 |    0 | getmore | local.oplog.rs | 192.168.117.3:40114 | OplogFetcher   |      | COLLSCAN                            | {getMore: 4195733008104728874, collec... |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
3 rows in set
```

```
> mt.ps({all: true, cols: 'opid,secs,op,ns,client,app', limit: 5})
-- db.adminCommand({currentOp: 1, $all: true})
+------+------+---------+-------------+---------------------+----------------+
| opid | secs | op      | ns          | client              | app            |
+------+------+---------+-------------+---------------------+----------------+
| 1852 |    9 | query   | shop.orders | 192.168.117.5:45392 | mongosh 2.14.2 |
| 1864 |    8 | command | admin.$cmd  | 192.168.117.5:45388 | mongosh 2.14.2 |
|      |    0 | idle    |             | 192.168.117.3:40118 |                |
|      |    0 | idle    |             | 192.168.117.5:45414 | mongosh 2.14.2 |
|      |    0 | idle    |             | 192.168.117.4:38384 |                |
+------+------+---------+-------------+---------------------+----------------+
5 rows in set  (共 78 行，只显示前 5 行)
```

### mt.cursors()：打开着的游标

`mt.ps()` 看的是正在执行的操作；`mt.cursors()` 看的是查到一半、等着客户端来取下一批的游标。程序打开游标不读完也不关，游标会一直留在服务端。类似 MySQL 里 `SHOW PROCESSLIST` 中 `Sleep` 的连接。

```js
mt.cursors()                // 计数，以及每个空闲的游标
mt.cursors({secs: 600})     // 只看空闲了 10 分钟以上的
mt.cursors({ns: 'shop'})    // 只看一个库；也可以写 'shop.orders'
```

| 字段 | 说明 |
|---|---|
| 表头 | `open` 打开着的游标数、`noTimeout` 其中设了 noCursorTimeout 的、`pinned` 正在被读的、`timedOut` 启动以来因为空闲超时被回收的、`totalOpened` 启动以来一共打开过多少（5.0 起）、`cursorTimeout` 和 `sessionTimeout`（见下面的说明） |
| `cursorId` | 游标 ID，关掉它时要用 |
| `shard` | 经 mongos 时，游标在哪个分片上 |
| `idleSecs` / `ageSecs` | 空闲了多少秒、打开了多少秒 |
| `docs` / `batches` | 已经返回了多少文档、多少批 |
| `flags` | `noTimeout`、`tailable`、`awaitData` |
| `command` | 打开这个游标的命令：find 的条件或 aggregate 的管道；程序带了 `comment` 时放在最前面；`batchSize` 之类游标本身的设置不列 |

下面是 MongoDB 7.0 上几个程序读到一半的游标：一个导出任务开了 noCursorTimeout、读了 3000 条就停了；一个带 `comment: 'daily-report'` 的报表；还有两个查询只取了第一批。

```
> mt.cursors()
-- db.serverStatus().metrics.cursor; getParameter cursorTimeoutMillis, localLogicalSessionTimeoutMinutes; aggregate([{$currentOp: {allUsers: true, idleCursors: true}}, {$match: {type: 'idleCursor'}}])
          open: 4
     noTimeout: 1
        pinned: 0
      timedOut: 0
   totalOpened: 7
 cursorTimeout: 10m 0s
sessionTimeout: 30m 0s

── 空闲的游标 ──
+---------------------+----------------+----------+---------+------+---------+-----------+-------------------------------------+--------------------------------------------------------------+
| cursorId            | ns             | idleSecs | ageSecs | docs | batches | flags     | plan                                | command                                                      |
+---------------------+----------------+----------+---------+------+---------+-----------+-------------------------------------+--------------------------------------------------------------+
| 4382608709592319410 | shop.orders    |      103 |     103 | 3000 |       3 | noTimeout | COLLSCAN                            | {find: orders, filter: {}, projection: {orderNo: 1, amoun... |
| 5178228565502310856 | shop.orders    |       63 |      63 |  500 |       1 |           | IXSCAN { status: 1, createdAt: -1 } | {comment: daily-report, aggregate: orders, pipeline: [{$m... |
| 5282542937179335357 | shop.orders    |       33 |      33 |  101 |       1 |           | IXSCAN { status: 1, createdAt: -1 } | {find: orders, filter: {status: new}, sort: {createdAt: -1}} |
| 8019749106198471030 | shop.customers |       33 |      33 |    2 |       1 |           | COLLSCAN                            | {find: customers, filter: {}}                                |
+---------------------+----------------+----------+---------+------+---------+-----------+-------------------------------------+--------------------------------------------------------------+
4 rows in set
注意：有 1 个 noCursorTimeout 的游标：不受 cursorTimeout 限制，程序不读完也不关就可能一直留在服务端；确认没用了可以用 killCursors 关掉
```

- 每个空闲的游标来自 `$currentOp` 的 `idleCursors`，4.2 起才有；之前只有表头的计数。
- 空闲游标的记录里没有客户端地址，要靠 `ns`、查询和 `comment` 判断是哪个程序。让程序给查询带上 `comment` 最方便。
- 空闲多久会被回收：4.4 之前是 `cursorTimeout`（参数 `cursorTimeoutMillis`，默认 10 分钟）。4.4 起，会话里打开的游标不按它回收，要等会话过期（`sessionTimeout`，参数 `localLogicalSessionTimeoutMinutes`，默认 30 分钟）才关；现在的驱动和 mongosh 默认都用会话。本地在 4.2 和 4.4.30、5.0、6.0、7.0 上试过。
- 关掉一个游标：`db.getSiblingDB('库').runCommand({killCursors: '集合', cursors: [NumberLong('游标 ID')]})`。
- 经 mongos 时，表头是 mongos 自己的计数；表里列的是各分片上的空闲游标，客户端的一个游标在每个涉及的分片上各有一个，`command` 里去掉了 mongos 加的内部字段。
- 这些情况会在最后提示：有 noCursorTimeout 的游标；启动以来有游标因为空闲超时被回收。

### mt.slow()：慢查询

相当于 MySQL 的慢查询日志，读的是 profiler 写进 `system.profile` 集合的记录。

```js
mt.slow()                           // 当前库
mt.slow('shop')                     // 指定库，也可以传 db 对象：mt.slow(db.getSiblingDB('shop'))
mt.slow({ms: 500, ns: 'orders'})    // 只看超过 500 毫秒的、orders 集合的
mt.slow('shop', {sort: 'ms'})       // 最慢的在前
```

| 选项 | 说明 |
|---|---|
| `ms` | 只看耗时不少于这么多毫秒的，变成 `{millis: {$gte: ms}}` |
| `ns` | 集合名（`'orders'`）或完整的 `'库.集合'` |
| `sort` | `'desc'`（默认，`{ts: -1}` 最新的在前）、`'asc'`（`{ts: 1}` 最早的在前）、`'ms'`（`{millis: -1, ts: -1}` 最慢的在前），或排序文档如 `{docsExamined: -1}` |

表头显示 profiler 的设置：

- profiler 按库开关：`level` 0 关闭，1 只记超过 `slowms` 毫秒的操作，2 全记；`sampleRate` 是抽样比例。
- 默认是关的。没开时 `mt.slow()` 会提示用 `db.setProfilingLevel(1, {slowms: 100})` 打开，要在每个库里分别执行。

| 列 | 说明 |
|---|---|
| `#` | 行号，`mt.explainLog(n)` / `mt.logQuery(n)` 用它 |
| `ts` | 操作结束的时间 |
| `ms` | 耗时（毫秒），即 `millis` |
| `op` | `query`、`update`、`command`... |
| `ns` | 库.集合 |
| `plan` | 执行计划摘要，如 `COLLSCAN`、`IXSCAN { status: 1 }` |
| `keysExamined` / `docsExamined` | 扫描了多少索引键、多少文档 |
| `nreturned` | 返回了多少条 |
| `client` / `user` | 客户端 IP、用户；没开认证时 `user` 全空，这一列不显示 |
| `command` | 命令内容，去掉了驱动加的字段 |

```
> mt.slow()
-- db.getSiblingDB('shop').system.profile.find({}).sort({ts: -1})
        db: shop
     level: 1
    slowms: 20
sampleRate: 1
*************************** 1. row ***************************
           #: 1
          ts: 2026-11-22 12:50:12.272
          ms: 10444
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 101
docsExamined: 101
   nreturned: 101
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(100) || true, status: NEW}}
*************************** 2. row ***************************
           #: 2
          ts: 2026-11-22 12:50:01.103
          ms: 23
          op: command
          ns: shop.orders
        plan: COLLSCAN
keysExamined: 0
docsExamined: 20000
   nreturned: 4
      client: 192.168.107.5
     command: {aggregate: orders, pipeline: [{$group: {_id: $customer.name, total: {$sum: $amount}}}], cursor: {}}
*************************** 3. row ***************************
           #: 3
          ts: 2026-11-22 12:50:01.067
          ms: 40
          op: update
          ns: shop.orders
        plan: COLLSCAN
keysExamined: 0
docsExamined: 20000
   nreturned: 
      client: 192.168.107.5
     command: {q: {customer.vip: true}, u: {$set: {level: gold}}, multi: true, upsert: false}
*************************** 4. row ***************************
           #: 4
          ts: 2026-11-22 12:50:01.025
          ms: 181
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 80
docsExamined: 80
   nreturned: 80
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(1) || true, status: NEW}, limit: 80}
4 rows in set
```

```
> mt.slow({sort: 'ms', limit: 2, vertical: true})
-- db.getSiblingDB('shop').system.profile.find({}).sort({millis: -1, ts: -1})
        db: shop
     level: 1
    slowms: 20
sampleRate: 1
*************************** 1. row ***************************
           #: 1
          ts: 2026-11-22 12:50:12.272
          ms: 10444
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 101
docsExamined: 101
   nreturned: 101
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(100) || true, status: NEW}}
*************************** 2. row ***************************
           #: 2
          ts: 2026-11-22 12:50:01.025
          ms: 181
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 80
docsExamined: 80
   nreturned: 80
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(1) || true, status: NEW}, limit: 80}
2 rows in set  (共 4 行，只显示前 2 行)
```

```
> mt.slow('crm')
-- db.getSiblingDB('crm').system.profile.find({}).sort({ts: -1})
        db: crm
     level: 0
    slowms: 20
sampleRate: 1
Empty set
没有开 profiler（level 0），可用 db.setProfilingLevel(1, {slowms: 100}) 打开
```

怎么查的：

- 先执行 `profile: -1` 拿到表头的设置（和 `db.getProfilingStatus()` 一样），再用 `count` 数出符合条件的总数，然后 `find(条件).sort(sort).limit(limit)`。所以默认拿到的是最近的 50 条，`{sort: 'ms'}` 拿到的是最慢的 50 条；总数比 `limit` 多时页脚会显示“共 N 行”。
- 总会排除读 `system.profile` 本身的操作和 `profile` 命令，否则在 level 2 下会看到 `mt.slow()` 自己。
- `docsExamined` 远大于 `nreturned`、`plan` 是 `COLLSCAN` 的，通常就是缺索引。用 `mt.explainLog(行号)` 看它的执行计划，见 [mt.explainLog()](#mtexplainlog对慢日志里的查询做-explain)；`mt.logQuery(行号)` 把它转成可以直接运行的查询语句。
- `system.profile` 是个 1 MB 的 capped 集合，满了会覆盖最早的记录，所以只能看到最近一段时间的。

### mt.profile()：profiler 设置

相当于 MySQL 的 `SHOW VARIABLES LIKE 'slow_query%'`：每个库的 profiler 开没开、过滤条件，以及 `system.profile` 存了多少、能往回查多远。执行的是 `db.getProfilingStatus()`，再对 `system.profile` 跑 `$collStats`，取最早、最晚一条。

```js
mt.profile()          // 所有库
mt.profile('shop')    // 只看一个库，也可以传 db 对象
```

| 字段 | 说明 |
|---|---|
| `slowms` / `sampleRate`（表头） | 整个实例共用，也决定哪些操作写进慢日志 |
| `db` / `level` | 库名、profiler 级别（0 关、1 只记慢操作、2 记所有操作） |
| `filter` | 过滤条件（4.4 起）；设了以后这个库不再看 slowms、sampleRate |
| `docs` / `size` | `system.profile` 里有几条、占多大 / 上限（默认 1 MB） |
| `oldest` / `window` | 最早一条的时间、最早到最晚隔了多久：慢查询能往回查多远 |

```
> mt.profile()
-- every db: db.getProfilingStatus(); system.profile: $collStats, first / last ts
    slowms: 50
sampleRate: 1
+---------+-------+------+-----------------+-------------------------+--------+
| db      | level | docs | size            | oldest                  | window |
+---------+-------+------+-----------------+-------------------------+--------+
| admin   |     0 |      |                 |                         |        |
| config  |     0 |      |                 |                         |        |
| crm     |     0 |      |                 |                         |        |
| local   |     0 |      |                 |                         |        |
| reports |     2 | 1    | 878 B / 1.0 MB  | 2026-11-23 16:31:08.401 | 5s     |
| shop    |     1 | 5    | 6.1 KB / 1.0 MB | 2026-11-23 16:31:08.105 | 0s     |
+---------+-------+------+-----------------+-------------------------+--------+
6 rows in set
注意：level 2 的库（reports）会记录所有操作，影响性能：db.setProfilingLevel(1, {slowms: 100})
```

- 这些情况会在最后提示：有库是 level 2；开着 profiler、`system.profile` 已经满了、只存了不到 1 小时；`slowms` 是 0（所有操作都会写进日志）。
- `system.profile` 是固定大小的集合，满了就覆盖最早的。要存得久，先停掉 profiler，再用 `db.createCollection('system.profile', {capped: true, size: ...})` 重建。
- level 2 的库会把 `mt.profile()` 自己的查询也记下来，所以读的过程中条数会变。
- 只能连 mongod；具体的慢查询用 `mt.slow()` 看。

### mt.qstats()：查询效率

相当于 MySQL 的 `SHOW STATUS LIKE 'Handler_read%'`：整台实例扫了多少、返回了多少、有没有全表扫描和内存排序。执行的是 `db.serverStatus()`，读其中的 `metrics`；默认间隔 1 秒采样两次，按每秒算。

```js
mt.qstats()                  // 间隔 1 秒采样两次
mt.qstats({interval: 10})    // 间隔 10 秒，数字更稳
mt.qstats({interval: 0})     // 只取一次，启动以来的累计值
mt.qstats('read,scans')      // 只看某几组
```

| 字段 | 说明 |
|---|---|
| `read.keysExamined` / `docsExamined` / `returned` | 扫描的索引键、扫描的文档、返回的文档 |
| `read.keysPerReturned` / `docsPerReturned` | 平均每返回 1 条文档扫了几个键、几条文档；`docsPerReturned` 远大于 1 说明索引不够好 |
| `scans.collScans` / `collScansNonTailable` | 全表扫描次数（4.4 起）；后者不算 oplog 这类 tailable 游标 |
| `scans.inMemorySorts` / `sortSpills` | 没用上索引、在内存里排序的次数；排序用到磁盘的次数（7.0 起） |
| `write.inserted` / `updated` / `deleted` / `conflicts` | 插入、更新、删除的文档数，写冲突次数 |
| `planCache.hits` / `misses` | 计划缓存命中、没命中的次数（7.0 起，classic 引擎） |
| `cursors.*` | 打开的游标数（其中 noTimeout、pinned 的个数），超时被关掉的游标数 |
| `killed.maxTimeMS` | 因为超过 maxTimeMS 被中止的操作（8.0 起） |

下面这个实例里，有个客户端一直在跑没有索引的查询：每返回 1 条文档要扫 900 多条，每秒 90 次全表扫描，最后两行提示了出来。

```
> mt.qstats()
-- db.serverStatus().metrics，间隔 1 秒采样两次，带 /s 的是每秒的量
         read.keysExamined/s: 90.9
         read.docsExamined/s: 4545545.5
             read.returned/s: 4818.2
        read.keysPerReturned: 0.02
        read.docsPerReturned: 943.4
           scans.collScans/s: 90.9
scans.collScansNonTailable/s: 90.9
       scans.inMemorySorts/s: 45.5
          scans.sortSpills/s: 0
            write.inserted/s: 0
             write.updated/s: 45.5
             write.deleted/s: 0
           write.conflicts/s: 0
            planCache.hits/s: 0
          planCache.misses/s: 180.8
                cursors.open: 0
           cursors.noTimeout: 0
              cursors.pinned: 0
          cursors.timedOut/s: 0
注意：平均每返回 1 条文档要扫 943.4 条：可能缺索引，用 mt.slow() 或 mt.log('Slow query') 找出具体的查询
注意：每秒有 90.9 次全表扫描：用 mt.log('COLLSCAN') 或 mt.slow() 找出来
```

- 这些是整台实例的计数，不分集合。发现问题后，用 `mt.slow()`、`mt.log('Slow query')` 找出具体的查询，再用 `mt.explainLog()` 看执行计划。
- 采样期间出现这些情况会在最后提示：每返回 1 条文档扫了 100 条以上（并且每秒扫了 1000 条以上），有全表扫描，有排序用到磁盘。`{interval: 0}` 是累计值，不提示。
- 间隔 1 秒时数字跳动大，看趋势可以用 `{interval: 10}`。
- 只能连 mongod。

### mt.explain()：执行计划

相当于 MySQL 的 `EXPLAIN`，加 `{analyze: true}` 相当于 `EXPLAIN ANALYZE`：把 explain 那一大段 JSON 排成一张表，一眼看出用了哪个索引、扫了多少、哪一步慢。

**默认只看计划，不执行查询**（`explain('queryPlanner')`），在生产库上也可以放心用；加 `{analyze: true}` 才会真的执行一遍（`explain('executionStats')`），拿到每一步扫了多少、返回多少、花了多久。

```js
mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))   // 游标：只看计划，不执行
mt.explain(db.orders.find({status: 'PAID'}), {analyze: true})        // 真的执行一遍，看扫描数、返回数、耗时
mt.explain(db.orders.explain('executionStats').aggregate([...]))     // 聚合：先 explain，再把结果交给 mt.explain
mt.explain(db.orders.aggregate([...]))                               // mongosh 里聚合游标也可以直接传
```

慢日志里的查询（`mt.slow()` / `mt.log()` 的行号、日志里的整行、命令）用 [`mt.explainLog()`](#mtexplainlog对慢日志里的查询做-explain)；想转成可以直接运行的语句用 [`mt.logQuery()`](#mtlogquery把慢日志转成查询语句)。

老的 mongo shell 的聚合游标没有 `explain()`，要用上面第三种写法，或者 `db.orders.aggregate([...], {explain: true})`（这种只有计划，没有执行统计）。也可以把自己跑好的任何 explain 结果直接传进来。

上面几行是整体情况：

| 字段 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `engine` | 执行引擎：`classic` 经典引擎，`sbe` 新的 slot-based 引擎（5.0 起部分查询使用） |
| `executionTimeMillis` | 总耗时（毫秒）；这一行到 `docsExaminedPerReturned` 只有 `{analyze: true}` 时才有 |
| `nReturned` | 返回了多少条 |
| `totalKeysExamined` / `totalDocsExamined` | 一共扫了多少索引键、多少文档 |
| `docsExaminedPerReturned` | 每返回 1 条要扫多少文档。理想是 1，几十上百说明索引不合适 |
| `rejectedPlans` | 被淘汰的候选计划个数 |

表格是计划树，**从上往下读是从结果往数据源**：最上面是最后一步，缩进最深的是最先执行的（读索引或读集合）。

| 列 | 说明 |
|---|---|
| `stage` | 阶段：`IXSCAN` 扫索引、`FETCH` 按索引取文档、`COLLSCAN` 扫整个集合、`SORT` 排序、`LIMIT`...；聚合管道里的阶段是 `$group`、`$sort` 这样 |
| `index` | 用的索引 |
| `nReturned` | 这一步输出了多少条 |
| `keysExamined` / `docsExamined` | 这一步扫了多少索引键、多少文档 |
| `ms` | 这一步的耗时估计（毫秒） |
| `detail` | 索引的扫描范围、过滤条件、排序字段、limit 等 |
| `note` | `全表扫描`（COLLSCAN）、`内存排序`（SORT：没走索引排序，数据多了会慢甚至超内存）、`用到了磁盘`、`取出后再过滤`（FETCH 后还要按条件过滤，说明索引没覆盖所有条件）、`多键索引` |

走对了索引的：每一步的扫描数和返回数都是 5。

```
> mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}).limit(5), {analyze: true})
-- cursor.explain('executionStats')
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 0
              nReturned: 5
      totalKeysExamined: 5
      totalDocsExamined: 5
docsExaminedPerReturned: 1
          rejectedPlans: 0
+------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
| stage      | index                 | nReturned | keysExamined | docsExamined | ms | detail                                   | note |
+------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
| LIMIT      |                       |         5 |              |              |  0 | limit 5                                  |      |
|   FETCH    |                       |         5 |              |            5 |  0 |                                          |      |
|     IXSCAN | status_1_createdAt_-1 |         5 |            5 |              |  0 | status ["PAID", "PAID"], createdAt [M... |      |
+------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
3 rows in set
```

没有合适的索引：扫了整个集合 2 万条，只要其中 1000 条，还要在内存里排序。这时可以建 `{'customer.name': 1, amount: -1}` 这样的索引。

```
> mt.explain(db.orders.find({'customer.name': 'Bob', amount: {$gt: 400}}).sort({amount: -1}), {analyze: true})
-- cursor.explain('executionStats')
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 5
              nReturned: 1000
      totalKeysExamined: 0
      totalDocsExamined: 20000
docsExaminedPerReturned: 20
          rejectedPlans: 0
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------+
| stage      | index | nReturned | keysExamined | docsExamined | ms | detail                                   | note     |
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------+
| SORT       |       |      1000 |              |              |  0 | sort {amount: -1}                        | 内存排序 |
|   COLLSCAN |       |      1000 |              |        20000 |  0 | filter {$and: [{customer.name: {$eq: ... | 全表扫描 |
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------+
2 rows in set
注意：内存排序；全表扫描
```

聚合：`$match` 下推成了索引扫描，后面的 `$group`、`$sort` 在上面。

```
> mt.explain(db.orders.explain('executionStats').aggregate([{$match: {status: 'NEW'}}, {$group: {_id: '$customer.name', total: {$sum: '$amount'}}}, {$sort: {total: -1}}]))
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 8
              nReturned: 6667
      totalKeysExamined: 6667
      totalDocsExamined: 6667
docsExaminedPerReturned: 1
          rejectedPlans: 0
+------------------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
| stage                  | index                 | nReturned | keysExamined | docsExamined | ms | detail                                   | note |
+------------------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
| $sort                  |                       |         4 |              |              |  6 | {sortKey: {total: -1}}                   |      |
|   $group               |                       |         4 |              |              |  6 | {_id: $customer.name, total: {$sum: $... |      |
|     PROJECTION_DEFAULT |                       |      6667 |              |              |  0 | {amount: 1, customer.name: 1, _id: 0}    |      |
|       FETCH            |                       |      6667 |              |         6667 |  0 |                                          |      |
|         IXSCAN         | status_1_createdAt_-1 |      6667 |         6667 |              |  0 | status ["NEW", "NEW"], createdAt [Max... |      |
+------------------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
5 rows in set
```

- 默认只看计划：表格里只有计划，没有扫描数、返回数、耗时这几列，也看不出 `docsExaminedPerReturned`；但全表扫描、内存排序、取出后再过滤这些在计划里就能看出来。
- `{analyze: true}` 会真的执行一遍查询来统计，大查询要注意耗时；写操作（update / delete）只统计，不会真的改数据。
- 传进来的如果已经是 explain 的结果（如上面第三种写法），里面有什么就显示什么，`analyze` 不起作用。
- `sbe` 引擎的计划只拿得到每一步的返回行数和耗时，扫描行数只有上面的合计。
- 分片集群（mongos）的计划会按分片分开显示，但还没测过。

### mt.explainLog()：对慢日志里的查询做 explain

不用自己把慢查询改写成 `find().sort().limit()`，按手里有的东西选一种写法（只想转成查询语句、不做 explain，用下一节的 `mt.logQuery()`，写法一样）：

| 手里有的 | 写法 |
|---|---|
| `mt.slow()` / `mt.log()` 刚列出来的行 | `mt.explainLog(行号)` |
| 日志文件里的一整行（4.4 起的 JSON，或之前的文本） | 整行用反引号包起来：``mt.explainLog(`整行`)`` |
| 日志里命令那一段，从 `{` 开始 | 用反引号包起来：``mt.explainLog(`{ find: ... }`)`` |
| `system.profile` 里的一条 | `mt.explainLog(db.system.profile.findOne(...))` |
| 自己写的命令 | `mt.explainLog({find: 'orders', filter: {...}, ...}, {db: '库名'})` |

**慢日志里记录的执行情况**

从慢日志来的（行号、整行日志、profile 文档），会先列出日志里记下的、**当时在线上实际执行的情况**，再显示现在的执行计划。默认只看计划、不执行，这部分就是唯一的实际数据：

| 字段 | 说明 |
|---|---|
| `time` / `durationMillis` | 什么时候执行的、花了多少毫秒 |
| `planSummary` | 当时用的计划，如 `COLLSCAN`、`IXSCAN { status: 1 }` |
| `keysExamined` / `docsExamined` / `nreturned` | 扫了多少索引键、多少文档，返回多少条 |
| `docsExaminedPerReturned` | 每返回 1 条扫了多少文档 |
| `hasSortStage` / `usedDisk` | 在内存里排了序、用到了磁盘 |
| `numYields` / `writeConflicts` | 让出锁的次数、写冲突次数 |
| `nMatched` / `nModified` / `ndeleted` / `ninserted` | 写操作匹配、修改、删除、插入了多少 |
| `reslen` / `bytesRead` / `readMs` | 返回的字节数；从磁盘读了多少、花了多久（4.4 起） |
| `queryHash` / `planCacheKey` | 查询形状和计划缓存的键，可以用 `mt.planCache(集合, {hash: ...})` 查缓存的计划 |
| `appName` / `client` | 应用名、客户端；经 mongos 转发的，取命令里 `$client.mongos.client` 的真正客户端 |

如果当时的计划和现在的不一样（比如当时 `COLLSCAN`、现在已经能走索引了），最后会提示出来。只给命令（`{ find: ... }` 或 JS 对象）时没有这一段。

**1. 按行号（最省事）**

```js
mt.slow({sort: 'ms'})                       // profiler 里的慢查询，每行前面有行号 #
mt.explainLog(1)                               // 第 1 行的执行计划

mt.log('Slow query', {n: 10})               // 日志里的慢查询（4.4 起）
mt.log('command: find', {n: 10})            // 4.4 之前的文本日志这样找
mt.explainLog(3)                               // 第 3 行的执行计划
```

`mt.explainLog(n)` 用的是**最近一次** `mt.slow()` 或 `mt.log()` 列出的行。

**2. 从日志文件里复制一整行**

先在服务器上找到那一行，比如：

```bash
grep 'Slow query' /var/log/mongodb/mongod.log | grep orders | tail -1          # 4.4 起
grep 'command: find' /var/log/mongodb/mongod.log | grep orders | tail -1      # 4.4 之前
```

整行原样复制，在 mongosh 里用**反引号**包起来传进去（行里的单引号、双引号都不用改）：

```js
mt.explainLog(`2026-11-21T15:46:55.624+0000 I COMMAND  [conn2166] command shop.orders appName: "order-service" command: find { find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, projection: { $sortKey: { $meta: "sortKey" } }, sort: { createdAt: -1 }, limit: 20, shardVersion: [ Timestamp(0, 0), ObjectId('000000000000000000000000') ], $clusterTime: { clusterTime: Timestamp(1795276015, 2), signature: { hash: BinData(0, D9414CF6101A9BBBE43BC15ACE884BFEDC177A72), keyId: 7710591826859655200 } }, $db: "shop" } planSummary: COLLSCAN keysExamined:0 docsExamined:1005163 hasSortStage:1 nreturned:1 465ms`)
```

实际执行的是：

```js
db.getSiblingDB('shop').runCommand({explain: {find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, verbosity: 'queryPlanner'})
```

库名、集合名都从这一行里取；`shardVersion`、`$clusterTime`、`$sortKey` 这些自动去掉。4.4 起的 JSON 日志行也一样整行传进来。老的 mongo shell 没有反引号，用单引号包起来，行里的单引号要写成 `\'`。

下面是 4.0 上的真实例子：日志文件里记下了一条全表扫描的慢查询，之后建了 `{userId: 1, createdAt: -1}` 索引。把日志里这一行：

```
2026-11-22T14:27:34.496+0000 I COMMAND  [conn5] command shop.orders appName: "mongosh 1.10.6" command: find { find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, sort: { createdAt: -1 }, limit: 20, lsid: { id: UUID("e5f5814f-9742-4c65-a48b-b66c69dcb964") }, $clusterTime: { clusterTime: Timestamp(1795357654, 47170), signature: { hash: BinData(0, 0000000000000000000000000000000000000000), keyId: 0 } }, $db: "shop" } planSummary: COLLSCAN keysExamined:0 docsExamined:200000 hasSortStage:1 cursorExhausted:1 numYields:1562 nreturned:20 reslen:2035 locks:{ Global: { acquireCount: { r: 1563 } }, Database: { acquireCount: { r: 1563 } }, Collection: { acquireCount: { r: 1563 } } } storage:{} protocol:op_msg 43ms
```

整行传进去：

```
> mt.explainLog(`...上面那一整行...`)
慢日志里记录的执行情况（当时实际跑的）：
                   time: 2026-11-22 14:27:34.496
         durationMillis: 43
            planSummary: COLLSCAN
           keysExamined: 0
           docsExamined: 200000
              nreturned: 20
docsExaminedPerReturned: 10000
           hasSortStage: true
              numYields: 1562
                 reslen: 2035
                appName: mongosh 1.10.6

-- db.getSiblingDB('shop').runCommand({explain: {find: orders, filter: {userId: 24530, status: {$in: [paid, shipped, completed]}}, sort: {createdAt: -1}, limit: 20}, verbosity: 'queryPlanner'})
           ns: shop.orders
       engine: classic
rejectedPlans: 0
+------------+-----------------------+------------------------------------------+--------------+
| stage      | index                 | detail                                   | note         |
+------------+-----------------------+------------------------------------------+--------------+
| LIMIT      |                       | limit 20                                 |              |
|   FETCH    |                       | filter {status: {$in: [completed, pai... | 取出后再过滤 |
|     IXSCAN | userId_1_createdAt_-1 | userId [24530, 24530], createdAt [Max... |              |
+------------+-----------------------+------------------------------------------+--------------+
3 rows in set
注意：取出后再过滤
注意：慢日志里用的是 COLLSCAN，现在的计划是 IXSCAN { userId: 1, createdAt: -1 }（索引、数据分布或计划缓存可能变了）
```

当时扫了 20 万条只返回 20 条、还在内存里排序；现在已经能走新建的索引了，最后一行提示两者不一样。要看现在实际扫多少、花多久，再加上 `{analyze: true}`。

**3. 只复制命令那一段**

从 `command: find ` 后面的 `{` 开始，到对应的 `}` 为止（后面多带了 `planSummary: ...` 也没关系），同样用反引号包起来：

```js
mt.explainLog(`{ find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, sort: { createdAt: -1 }, limit: 20, $db: "shop" }`)
```

库名取命令里的 `$db`；没有 `$db` 时先 `use 库名`，或者加选项 `{db: 'shop'}`。

**4. 自己写命令**

只挑关键的几项手写，直接写成 JS 对象（字符串加引号）：

```js
mt.explainLog({find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, {db: 'shop'})
```

**会报错的写法**

- 从 `mt.slow()` / `mt.log()` **表格里**复制命令：表格里的命令去掉了引号和类型，没法还原。用行号。
- 从 `command: find {` 或 `find {` 开始复制：要从 `{` 开始。
- 把日志里的命令**不加引号**直接当 JS 对象写：`BinData(0, D941...)` 里的十六进制、`customer.name` 这种带点的字段名都不是合法的 JS，会报语法错误。用反引号包成字符串。
- 日志行超过 10 KB 会被 MongoDB 截断，中间变成 `...`，这种解析不了，改用 `mt.slow()`。

怎么处理的：

- 去掉 mongos、驱动加的字段（`shardVersion`、`databaseVersion`、`lsid`、`$clusterTime`、`readConcern`、投影里的 `$sortKey`...），再用 `db.runCommand({explain: 命令, verbosity: 'queryPlanner'})` 执行（`{analyze: true}` 时是 `'executionStats'`）。
- 在哪个库上执行：命令里的 `$db`，或者 `ns` 的库名；都没有就用 `{db: 'shop'}` 选项，再没有就是当前库。
- 支持 `find`、`aggregate`、`count`、`distinct`、`update`、`delete`、`findAndModify`。profile 和日志里单条的 update / remove 会自动包成 `update` / `delete` 命令；getMore 用它的原始命令（`originatingCommand`）。explain 写操作不会真的修改数据。
- JSON 日志里的 `{"$date": ...}`、`{"$oid": ...}`、`{"$numberLong": ...}` 会换回真正的类型，否则条件就对不上了。
- 先把整行解析完：命令用来做 explain，命令后面的 `planSummary`、`keysExamined`、`docsExamined`、`nreturned`、`hasSortStage`、`numYields`、`reslen`、耗时等就是上面「慢日志里记录的执行情况」；4.4 起的 JSON 行从 `attr` 里取，profile 文档从对应字段取。
- 4.2 及之前，`getLog`（也就是 `mt.log()`）每行只保留前 512 个字符，命令长的话会被截断：截在命令里就没法 explain，截在后面就缺了耗时等字段。从日志**文件**里复制整行没有这个限制。
- 4.4 之前的文本日志，命令部分是 shell 写法：字段名不带引号、`ObjectId('...')`、`Timestamp(1, 2)`、`new Date(...)`、十六进制的 `BinData(0, D941...)`。这些都会解析成对应的类型（不用 `eval`），超过 2^53 的整数按 `NumberLong` 处理。

```
> mt.slow({sort: 'ms', cols: '#,ms,op,plan,docsExamined,nreturned,command'})
-- db.getSiblingDB('shop').system.profile.find({}).sort({millis: -1, ts: -1})
        db: shop
     level: 1
    slowms: 20
sampleRate: 1
+---+----+-------+----------------------+--------------+-----------+------------------------------------------+
| # | ms | op    | plan                 | docsExamined | nreturned | command                                  |
+---+----+-------+----------------------+--------------+-----------+------------------------------------------+
| 1 | 59 | query | IXSCAN { status: 1 } |        66667 |        40 | {find: orders, filter: {status: shipp... |
+---+----+-------+----------------------+--------------+-----------+------------------------------------------+
1 row in set
```

```
> mt.explainLog(1, {analyze: true})
慢日志里记录的执行情况（当时实际跑的）：
                   time: 2026-11-22 14:28:31.181
         durationMillis: 59
            planSummary: IXSCAN { status: 1 }
           keysExamined: 66667
           docsExamined: 66667
              nreturned: 40
docsExaminedPerReturned: 1666.7
           hasSortStage: true
              numYields: 66
                 reslen: 4175
              bytesRead: 1.2 MB
                 readMs: 0.9
              queryHash: 99CCC831
           planCacheKey: 0C7BC6BB
                appName: mongosh 2.14.2
                 client: 127.0.0.1

-- db.getSiblingDB('shop').runCommand({explain: {find: orders, filter: {status: shipped, amount: {$gte: 3000}}, sort: {createdAt: -1}, limit: 40}, verbosity: 'executionStats'})
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 70
              nReturned: 40
      totalKeysExamined: 66667
      totalDocsExamined: 66667
docsExaminedPerReturned: 1666.7
          rejectedPlans: 0
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
| stage      | index    | nReturned | keysExamined | docsExamined | ms | detail                        | note         |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
| SORT       |          |        40 |              |              |  4 | sort {createdAt: -1}          | 内存排序     |
|   FETCH    |          |     26667 |              |        66667 |  3 | filter {amount: {$gte: 3000}} | 取出后再过滤 |
|     IXSCAN | status_1 |     66667 |        66667 |              |  1 | status ["shipped", "shipped"] |              |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
3 rows in set
注意：内存排序；取出后再过滤
```

扫了 6 万多条只为返回 40 条（`docsExaminedPerReturned: 1666.7`）：`status_1` 只能按 `status` 找，`amount` 要取出文档再过滤，`createdAt` 还要在内存里排序。改成 `{status: 1, createdAt: -1, amount: 1}`（等值字段、排序字段、范围字段的顺序）就能顺着索引排好序，`amount` 也在索引里过滤掉。

### mt.logQuery()：把慢日志转成查询语句

和 `mt.explainLog()` 接受的东西一样（行号、整行日志、命令片段、profile 文档、命令对象），但不做 explain、什么都不执行，只打印出等价的、可以直接运行的 mongosh 语句。方便改条件、加 `.hint()`、拿到测试环境上重跑，或者再交给 `mt.explain()`。

```js
mt.slow({sort: 'ms'})
mt.logQuery(1)                 // 第 1 行转成查询语句
mt.logQuery(`整行日志`)          // 日志文件里复制的整行
```

```
> mt.logQuery(`...整行...`)
// 慢日志：2026-11-22 14:27:34.496，43ms，COLLSCAN，docsExamined 200000，nreturned 20，mongosh 1.10.6
db.getSiblingDB('shop').orders.find({userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}).sort({createdAt: -1}).limit(20)

> mt.logQuery({update: 'orders', updates: [{q: {status: 'new', createdAt: {$lt: ISODate('2024-01-01T00:00:00Z')}}, u: {$set: {status: 'expired'}}, multi: true}], $db: 'shop'})
// 注意：这是写操作，执行会修改数据
db.getSiblingDB('shop').orders.updateMany({status: 'new', createdAt: {$lt: ISODate('2024-01-01T00:00:00.000Z')}}, {$set: {status: 'expired'}})
```

- 来自慢日志的，第一行注释写着当时的时间、耗时、计划、扫描数和返回数，复制整段也不影响执行。
- 类型照原样写出来：日期是 `ISODate('...')`，还有 `ObjectId('...')`、`NumberLong('...')`、`NumberDecimal('...')`、`UUID('...')`、正则等；字段名带点的会加引号。
- 和 explain 一样去掉 mongos、驱动加的字段（`shardVersion`、`lsid`、`$clusterTime`、`$sortKey`...）。
- find 写成 `.find(filter, projection).sort().skip().limit().hint()...`；aggregate、count、distinct 写成对应的方法；update / delete 按 `multi` / `limit` 写成 `updateOne` / `updateMany` / `replaceOne` / `deleteOne` / `deleteMany`，findAndModify 写成 `findOneAndUpdate` 等。**写操作前面会加一行注释提醒，执行会真的修改数据。**
- 集合名和数据库的方法重名（如 `stats`）或者不是合法的标识符时，写成 `getCollection('...')`。

### mt.planCache()：计划缓存

线上为什么选了“错误”的索引？MongoDB 会把同一种查询形状选出来的计划缓存起来，后面直接用。这个命令列出集合里缓存的计划。

```js
mt.planCache('orders')                          // 每种查询形状缓存的计划
mt.planCache('orders', {hash: 'AF0F05C1'})      // 按 queryHash 或 planCacheKey 找
```

`mt.explainLog()` 列出的「慢日志里记录的执行情况」里有 `queryHash` / `planCacheKey`，拿来这里一查，就知道这种查询缓存的是哪个计划。

| 列 | 说明 |
|---|---|
| `hash` / `planCacheKey` | 查询形状的哈希（8.0 叫 `planCacheShapeHash`）、计划缓存的键 |
| `active` | 是否生效；不生效的还在试用期 |
| `works` | 评估这个计划时的工作量，越小越好 |
| `shape` | 查询形状：条件、`sort`、`proj` |
| `plan` | 缓存的计划用了什么扫描，如 `IXSCAN { status: 1 }`；SBE 计划只显示 `(SBE 计划)` |
| `created` | 缓存的时间 |

```
> mt.planCache('orders')
-- db.getSiblingDB('shop').getCollection('orders').aggregate([{$planCacheStats: {}}])
+----------+--------------+--------+-------+--------------------------------------------------------+-----------------------------+-------------------------+
| hash     | planCacheKey | active | works | shape                                                  | plan                        | created                 |
+----------+--------------+--------+-------+--------------------------------------------------------+-----------------------------+-------------------------+
| 9375056E | 59E1C32C     | true   |    82 | {status: PAID, customer.name: c1} sort {createdAt: -1} | IXSCAN { customer.name: 1 } | 2026-11-22 16:45:46.509 |
+----------+--------------+--------+-------+--------------------------------------------------------+-----------------------------+-------------------------+
1 row in set
```

上面这种 `{status, customer.name}` 加按 `createdAt` 排序的查询，缓存的是 `customer.name_1`，而不是 `status_1_createdAt_-1`。

- 4.2 起用 `$planCacheStats`；3.6 / 4.0 没有这个阶段，改用 `planCacheListQueryShapes` / `planCacheListPlans`，没有 `hash`、`active`、`created` 这几列。
- 计划缓存在内存里，每个节点各自一份，重启、建删索引后清空；只有存在多个候选计划的查询才会被缓存。
- 清掉某个集合的缓存：`db.orders.getPlanCache().clear()`（会影响正在跑的同类查询，慎用；MongoTab 不会替你执行）。

### mt.top()：各集合读写耗时

类似 mongotop，看哪些集合最忙。

```js
mt.top()                    // 间隔 1 秒采样两次，看这 1 秒内的耗时
mt.top({interval: 5})       // 间隔 5 秒
mt.top({interval: 0})       // 只取一次，看启动以来的累计值
mt.top({ns: 'shop'})        // 只看 shop 库；'shop.orders' 只看这一个集合
```

| 列 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `totalMs` | 这段时间里所有操作的耗时（毫秒） |
| `readMs` / `writeMs` | 其中读锁、写锁的耗时 |
| `ops` | 操作次数 |

```
> mt.top()
-- db.adminCommand({top: 1})，间隔 1 秒采样两次，显示这段时间内的耗时（毫秒）
+----------------+---------+--------+---------+-----+
| ns             | totalMs | readMs | writeMs | ops |
+----------------+---------+--------+---------+-----+
| shop.orders    |   10318 |  10318 |       0 |   1 |
| local.oplog.rs |       1 |      1 |       0 |   2 |
+----------------+---------+--------+---------+-----+
2 rows in set
```

```
> mt.top({interval: 0, ns: 'shop'})
-- db.adminCommand({top: 1})，启动以来累计（毫秒）
+---------------------+---------+--------+---------+-----+
| ns                  | totalMs | readMs | writeMs | ops |
+---------------------+---------+--------+---------+-----+
| shop.orders         |   10869 |  10511 |     359 |  49 |
| shop.users          |       8 |      0 |       8 |   1 |
| shop.system.profile |       1 |      1 |       0 |   4 |
| shop.system.js      |       0 |      0 |       0 |   4 |
+---------------------+---------+--------+---------+-----+
4 rows in set
```

怎么算的：

- 执行的是 `db.adminCommand({top: 1})`。mongod 按集合累计了启动以来的耗时（微秒）和次数：

  ```js
  totals: {
    "shop.orders": {
      total:     { time: 244000, count: 22 },   // 所有操作
      readLock:  { time: 2000,   count: 5 },    // 读
      writeLock: { time: 242000, count: 17 },   // 写
      ...
    },
    ...
  }
  ```

- 默认取两次，中间 `sleep` 1 秒，两次相减就是这 1 秒内每个集合花的时间；`totalMs`、`readMs`、`writeMs` 分别来自 `total`、`readLock`、`writeLock` 的 `time`（换成毫秒，取整），`ops` 来自 `total.count`。
- 这段时间里没有操作的集合不显示，按 `totalMs` 从大到小排。
- `top` 是在操作**结束时**才记时间的：还在跑的长查询要等它结束才算进来，结束时一次记下全部耗时。所以上面 1 秒的采样里会出现 `shop.orders` 1 万多毫秒，那是一个刚跑完一批的长查询；还在跑的操作看 `mt.ps()`。
- 有些操作不算读锁也不算写锁，所以 `readMs + writeMs` 可能小于 `totalMs`。

### mt.latency()：读写延迟

`mt.top()` 看的是各集合一共花了多少时间，`mt.latency()` 看的是平均每次操作多慢。

```js
mt.latency()                // 间隔 1 秒采样两次，看这 1 秒内的平均延迟
mt.latency('shop')          // 只看一个库；默认所有用户库（跳过 admin、local、config）
mt.latency({interval: 5})   // 间隔 5 秒
mt.latency({interval: 0})   // 只取一次，看启动以来的平均值
```

上面几行是整台的情况（`serverStatus().opLatencies`）：`reads` / `writes` / `commands` / `transactions` 的平均延迟 `avgMs`，以及每秒次数 `ops/s`（启动以来时是总次数 `ops`）。下面是各集合（`$collStats` 的 `latencyStats`）：

| 列 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `readOps` / `readMs` | 读的次数、平均延迟（毫秒） |
| `writeOps` / `writeMs` | 写的次数、平均延迟 |
| `cmdOps` / `cmdMs` | 其他命令的次数、平均延迟 |
| `totalMs` | 这段时间里花的总时间，按它从大到小排 |

```
> mt.latency()
-- db.serverStatus().opLatencies; every user db: each collection aggregate([{$collStats: {latencyStats: {}}}])，间隔 1 秒采样两次，显示这段时间内的平均延迟（毫秒）
       reads.avgMs: 1.81
       reads.ops/s: 78
      writes.avgMs: 4.26
      writes.ops/s: 48
    commands.ops/s: 0
transactions.ops/s: 0
+-------------+---------+--------+----------+---------+--------+-------+---------+
| ns          | readOps | readMs | writeOps | writeMs | cmdOps | cmdMs | totalMs |
+-------------+---------+--------+----------+---------+--------+-------+---------+
| shop.orders |      55 |   0.54 |       52 |    0.33 |      0 |       |      47 |
| shop.users  |      25 |   0.18 |        0 |         |      0 |       |       5 |
+-------------+---------+--------+----------+---------+--------+-------+---------+
2 rows in set
```

- 延迟是 mongod 处理请求的时间，不含网络往返。
- 这段时间里没有操作的集合不显示。
- `mt.latency()` 自己调用 `serverStatus`、`$collStats` 也会被 MongoDB 计数：采样时会先测出这些探测的次数和耗时，再从结果里减掉，所以安静的实例上看到的是 0，而不是自己的探测。
- 要对每个集合各执行几次 `$collStats`，集合很多时会慢，可以指定一个库。

### mt.locks()：谁在等锁

相当于 MySQL 的 `sys.innodb_lock_waits`：哪些操作在排队等锁，锁又被谁占着。

```js
mt.locks()              // 只看有人排队的锁，以及挡住它们的持有者
mt.locks({all: true})   // 所有被占用的锁，包括没人排队的
```

用 `db.adminCommand({lockInfo: 1})` 拿到每个锁资源的持有者（granted）和排队者（pending），再按 opid 关联 `currentOp`，补上运行时间、客户端和命令。

| 列 | 说明 |
|---|---|
| `resource` | 锁资源，如 `Database shop`、`Collection shop.orders`；全局一级的锁显示成 `Global 3` 这样的编号，编号随版本不同 |
| `mode` | 锁模式：`IS` / `IX` 意向共享 / 意向排他，`S` 共享，`X` 排他（`currentOp` 里写作 `r` / `w` / `R` / `W`） |
| `state` | `HOLD` 占着，`WAIT` 在排队 |
| `opid` / `secs` | 操作 ID、已经运行的秒数；`db.killOp(opid)` 可以杀掉 |
| `client` / `desc` | 客户端；`desc` 是连接名（如 `conn31`）或内部线程名（如 `fsyncLockWorker`） |
| `op` / `ns` / `command` | 操作类型、库.集合、命令内容 |

下面是 `db.fsyncLock()` 之后的样子：`fsyncLockWorker` 以 `S` 模式占着全局锁，写入（`IX`）全都在排队，直到 `db.fsyncUnlock()`。备份时锁了忘记解，就是这个现象。

```
> mt.locks()
-- db.adminCommand({lockInfo: 1}); db.adminCommand({currentOp: 1, $all: true})
+----------+------+-------+------+------+---------------------+------------------+--------+----------+------------------------------------------+
| resource | mode | state | opid | secs | client              | desc             | op     | ns       | command                                  |
+----------+------+-------+------+------+---------------------+------------------+--------+----------+------------------------------------------+
| Global 3 | S    | HOLD  | 1827 |      |                     | fsyncLockWorker  | none   |          |                                          |
| Global 3 | IX   | WAIT  | 1821 |      |                     | JournalFlusher   | none   |          |                                          |
| Global 3 | IX   | WAIT  | 1828 |      |                     | TimestampMonitor | none   |          |                                          |
| Global 3 | IX   | WAIT  | 1830 |    0 | 192.168.117.4:42734 | conn31           | insert | mtlock.c | {insert: c, documents: [{i: 21, _id: ... |
+----------+------+-------+------+------+---------------------+------------------+--------+----------+------------------------------------------+
4 rows in set
```

- 默认只列和排队者冲突的持有者：`IS` 和 `S` 不冲突，所以正在跑的读操作不会出现在上面。想看全部用 `{all: true}`。
- WiredTiger 是文档级并发，普通读写之间的冲突是重试（WriteConflict），不是等锁，不会出现在这里。会等锁的多是 `fsyncLock`、建索引的开始和结束、`collMod`、`renameCollection`、`drop` 这类要排他锁的操作。
- 4.2 的全局锁不在 `lockInfo` 里，这时从 `currentOp` 的 `waitingForLock` 补上：排队者等的是它 `locks` 里的最后一项，持有者是同一把锁上模式冲突的操作。

### mt.txns()：未提交的事务

相当于 MySQL 的 `INFORMATION_SCHEMA.INNODB_TRX`。事务从 MongoDB 4.0 起才有。

```js
mt.txns()                 // 开得最久的在前
mt.txns({secs: 10})       // 只看开了 10 秒以上的
mt.txns({sort: 'asc'})    // 最短的在前；也可以给排序文档如 {client: 1}
```

执行的是 `db.adminCommand({currentOp: 1, $all: true})`，只取带 `transaction` 字段的；两条语句之间空闲的事务也在里面（`type: idleSession`）。

| 列 | 说明 |
|---|---|
| `lsid` / `txnNumber` | 会话 ID 和会话里的事务编号 |
| `state` | `active` 正在执行语句，`idle` 两条语句之间空闲 |
| `openSecs` | 事务已经开了多久 |
| `activeSecs` / `idleSecs` | 其中执行语句、空闲的时间 |
| `start` | 事务开始的时间 |
| `expiresIn` | 再过多少秒会被自动中止（`transactionLifetimeLimitSeconds`，默认 60 秒） |
| `opid` / `ns` | 正在执行时的操作 ID、库.集合 |
| `client` / `app` | 客户端、appName |

```
> mt.txns()
-- db.adminCommand({currentOp: 1, $all: true}) → transaction
+--------------------------------------+-----------+-------+----------+------------+----------+-------------------------+-----------+------+---------------------+----------------+----+
| lsid                                 | txnNumber | state | openSecs | activeSecs | idleSecs | start                   | expiresIn | opid | client              | app            | ns |
+--------------------------------------+-----------+-------+----------+------------+----------+-------------------------+-----------+------+---------------------+----------------+----+
| 02581e23-79b1-42d1-80e5-e71a10e947a7 |         3 | idle  |        0 |          0 |        0 | 2026-11-22 08:26:06.151 |        60 |      | 192.168.117.5:45476 | mongosh 2.14.2 |    |
+--------------------------------------+-----------+-------+----------+------------+----------+-------------------------+-----------+------+---------------------+----------------+----+
1 row in set
```

- 长时间不提交的事务会一直占着 WiredTiger 缓存里的旧版本数据，`idleSecs` 很大的通常是应用忘了 commit / abort。
- 想立刻结束一个事务：`db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})`。

### mt.repl()：副本集状态

相当于 `SHOW SLAVE STATUS`，执行的是 `rs.status()`。只能在副本集成员上执行。

| 列 | 说明 |
|---|---|
| `name` | 成员地址 |
| `state` | `PRIMARY`、`SECONDARY`、`ARBITER`、`RECOVERING`... |
| `health` | 1 正常，0 连不上 |
| `lagSecs` | 复制延迟（秒）：主节点的 optime 减去这个成员的；没有主节点时和 optime 最新的成员比 |
| `optime` | 这个成员最后应用的操作时间 |
| `syncSource` | 从哪个成员同步 |
| `pingMs` | 心跳往返时间 |
| `lastHeartbeat` | 最后一次收到心跳的时间 |
| `self` | `*` 是当前连接的成员 |

```
> mt.repl()
-- rs.status()
 set: rs0
date: 2026-11-22 08:05:48.819
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| name      | state     | health | lagSecs | optime              | syncSource | pingMs | lastHeartbeat           | self |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| db1:27017 | PRIMARY   |      1 |       0 | 2026-11-22 08:05:37 |            |        |                         | *    |
| db2:27017 | SECONDARY |      1 |       0 | 2026-11-22 08:05:37 | db1:27017  |      0 | 2026-11-22 08:05:48.320 |      |
| db3:27017 | SECONDARY |      1 |       0 | 2026-11-22 08:05:37 | db1:27017  |      0 | 2026-11-22 08:05:48.321 |      |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
3 rows in set
```

### mt.rsconf()：副本集配置

把 `rs.conf()` 排成表，加上各成员现在的状态（`rs.status()`）和默认读写关注（4.4 起），相当于 MySQL 的 `SHOW SLAVE HOSTS` 加上复制相关的配置。

```js
mt.rsconf()                                // 成员配置和选举设置
mt.rsconf({cols: 'host,priority,votes'})   // 只看某几列
```

| 字段 | 说明 |
|---|---|
| 表头 | set、version、term（4.4 起）、chainingAllowed、选举和心跳的超时、`majorityJournalDefault`（即 `writeConcernMajorityJournalDefault`）、自定义的写关注模式、默认读写关注（4.4 起，括号里是来源：`implicit` 隐含的默认值，`global` 用 setDefaultRWConcern 设过） |
| `id` / `host` | 成员编号、地址 |
| `state` | 现在的状态（来自 `rs.status()`） |
| `priority` / `votes` | 选举优先级、有没有投票权 |
| `arbiter` / `hidden` / `delay` / `buildIndexes` / `tags` | 仲裁节点、隐藏、延迟复制多久、不建索引、标签；只在有成员用到时才显示这一列 |

下面是 3 个数据节点加 1 个仲裁节点的副本集，`db3` 是隐藏、延迟 1 小时的备份节点，但还有投票权。最后三行提示了这几处配置问题：

```
> mt.rsconf()
-- rs.conf(); rs.status(); db.adminCommand({getDefaultRWConcern: 1})
                    set: rs0
                version: 2
                   term: 1
        protocolVersion: 1
        chainingAllowed: true
  electionTimeoutMillis: 10000
heartbeatIntervalMillis: 2000
   catchUpTimeoutMillis: -1
 majorityJournalDefault: true
    defaultWriteConcern: {w: 1, wtimeout: 0} (global)
     defaultReadConcern: {level: local} (implicit)
+----+-----------+-----------+----------+-------+---------+--------+-------+--------------+
| id | host      | state     | priority | votes | arbiter | hidden | delay | tags         |
+----+-----------+-----------+----------+-------+---------+--------+-------+--------------+
|  0 | db1:27017 | PRIMARY   |        2 |     1 |         |        |       |              |
|  1 | db2:27017 | SECONDARY |        1 |     1 |         |        |       |              |
|  2 | db3:27017 | SECONDARY |        0 |     1 |         | true   | 1h 0m | {dc: backup} |
|  3 | arb:27017 | ARBITER   |        0 |     1 | true    |        |       |              |
+----+-----------+-----------+----------+-------+---------+--------+-------+--------------+
4 rows in set
注意：有投票权的成员是偶数个（4 个）：能容忍挂掉的个数和少一个成员时一样，建议改成奇数个
注意：有仲裁节点：一个数据节点挂掉后，w: 'majority' 的写入会等不到确认，缓存压力也会变大；能换成数据节点最好
注意：延迟成员有投票权（db3:27017）：w: 'majority' 的写入可能要等它，建议设成 votes: 0
```

- 这些情况会在最后提示：有投票权的成员是偶数个；有仲裁节点（PSA 架构里一个数据节点挂掉后，`w: 'majority'` 的写入等不到确认）；延迟成员有投票权。
- 延迟的字段 5.0 起叫 `secondaryDelaySecs`，之前叫 `slaveDelay`，这里都显示成 `delay`。
- 只适用于副本集；单机、mongos 上只打印一行说明。各成员的复制延迟看 `mt.repl()`。

### mt.shards()：分片集群

相当于 `sh.status()`，排成两张表：各分片的情况，以及各分片集合的块分布。要连 mongos。

```js
mt.shards()          // 均衡器、各分片、所有分片的集合
mt.shards('shop')    // 只看一个库的分片集合，也可以传 db 对象
```

| 字段 | 说明 |
|---|---|
| 表头 | `balancer`（均衡器的模式，正在做一轮时会注明）、`activeWindow`（设了均衡时间窗才有）、`chunkSizeMB`（设过才有）、分片数、分片集合数 |
| 分片：`shard` / `host` | 分片名、副本集地址 |
| `draining` | `true`：removeShard 之后正在排空 |
| `zones` | 分片所在的区域 |
| `chunks` / `size` | 这个分片上的块数；数据量（6.0.3 起，来自 `$shardedDataDistribution`） |
| `primaryFor` | 哪些库的主分片是它（没分片的集合都放在主分片上） |
| 分片的集合：`ns` / `key` / `unique` | 集合、分片键、是否唯一 |
| `chunks` / `distribution` | 总块数；每个分片上几块（6.0.3 起括号里是数据量） |
| `jumbo` / `orphans` | jumbo 块的个数；孤儿文档数（6.0.3 起，迁移后还没删掉的） |

下面是 3 个分片的集群：均衡器关着，`sh3` 在排空，`shop.orders` 刚把两块迁到 `sh2`，`sh1` 上还留着 2000 条等着清理的孤儿文档：

```
> mt.shards()
-- listShards, balancerStatus, config.settings / databases / collections / chunks, $shardedDataDistribution
          balancer: off
            shards: 3
shardedCollections: 2

── 分片 ──
+-------+------------------+----------+-------+--------+----------+------------+
| shard | host             | draining | zones | chunks | size     | primaryFor |
+-------+------------------+----------+-------+--------+----------+------------+
| sh1   | sh1/db-sh1:27017 |          |       |      4 | 134.8 KB | shop       |
| sh2   | sh2/db-sh2:27017 |          | EU    |      6 | 134.8 KB | crm        |
| sh3   | sh3/db-sh3:27017 | true     |       |      0 | 0 B      |            |
+-------+------------------+----------+-------+--------+----------+------------+
3 rows in set

── 分片的集合 ──
+-------------+-----------------+--------+------------------------------------+---------+
| ns          | key             | chunks | distribution                       | orphans |
+-------------+-----------------+--------+------------------------------------+---------+
| shop.orders | {customerId: 1} |      4 | sh1 2 (134.8 KB), sh2 2 (134.8 KB) | 2000    |
| shop.events | {_id: hashed}   |      6 | sh1 2 (29 B), sh2 4 (58 B)         |         |
+-------------+-----------------+--------+------------------------------------+---------+
2 rows in set
注意：均衡器关着：块不会自动迁移，各分片的数据可能越来越不均匀；sh.startBalancer() 打开
注意：sh3 正在排空（removeShard 之后）：块迁走之前不能删掉；均衡器关着时不会迁
```

- 这些情况会在最后提示：均衡器关着；有分片正在排空；有 jumbo 块。
- 6.0.3 起均衡器按各分片的数据量平衡，不再按块数，所以块数不均匀不一定有问题，看 `size`。
- 块和集合的对应：5.0 起按 uuid，之前按 ns，两种都能处理。
- 只能连 mongos；连的是 mongod 时只打印一行说明。

### mt.balancer()：均衡器和块迁移

`sh.status()` 只告诉你“最近 24 小时成功迁了几次、失败几次”；`mt.balancer()` 把每次迁移列出来：哪个集合、从哪个分片到哪个分片、哪个范围、复制了多少文档、花了多久、成没成功。要连 mongos。

```js
mt.balancer()                      // 最近 24 小时的迁移，新的在前，最多 20 条
mt.balancer('shop.orders')         // 只看一个集合；传库名看这个库的所有集合
mt.balancer({hours: 168, n: 0})    // 最近 7 天的全部迁移
```

| 字段 | 说明 |
|---|---|
| 表头 | `balancer`（均衡器的模式）、`activeWindow`（设了均衡时间窗才有）、`rounds`（这段时间的均衡轮次和迁了几块，`config.actionlog` 里有记录才显示）、`migrations`（迁移次数，成功几次、失败几次） |
| 正在迁移 | `config.migrations` 里正在进行的迁移（没有就不显示） |
| `time` | 迁移结束的时间 |
| `from` / `to` | 源分片、目标分片 |
| `range` | 块的范围（分片键只有一个字段时只写值） |
| `docs` / `size` | 复制了多少文档、多少字节；失败的迁移没有 |
| `ms` | 从开始到结束花了多少毫秒 |
| `result` | `success`；`aborted`（没成功）；有错误信息时附在后面 |

下面是 MongoDB 7.0：`shop.orders` 的两块刚迁到 `sh2`，又手动往正在排空的 `sh3` 迁一块，被中止了：

```
> mt.balancer()
-- balancerStatus; config.settings / migrations / actionlog / changelog
  balancer: off
migrations: 3 (success 2, failed 1)

── 最近 24 小时的迁移 ──
+-------------------------+-------------+------+-----+--------------+------+---------+-----+---------+
| time                    | ns          | from | to  | range        | docs | size    | ms  | result  |
+-------------------------+-------------+------+-----+--------------+------+---------+-----+---------+
| 2026-11-24 01:04:03.747 | shop.orders | sh1  | sh3 | 100 → 200    |      |         | 226 | aborted |
| 2026-11-24 01:03:59.035 | shop.orders | sh1  | sh2 | 300 → MaxKey | 1000 | 68.2 KB | 174 | success |
| 2026-11-24 01:03:58.848 | shop.orders | sh1  | sh2 | 200 → 300    | 1000 | 68.2 KB | 275 | success |
+-------------------------+-------------+------+-----+--------------+------+---------+-----+---------+
3 rows in set
注意：均衡器关着：块不会自动迁移，各分片的数据可能越来越不均匀；sh.startBalancer() 打开
注意：1 次迁移没有成功：原因在源分片（from）主节点的日志里，搜 moveChunk
```

- 读的是 `config.changelog`（`moveChunk.start` / `commit` / `from` / `error`）、`config.actionlog`、`config.migrations` 和 `balancerStatus`。
- 手动的 `moveChunk` / `moveRange` 也会记在里面，不只是均衡器做的迁移。
- `config.changelog` 是 200 MB 的固定集合，迁移很多时更早的记录会被覆盖。
- 这些情况会在最后提示：均衡器关着；有迁移没成功（原因在源分片主节点的日志里）；均衡轮次出错。

### mt.dbs()：各库大小

相当于 `SHOW DATABASES`，执行的是 `listDatabases`，按库名排序，最后一行是合计。`disk` 是磁盘占用（`sizeOnDisk`）。

```
> mt.dbs()
-- db.adminCommand({listDatabases: 1})
+--------+----------+-------+
| name   | disk     | empty |
+--------+----------+-------+
| admin  |  80.0 KB | false |
| config | 168.0 KB | false |
| crm    |  40.0 KB | false |
| local  |   1.8 MB | false |
| shop   |   2.2 MB | false |
+--------+----------+-------+
5 rows in set
合计 4.2 MB
```

### mt.colls()：各集合大小

相当于 `SHOW TABLE STATUS`。

```js
mt.colls()          // 当前库
mt.colls('shop')    // 指定库，也可以传 db 对象
```

对每个集合执行 `$collStats`（视图跳过），按 `disk + indexDisk`（磁盘占用）从大到小排。

| 列 | 说明 |
|---|---|
| `count` | 文档数 |
| `logical` | 数据的逻辑大小（未压缩的 BSON） |
| `disk` | 数据占的磁盘空间（压缩后） |
| `indexes` | 索引个数 |
| `indexDisk` | 索引占的磁盘空间 |

```
> mt.colls()
-- db.getSiblingDB('shop').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}])
+----------------+-------+---------+----------+---------+-----------+
| name           | count | logical | disk     | indexes | indexDisk |
+----------------+-------+---------+----------+---------+-----------+
| orders         | 20000 |  3.6 MB | 960.0 KB |       4 |    1.2 MB |
| users          |     2 |    68 B |  20.0 KB |       1 |   20.0 KB |
| system.profile |     5 |  7.0 KB |   4.0 KB |       0 |       0 B |
+----------------+-------+---------+----------+---------+-----------+
3 rows in set
```

### mt.desc()：集合的字段结构

相当于 MySQL 的 `DESC t`。MongoDB 没有固定的表结构，就抽样一批文档，看每个字段实际是什么类型、有多少文档有它。

```js
mt.desc('orders')                          // 当前库的 orders，抽样 1000 条
mt.desc('shop.orders', {sample: 10000})    // 多抽一些，少见的字段也能看到
mt.desc(db.orders, {depth: 1})             // 只看第一层字段
```

上面几行是集合信息：类型（collection / view / timeseries / capped / clustered）、文档总数、抽样数、校验规则、collation、索引。

| 列 | 说明 |
|---|---|
| `field` | 字段路径；嵌套文档写成 `customer.name`，文档数组里的字段写成 `items.sku` |
| `types` | 类型，有多种时带占比；数组写成 `array<元素类型>` |
| `present` | 多少比例的抽样文档有这个字段 |
| `example` | 示例值 |

```
> mt.desc('orders')
-- db.getSiblingDB('shop').getCollection('orders').aggregate([{$sample: {size: 1000}}]); getCollectionInfos; getIndexes
     ns: shop.orders
   type: collection
  count: 3000
sampled: 1000
indexes: _id_, status_1_createdAt_-1, customer.name_1
+---------------+-----------------------+---------+--------------------------+
| field         | types                 | present | example                  |
+---------------+-----------------------+---------+--------------------------+
| _id           | objectId              |  100.0% | 6b031c3a3a00992f040cb256 |
| orderNo       | string                |  100.0% | SO2602                   |
| status        | string                |  100.0% | PAID                     |
| amount        | decimal 87%, null 13% |  100.0% | 102.5                    |
| customer      | object                |  100.0% |                          |
| customer.name | string                |  100.0% | c2                       |
| customer.vip  | bool                  |  100.0% | false                    |
| items         | array<object>         |  100.0% |                          |
| items.sku     | string                |  100.0% | A2                       |
| items.n       | number                |  100.0% | 2                        |
| createdAt     | date                  |  100.0% | 2024-01-02 19:22:00      |
| coupon        | string                |   25.2% | VIP0                     |
| tags          | array<string>         |    9.4% | [x, y]                   |
+---------------+-----------------------+---------+--------------------------+
13 rows in set
```

- 用 `$sample` 随机抽样，很少出现的字段可能抽不到，可以调大 `sample`。抽样条数超过集合的 5% 时，`$sample` 会扫描整个集合再排序，大集合上别设太大。
- 字段按它在文档里的平均位置排，子字段紧跟在父字段后面。
- `number` 是 int 和 double（shell 里分不出来），`long`、`decimal` 单独列出；同一个字段有多种类型（如上面 `amount` 有 13% 是 null）往往是数据问题的线索。

### mt.frag()：可回收的磁盘空间

相当于 MySQL `information_schema.TABLES` 的 `DATA_FREE`：删了大量数据之后，哪些集合的文件里有空间可以回收。

```js
mt.frag()          // 当前库
mt.frag('shop')    // 指定库，也可以传 db 对象
```

WiredTiger 删掉的数据不会把文件变小，空出来的块留在文件里给以后的写入复用。对每个集合执行 `$collStats`，读 `wiredTiger['block-manager']['file bytes available for reuse']`，索引的也一起算；按数据加索引可回收的总量从大到小排，最后一行是合计。

| 列 | 说明 |
|---|---|
| `disk` | 数据文件在磁盘上的大小 |
| `reusable` | 其中可复用的空间 |
| `pct` | 可复用占数据文件的比例 |
| `indexDisk` / `indexReusable` | 索引文件在磁盘上的大小、其中可复用的空间 |

```
> mt.frag('shop')
-- db.getSiblingDB('shop').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger['block-manager']
+----------------+---------+----------+-------+-----------+---------------+
| name           | disk    | reusable | pct   | indexDisk | indexReusable |
+----------------+---------+----------+-------+-----------+---------------+
| orders         |  2.0 MB | 960.0 KB | 46.1% |    3.6 MB |        1.2 MB |
| system.profile | 20.0 KB |      0 B |  0.0% |       0 B |           0 B |
| users          | 20.0 KB |      0 B |  0.0% |   20.0 KB |           0 B |
+----------------+---------+----------+-------+-----------+---------------+
3 rows in set
合计可回收 2.1 MB（数据 960.0 KB，索引 1.2 MB）
```

- 可复用的空间新写入的数据会先用掉；想把它还给操作系统，要对集合执行 `compact`（4.4 起不再阻塞读写，但仍会占用 I/O），或者对从节点做一次全量同步。
- 数字是 WiredTiger 上次 checkpoint（默认每 60 秒）时的值，刚删完的数据要等一会才会体现出来。

### mt.idx()：索引

相当于 `SHOW INDEX FROM t`。

```js
mt.idx('orders')          // 当前库的 orders
mt.idx('shop.orders')     // 指定库
mt.idx(db.orders)         // 集合对象
```

用 `getIndexes()` 拿索引定义，`$indexStats` 拿使用次数，`$collStats` 拿每个索引的大小。

| 列 | 说明 |
|---|---|
| `name` | 索引名 |
| `key` | 索引键 |
| `disk` | 磁盘占用 |
| `ops` | 自 `since` 以来被查询用到的次数；一直是 0 的索引可以考虑删掉 |
| `since` | 开始计数的时间（mongod 重启或索引重建后清零） |
| `options` | `unique`、`sparse`、`ttl=秒`、`partial=条件`、`hidden`、`collation=语言` |

```
> mt.idx('orders')
-- db.getSiblingDB('shop').getCollection('orders').getIndexes(); aggregate([{$indexStats: {}}])
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
| name                  | key                        | disk     | ops | since                   | options        |
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
| _id_                  | {_id: 1}                   | 508.0 KB |   6 | 2026-11-22 10:32:18.399 |                |
| orderNo_1             | {orderNo: 1}               | 248.0 KB |   1 | 2026-11-22 10:32:18.517 | unique         |
| status_1_createdAt_-1 | {status: 1, createdAt: -1} | 232.0 KB |  32 | 2026-11-22 10:32:18.572 |                |
| ttl_createdAt         | {createdAt: 1}             | 232.0 KB |   0 | 2026-11-22 10:32:18.623 | ttl=315360000s |
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
4 rows in set
```

### mt.unusedIdx()：没被用过的索引

相当于 MySQL 的 `sys.schema_unused_indexes`：哪些索引一直没被查询用过，可以考虑删掉，省磁盘、省缓存、也让写入更快。

```js
mt.unusedIdx()              // 所有用户库（跳过 admin、local、config）
mt.unusedIdx('shop')        // 只看一个库，也可以传 db 对象
mt.unusedIdx({days: 30})    // 计数开始满 30 天的才算（默认 7）；0 = 刚建的也列
```

对每个集合执行 `$indexStats`，列出 `accesses.ops` 为 0、并且计数开始（`since`）已经满 7 天的索引，按磁盘占用从大到小排。刚建或者刚重启过的索引计数还不够，不列出来，只在表下面说一句“另有 N 个索引计数开始不到 7 天”。上面 `node` 是这些计数来自哪个节点，`uptime` 是 mongod 已经运行了多久。

| 列 | 说明 |
|---|---|
| `ns` / `index` / `key` | 库.集合、索引名、索引键 |
| `disk` | 索引占的磁盘空间，删掉能省下的就是这么多 |
| `since` | 从什么时候开始计数（mongod 启动或索引建好的时间） |
| `options` | `unique`、`ttl=秒`、`partial=条件`、`sparse`、`hidden`、`collation=语言`、`shardKey`（以分片键开头，分片要用，不能删） |

```
> mt.unusedIdx({days: 0})
-- every user db: each collection getIndexes() + aggregate([{$indexStats: {}}]) → accesses.ops = 0
  node: db1
uptime: 17s
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| ns          | index           | key                 | disk     | since                   | options        |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| shop.orders | ttl_createdAt   | {createdAt: 1}      | 232.0 KB | 2026-11-23 01:29:31.539 | ttl=315360000s |
| shop.orders | customer.name_1 | {customer.name: 1}  | 168.0 KB | 2026-11-23 01:29:31.415 |                |
| shop.orders | status_1        | {status: 1}         | 116.0 KB | 2026-11-23 01:29:31.147 |                |
| shop.users  | email_1_name_1  | {email: 1, name: 1} |  20.0 KB | 2026-11-23 01:29:31.814 |                |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
4 rows in set
计数只是本节点 db1 的：只被从节点读用到的索引在这里也是 0 次，副本集每个成员都要各查一次
确认各成员都没用后，先 db.集合.hideIndex('名字') 观察一段时间，再 dropIndex
```

删之前先确认：

- **统计时间够不够长**：计数在 mongod 重启、索引重建后清零，所以按每个索引自己的 `since` 判断，默认要满 7 天。月报、年报这类偶尔才跑的查询，用 `{days: 30}` 甚至更长更稳。
- **每个成员都要看**：计数是每个节点自己的。读写分离时，从节点上的查询只记在从节点上，表下面会提示计数来自哪个节点，要连到每个成员上分别执行。经 mongos 时是各分片接到请求的那个节点（通常是主节点）的计数。
- **`unique` 索引**即使没被查询用过，也在保证唯一性，不能随便删；**`ttl` 索引**在负责过期删除，同样不能删。
- **分片键索引**（`options` 里的 `shardKey`）分片要用，删不掉。经 mongos 时从 `config.collections` 读分片键，在分片的 mongod 上从 `config.cache.collections` 读。
- 不确定的话，可以先 `db.orders.hideIndex('status_1')`（4.4 起）把它藏起来观察一段时间，查询变慢了再 `unhideIndex` 恢复，比直接删安全。表下面的最后一句按版本给出这条建议。
- `_id_` 索引删不掉，不列出来。

### mt.dupIdx()：冗余索引

相当于 MySQL 的 `sys.schema_redundant_indexes`：一个索引的键是另一个索引键的前缀（字段和方向都一样），比如 `{status: 1}` 能做的，`{status: 1, createdAt: -1}` 都能做，前者就是多余的。

```js
mt.dupIdx()          // 所有用户库（跳过 admin、local、config）
mt.dupIdx('shop')    // 只看一个库，也可以传 db 对象
```

| 列 | 说明 |
|---|---|
| `ns` / `index` / `key` | 冗余的那个索引 |
| `disk` | 它占的磁盘空间 |
| `coveredBy` / `coveredKey` | 能代替它的索引；有多个时取键最短的那个 |

```
> mt.dupIdx()
-- every user db: each collection getIndexes() → key is a prefix of another index
+-------------+----------+-------------+----------+-----------------------+----------------------------+
| ns          | index    | key         | disk     | coveredBy             | coveredKey                 |
+-------------+----------+-------------+----------+-----------------------+----------------------------+
| shop.orders | status_1 | {status: 1} | 116.0 KB | status_1_createdAt_-1 | {status: 1, createdAt: -1} |
+-------------+----------+-------------+----------+-----------------------+----------------------------+
1 row in set
```

为了不误报，这些情况不算冗余：

- 前缀索引是 `unique`、`ttl`、`partial`、`sparse`、`hidden` 的：它们有额外作用，或者本来就没在用。
- 长的那个索引是 `partial` 或 `sparse` 的：它不包含所有文档，代替不了。
- 两个索引的 collation 不一样，或者有 `text`、`2dsphere`、`hashed` 这类特殊索引。
- 方向不同的，如 `{d: -1}` 和 `{d: 1, e: 1}`。

删冗余索引前同样建议先 `hideIndex` 观察。

### mt.builds()：正在建的索引

相当于看 MySQL online DDL（`ALTER TABLE ... ADD INDEX`）的进度：大集合上建索引要很久，看它在哪个阶段、做到多少了。

```js
mt.builds()
```

执行的是 `db.adminCommand({currentOp: 1, $all: true})`，取出正在建索引的操作。

| 列 | 说明 |
|---|---|
| `ns` / `index` / `key` | 库.集合、索引名、索引键（一次建多个时用逗号分开） |
| `phase` | 阶段：`scanning collection` 扫描集合，`inserting keys from external sorter into index` 把排好序的键写进索引，`draining writes received during build` 补上建索引期间新写入的数据；老版本是 `background` 等 |
| `done` / `total` / `pct` | 当前阶段的进度；有的阶段没有进度，就是空的 |
| `secs` | 已经跑了多少秒 |
| `opid` / `client` | 操作 ID、发起建索引的客户端 |

```
> mt.builds()
-- db.adminCommand({currentOp: 1, $all: true}) → msg /Index Build/ or command.createIndexes
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
| ns          | index                        | key                               | phase                                    | done    | total   | pct   | secs | opid | client              |
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
| shop.orders | customer.name_1_createdAt_-1 | {customer.name: 1, createdAt: -1} | inserting keys from external sorter i... | 1889840 | 3000000 | 63.0% |    4 | 1096 | 192.168.107.3:50336 |
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
1 row in set
```

- 4.4 起索引在后台线程里建，客户端那条 `createIndexes` 在旁边等着；两条合成一行显示。
- 只有客户端的 `createIndexes`、找不到建索引线程的，显示成 `等待中`：可能还没开始（比如在等锁），也可能已经建完、在等提交（4.4 起要等多数节点建完）。
- 想中途停掉：4.4 起用 `db.orders.dropIndex('索引名')`，之前的版本用 `db.killOp(opid)`。
- 副本集上主节点建完之后，从节点也要各自建一遍（4.4 起是同时建），要连到从节点上看它们的进度。

### mt.conns()：连接来源

按客户端 IP 统计连接数，看是哪台机器、哪个应用连得最多。

- 上面几行来自 `db.serverStatus().connections`：`current` 当前连接数，`available` 还能建多少，`totalCreated` 启动以来一共建过多少。
- 表格来自 `currentOp` 的 `$all: true`：`conns` 连接数，`active` 其中正在执行操作的，`apps` 这些连接的 appName。

```
> mt.conns()
-- db.serverStatus().connections; db.adminCommand({currentOp: 1, $all: true})
     current: 19
   available: 8173
totalCreated: 69
+---------------+-------+--------+----------------+
| client        | conns | active | apps           |
+---------------+-------+--------+----------------+
| 192.168.117.4 |     5 |      1 | OplogFetcher   |
| 192.168.117.5 |     5 |      2 | mongosh 2.14.2 |
| 192.168.117.6 |     5 |      1 | mongosh 2.14.2 |
| 192.168.117.3 |     4 |      1 | OplogFetcher   |
| 192.168.117.2 |     1 |      0 |                |
+---------------+-------+--------+----------------+
5 rows in set
```

### mt.pool()：连出去的连接池

`mt.conns()` 看的是客户端连进来的连接；`mt.pool()` 看的是这个节点连出去的：mongos 到各分片和配置服务器，或者 mongod 到其他成员。相当于 ProxySQL 的 `stats_mysql_connection_pool`，执行的是 `connPoolStats`，mongos 和 mongod 都能用。

```js
mt.pool()              // 按目标主机汇总
mt.pool({all: true})   // 再按连接池（任务执行器、ShardRegistry、ReplNetwork...）列出
```

| 字段 | 说明 |
|---|---|
| 表头 | 所有连接池合计；7.0 起还有 `leased`、`wasNeverUsed`、`acquired`（取过多少次连接）和 `slowWaits`；`replicaSetMatchingStrategy`（4.4 起） |
| `host` / `set` / `state` / `pingMs` | 目标主机；它属于哪个副本集、复制集监视器看到的状态（`PRIMARY` / `SECONDARY` / `unreachable`）和 ping（毫秒） |
| `inUse` / `available` | 正在用的连接；空闲、可以直接用的连接 |
| `leased` | 借出去、要过很久才还的连接，不算在 `inUse` 里（7.0 起） |
| `created` | 启动以来建过的连接数；涨得快说明连接频繁断开重建 |
| `refreshing` | 正在检查是否可用的连接 |
| `wasNeverUsed` | 建了没用过就关掉的连接（7.0 起） |
| `slowWaits` | 取连接等了 100 ms 以上的次数，启动以来（7.0 起） |

经 mongos 看 3 个分片的集群：

```
> mt.pool()
-- db.adminCommand({connPoolStats: 1})
                     inUse: 0
                 available: 9
                    leased: 0
                   created: 9
                refreshing: 0
              wasNeverUsed: 0
replicaSetMatchingStrategy: matchPrimaryNode
                  acquired: 82
                 slowWaits: 0
+--------------+-----+---------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
| host         | set | state   | pingMs | inUse | available | leased | created | refreshing | wasNeverUsed | slowWaits |
+--------------+-----+---------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
| db-cfg:27017 | cfg | PRIMARY |    0.8 |     0 |         5 |      0 |       5 |          0 |            0 |         0 |
| db-sh1:27017 | sh1 | PRIMARY |    0.6 |     0 |         2 |      0 |       2 |          0 |            0 |         0 |
| db-sh2:27017 | sh2 | PRIMARY |    0.7 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| db-sh3:27017 | sh3 | PRIMARY |    0.4 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
+--------------+-----+---------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
4 rows in set
```

把 `sh3` 停掉，过一会儿复制集监视器发现连不上，`state` 变成 `unreachable`，最后两行提示。`created` 和 `wasNeverUsed` 一直在涨，是 mongos 不停地重试建连接：

```
> mt.pool({all: true})
-- db.adminCommand({connPoolStats: 1})
                     inUse: 0
                 available: 10
                    leased: 0
                   created: 27
                refreshing: 0
              wasNeverUsed: 16
replicaSetMatchingStrategy: matchPrimaryNode
                  acquired: 107
                 slowWaits: 0
+--------------+-----+-------------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
| host         | set | state       | pingMs | inUse | available | leased | created | refreshing | wasNeverUsed | slowWaits |
+--------------+-----+-------------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
| db-cfg:27017 | cfg | PRIMARY     |    0.7 |     0 |         5 |      0 |       5 |          0 |            0 |         0 |
| db-sh1:27017 | sh1 | PRIMARY     |    0.6 |     0 |         2 |      0 |       2 |          0 |            0 |         0 |
| db-sh2:27017 | sh2 | PRIMARY     |    0.6 |     0 |         2 |      0 |       2 |          0 |            0 |         0 |
| db-sh3:27017 | sh3 | unreachable |        |     0 |         1 |      0 |      18 |          0 |           16 |         0 |
+--------------+-----+-------------+--------+-------+-----------+--------+---------+------------+--------------+-----------+
4 rows in set

── 各连接池 ──
+---------------------------------------+--------------+-------+-----------+--------+---------+------------+--------------+-----------+
| pool                                  | host         | inUse | available | leased | created | refreshing | wasNeverUsed | slowWaits |
+---------------------------------------+--------------+-------+-----------+--------+---------+------------+--------------+-----------+
| NetworkInterfaceTL-ShardRegistry      | db-cfg:27017 |     0 |         4 |      0 |       4 |          0 |            0 |         0 |
| NetworkInterfaceTL-ShardRegistry      | db-sh1:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| NetworkInterfaceTL-ShardRegistry      | db-sh2:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| NetworkInterfaceTL-ShardRegistry      | db-sh3:27017 |     0 |         0 |      0 |      17 |          0 |           16 |         0 |
| NetworkInterfaceTL-TaskExecutorPool-0 | db-cfg:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| NetworkInterfaceTL-TaskExecutorPool-0 | db-sh1:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| NetworkInterfaceTL-TaskExecutorPool-0 | db-sh2:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
| NetworkInterfaceTL-TaskExecutorPool-0 | db-sh3:27017 |     0 |         1 |      0 |       1 |          0 |            0 |         0 |
+---------------------------------------+--------------+-------+-----------+--------+---------+------------+--------------+-----------+
8 rows in set
注意：复制集监视器连不上 db-sh3:27017：发往那里的请求会失败或卡住，检查网络、防火墙和对方的 mongod
注意：副本集 sh3 没有主节点（复制集监视器看到的）：发往它的写入和默认读会失败
```

- 表里的主机来自两处：连接池里有连接的主机，和复制集监视器（`replicaSets`）知道的主机；所以连不上的主机也会列出来。
- 这些情况会在最后提示：复制集监视器连不上某个主机；某个副本集没有主节点；取连接等了 100 ms 以上。
- mongos 连各分片的连接池大小由 `ShardingTaskExecutorPoolMinSize` / `MaxSize` / `MaxConnecting` 控制，用 `mt.vars('ShardingTaskExecutorPool')` 看。
- 单机和单节点副本集一般没有连出去的连接，只打印一行说明。

### mt.users()：用户和自定义角色

相当于 `SELECT * FROM mysql.user`：所有库的用户、每个用户的角色和登录方式，以及自定义角色的权限。

```js
mt.users()         // 所有库
mt.users('shop')   // 只看在 shop 库里建的用户和角色，也可以传 db 对象
```

| 字段 | 说明 |
|---|---|
| 表头 | `authorization`（认证是否打开，看不到启动参数时不显示）、`currentUser`（当前登录的用户）、用户数、自定义角色数 |
| 用户：`user` / `db` | 用户名、建在哪个库（登录时的 authSource） |
| `roles` | 角色；和用户在同一个库的只写名字，其他库的写成 `角色@库` |
| `mechanisms` | 能用哪些方式登录（4.0 起） |
| 自定义角色：`inherits` | 继承的角色 |
| `privileges` | 自己定义的权限：资源（`库.集合`，`*` 表示全部；`cluster`）和操作，多于 5 个时只列前 5 个 |
| `users` | 有几个用户直接被授予了这个角色；0 表示没人用 |

```
> mt.users()
-- db.adminCommand({usersInfo: {forAllDBs: true}}); admin.system.roles / rolesInfo; getCmdLineOpts; connectionStatus
authorization: enabled
  currentUser: root@admin
        users: 7
  customRoles: 2

── 用户 ──
+---------+-------+--------------------------------------+----------------------------+
| user    | db    | roles                                | mechanisms                 |
+---------+-------+--------------------------------------+----------------------------+
| dba     | admin | userAdminAnyDatabase, clusterMonitor | SCRAM-SHA-1, SCRAM-SHA-256 |
| root    | admin | root                                 | SCRAM-SHA-1, SCRAM-SHA-256 |
| zabbix  | admin | monitor                              | SCRAM-SHA-1, SCRAM-SHA-256 |
| app     | shop  | readWrite                            | SCRAM-SHA-1, SCRAM-SHA-256 |
| bi      | shop  | reporter                             | SCRAM-SHA-1, SCRAM-SHA-256 |
| etl     | shop  | readWrite                            | SCRAM-SHA-1                |
| olduser | shop  |                                      | SCRAM-SHA-1, SCRAM-SHA-256 |
+---------+-------+--------------------------------------+----------------------------+
7 rows in set

── 自定义角色 ──
+----------+-------+----------------+-----------------------------------------+-------+
| role     | db    | inherits       | privileges                              | users |
+----------+-------+----------------+-----------------------------------------+-------+
| monitor  | admin | clusterMonitor | cluster: replSetGetStatus, serverStatus |     1 |
| reporter | shop  |                | shop.orders: collStats, find            |     1 |
+----------+-------+----------------+-----------------------------------------+-------+
2 rows in set
注意：能给自己授予任何权限的用户：dba@admin、root@admin；越少越好，应用不要用这些账号
注意：只能用 SCRAM-SHA-1 登录的用户：etl@shop；改密码时加上 mechanisms: ['SCRAM-SHA-256']
注意：没有任何角色的用户：olduser@shop；登录后什么都做不了，可能是忘了授权或者已经不用了
```

- 执行的是 `usersInfo`（`forAllDBs`，4.0 起；之前读 `admin.system.users`，不取密码），读 `admin.system.roles`，再加 `getCmdLineOpts`、`connectionStatus`。
- 要有 `viewUser`、`viewRole` 权限（`userAdminAnyDatabase` 或 `root` 都有）；没有时打印一行说明。
- 这些情况会在最后提示：没开认证；有能给自己授予任何权限的用户（`root`、`__system`、`userAdminAnyDatabase`，以及 admin 库上的 `userAdmin`、`dbOwner`）；只能用 SCRAM-SHA-1 登录的用户；没有任何角色的用户。
- IP 白名单（`authenticationRestrictions`）要按用户名单独查，这里不列：`db.getUser('名字', {showAuthenticationRestrictions: true})`。

### mt.oplog()：oplog 窗口

相当于 `SHOW BINARY LOGS`，和 `rs.printReplicationInfo()` 看的是同一件事：oplog 能覆盖多长时间。只能在副本集成员上执行。

| 字段 | 说明 |
|---|---|
| `maxLogical` | oplog 上限（按逻辑大小算，即 `--oplogSize`） |
| `usedLogical` | 已经用了多少（逻辑大小） |
| `disk` | oplog 在磁盘上占的空间（压缩后） |
| `firstEvent` / `lastEvent` | oplog 里最早、最晚一条的时间 |
| `window` | 两者之差。从节点停机或延迟超过这个时间，就要全量重新同步 |
| `now` | 当前时间 |

```
> mt.oplog()
-- rs.printReplicationInfo()
 maxLogical: 1.4 GB
usedLogical: 9.5 MB
       disk: 1.4 MB
 firstEvent: 2026-11-22 10:32:04
  lastEvent: 2026-11-22 10:32:19
     window: 15s (0.00 h)
        now: 2026-11-22 10:32:31.489
```

示例是刚建好的副本集，所以窗口只有几十秒；生产环境一般要有几十个小时以上。

### mt.status()：关键指标

相当于 `SHOW GLOBAL STATUS`，从 `serverStatus` 里挑出常看的指标。

```js
mt.status()                 // 间隔 1 秒采样两次，ops/s 和 network/s 是每秒的量
mt.status({interval: 5})    // 间隔 5 秒
mt.status({interval: 0})    // 只取一次，显示 opcounters 启动以来的累计值
```

| 字段 | 说明 |
|---|---|
| `host` / `version` / `role` / `uptime` | 主机、版本、角色（副本集名）、运行时长 |
| `ops/s.*` | 每秒的 insert / query / update / delete / getmore / command 次数 |
| `connections.*` | 当前连接数、还能建多少 |
| `activeClients.*` | 正在执行读、写操作的客户端数 |
| `queue.*` | 在排队等锁的读、写操作数，持续不为 0 说明有压力 |
| `network/s.*` | 每秒进、出流量 |
| `mem.*` | 常驻内存、虚拟内存 |
| `cache.*` | WiredTiger 缓存：已用、上限、脏数据 |

```
> mt.status()
-- db.serverStatus()，间隔 1 秒采样两次算 ops/s
                 host: db1
              version: 7.0.48
                 role: PRIMARY (rs0)
               uptime: 32s
         ops/s.insert: 0
          ops/s.query: 0
         ops/s.update: 0
         ops/s.delete: 0
        ops/s.getmore: 0
        ops/s.command: 4
  connections.current: 20
connections.available: 8172
activeClients.readers: 1
activeClients.writers: 0
        queue.readers: 0
        queue.writers: 0
         network/s.in: 1.1 KB
        network/s.out: 75.3 KB
         mem.resident: 217.0 MB
          mem.virtual: 1.1 GB
           cache.used: 22.2 MB
            cache.max: 7.3 GB
          cache.dirty: 11.0 MB
```

### mt.host()：机器和进程信息

接手一个实例时先看看它跑在什么机器上、用什么参数启动的，相当于 MySQL 的 `SHOW VARIABLES LIKE 'version%'` 加上服务器信息。

```js
mt.host()                       // 机器、操作系统、mongod、启动参数
mt.host({all: true})            // 再加上全部启动参数（parsed.*）
mt.host('mongod,startup')       // 只看某几组；也可以 {cols: 'host.memory,startup.*'}
```

| 分组 | 字段 |
|---|---|
| `host.*` | hostname、platform（部署方式，见下文）、cpuArch、cpuCores、cpuAvailable（容器限制了 CPU 时）、physicalCores、cpuSockets、memory、memLimit（容器限制和内存不同时才显示）、numa、numaNodes、time |
| `os.*` | type、name、version、kernel、libc、maxOpenFiles（低于 64000 会提示） |
| `mongod.*` | version、edition（community / enterprise）、gitVersion、allocator、jsEngine、openssl、fcv、storageEngine、process、pid、uptime、cacheMax（WiredTiger 缓存上限，超过可用内存 80% 时提示） |
| `startup.*` | argv、config、dbPath、port、bindIp、replSet、oplogSizeMB、authorization、keyFile、logPath、cacheSizeGB（没设的不显示） |

下面是跑在 2 GB 内存限制的容器里、指定了缓存和 oplog 大小的实例：

```
> mt.host()
-- db.hostInfo(); db.serverBuildInfo(); db.adminCommand({getCmdLineOpts: 1}); db.serverStatus()
       host.hostname: db1
       host.platform: 容器（内存限制 2.0 GB，mongod 是 1 号进程），运行在虚拟机上（内核 7.0.11-orbstack-00360-gc9bc4d96ac70）
        host.cpuArch: aarch64
       host.cpuCores: 10
  host.physicalCores: 1
     host.cpuSockets: 1
         host.memory: 15.7 GB
       host.memLimit: 2.0 GB
           host.numa: false
      host.numaNodes: 1
           host.time: 2026-11-22 17:32:38.234
             os.type: Linux
             os.name: Ubuntu
          os.version: 22.04
           os.kernel: 7.0.11-orbstack-00360-gc9bc4d96ac70
             os.libc: 2.35
     os.maxOpenFiles: 20480（建议至少 64000）
      mongod.version: 7.0.48
      mongod.edition: community
   mongod.gitVersion: 6937736f0539
    mongod.allocator: tcmalloc
     mongod.jsEngine: mozjs
      mongod.openssl: OpenSSL 3.0.2 15 Mar 2022
          mongod.fcv: 7.0
mongod.storageEngine: wiredTiger
      mongod.process: mongod
          mongod.pid: 1
       mongod.uptime: 15s
     mongod.cacheMax: 512.0 MB
        startup.argv: mongod --replSet rs0 --bind_ip_all --oplogSize 2048 --wiredTigerCacheSizeGB 0.5 --dbpath /data/db
      startup.dbPath: /data/db
      startup.bindIp: *
     startup.replSet: rs0
 startup.oplogSizeMB: 2048
 startup.cacheSizeGB: 0.5
```

- 来自 `hostInfo`、`buildInfo`、`getCmdLineOpts`、`serverStatus`，需要 `clusterMonitor` 之类的权限；某一部分拿不到时那一组就少几行。
- 文件句柄数之外，其他问题（如 NUMA、透明大页）mongod 启动时会写成启动警告，用 `mt.check()` 或 `mt.log({startup: true})` 看。

**部署方式（`host.platform`）**

mongod 本身不知道自己跑在什么上面，`platform` 是根据下面这些迹象推断的，后面括号里写着依据：

| 显示 | 依据 |
|---|---|
| 容器 | 内存限制（`memLimit` 小于机器内存）、CPU 限制（`cpuAvailable` 小于核数，7.0 起）、mongod 是 1 号进程 |
| 虚拟机 | CPU 标志 `hypervisor`（x86 虚拟机都有）；内核名带 `-aws`、`-azure`、`-gcp`、`-oracle`、`orbstack`、`linuxkit`、`microsoft-standard` 等（ARM 云主机没有 hypervisor 标志，靠这个） |
| 容器，运行在虚拟机上 | 两类迹象都有，比如云上的 Kubernetes |
| 可能是物理机 | 没有容器和虚拟机迹象，且有多路 CPU 或多个 NUMA 节点 |
| 物理机或无法判断 | 什么迹象都没有 |

不同部署方式要注意的：

- **物理机**：多路 CPU（多个 NUMA 节点）时要用 `numactl --interleave=all` 启动 mongod，并关闭 `vm.zone_reclaim_mode`，否则 mongod 会在启动警告里提示；`numaNodes` 大于 1 就要留意。
- **虚拟机**：CPU 被别的虚拟机抢（steal）、内存气球（ballooning）、超卖，这些在 mongod 里看不到，要看虚拟化平台或云监控；数据盘别用共享的低性能存储。
- **容器**：`memory`、`cpuCores` 通常是宿主机的，`memLimit`、`cpuAvailable` 才是容器自己的。WiredTiger 缓存默认按（内存 − 1 GB）的一半算：4.4 起认容器的内存限制，**4.4 之前看不到容器的内存限制，会按宿主机内存算，缓存可能比容器内存还大**，这时 `cacheMax` 后面会提示，要用 `--wiredTigerCacheSizeGB` 显式设小。

- 文件句柄数（`ulimit -n`）MongoDB 建议至少 64000，太低时连接数和文件多了会出错。

### mt.vars()：运行参数

相当于 MySQL 的 `SHOW VARIABLES`，执行的是 `db.adminCommand({getParameter: {allParameters: true, showDetails: true}})`（4.2 之前是 `{getParameter: '*'}`）。

```js
mt.vars()                 // 全部参数，按名字排；默认只显示前 50 行
mt.vars('ttlMonitor')     // 名字里含 ttlMonitor 的（不分大小写）
mt.vars('wiredTiger*')    // 通配符：* 任意多个字符，? 一个字符
mt.vars(/^ttl|^diag/i)    // 正则
mt.vars({limit: 0})       // 全部列出
```

| 列 | 说明 |
|---|---|
| name | 参数名，setParameter 时用 |
| value | 当前值；文档写成一行 |
| runtime | `true`：可以在运行时用 `db.adminCommand({setParameter: 1, 名字: 值})` 改；`false`：只能启动时设。4.2 起才有这一列 |

```
> mt.vars('ttlMonitor')
-- db.adminCommand({getParameter: {allParameters: true, showDetails: true}})
+--------------------------------------+-------+---------+
| name                                 | value | runtime |
+--------------------------------------+-------+---------+
| ttlMonitorBatchDeletes               | true  | true    |
| ttlMonitorEnabled                    | true  | true    |
| ttlMonitorMaxMetadataRecoveryThreads | 5     | false   |
| ttlMonitorSleepSecs                  | 60    | true    |
| ttlMonitorSubPassTargetSecs          | 60    | true    |
+--------------------------------------+-------+---------+
5 rows in set
```

```
> mt.vars('featureCompat*')
-- db.adminCommand({getParameter: {allParameters: true, showDetails: true}})
+-----------------------------+----------------+---------+
| name                        | value          | runtime |
+-----------------------------+----------------+---------+
| featureCompatibilityVersion | {version: 7.0} | false   |
+-----------------------------+----------------+---------+
1 row in set
```

- 参数很多（7.0 有 600 多个，3.6 有 170 多个），先用关键字过滤。
- `mt.vars()` 看的是现在生效的值，包括运行时用 setParameter 改过的；启动时用的配置文件和命令行参数用 `mt.host({all: true})` 看。

### mt.engine()：存储引擎状态

相当于 MySQL 的 `SHOW ENGINE INNODB STATUS`，看 WiredTiger 的缓存、驱逐、检查点和读写票据。执行的是 `db.serverStatus()`，读其中的 `wiredTiger`；默认间隔 1 秒采样两次，读写量和驱逐按每秒算。

```js
mt.engine()                     // 间隔 1 秒采样两次
mt.engine({interval: 5})        // 间隔 5 秒
mt.engine({interval: 0})        // 只取一次，显示启动以来的累计值
mt.engine('cache,checkpoint')   // 只看某几组
```

| 字段 | 说明 |
|---|---|
| `cache.max` / `used` / `dirty` / `updates` | 缓存上限、已用、脏数据、更新占用（4.4 起），括号里是占上限的比例 |
| `cache.read` / `written` | 读进缓存、从缓存写出的字节数 |
| `cache.evicted` / `appEvicted` | 驱逐的页面数；`appEvicted` 是处理请求的应用线程驱逐的，正常应该是 0 |
| `cache.aggressive` | 驱逐是否处于激进模式 |
| `checkpoint.*` | 检查点次数、是否正在做（8.0 起没有这项）、最近一次 / 最长 / 平均耗时（毫秒） |
| `historyStore.disk` | 历史存储占的磁盘（4.4 起），长事务、快照读会让它变大 |
| `tickets.read` / `write` | 读写票据：在用 / 总数；7.0 起总数会自动调整 |
| `journal.syncs` / `written` | 日志刷盘次数、写入的字节数 |
| `disk.read` / `written` | 存储引擎读写磁盘的字节数 |
| `handles.data` / `files` | 打开的数据句柄数、文件数 |

下面是缓存只有 256 MB、一直在批量写入的实例：应用线程也在驱逐页面，最后一行提示了这一点。

```
> mt.engine()
-- db.serverStatus().wiredTiger，间隔 1 秒采样两次，带 /s 的是每秒的量
         cache.max: 256.0 MB
        cache.used: 192.3 MB (75.1%)
       cache.dirty: 4.8 MB (1.9%)
     cache.updates: 4.2 MB (1.6%)
      cache.read/s: 20.3 KB
   cache.written/s: 181.4 MB
   cache.evicted/s: 582.2
cache.appEvicted/s: 17.8
  cache.aggressive: false
  checkpoint.count: 4
checkpoint.running: false
 checkpoint.lastMs: 124
  checkpoint.maxMs: 154
  checkpoint.avgMs: 119
 historyStore.disk: 4.0 KB
      tickets.read: 0 / 10
     tickets.write: 1 / 10
   journal.syncs/s: 9.9
 journal.written/s: 11.4 MB
       disk.read/s: 23.8 KB
    disk.written/s: 14.5 MB
      handles.data: 27
     handles.files: 16
注意：应用线程每秒驱逐 17.8 个页面：缓存压力大，请求在帮着腾地方
```

- 这些情况会在最后提示：缓存用到 95%、脏数据到 20%、更新到 10%（4.4 起），这几个是 WiredTiger 默认的触发线（`eviction_trigger`、`eviction_dirty_trigger`、`eviction_updates_trigger`），到了以后处理请求的线程也要帮忙驱逐，读写会变慢；采样期间应用线程驱逐了页面；最近一次检查点超过 60 秒（默认的检查点间隔）。
- 带 `/s` 的是两次采样的差除以间隔；`{interval: 0}` 时没有 `/s`，是启动以来的累计值。
- 8.0 起检查点的统计挪到了 `wiredTiger.checkpoint`，票据挪到了 `serverStatus().queues.execution`，这两处都已经按版本处理。
- 只能连 mongod；mongos 上没有存储引擎，只打印一行说明。`mt.status()` 里也有缓存的三项，`mt.cache()` 看各集合占了多少缓存。

### mt.mem()：内存都花在哪

相当于 MySQL 的 `sys.memory_global_by_current_bytes`：mongod 的常驻内存（RSS）分成几部分，各占多少。常驻内存比缓存上限大很多、容器快被 OOM 杀掉时，先看这个。

```js
mt.mem()
```

上面几行：`memory` 机器内存，`memLimit` 容器限制了内存时的上限，`resident` 常驻内存和 `cacheMax` 缓存上限（括号里是占可用内存的比例），`virtual` 虚拟内存，`connections` 当前连接数。下面的表把常驻内存分成：

| 行 | 说明 |
|---|---|
| `WiredTiger cache` | 缓存里现在的数据；`detail` 里是占缓存上限的比例和脏数据的比例 |
| `other in use` | mongod 分配了、但不在缓存里的内存：连接、查询执行、排序 / 聚合、索引构建、元数据等；8.0 起还列出计划缓存 |
| `tcmalloc free` | 已经释放、但内存分配器 tcmalloc 还留着备用的内存：页堆加各级缓存 |
| `outside tcmalloc` | 常驻内存减去上面几项：线程栈、程序代码、分配器的元数据等 |
| `released to OS` | tcmalloc 已经还给系统的内存，不占物理内存，不算比例 |

`share` 是占常驻内存的比例。

下面是 MongoDB 7.0、容器限制 6 GB 内存，灌了约 2.4 GB 数据、又删掉其中一个集合之后：缓存空出来了，常驻内存却没降，多出来的是 tcmalloc 留着的空闲内存，最后一行提示了这一点。

```
> mt.mem()
-- db.serverStatus({tcmalloc: 1}) → mem, tcmalloc, wiredTiger.cache, connections; hostInfo
     memory: 15.7 GB
   memLimit: 6.0 GB
   resident: 2.2 GB (36.5%)
    virtual: 2.6 GB
   cacheMax: 2.5 GB (41.7%)
connections: 5

── 常驻内存的去向 ──
+------------------+----------+-------+------------------------------------------+
| part             | size     | share | detail                                   |
+------------------+----------+-------+------------------------------------------+
| WiredTiger cache | 769.0 MB | 34.3% | 占上限 30.0%，脏数据 0.0%                |
| other in use     |  69.1 MB |  3.1% | 连接 5 个、查询、排序 / 聚合、索引构建等 |
| tcmalloc free    |   1.3 GB | 61.6% | 页堆 1.3 GB，各级缓存 4.5 MB             |
| outside tcmalloc |  22.0 MB |  1.0% | 线程栈、程序代码、分配器元数据等         |
| released to OS   |   1.1 MB |       | 已还给系统，不占物理内存                 |
+------------------+----------+-------+------------------------------------------+
5 rows in set
注意：tcmalloc 手里有 1.3 GB 空闲内存没还给系统（占 61.6%）：常见于删了大量数据、跑过大查询或连接数突增之后，常驻内存看着大但不是泄漏；归还的快慢由参数 tcmallocReleaseRate 控制
```

- 执行的是 `serverStatus({tcmalloc: 1})` 和 `hostInfo`。8.0 起用的是新版 tcmalloc，字段名不同，这里都换算成同样几项。
- 可用内存：容器限制了内存时按限制算，否则按机器内存；4.4 之前看不到容器的限制。
- 这些情况会在最后提示：常驻内存超过可用内存的 80%；缓存上限超过可用内存的 80%；脏数据超过缓存上限的 20%；tcmalloc 留着超过 1 GB、且超过常驻内存 20% 的空闲；缓存以外的分配超过 1 GB、且超过常驻内存的一半。
- mongos 上没有 WiredTiger 缓存，只有后面几行。各集合占了多少缓存看 `mt.cache()`。

### mt.cache()：谁占着缓存

相当于 MySQL 的 `sys.innodb_buffer_stats_by_table`：WiredTiger 缓存被哪些集合占着。

```js
mt.cache()          // 所有库
mt.cache('shop')    // 只看一个库，也可以传 db 对象
```

上面几行来自 `serverStatus().wiredTiger.cache`：`used` 已用（括号里是占上限的比例），`max` 上限（默认是内存减 1 GB 后的一半，至少 256 MB），`dirty` 还没写回磁盘的数据。表格对每个集合执行 `$collStats`，读 `wiredTiger.cache['bytes currently in the cache']`。

| 列 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `cached` | 数据加索引在缓存里占了多少 |
| `dataCached` / `indexCached` | 其中数据、索引各占多少 |
| `share` | 占已用缓存的比例 |

```
> mt.cache({limit: 6})
-- db.serverStatus().wiredTiger.cache; every db: each collection aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger.cache
 used: 34.1 MB (0.5%)
  max: 7.3 GB
dirty: 0 B (0.0%)
+---------------------------+---------+------------+-------------+-------+
| ns                        | cached  | dataCached | indexCached | share |
+---------------------------+---------+------------+-------------+-------+
| shop.orders               | 18.2 MB |     7.6 MB |     10.6 MB | 53.3% |
| local.oplog.rs            | 14.5 MB |    14.5 MB |         0 B | 42.4% |
| config.transactions       | 77.3 KB |    75.8 KB |      1.6 KB |  0.2% |
| shop.system.profile       | 11.7 KB |    11.7 KB |         0 B |  0.0% |
| config.system.indexBuilds |  6.2 KB |     4.5 KB |      1.7 KB |  0.0% |
| local.startup_log         |  4.7 KB |     3.5 KB |      1.2 KB |  0.0% |
+---------------------------+---------+------------+-------------+-------+
6 rows in set  (共 25 行，只显示前 6 行)
以上集合在缓存里合计 32.8 MB，占已用缓存的 96.0%
```

- 缓存里放的是解压后的数据，所以一个集合占的缓存可能比它的磁盘文件还大。
- 各集合加起来会比 `used` 少一点，差的是 WiredTiger 自己的元数据等。
- 要对每个集合执行一次 `$collStats`，集合很多（上千个）时会慢，可以用 `mt.cache('shop')` 只看一个库。
- 只能连 mongod 执行，mongos 上没有缓存数据。
- `dirty` 长时间超过上限的 20% 左右，说明写入压力大、来不及写回磁盘。

### mt.ttl()：TTL 索引

相当于查 MySQL 里定时清理数据的 EVENT（`information_schema.EVENTS`）：哪些集合会自动删过期数据，删得跟不跟得上。

```js
mt.ttl()          // 所有库
mt.ttl('shop')    // 只看一个库，也可以传 db 对象
```

上面几行是 TTL 后台线程的状态：`ttlMonitorEnabled` 是否在跑、`ttlMonitorSleepSecs` 每隔几秒扫一遍（默认 60），`passes` 扫了几遍、`deletedDocuments` 一共删了多少条（都是启动以来的累计）。下面每个 TTL 一行：

| 列 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `index` | TTL 索引名；时间序列集合显示 `(timeseries)`，聚簇集合显示 `(clustered)`（这两种的过期时间设在集合上，不在索引上） |
| `field` | 按哪个日期字段算过期 |
| `expireAfterSeconds` / `expire` | 过期时间，秒数和换算后的时长 |
| `oldest` | 这个字段最早的一条（顺着 TTL 索引取，很快） |
| `overdueSecs` | 最早那条已经超过过期时间多少秒 |
| `options` | `partial=条件`、`hidden` |

```
> mt.ttl('shop')
-- db.getSiblingDB('shop'): getCollectionInfos() + each getIndexes() → expireAfterSeconds; getParameter ttlMonitor*; serverStatus().metrics.ttl
  ttlMonitorEnabled: false
ttlMonitorSleepSecs: 60
             passes: 0
   deletedDocuments: 0
+---------------+---------------+-----------+--------------------+------------+-------------------------+-------------+---------+
| ns            | index         | field     | expireAfterSeconds | expire     | oldest                  | overdueSecs | options |
+---------------+---------------+-----------+--------------------+------------+-------------------------+-------------+---------+
| shop.sessions | lastSeen_1    | lastSeen  |               1800 | 30m 0s     | 2026-11-21 19:55:35.958 |       49742 |         |
| shop.orders   | ttl_createdAt | createdAt |           31536000 | 365d 0h 0m | 2026-05-06 10:14:35.923 |           0 |         |
| shop.metrics  | (timeseries)  | ts        |             604800 | 7d 0h 0m   |                         |             |         |
+---------------+---------------+-----------+--------------------+------------+-------------------------+-------------+---------+
3 rows in set
```

- `overdueSecs` 正常应该在 TTL 线程的间隔（60 秒）左右或者是 0；明显更大，说明 TTL 删不过来（过期的数据太多）、或者线程没在跑（如上例 `ttlMonitorEnabled: false`）。字段的值不是日期的文档 TTL 不会删，`oldest` 也不算它们。
- 只有普通 TTL 索引算 `oldest` / `overdueSecs`；带 `partialFilterExpression` 的、时间序列和聚簇集合的留空。
- 从节点不自己删，过期的文档跟着主节点的删除一起复制过来。

### mt.log()：最近的日志

相当于 MySQL 的 `performance_schema.error_log`：不用登录服务器看日志文件，直接在 shell 里看最近的日志。

```js
mt.log()                        // 最近 20 行
mt.log(100)                     // 最近 100 行
mt.log('Slow query')            // 只看包含这段文字的（不分大小写）
mt.log(/COLLSCAN|IXSCAN/)       // 正则
mt.log({sev: 'W'})              // 只看警告（W）、错误（E）、致命（F）
mt.log({startup: true})         // 启动时的警告，如没开认证、文件句柄数太低
mt.log('Slow query', {n: 5, vertical: true})   // 选项和 t() 通用
```

执行的是 `db.adminCommand({getLog: 'global'})`，按时间正序显示最后 `n` 行。

| 选项 | 说明 |
|---|---|
| `n` | 显示最后几行，默认 20 |
| `grep` | 文字（不分大小写）或正则；第一个参数是字符串或正则时就是 `grep` |
| `sev` | `'F'`、`'E'`、`'W'`、`'I'`、`'D'`：只看这个级别及更严重的 |
| `startup` | `true` 时看启动警告（`getLog: 'startupWarnings'`） |

| 列 | 说明 |
|---|---|
| `#` | 行号，`mt.explainLog(n)` / `mt.logQuery(n)` 用它（带命令的行，如慢查询） |
| `time` | 时间，按 `tz` 显示 |
| `sev` | 级别：`F` 致命、`E` 错误、`W` 警告、`I` 信息、`D1`~`D5` 调试 |
| `comp` | 组件：`NETWORK`、`COMMAND`、`REPL`、`STORAGE`... |
| `ctx` | 线程，如 `conn89`、`listener` |
| `id` / `attr` | 4.4 起的日志才有：消息编号、详细内容 |
| `msg` | 消息 |

```
> mt.log({n: 6, cols: 'time,sev,comp,ctx,msg'})
-- db.adminCommand({getLog: 'global'})
+-------------------------+-----+---------+----------+------------------------------------------+
| time                    | sev | comp    | ctx      | msg                                      |
+-------------------------+-----+---------+----------+------------------------------------------+
| 2026-11-22 09:49:40.018 | I   | NETWORK | listener | Connection accepted                      |
| 2026-11-22 09:49:40.019 | I   | NETWORK | conn87   | client metadata                          |
| 2026-11-22 09:49:40.019 | I   | ACCESS  | conn87   | Connection not authenticating            |
| 2026-11-22 09:49:40.020 | I   | NETWORK | conn88   | client metadata                          |
| 2026-11-22 09:49:40.020 | I   | ACCESS  | conn88   | Connection not authenticating            |
| 2026-11-22 09:49:40.022 | I   | NETWORK | conn88   | Received first command on ingress con... |
+-------------------------+-----+---------+----------+------------------------------------------+
6 rows in set
(共 759 行，只显示最后 6 行)
```

```
> mt.log('COLLSCAN', {n: 1, vertical: true})
-- db.adminCommand({getLog: 'global'})
*************************** 1. row ***************************
   #: 1
time: 2026-11-22 12:50:45.011
 sev: I
comp: WRITE
 ctx: conn85
  id: 51803
 msg: Slow query
attr: {type: remove, ns: shop.orders, appName: mongosh 2.14.2, command: {q: {amount: {$lt: {$numberDecimal: 300}}}, limit: 0}, planSummary: COLLSCAN, planningTimeMicros: 496, totalOplogSlotDurationMicros: 15106, keysExamined: 0, docsExamined: 13333, ndeleted: 8000, keysDeleted: 32000, numYields: 13, locks: {ParallelBatchWriterMode: {acquireCount: {r: 14}}, FeatureCompatibilityVersion: {acquireCount: {w: 14}}, ReplicationStateTransition: {acquireCount: {w: 14}}, Global: {acquireCount: {w: 14}}, Database: {acquireCount: {w: 14}}, Collection: {acquireCount: {w: 14}}}, flowControl: {acquireCount: 14}, readConcern: {level: local, provenance: implicitDefault}, storage: {data: {bytesRead: 124878, timeReadingMicros: 167}}, cpuNanos: 84921849, remote: "192.168.107.6:56430", durationMillis: 91}
1 row in set
(共 4 行，只显示最后 1 行)
```

```
> mt.log({startup: true})
-- db.adminCommand({getLog: 'startupWarnings'})
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
| # | time                    | sev | comp    | ctx           | id    | msg                                      | attr                                     |
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
| 1 | 2026-11-22 12:50:16.811 | W   | CONTROL | initandlisten | 22120 | Access control is not enabled for the... |                                          |
| 2 | 2026-11-22 12:50:16.811 | W   | CONTROL | initandlisten | 22184 | Soft rlimits for open file descriptor... | {currentValue: 20480, recommendedMini... |
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
2 rows in set
```

- `getLog` 只保留内存里最近的 1024 行，更早的要看日志文件。
- 4.4 起日志是 JSON，`msg` 是固定的模板（如 `Slow query`），具体内容在 `attr` 里，表格里会截断，用 `{vertical: true}` 或 `{maxCol: 0}` 看全；4.4 之前是一行文本，全在 `msg` 里，没有 `id` / `attr` 列。
- 过滤（`grep`、`sev`）先做，再取最后 `n` 行；页脚会显示一共匹配了多少行。
- 4.2 及之前的启动警告是 `I` 级别的多行文本（`** WARNING: ...`），用 `{sev: 'W'}` 会过滤掉，直接用 `mt.log({startup: true})` 看。

### 也可以直接套原生命令

| MySQL 习惯 | mongosh + MongoTab |
|---|---|
| `SHOW PROCESSLIST` | `t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')` |
| `SHOW SLAVE STATUS` | `t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost,lastHeartbeat')` |
| `SHOW DATABASES` | `t(db.adminCommand({listDatabases: 1}).databases)` |
| `SHOW INDEX FROM t` | `t(db.orders.getIndexes())` |
| `SHOW GLOBAL STATUS` | `t(db.serverStatus(), 'connections,opcounters,mem')` |

单个大文档（`rs.status()`、`serverStatus()`）先竖排列出普通字段，里面的文档数组（如 `members`）会单独成子表。
选列也能指到子表：`t(rs.status(), 'set,myState,members.name,members.stateStr')`。

想查更多 MySQL 命令在 MongoDB 里怎么写，可以用在线工具 [DBA Command Finder](https://www.solidstack.io/dba-command-finder)（打开网页就能用，不用安装）：输入 MySQL 命令或要做的事（比如 `SHOW SLAVE STATUS\G`、“锁等待”），就能看到对应的 mongosh 命令，以及各版本能不能用、字段怎么对应。每条命令都在真实数据库上逐个版本实测过，也覆盖 Redis、PostgreSQL、TiDB。查到的命令套上 `t()` / `g()`，结果就是表格。

源码、测试和数据在 [yinx0004/dba-command-finder](https://github.com/yinx0004/dba-command-finder)，发现缺的命令或者结果不对，欢迎[提 issue](https://github.com/yinx0004/dba-command-finder/issues/new)。

## 显示约定

| BSON | 显示 |
|---|---|
| ObjectId | hex 字符串 |
| Date | `2024-01-01 08:30:00[.123]`，默认 UTC，可配时区 |
| Long / Int32 / Double / Decimal128 | 数字，右对齐 |
| Timestamp | `2023-11-14 22:13:20 (1700000000:3)` |
| UUID / Binary subtype 3、4 | UUID 字符串 |
| 其他 Binary | `Binary(子类型, base64 前缀..., N bytes)` |
| 值为 null | `NULL` |
| 空字符串 `""` | 空白（和 MySQL 一样） |
| **文档里没有这个字段** | **`(无字段)`**，终端里变暗；英文为 `(missing)` |
| 字符串里的换行 / tab | `\n` / `\t` |

```
+-----+---------+--------+----------+----------+
| _id | orderNo | remark | coupon   | qty      |
+-----+---------+--------+----------+----------+
|   1 | SO1     | NULL   |          |        2 |
|   2 | SO2     |        | VIP10    | (无字段) |
+-----+---------+--------+----------+----------+
```

竖排（`g()`）里不存在的字段直接不显示。`mt.csv()` 的约定和表格相同：`NULL`、空、`(无字段)`。
贴进 Excel 后 `NULL` 和 `(无字段)` 是普通文字，不是空单元格。

中文按 2 列宽对齐。超过 `maxCol`（默认 40）的单元格截断为 `...`，竖排不截断。

## 配置项

各选项的默认值和说明见[选项一览](#选项一览)，会话里用 [`mt.config()`](#会话默认值mtconfig) 修改。

`missingText` 不设时跟随语言显示 `(无字段)` / `(missing)`；自己设了就固定用设的值，例如 `mt.config({missingText: '-'})`，设成 `''` 则留空。

环境变量（加载时读取）：

- `MONGOTAB_TZ=+08:00`：默认时区。写错了会回退到 UTC 并给出提示。
- `MONGOTAB_LANG=zh` 或 `en`：帮助和提示信息的语言。不设时跟随 `LC_ALL` / `LC_MESSAGES` / `LANG`（以 `zh` 开头为中文，其余为英文）。会话里也可以用 `mt.config({lang: 'zh'})` 切换。

## 兼容性

每个 PR 和每次推送到 main 都会在 GitHub Actions 里跑 [test/compat.js](test/compat.js)（连真实数据库）：

- mongosh：MongoDB 4.4、5.0、6.0、7.0、8.0 各配 mongosh 1.8.0 和 2.x 最新版；MongoDB 4.0 配 mongosh 1.8.0 和 1.10.6（mongosh 2.x 连不了 4.0）。共 12 组。
- 老的 mongo shell：MongoDB 3.6、4.0、4.2、4.4、5.0，各用自带的 `mongo` 连同版本的服务器。共 5 组。

都是单节点副本集。另外在一个分片集群（配置服务器、3 个分片、mongos，见 [test/shard.sh](test/shard.sh)）上跑 [test/shard.js](test/shard.js)，再停掉一个分片跑 [test/shard-down.js](test/shard-down.js)：MongoDB 3.6（老 `mongo`）、4.4（mongosh 1.8.0）、5.0、7.0、8.0（mongosh 2.x），共 5 组。在开了 `--auth` 的 mongod 上跑 [test/auth.js](test/auth.js)（见 [test/auth.sh](test/auth.sh)，以 root 和一个没有查看用户权限的用户登录）：3.6（老 `mongo`）、4.4（mongosh 1.8.0）、8.0（mongosh 2.x），共 3 组。还跑 [test/format.js](test/format.js)（不连数据库，只测排版、`load()` 路径和 `MONGOTAB_LANG` / `MONGOTAB_TZ` 环境变量）：Linux、macOS、Windows 上的 mongosh 1.8.0 和 2.14.2，以及上面 5 个版本的老 `mongo`。

本地跑（需要 Docker）：

```bash
test/run.sh mongo:7.0
```

```bash
# 第二个参数指定客户端镜像：mongo:6.0.4 带 mongosh 1.8.0
test/run.sh mongo:4.4 mongo:6.0.4
```

```bash
# 镜像里没有 mongosh 时自动用老的 mongo；两个都有时用 MONGO_SHELL=mongo 指定
test/run.sh mongo:4.0
MONGO_SHELL=mongo test/run.sh mongo:5.0
```

```bash
# 分片集群上的测试
test/shard.sh mongo:7.0
MONGO_SHELL=mongo test/shard.sh mongo:3.6
```

```bash
# 开了认证的 mongod 上的测试
test/auth.sh mongo:7.0
MONGO_SHELL=mongo test/auth.sh mongo:3.6
```

```bash
# 只测排版，不连数据库
mongosh --nodb test/format.js
test/format.sh mongo:4.0
```

### 老的 mongo shell

从 [v0.2.0](https://github.com/yinx0004/mongosh-table/releases/tag/v0.2.0) 起，MongoDB 5.0 及更早版本自带的老 `mongo` 命令（提示符像 `rs0:PRIMARY>`）也能用，加载方法和 mongosh 一样，把命令里的 `mongosh` 换成 `mongo` 即可：

```js
load('/path/to/mongotab.js')
```

```bash
mongo "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

> **版本说明**：v0.1.x 不支持老 shell。v0.1.0 在老 shell 里加载会报 `TypeError: root is undefined`，v0.1.1 会提示“MongoTab 需要 mongosh”。遇到这两种情况，按[下载](#下载)换成最新版即可。改动和测试范围见 [v0.2.0 release 说明](https://github.com/yinx0004/mongosh-table/releases/tag/v0.2.0)。

表格、竖排、CSV 和各种 BSON 类型的显示和 mongosh 里一样，只有下面几点不同，因为老 shell 缺少 mongosh 自带的这些能力：

| | mongosh | 老 mongo shell |
|---|---|---|
| 时区 | `'UTC'`、`'local'`、`'+08:00'`、`'Asia/Shanghai'` | 不支持 `'Asia/Shanghai'` 这样的时区名，用 `'+08:00'` 这样的偏移 |
| `MONGOTAB_LANG` / `MONGOTAB_TZ` | 都能读 | 4.4、5.0 能读；3.6–4.2 读不到，默认英文、UTC，用 `mt.config({lang: 'zh', tz: '+08:00'})` 切换 |
| 终端宽度 | 自动检测 | 读不到，按 160 列算；终端较窄时用 `mt.config({width: 120})` |
| 颜色 | 终端里自动开启 | 默认关闭，用 `mt.config({color: true})` 打开 |

每次连接都要设的话，可以一起写在启动命令里：

```bash
mongo "mongodb://user@host:27017/admin" --eval "load('/path/to/mongotab.js'); mt.config({lang: 'zh', tz: '+08:00'})" --shell
```

### MongoDB 4.0

MongoDB 4.0 用老的 `mongo`（见上一节）或 **mongosh 1.x** 都可以；mongosh 2.x 不行，它最低要求 MongoDB 4.2，连 4.0 会报 `requires at least 8 (MongoDB 4.2)`。

想用 mongosh 的话，1.x 解压就能用，不需要 root，也不影响机器上原来的 `mongo`。以 Linux x64 为例（1.10.6 是 1.x 的最后一版）：

```bash
curl -fLO https://downloads.mongodb.com/compass/mongosh-1.10.6-linux-x64.tgz && tar xzf mongosh-1.10.6-linux-x64.tgz
```

```bash
./mongosh-1.10.6-linux-x64/bin/mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

其他系统把链接里的 `linux-x64.tgz` 换成 `darwin-arm64.zip`（Apple 芯片的 Mac）、`darwin-x64.zip`（Intel Mac）或 `win32-x64.zip`（Windows）。

## License

[MIT](LICENSE) © 2026 Sherry Yin
