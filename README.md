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
mt.help()                                       // 帮助；t() / g() 不带参数也是帮助
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

DBA 命令另有自己的选项（`secs`、`ns`、`sort`、`interval`...），见下一节各命令。

### 会话默认值：mt.config()

```js
mt.config()                                  // 查看当前设置
mt.config({tz: '+08:00', limit: 100})        // 修改，只影响本会话
```

```
> mt.config()
{"limit":50,"maxCol":40,"tz":"UTC","nullText":"NULL","missingText":null,"color":null,"width":200,"depth":null,"showCmd":true,"lang":"zh"}
```

- 设置只在当前 mongosh 会话里有效，退出就没了；重新 `load()` 也会回到默认值。
- 想每次都生效，用环境变量 `MONGOTAB_TZ`、`MONGOTAB_LANG`，见[配置项](#配置项)。
- `t`、`g`、`mt` 这几个名字已经被别的脚本占用时，MongoTab 不会覆盖，加载时会提示；这时用 `mongotab.table()`、`mongotab.vertical()`、`mongotab.ps()` 等，用法完全一样。

## DBA 常用命令

`mt` 下面带了一组只读的快捷命令，对应 MySQL 的 `SHOW ...`。`mt.cmds()` 列出全部：

```
> mt.cmds()
+------------------------------+----------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| command                      | mysql                            | description                                                                                                                                                                            |
+------------------------------+----------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| mt.ps({secs, ns, all, sort}) | SHOW PROCESSLIST                 | 正在执行的操作；secs 最短秒数，ns 库或集合，all 含空闲连接，sort: 'desc' 运行最久的在前（默认）/ 'asc' / 'opid'                                                                        |
| mt.slow({ms, ns, sort})      | mysql.slow_log                   | 慢查询（system.profile）；默认当前库，可传 'db'；ms 最短毫秒数，ns 集合，sort: 'desc' 新的在前（默认）/ 'asc' / 'ms' 最慢的在前                                                        |
| mt.top({interval, ns})       | sys.schema_table_statistics      | 各集合读写耗时，忙的在前；interval 采样秒数，0 = 启动以来累计；ns 库或集合                                                                                                             |
| mt.locks({all})              | sys.innodb_lock_waits            | 谁在等锁、锁被谁占着；all 显示所有被占用的锁                                                                                                                                           |
| mt.txns({secs, sort})        | INFORMATION_SCHEMA.INNODB_TRX    | 未提交的事务：开了多久、空闲多久、多久后自动中止；secs 最短秒数，sort: 'desc' / 'asc'                                                                                                  |
| mt.repl()                    | SHOW SLAVE STATUS                | 副本集成员状态、复制延迟（秒）、同步源                                                                                                                                                 |
| mt.dbs()                     | SHOW DATABASES                   | 各库占用的磁盘空间                                                                                                                                                                     |
| mt.colls('db')               | SHOW TABLE STATUS                | 各集合文档数、数据和索引大小，大的在前；默认当前库                                                                                                                                     |
| mt.frag('db')                | TABLES.DATA_FREE                 | 各集合删数据后可回收的磁盘空间，多的在前；默认当前库                                                                                                                                   |
| mt.idx('coll')               | SHOW INDEX FROM t                | 索引的键、大小、使用次数和选项                                                                                                                                                         |
| mt.explain(cursor | n)       | EXPLAIN ANALYZE                  | 执行计划排成表：每个阶段的索引、扫描和返回行数、耗时，标出全表扫描、内存排序；也接受慢日志里的命令，mt.explain(n) 对上次 mt.slow() / mt.log() 的第 n 行；analyze: false 只看计划不执行 |
| mt.builds()                  | ALTER TABLE progress             | 正在建的索引：哪个集合、哪个索引、在哪个阶段、进度、已经跑了多久                                                                                                                       |
| mt.unusedIdx('db')           | sys.schema_unused_indexes        | 没被用过的索引（ops = 0），大的在前；默认所有用户库                                                                                                                                    |
| mt.dupIdx('db')              | sys.schema_redundant_indexes     | 冗余索引：键是另一个索引的前缀，如 {a: 1} 被 {a: 1, b: 1} 覆盖；默认所有用户库                                                                                                         |
| mt.conns()                   | PROCESSLIST GROUP BY host        | 按客户端 IP 统计连接数                                                                                                                                                                 |
| mt.oplog()                   | SHOW BINARY LOGS                 | oplog 大小和能覆盖多长时间                                                                                                                                                             |
| mt.status({interval})        | SHOW GLOBAL STATUS               | 版本、角色、ops/s、连接、缓存等关键指标                                                                                                                                                |
| mt.cache('db')               | sys.innodb_buffer_stats_by_table | 各集合占用的 WiredTiger 缓存，多的在前；默认所有库                                                                                                                                     |
| mt.ttl('db')                 | information_schema.EVENTS        | TTL 索引：过期时间、最早一条的时间、超期了多久，以及 TTL 线程的状态；默认所有库                                                                                                        |
| mt.log({n, grep, sev})       | performance_schema.error_log     | 最近的日志（getLog）；n 行数，grep 关键字或正则，sev: 'W' 只看警告及以上，startup 启动警告                                                                                             |
+------------------------------+----------------------------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
都可以加 t() 的选项，如 {cols: ...}、{vertical: true}；mt.config({showCmd: false}) 不打印原生命令
```

所有命令的共同点：

- **先打印原生命令**：第一行 `-- ...`（终端里是灰色）是它实际执行的 MongoDB 命令，方便复制、核对；`mt.config({showCmd: false})` 关掉。
- **选项和 `t()` 通用**：`cols`、`exclude`、`limit`、`vertical`、`table`、`tz` 都能用，例如 `mt.ps({secs: 5, cols: 'opid,secs,ns,command'})`、`mt.idx('orders', {vertical: true})`。
- **只读**：不会改任何设置，`mt.slow()` 也不会打开 profiler。
- **大小分逻辑和磁盘**：列名里带 `logical` 的是未压缩的数据量（BSON 大小），带 `disk` 的是磁盘上实际占的（WiredTiger 压缩后），带 `cached` 的是在内存缓存里占的（解压后）。同一份数据三者可以差好几倍。
- **权限**：需要监控类权限，如 `clusterMonitor` 角色。权限不够、在单机上执行 `mt.repl()` / `mt.oplog()`、在 mongos 上执行 `mt.slow()` / `mt.top()` / `mt.locks()` / `mt.cache()` 时，只打印一行说明，不抛异常。
- **版本**：老的 mongo shell 和 mongosh 都能用，CI 里在副本集上逐个版本测过；分片集群（mongos）还没测过。

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
| `#` | 行号，`mt.explain(n)` 用它 |
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
- `docsExamined` 远大于 `nreturned`、`plan` 是 `COLLSCAN` 的，通常就是缺索引。用 `mt.explain(行号)` 看它的执行计划，见[对慢日志里的命令做 explain](#对慢日志里的命令做-explain)。
- `system.profile` 是个 1 MB 的 capped 集合，满了会覆盖最早的记录，所以只能看到最近一段时间的。

### mt.explain()：执行计划

相当于 MySQL 的 `EXPLAIN ANALYZE`：把 `explain('executionStats')` 那一大段 JSON 排成一张表，一眼看出用了哪个索引、扫了多少、哪一步慢。

```js
mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))   // 游标：会真的执行一遍查询
mt.explain(db.orders.find({status: 'PAID'}), {analyze: false})       // 只看计划，不执行（queryPlanner）
mt.explain(db.orders.explain('executionStats').aggregate([...]))     // 聚合：先 explain，再把结果交给 mt.explain
mt.explain(db.orders.aggregate([...]))                               // mongosh 里聚合游标也可以直接传
mt.explain(1)                                                        // 上一次 mt.slow() / mt.log() 的第 1 行，见下文
```

老的 mongo shell 的聚合游标没有 `explain()`，要用上面第三种写法，或者 `db.orders.aggregate([...], {explain: true})`（这种只有计划，没有执行统计）。也可以把自己跑好的任何 explain 结果直接传进来。

上面几行是整体情况：

| 字段 | 说明 |
|---|---|
| `ns` | 库.集合 |
| `engine` | 执行引擎：`classic` 经典引擎，`sbe` 新的 slot-based 引擎（5.0 起部分查询使用） |
| `executionTimeMillis` | 总耗时（毫秒） |
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
> mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}).limit(5))
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
> mt.explain(db.orders.find({'customer.name': 'Bob', amount: {$gt: 400}}).sort({amount: -1}))
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

