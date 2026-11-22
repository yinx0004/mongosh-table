# MongoTab

[![release](https://img.shields.io/github/v/release/yinx0004/mongosh-table)](https://github.com/yinx0004/mongosh-table/releases/latest)
[![license](https://img.shields.io/github/license/yinx0004/mongosh-table)](LICENSE)
[![compat](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml/badge.svg)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![shell](https://img.shields.io/badge/shell-mongosh%201.x%20%7C%202.x%20%7C%20legacy%20mongo-47A248?logo=mongodb&logoColor=white)](#legacy-mongo-shell)
[![MongoDB](https://img.shields.io/badge/MongoDB-3.6%20%7C%204.0%20%7C%204.2%20%7C%204.4%20%7C%205.0%20%7C%206.0%20%7C%207.0%20%7C%208.0-47A248?logo=mongodb&logoColor=white)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](#compatibility)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](mongotab.js)

[中文](README.md) | **English**

**Make mongosh readable.**

MongoTab renders query results in mongosh as MySQL-style tables or `\G`-style vertical records, without changing how you write MongoDB commands. A single JS file with no dependencies.
The legacy `mongo` shell that ships with MongoDB 5.0 and earlier works too (since v0.2.0); see [Legacy mongo shell](#legacy-mongo-shell).

**Non-intrusive**: it only adds three globals, `t`, `g` and `mt` (any name already taken is skipped; use `mongotab.xxx` instead).
It does not touch mongosh objects, prototypes, `.mongoshrc` or any config, and it is gone when the session ends.

## Download

It is a single file, `mongotab.js`. Put it anywhere on **the machine where you run mongosh** (your computer or a jump host). When you connect to a remote MongoDB, nothing goes on the server; see [Connecting to a remote MongoDB](#connecting-to-a-remote-mongodb). With the legacy `mongo` shell, likewise put it where `mongo` runs.

Linux / macOS:

```bash
curl -fLO https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js
```

```bash
# without curl
wget https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js
```

Windows (PowerShell):

```powershell
Invoke-WebRequest -Uri https://github.com/yinx0004/mongosh-table/releases/latest/download/mongotab.js -OutFile mongotab.js
```

In PowerShell, `curl` is an alias for `Invoke-WebRequest` and does not accept `-fLO`; to use curl, type `curl.exe -fLO ...`.

```bash
# or clone the whole repository (development version on main)
git clone https://github.com/yinx0004/mongosh-table.git
```

If you run mongosh on a jump host that has no internet access, download it on your own machine first and copy it to the jump host:

```bash
scp mongotab.js user@jumphost:~/
```

These links fetch the latest release; older versions are on the [Releases](https://github.com/yinx0004/mongosh-table/releases) page. For the development version on `main`, use `https://raw.githubusercontent.com/yinx0004/mongosh-table/main/mongotab.js` instead.

## Loading

```js
// after connecting
load('/path/to/mongotab.js')
```

`load()` does not expand `~`, so use a full path such as `load('/home/dba/mongotab.js')`; a relative path is resolved from the directory you started mongosh in.
On Windows, forward slashes are easiest: `load('C:/Users/dba/mongotab.js')`; backslashes must be doubled: `load('C:\\Users\\dba\\mongotab.js')`.

```bash
# load it when connecting
mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

```bash
# optional: a function in your own ~/.bashrc (this changes bash, not mongosh); then msh "mongodb://..." loads it for you
msh() { mongosh "$@" /path/to/mongotab.js --shell; }
```

```powershell
# Windows: add this to your PowerShell $PROFILE
function msh { mongosh @args C:/tools/mongotab.js --shell }
```

The connection string must come before the `.js` file; after it, mongosh does not treat it as a connection string and connects to localhost instead.

On Windows, Windows Terminal is recommended; if CJK columns do not line up, try it first.

### Connecting to a remote MongoDB

`load()` reads the file on the machine where mongosh runs, and `t` / `g` / `mt` live only in that mongosh session: queries go to the remote server as usual, and the results are laid out as tables locally. So nothing goes on the MongoDB server, and it needs no extra privileges or configuration.

| Where mongosh runs | Where mongotab.js goes |
|---|---|
| Your computer, connecting directly or through an SSH tunnel | Your computer |
| A jump host you SSH into first | The jump host |
| The database server itself | The database server |

```bash
# from your computer to a remote server
mongosh "mongodb://user@db.example.com:27017/admin" ~/mongotab.js --shell
```

A `~` in command-line arguments is expanded by your shell, so this works; a `~` inside `load()` is not.

## Usage

```js
t(db.orders.find({status: 'PAID'}))              // table; switches to vertical when too wide
g(db.orders.findOne())                           // vertical, like MySQL \G
t(db.orders.find(), 'orderNo,customer,amount')   // pick columns; customer = all of customer.*
t(db.orders.find(), {exclude: 'items,raw.*'})    // exclude columns
t(db.orders.find(), {limit: 200})                // shows at most 50 rows by default
t(db.orders.find(), {tz: '+08:00'})              // show times in UTC+8 for this call
mt.csv(db.orders.find(), 'orderNo,amount')       // print CSV, ready to paste into Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})     // change defaults for this session
mt.ps() / mt.repl() / mt.colls() ...             // DBA commands, see below
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

### For DBAs

Since v0.3.0, `mt` comes with a set of read-only shortcuts for the usual MySQL `SHOW ...` commands (`mt.slow()` and `mt.top()` since v0.4.0):

```js
mt.cmds()                     // list all commands
mt.ps()                       // SHOW PROCESSLIST: running operations, longest first
mt.ps({secs: 5})              // only those running for more than 5 seconds
mt.ps({ns: 'shop.orders'})    // only one database or collection
mt.ps({all: true})            // include idle connections and internal threads
mt.slow()                     // slow query log: reads system.profile, newest first; current db, or mt.slow('shop')
mt.slow({ms: 500, ns: 'orders'})  // only those over 500 ms, only one collection
mt.top()                      // read/write time per collection (ms), sampled 1 second apart, busiest first; like mongotop
mt.top({interval: 0})         // totals since startup
mt.repl()                     // SHOW REPLICA STATUS: member state, replication lag (seconds), sync source
mt.dbs()                      // SHOW DATABASES: disk space per database
mt.colls('shop')              // SHOW TABLE STATUS: documents, data and index size per collection, largest first; current db if omitted
mt.idx('orders')              // SHOW INDEX: index keys, size, usage count; 'shop.orders' or db.orders also work
mt.conns()                    // connections per client IP
mt.oplog()                    // SHOW BINARY LOGS: oplog size and how much time it covers
mt.status()                   // SHOW GLOBAL STATUS: version, role, ops/s (sampled 1 second apart), connections, cache
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

- Each command first prints the native command it runs (the `-- ...` line, dimmed in a terminal) so you can copy or check it. Turn it off with `mt.config({showCmd: false})`.
- They take the same options as `t()`, e.g. `mt.ps({secs: 5, cols: 'opid,secs,ns,command'})`, `mt.colls('shop', {limit: 200})`, `mt.idx('orders', {vertical: true})`.
- By default `mt.ps()` hides idle connections, internal threads, drivers' awaitable `hello` polls and its own query.
- `mt.slow()` only reads `system.profile` and never changes profiler settings. The profiler is off by default; when it is, `mt.slow()` tells you to turn it on with `db.setProfilingLevel(1, {slowms: 100})` (set per database).
- `mt.slow()` and `mt.top()` must run on a mongod; a mongos has no such data.
- They need monitoring privileges (such as the `clusterMonitor` role). Without them, or when `mt.repl()` / `mt.oplog()` runs on a standalone server, they print a one-line explanation instead of throwing.
- They work in both the legacy mongo shell and mongosh and are tested in CI on a replica set for every version; sharded clusters (mongos) are not tested yet.

#### Or wrap the native commands yourself

| MySQL habit | mongosh + MongoTab |
|---|---|
| `SHOW PROCESSLIST` | `t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')` |
| `SHOW REPLICA STATUS` | `t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost,lastHeartbeat')` |
| `SHOW DATABASES` | `t(db.adminCommand({listDatabases: 1}).databases)` |
| `SHOW INDEX FROM t` | `t(db.orders.getIndexes())` |
| `SHOW GLOBAL STATUS` | `t(db.serverStatus(), 'connections,opcounters,mem')` |

A single large document (`rs.status()`, `serverStatus()`) is shown as vertical key/value pairs, and any array of documents inside it (such as `members`) becomes its own sub-table.
Column selection can reach into sub-tables too: `t(rs.status(), 'set,myState,members.name,members.stateStr')`.

To look up more MySQL commands and their MongoDB equivalents, try the online tool [DBA Command Finder](https://www.solidstack.io/dba-command-finder) (runs in your browser, nothing to install; in Chinese): type a MySQL command or what you want to do (e.g. `SHOW SLAVE STATUS\G`) and it shows the matching mongosh command, which versions support it and how the fields map. Every command is tested on real databases version by version, and it also covers Redis, PostgreSQL and TiDB. Wrap what you find in `t()` / `g()` to get a table.

The source, tests and data are in [yinx0004/dba-command-finder](https://github.com/yinx0004/dba-command-finder); if a command is missing or wrong, please [open an issue](https://github.com/yinx0004/dba-command-finder/issues/new).

## Display conventions

| BSON | Shown as |
|---|---|
| ObjectId | hex string |
| Date | `2024-01-01 08:30:00[.123]`, UTC by default, time zone configurable |
| Long / Int32 / Double / Decimal128 | number, right-aligned |
| Timestamp | `2023-11-14 22:13:20 (1700000000:3)` |
| UUID / Binary subtype 3, 4 | UUID string |
| Other Binary | `Binary(subtype, base64 prefix..., N bytes)` |
| Value is null | `NULL` |
| Empty string `""` | blank (same as MySQL) |
| **Field missing from the document** | **`(missing)`**, dimmed in a terminal; `(无字段)` in Chinese |
| Newline / tab inside a string | `\n` / `\t` |

```
+-----+---------+--------+-----------+-----------+
| _id | orderNo | remark | coupon    | qty       |
+-----+---------+--------+-----------+-----------+
|   1 | SO1     | NULL   |           |         2 |
|   2 | SO2     |        | VIP10     | (missing) |
+-----+---------+--------+-----------+-----------+
```

Vertical output (`g()`) simply leaves missing fields out. `mt.csv()` follows the same rules as the table: `NULL`, empty, `(missing)`.
Once pasted into Excel, `NULL` and `(missing)` are plain text, not empty cells.

CJK characters count as 2 columns, so tables stay aligned. Cells longer than `maxCol` (default 40) are cut with `...`; vertical output is never cut.

## Options

`limit` 50 · `maxCol` 40 · `tz` `'UTC'` · `nullText` `'NULL'` · `missingText` follows `lang` · `color` auto · `width` auto · `depth` fully expanded · `lang` auto · `showCmd` true (DBA commands print the native command first)

When `missingText` is unset it shows `(missing)` / `(无字段)` depending on the language; once you set it, that value is used in every language, e.g. `mt.config({missingText: '-'})`, and `''` leaves the cell blank.

Environment variables, read when the script loads:

- `MONGOTAB_TZ=+08:00`: default time zone. An invalid value falls back to UTC with a warning.
- `MONGOTAB_LANG=en` or `zh`: language of help text and messages. If unset, it follows `LC_ALL` / `LC_MESSAGES` / `LANG` (`zh*` means Chinese, anything else English). You can also switch in the session with `mt.config({lang: 'en'})`.

## Compatibility

Every PR and every push to main runs [test/compat.js](test/compat.js) against a real database in GitHub Actions:

- mongosh: MongoDB 4.4, 5.0, 6.0, 7.0 and 8.0, each with mongosh 1.8.0 and the newest 2.x; MongoDB 4.0 with mongosh 1.8.0 and 1.10.6 (mongosh 2.x cannot connect to 4.0). 12 jobs.
- Legacy mongo shell: MongoDB 3.6, 4.0, 4.2, 4.4 and 5.0, each with its own `mongo` against a server of the same version. 5 jobs.

All on single-node replica sets. It also runs [test/format.js](test/format.js) (no database; covers formatting, `load()` paths and the `MONGOTAB_LANG` / `MONGOTAB_TZ` variables) with mongosh 1.8.0 and 2.14.2 on Linux, macOS and Windows, and with the legacy `mongo` from the 5 versions above.

To run them locally (needs Docker):

```bash
test/run.sh mongo:7.0
```

```bash
# the second argument picks the client image: mongo:6.0.4 ships mongosh 1.8.0
test/run.sh mongo:4.4 mongo:6.0.4
```

```bash
# images without mongosh use the legacy mongo; where both exist, pick it with MONGO_SHELL=mongo
test/run.sh mongo:4.0
MONGO_SHELL=mongo test/run.sh mongo:5.0
```

```bash
# formatting only, no database
mongosh --nodb test/format.js
test/format.sh mongo:4.0
```

### Legacy mongo shell

Since [v0.2.0](https://github.com/yinx0004/mongosh-table/releases/tag/v0.2.0) the legacy `mongo` command that ships with MongoDB 5.0 and earlier (prompt like `rs0:PRIMARY>`) works too. Load it the same way as in mongosh, with `mongo` in place of `mongosh`:

```js
load('/path/to/mongotab.js')
```

```bash
mongo "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

> **Versions:** v0.1.x does not support the legacy shell. v0.1.0 fails there with `TypeError: root is undefined`, and v0.1.1 says "MongoTab needs mongosh". If you see either, get the latest version from [Download](#download). For the changes and what was tested, see the [v0.2.0 release notes](https://github.com/yinx0004/mongosh-table/releases/tag/v0.2.0).

Tables, vertical output, CSV and all BSON types look the same as in mongosh. A few things differ because the legacy shell lacks what mongosh provides:

| | mongosh | Legacy mongo shell |
|---|---|---|
| Time zone | `'UTC'`, `'local'`, `'+08:00'`, `'Asia/Shanghai'` | No names like `'Asia/Shanghai'`; use an offset such as `'+08:00'` |
| `MONGOTAB_LANG` / `MONGOTAB_TZ` | Read | Read on 4.4 and 5.0; 3.6–4.2 cannot read them, so it starts in English and UTC; switch with `mt.config({lang: 'zh', tz: '+08:00'})` |
| Terminal width | Detected | Unknown, assumed 160 columns; on a narrower terminal use `mt.config({width: 120})` |
| Color | On in a terminal | Off; turn on with `mt.config({color: true})` |

To apply settings on every connection, put them in the start command:

```bash
mongo "mongodb://user@host:27017/admin" --eval "load('/path/to/mongotab.js'); mt.config({lang: 'zh', tz: '+08:00'})" --shell
```

### MongoDB 4.0

For MongoDB 4.0 use either the legacy `mongo` (see above) or **mongosh 1.x**. mongosh 2.x does not work: it needs MongoDB 4.2 or later and fails with `requires at least 8 (MongoDB 4.2)`.

If you prefer mongosh, 1.x runs straight from the archive, needs no root and leaves the existing `mongo` alone. On Linux x64 (1.10.6 is the last 1.x release):

```bash
curl -fLO https://downloads.mongodb.com/compass/mongosh-1.10.6-linux-x64.tgz && tar xzf mongosh-1.10.6-linux-x64.tgz
```

```bash
./mongosh-1.10.6-linux-x64/bin/mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

For other systems, replace `linux-x64.tgz` in the link with `darwin-arm64.zip` (Apple silicon Mac), `darwin-x64.zip` (Intel Mac) or `win32-x64.zip` (Windows).

## License

[MIT](LICENSE) © 2026 Sherry Yin
