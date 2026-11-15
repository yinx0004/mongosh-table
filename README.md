# MongoTab

[![release](https://img.shields.io/github/v/release/yinx0004/mongosh-table)](https://github.com/yinx0004/mongosh-table/releases/latest)
[![license](https://img.shields.io/github/license/yinx0004/mongosh-table)](LICENSE)
[![compat](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml/badge.svg)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![mongosh](https://img.shields.io/badge/mongosh-1.x%20%7C%202.x-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/docs/mongodb-shell/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4.4%20%7C%205.0%20%7C%206.0%20%7C%207.0%20%7C%208.0-47A248?logo=mongodb&logoColor=white)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](#兼容性)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](mongotab.js)

**中文** | [English](README.en.md)

**Make mongosh readable.**

MongoTab 在 mongosh 里把查询结果排成 MySQL 风格的表格 / `\G` 竖排，不改变你写 MongoDB 命令的方式。单个 JS 文件，无依赖。

**零侵入**：只新增 `t`、`g`、`mt` 三个全局函数（名字被占用就跳过，改用 `mongotab.xxx`）。
不改 mongosh 的对象、prototype、`.mongoshrc` 或任何配置，退出会话即失效。

## 下载

只有一个文件 `mongotab.js`，放到**运行 mongosh 的机器**上（你的电脑或跳板机），哪个目录都行。连接远程 MongoDB 时，服务器上不用放任何东西，见[连接远程 MongoDB](#连接远程-mongodb)。

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

### DBA 常用

| MySQL 习惯 | mongosh + MongoTab |
|---|---|
| `SHOW PROCESSLIST` | `t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')` |
| `SHOW SLAVE STATUS` | `t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost,lastHeartbeat')` |
| `SHOW DATABASES` | `t(db.adminCommand({listDatabases: 1}).databases)` |
| `SHOW INDEX FROM t` | `t(db.orders.getIndexes())` |
| `SHOW GLOBAL STATUS` | `t(db.serverStatus(), 'connections,opcounters,mem')` |

单个大文档（`rs.status()`、`serverStatus()`）先竖排列出普通字段，里面的文档数组（如 `members`）会单独成子表。
选列也能指到子表：`t(rs.status(), 'set,myState,members.name,members.stateStr')`。

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

`limit` 50 · `maxCol` 40 · `tz` `'UTC'` · `nullText` `'NULL'` · `missingText` 跟随语言 · `color` 自动 · `width` 自动 · `depth` 全部展开 · `lang` 自动

`missingText` 不设时跟随语言显示 `(无字段)` / `(missing)`；自己设了就固定用设的值，例如 `mt.config({missingText: '-'})`，设成 `''` 则留空。

环境变量（加载时读取）：

- `MONGOTAB_TZ=+08:00`：默认时区。写错了会回退到 UTC 并给出提示。
- `MONGOTAB_LANG=zh` 或 `en`：帮助和提示信息的语言。不设时跟随 `LC_ALL` / `LC_MESSAGES` / `LANG`（以 `zh` 开头为中文，其余为英文）。会话里也可以用 `mt.config({lang: 'zh'})` 切换。

## 兼容性

每个 PR 和每次推送到 main 都会在 GitHub Actions 里跑 [test/compat.js](test/compat.js)，下面每个 MongoDB 版本和每个 mongosh 版本两两组合各跑一遍（共 10 组）：

- MongoDB：4.4、5.0、6.0、7.0、8.0（单节点副本集）
- mongosh：1.8.0、2.x 最新版

本地跑（需要 Docker）：

```bash
test/run.sh mongo:7.0
```

```bash
# mongo:4.4 镜像里没有 mongosh，第二个参数指定客户端镜像（mongo:6.0.4 带 mongosh 1.8.0）
test/run.sh mongo:4.4 mongo:6.0.4
```

另外在 Linux、macOS、Windows 上分别用 mongosh 1.8.0 和 2.14.2 跑 [test/format.js](test/format.js)（共 6 组）。它不连数据库，只测排版、`load()` 路径（含 Windows 的正斜杠和反斜杠写法）以及 `MONGOTAB_LANG` / `MONGOTAB_TZ` 环境变量。本地跑：

```bash
mongosh --nodb test/format.js
```

## License

[MIT](LICENSE) © 2026 Sherry Yin