- 默认（`executionStats`）会真的执行一遍查询来统计，大查询要注意耗时；只想看计划用 `{analyze: false}`。
- `sbe` 引擎的计划只拿得到每一步的返回行数和耗时，扫描行数只有上面的合计。
- 分片集群（mongos）的计划会按分片分开显示，但还没测过。

#### 对慢日志里的命令做 explain

不用自己把慢查询改写成 `find().sort().limit()`，按手里有的东西选一种写法：

| 手里有的 | 写法 |
|---|---|
| `mt.slow()` / `mt.log()` 刚列出来的行 | `mt.explain(行号)` |
| 日志文件里的一整行（4.4 起的 JSON，或之前的文本） | 整行用反引号包起来：``mt.explain(`整行`)`` |
| 日志里命令那一段，从 `{` 开始 | 用反引号包起来：``mt.explain(`{ find: ... }`)`` |
| `system.profile` 里的一条 | `mt.explain(db.system.profile.findOne(...))` |
| 自己写的命令 | `mt.explain({find: 'orders', filter: {...}, ...}, {db: '库名'})` |

**1. 按行号（最省事）**

```js
mt.slow({sort: 'ms'})                       // profiler 里的慢查询，每行前面有行号 #
mt.explain(1)                               // 第 1 行的执行计划

mt.log('Slow query', {n: 10})               // 日志里的慢查询（4.4 起）
mt.log('command: find', {n: 10})            // 4.4 之前的文本日志这样找
mt.explain(3)                               // 第 3 行的执行计划
```

