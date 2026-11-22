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
MongoDB 5.0 及更早版本自带的老 `mongo` shell 也能用，见[老的 mongo shell](#老的-mongo-shell)。

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

```js
t(db.orders.find({status: 'PAID'}))          // 表格，太宽自动改竖排
g(db.orders.findOne())                       // 竖排，相当于 \G
t(db.orders.find(), 'orderNo,customer,amount')   // 选列；customer = customer.* 全部
t(db.orders.find(), {exclude: 'items,raw.*'})    // 排除列
t(db.orders.find(), {limit: 200})                // 默认最多 50 行
t(db.orders.find(), {tz: '+08:00'})              // 本次按东八区显示时间
mt.csv(db.orders.find(), 'orderNo,amount')      // 输出 CSV，贴进 Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})    // 改本会话默认值
mt.ps() / mt.repl() / mt.colls() ...            // DBA 常用命令，见下文
mt.help()
```

```
+---------------+---------------+---------+---------------------+
| orderNo       | customer.name | amount  | createdAt           |
+---------------+---------------+---------+---------------------+
| SO20240101001 | 张三          | 1299.50 | 2024-01-01 16:30:00 |
| SO20240101002 | Alice         |   88.00 | 2024-01-01 17:00:00 |
+---------------+---------------+---------+---------------------+
2 rows in set
```

### DBA 常用命令

从 v0.3.0 起，`mt` 下面带了一组只读的快捷命令，对应 MySQL 的 `SHOW ...`：

```js
mt.cmds()                     // 列出全部命令
mt.ps()                       // SHOW PROCESSLIST：正在执行的操作，耗时长的在前
mt.ps({secs: 5})              // 只看运行超过 5 秒的
mt.ps({ns: 'shop.orders'})    // 只看某个库或集合
mt.ps({all: true})            // 含空闲连接和内部线程
mt.repl()                     // SHOW SLAVE STATUS：成员状态、复制延迟（秒）、同步源
mt.dbs()                      // SHOW DATABASES：各库占用空间
mt.colls('shop')              // SHOW TABLE STATUS：各集合文档数、数据和索引大小，大的在前；不写库名就是当前库
mt.idx('orders')              // SHOW INDEX：索引的键、大小、使用次数；也可以写 'shop.orders' 或 db.orders
mt.conns()                    // 按客户端 IP 统计连接数
mt.oplog()                    // SHOW BINARY LOGS：oplog 大小和能覆盖多长时间
mt.status()                   // SHOW GLOBAL STATUS：版本、角色、ops/s（间隔 1 秒采样）、连接、缓存
```

```
> mt.ps()
-- db.adminCommand({currentOp: 1, active: true})
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| opid | secs | op      | ns             | client              | app            | lock | plan                                | command                                  |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| 1625 |    9 | query   | shop.orders    | 192.168.147.5:47218 | mongosh 2.14.2 |      | IXSCAN { status: 1, createdAt: -1 } | {find: orders, filter: {$where: sleep... |
| 1791 |    0 | getmore | local.oplog.rs | 192.168.147.3:41478 | OplogFetcher   |      | COLLSCAN                            | {getMore: 7311352941832819751, collec... |
| 1790 |    0 | getmore | local.oplog.rs | 192.168.147.4:55718 | OplogFetcher   |      | COLLSCAN                            | {getMore: 8081156913663858071, collec... |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
3 rows in set

> mt.repl()
-- rs.status()
 set: rs0
date: 2026-11-22 05:02:46.493
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| name      | state     | health | lagSecs | optime              | syncSource | pingMs | lastHeartbeat           | self |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| db1:27017 | PRIMARY   |      1 |       0 | 2026-11-22 05:02:36 |            |        |                         | *    |
| db2:27017 | SECONDARY |      1 |       0 | 2026-11-22 05:02:36 | db1:27017  |      0 | 2026-11-22 05:02:45.284 |      |
| db3:27017 | SECONDARY |      1 |       0 | 2026-11-22 05:02:36 | db1:27017  |      0 | 2026-11-22 05:02:45.284 |      |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
3 rows in set
```

- 每条命令先打印对应的原生命令（`-- ...` 那一行，终端里是灰色），方便复制、核对。不想看用 `mt.config({showCmd: false})` 关掉。
- 选项和 `t()` 通用，例如 `mt.ps({secs: 5, cols: 'opid,secs,ns,command'})`、`mt.colls('shop', {limit: 200})`、`mt.idx('orders', {vertical: true})`。
- `mt.ps()` 默认不显示空闲连接、内部线程、驱动的心跳长轮询（awaitable hello）和这条查询自己。
- 这些命令需要监控类权限（如 `clusterMonitor` 角色）。权限不够、在单机上执行 `mt.repl()` / `mt.oplog()` 时，只打印一行说明，不抛异常。
- 老的 mongo shell 和 mongosh 都能用，CI 里在副本集上逐个版本测过；分片集群（mongos）还没测过。

#### 也可以直接套原生命令

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

`limit` 50 · `maxCol` 40 · `tz` `'UTC'` · `nullText` `'NULL'` · `missingText` 跟随语言 · `color` 自动 · `width` 自动 · `depth` 全部展开 · `lang` 自动 · `showCmd` true（DBA 命令先打印原生命令）

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

从 v0.2.0 起，MongoDB 5.0 及更早版本自带的老 `mongo` 命令（提示符像 `rs0:PRIMARY>`）也能用，加载方法和 mongosh 一样，把命令里的 `mongosh` 换成 `mongo` 即可：

```js
load('/path/to/mongotab.js')
```

```bash
mongo "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

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