`mt.explain(n)` 用的是**最近一次** `mt.slow()` 或 `mt.log()` 列出的行。

**2. 从日志文件里复制一整行**

先在服务器上找到那一行，比如：

```bash
grep 'Slow query' /var/log/mongodb/mongod.log | grep orders | tail -1          # 4.4 起
grep 'command: find' /var/log/mongodb/mongod.log | grep orders | tail -1      # 4.4 之前
```

整行原样复制，在 mongosh 里用**反引号**包起来传进去（行里的单引号、双引号都不用改）：

```js
mt.explain(`2026-11-21T15:46:55.624+0000 I COMMAND  [conn2166] command shop.orders appName: "order-service" command: find { find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, projection: { $sortKey: { $meta: "sortKey" } }, sort: { createdAt: -1 }, limit: 20, shardVersion: [ Timestamp(0, 0), ObjectId('000000000000000000000000') ], $clusterTime: { clusterTime: Timestamp(1795276015, 2), signature: { hash: BinData(0, D9414CF6101A9BBBE43BC15ACE884BFEDC177A72), keyId: 7710591826859655200 } }, $db: "shop" } planSummary: COLLSCAN keysExamined:0 docsExamined:1005163 hasSortStage:1 nreturned:1 465ms`)
```

实际执行的是：

```js
db.getSiblingDB('shop').runCommand({explain: {find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, verbosity: 'executionStats'})
```

库名、集合名都从这一行里取；`shardVersion`、`$clusterTime`、`$sortKey` 这些自动去掉。4.4 起的 JSON 日志行也一样整行传进来。老的 mongo shell 没有反引号，用单引号包起来，行里的单引号要写成 `\'`。

**3. 只复制命令那一段**

从 `command: find ` 后面的 `{` 开始，到对应的 `}` 为止（后面多带了 `planSummary: ...` 也没关系），同样用反引号包起来：

```js
mt.explain(`{ find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, sort: { createdAt: -1 }, limit: 20, $db: "shop" }`)
```

库名取命令里的 `$db`；没有 `$db` 时先 `use 库名`，或者加选项 `{db: 'shop'}`。

**4. 自己写命令**

只挑关键的几项手写，直接写成 JS 对象（字符串加引号）：

```js
mt.explain({find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, {db: 'shop'})
```

**会报错的写法**

- 从 `mt.slow()` / `mt.log()` **表格里**复制命令：表格里的命令去掉了引号和类型，没法还原。用行号。
- 从 `command: find {` 或 `find {` 开始复制：要从 `{` 开始。
- 把日志里的命令**不加引号**直接当 JS 对象写：`BinData(0, D941...)` 里的十六进制、`customer.name` 这种带点的字段名都不是合法的 JS，会报语法错误。用反引号包成字符串。
- 日志行超过 10 KB 会被 MongoDB 截断，中间变成 `...`，这种解析不了，改用 `mt.slow()`。

怎么处理的：

- 去掉 mongos、驱动加的字段（`shardVersion`、`databaseVersion`、`lsid`、`$clusterTime`、`readConcern`、投影里的 `$sortKey`...），再用 `db.runCommand({explain: 命令, verbosity: 'executionStats'})` 执行。
- 在哪个库上执行：命令里的 `$db`，或者 `ns` 的库名；都没有就用 `{db: 'shop'}` 选项，再没有就是当前库。
- 支持 `find`、`aggregate`、`count`、`distinct`、`update`、`delete`、`findAndModify`。profile 和日志里单条的 update / remove 会自动包成 `update` / `delete` 命令；getMore 用它的原始命令（`originatingCommand`）。explain 写操作不会真的修改数据。
- JSON 日志里的 `{"$date": ...}`、`{"$oid": ...}`、`{"$numberLong": ...}` 会换回真正的类型，否则条件就对不上了。
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
| 1 | 46 | query | IXSCAN { status: 1 } |        66667 |        40 | {find: orders, filter: {status: shipp... |
+---+----+-------+----------------------+--------------+-----------+------------------------------------------+
1 row in set
```

```
> mt.explain(1)
-- db.getSiblingDB('shop').runCommand({explain: {find: orders, filter: {status: shipped, amount: {$gte: 3000}}, sort: {createdAt: -1}, limit: 40}, verbosity: 'executionStats'})
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 167
              nReturned: 40
      totalKeysExamined: 66667
      totalDocsExamined: 66667
docsExaminedPerReturned: 1666.7
          rejectedPlans: 0
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
| stage      | index    | nReturned | keysExamined | docsExamined | ms | detail                        | note         |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
| SORT       |          |        40 |              |              | 46 | sort {createdAt: -1}          | 内存排序     |
|   FETCH    |          |     26667 |              |        66667 | 46 | filter {amount: {$gte: 3000}} | 取出后再过滤 |
|     IXSCAN | status_1 |     66667 |        66667 |              |  9 | status ["shipped", "shipped"] |              |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+--------------+
3 rows in set
注意：内存排序；取出后再过滤
```

扫了 6 万多条只为返回 40 条（`docsExaminedPerReturned: 1666.7`）：`status_1` 只能按 `status` 找，`amount` 要取出文档再过滤，`createdAt` 还要在内存里排序。改成 `{status: 1, createdAt: -1, amount: 1}`（等值字段、排序字段、范围字段的顺序）就能顺着索引排好序，`amount` 也在索引里过滤掉。

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
mt.unusedIdx()          // 所有用户库（跳过 admin、local、config）
mt.unusedIdx('shop')    // 只看一个库，也可以传 db 对象
```

对每个集合执行 `$indexStats`，列出 `accesses.ops` 为 0 的索引，按磁盘占用从大到小排。上面一行 `uptime` 是 mongod 已经运行了多久。

| 列 | 说明 |
|---|---|
| `ns` / `index` / `key` | 库.集合、索引名、索引键 |
| `disk` | 索引占的磁盘空间，删掉能省下的就是这么多 |
| `since` | 从什么时候开始计数（mongod 启动或索引建好的时间） |
| `options` | `unique`、`ttl=秒`、`partial=条件`、`sparse`、`hidden`、`collation=语言` |

```
> mt.unusedIdx()
-- every user db: each collection getIndexes() + aggregate([{$indexStats: {}}]) → accesses.ops = 0
uptime: 15s
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| ns          | index           | key                 | disk     | since                   | options        |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| shop.orders | ttl_createdAt   | {createdAt: 1}      | 232.0 KB | 2026-11-22 11:07:07.525 | ttl=315360000s |
| shop.orders | customer.name_1 | {customer.name: 1}  | 168.0 KB | 2026-11-22 11:07:07.383 |                |
| shop.orders | status_1        | {status: 1}         | 116.0 KB | 2026-11-22 11:07:07.131 |                |
| shop.users  | email_1_name_1  | {email: 1, name: 1} |  20.0 KB | 2026-11-22 11:07:07.775 |                |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
4 rows in set
```

删之前先确认：

- **统计时间够不够长**：计数在 mongod 重启、索引重建后清零。`uptime` 或 `since` 只有几天的话，月报、年报这类偶尔才跑的查询可能还没来得及用到。
- **每个成员都要看**：计数是每个节点自己的。读写分离时，从节点上的查询只记在从节点上，要连到每个成员上分别执行。
- **`unique` 索引**即使没被查询用过，也在保证唯一性，不能随便删；**`ttl` 索引**在负责过期删除，同样不能删。
- 不确定的话，可以先 `db.orders.hideIndex('status_1')`（4.4 起）把它藏起来观察一段时间，查询变慢了再 `unhideIndex` 恢复，比直接删安全。
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
- 还没开始（比如在等锁）的建索引显示成 `等待开始`。
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
| `#` | 行号，`mt.explain(n)` 用它（带命令的行，如慢查询） |
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

都是单节点副本集。另外还跑 [test/format.js](test/format.js)（不连数据库，只测排版、`load()` 路径和 `MONGOTAB_LANG` / `MONGOTAB_TZ` 环境变量）：Linux、macOS、Windows 上的 mongosh 1.8.0 和 2.14.2，以及上面 5 个版本的老 `mongo`。

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
