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

Quick reference first; the sections below have the details.

```js
t(db.orders.find({status: 'PAID'}))          // table; switches to vertical when too wide
g(db.orders.findOne())                       // vertical, like \G
t(db.orders.find(), 'orderNo,customer,amount')   // pick columns; customer = all of customer.*
t(db.orders.find(), {exclude: 'items,raw.*'})    // exclude columns
t(db.orders.find(), {limit: 200})                // 50 rows by default
t(db.orders.find(), {tz: '+08:00'})              // show times in UTC+8 for this call
mt.csv(db.orders.find(), 'orderNo,amount')      // print CSV to paste into Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})    // change defaults for this session
mt.ps() / mt.slow() / mt.colls() ...            // DBA commands, see the next section
mt.help()                                       // help; t() / g() with no arguments also show it
```

All examples below come from a 3-node replica set (`db1` / `db2` / `db3`) with 20,000 orders in `shop.orders`; the output is real.

### Tables and vertical output: t() / g()

```js
t(x)                 // table
t(x, 'a,b,c')        // a string as the second argument picks columns
t(x, {limit: 200})   // an object as the second argument sets options, see "All options"
g(x)                 // vertical; same arguments as t()
```

`x` can be:

| Input | Examples | Shown as |
|---|---|---|
| A cursor | `find()`, `aggregate()`, with or without `.sort()` / `.limit()` | One row per document, at most `limit` rows (50 by default) |
| An array | `toArray()`, `getIndexes()`, `currentOp().inprog`, `rs.status().members` | One row per element |
| A single document | `findOne()`, `rs.status()`, `serverStatus()`, `db.stats()` | Vertical `field: value`; arrays of documents inside become sub-tables |
| Anything else | a number, a string | Printed as is |

- **Table or vertical**: `t()` builds a table and switches to vertical output when it is wider than the terminal; `{table: true}` always keeps the table (the terminal wraps long lines). `g()` is always vertical, the same as `t(x, {vertical: true})`.
- **Nested documents** become `a.b` columns such as `customer.name`; `{depth: 1}` expands one level only and puts anything deeper in a single cell, like `{city: Shanghai, zip: 200000}`.
- **Plain arrays** show as `[a, b]` and arrays of documents as `[{...}, {...}]`; inside a single document, an array of documents (such as `members` in `rs.status()`) becomes its own sub-table.
- **Column order** follows the order in which fields first appear; a document without a field shows `(missing)`, see [Display conventions](#display-conventions).
- Numbers are right-aligned; CJK characters count as two columns; cells longer than `maxCol` (40 by default) are cut to `...` in tables, never in vertical output.

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
          _id: 6b02a27307cd0862525ce7b2
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

### Picking and excluding columns

```js
t(x, 'orderNo,customer,amount')            // a comma-separated string
t(x, ['orderNo', 'customer', 'amount'])    // or an array
t(x, {cols: 'orderNo,amount', limit: 10})  // use cols together with other options
t(x, {exclude: '_id,items,raw.*'})         // exclude columns
```

- Columns appear in the order you list them.
- `customer` means `customer` plus all of `customer.*`.
- Wildcards: `*` matches any characters and `?` matches one, e.g. `'*.name'`, `'customer.*'`, `'item?'`.
- `cols` and `exclude` work together: pick first, then exclude.
- For a single document, columns can reach into sub-tables: `'members.name'` shows only the `name` column of `members`; if nothing about `members` is listed, that sub-table is left out.

```
> t(db.orders.find().sort({_id: 1}).limit(2), {exclude: '_id,items'})
+---------------+--------+--------+---------------+--------------+---------------------+-----------+-----------+-----------+
| orderNo       | status | amount | customer.name | customer.vip | createdAt           | level     | coupon    | remark    |
+---------------+--------+--------+---------------+--------------+---------------------+-----------+-----------+-----------+
| SO20240101000 | NEW    |    0.5 | 张三          | true         | 2024-01-01 08:30:00 | gold      | (missing) | (missing) |
| SO20240101001 | PAID   |    1.5 | Alice         | false        | 2024-01-01 08:31:00 | (missing) |           | NULL      |
+---------------+--------+--------+---------------+--------------+---------------------+-----------+-----------+-----------+
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

### Row limit

- Cursors show at most 50 rows by default. When there are more, the footer tells you how to see them:

```
> t(db.orders.find().sort({_id: 1}), {cols: 'orderNo,status', limit: 3})
+---------------+--------+
| orderNo       | status |
+---------------+--------+
| SO20240101000 | NEW    |
| SO20240101001 | PAID   |
| SO20240101002 | PAID   |
+---------------+--------+
3 rows in set  (showing the first 3 rows, more available; use t(x, {limit: 200}) to see more)
```

- `{limit: 0}` means no limit; `mt.config({limit: 200})` changes the default for the session.
- Arrays are cut at `limit` too, and the footer says "showing the first M of N rows".
- To fetch less from the server, put `.limit(n)` on the cursor itself; that saves traffic compared with `{limit: n}`.

### Dates and time zones

Dates show in UTC as `2024-01-01 08:30:00`, with `.123` when there are milliseconds.

```js
t(x, {tz: '+08:00'})          // UTC+8 for this call
t(x, {tz: 'Asia/Shanghai'})   // an IANA name (not in the legacy mongo shell; use an offset there)
t(x, {tz: 'local'})           // the time zone of the machine running the shell
mt.config({tz: '+08:00'})     // default for this session
```

You can also set `MONGOTAB_TZ=+08:00` before starting the shell, see [Options](#options).

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

### CSV export: mt.csv()

```js
mt.csv(db.orders.find({status: 'PAID'}), 'orderNo,customer.name,amount')
```

- Same arguments as `t()`: columns, `exclude`, `limit` and `tz` all work. Cursors stop at `limit` rows; arrays are printed in full.
- Values with commas, quotes or line breaks are quoted by CSV rules; there are no colors or footer, so you can paste the output straight into Excel.
- `NULL`, empty strings and `(missing)` follow the same conventions as tables.

```
> mt.csv(db.orders.find().sort({_id: 1}).limit(3), 'orderNo,customer.name,amount,remark')
orderNo,customer.name,amount,remark
SO20240101000,张三,0.5,(missing)
SO20240101001,Alice,1.5,NULL
SO20240101002,Bob,2.5,(missing)
```

### All options

Every option can be passed to a single call (`t(x, {maxCol: 80})`) or set as the session default with `mt.config()`.

| Option | Default | Meaning |
|---|---|---|
| `cols` | all | Only these columns, see "Picking and excluding columns" |
| `exclude` | none | Leave these columns out |
| `limit` | `50` | Max rows for cursors and arrays; `0` = no limit |
| `table` | `false` | Always a table, never switch to vertical |
| `vertical` | `false` | Always vertical; `g()` is `vertical: true` |
| `tz` | `'UTC'` | Time zone: `'UTC'`, `'local'`, `'+08:00'`, `'Asia/Shanghai'` |
| `maxCol` | `40` | Max width of a table cell; longer values are cut to `...`; `0` = never cut |
| `width` | auto | Terminal width; wider tables switch to vertical. 160 when it cannot be detected |
| `depth` | all | How many levels of nested documents to expand |
| `color` | auto | `true` / `false`: bold headers, dimmed `(missing)` and so on; off when not a terminal |
| `nullText` | `'NULL'` | What a null value shows as |
| `missingText` | follows `lang` | What a missing field shows as: `(missing)` / `(无字段)` by default |
| `lang` | auto | `'en'` / `'zh'`: language of messages and help |
| `showCmd` | `true` | DBA commands print the native command first |

DBA commands have their own options too (`secs`, `ns`, `sort`, `interval`...); see each command in the next section.

### Session defaults: mt.config()

```js
mt.config()                                  // show the current settings
mt.config({tz: '+08:00', limit: 100})        // change them for this session
```

```
> mt.config()
{"limit":50,"maxCol":40,"tz":"UTC","nullText":"NULL","missingText":null,"color":null,"width":200,"depth":null,"showCmd":true,"lang":"en"}
```

- Settings last for the current shell session only; running `load()` again also resets them.
- To make them stick, use the `MONGOTAB_TZ` and `MONGOTAB_LANG` environment variables, see [Options](#options).
- If the names `t`, `g` or `mt` are already taken by another script, MongoTab leaves them alone and says so when it loads; use `mongotab.table()`, `mongotab.vertical()`, `mongotab.ps()` and so on instead, which work the same way.

## For DBAs

`mt` comes with a set of read-only shortcuts for the usual MySQL `SHOW ...` commands. `mt.cmds()` lists them:

```
> mt.cmds()
+------------------------------+----------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| command                      | mysql                            | description                                                                                                                                                                                                                                                  |
+------------------------------+----------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| mt.ps({secs, ns, all, sort}) | SHOW PROCESSLIST                 | Running operations; secs = minimum seconds, ns = db or collection, all = include idle, sort: 'desc' longest running first (default) / 'asc' / 'opid'                                                                                                         |
| mt.slow({ms, ns, sort})      | mysql.slow_log                   | Slow operations from system.profile; current db unless you pass 'db'; ms = minimum milliseconds, ns = collection, sort: 'desc' newest first (default) / 'asc' / 'ms' slowest first                                                                           |
| mt.top({interval, ns})       | sys.schema_table_statistics      | Read/write time per collection, busiest first; interval = seconds to sample, 0 = totals since startup; ns = db or collection                                                                                                                                 |
| mt.locks({all})              | sys.innodb_lock_waits            | Who is waiting for a lock and who holds it; all = every lock that is held                                                                                                                                                                                    |
| mt.txns({secs, sort})        | INFORMATION_SCHEMA.INNODB_TRX    | Open transactions: how long open, how long idle, when they get aborted; secs = minimum seconds, sort: 'desc' / 'asc'                                                                                                                                         |
| mt.repl()                    | SHOW SLAVE STATUS                | Replica set members, replication lag (seconds), sync source                                                                                                                                                                                                  |
| mt.dbs()                     | SHOW DATABASES                   | Disk space used by each database                                                                                                                                                                                                                             |
| mt.colls('db')               | SHOW TABLE STATUS                | Documents, data and index size per collection, largest first; current db by default                                                                                                                                                                          |
| mt.frag('db')                | TABLES.DATA_FREE                 | Disk space each collection can reuse after deletes, most first; current db by default                                                                                                                                                                        |
| mt.idx('coll')               | SHOW INDEX FROM t                | Index keys, size, usage count and options                                                                                                                                                                                                                    |
| mt.explain(cursor | n)       | EXPLAIN ANALYZE                  | Query plan as a table: index, rows scanned and returned, and time per stage; flags full scans and in-memory sorts; also takes slow-log commands, and mt.explain(n) explains row n of the last mt.slow() / mt.log(); analyze: false = plan only, no execution |
| mt.builds()                  | ALTER TABLE progress             | Index builds in progress: collection, index, phase, progress and how long they have run                                                                                                                                                                      |
| mt.unusedIdx('db')           | sys.schema_unused_indexes        | Indexes never used (ops = 0), largest first; all user databases by default                                                                                                                                                                                   |
| mt.dupIdx('db')              | sys.schema_redundant_indexes     | Redundant indexes whose key is a prefix of another index, e.g. {a: 1} covered by {a: 1, b: 1}; all user databases by default                                                                                                                                 |
| mt.conns()                   | PROCESSLIST GROUP BY host        | Connections per client IP                                                                                                                                                                                                                                    |
| mt.oplog()                   | SHOW BINARY LOGS                 | Oplog size and how much time it covers                                                                                                                                                                                                                       |
| mt.status({interval})        | SHOW GLOBAL STATUS               | Version, role, ops/s, connections, cache and other key metrics                                                                                                                                                                                               |
| mt.cache('db')               | sys.innodb_buffer_stats_by_table | WiredTiger cache used by each collection, most first; all databases by default                                                                                                                                                                               |
| mt.ttl('db')                 | information_schema.EVENTS        | TTL indexes: expiry, oldest document, how far past expiry, and the TTL thread; all databases by default                                                                                                                                                      |
| mt.log({n, grep, sev})       | performance_schema.error_log     | Recent log lines (getLog); n = lines, grep = text or regex, sev: 'W' = warnings and worse, startup = startup warnings                                                                                                                                        |
+------------------------------+----------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
All accept t() options such as {cols: ...} or {vertical: true}; mt.config({showCmd: false}) hides the native command
```

All of them:

- **Print the native command first**: the `-- ...` line (dimmed in a terminal) is the MongoDB command actually run, so you can copy or check it; turn it off with `mt.config({showCmd: false})`.
- **Take the same options as `t()`**: `cols`, `exclude`, `limit`, `vertical`, `table` and `tz` all work, e.g. `mt.ps({secs: 5, cols: 'opid,secs,ns,command'})`, `mt.idx('orders', {vertical: true})`.
- **Are read-only**: they never change settings; `mt.slow()` does not turn the profiler on either.
- **Tell logical from disk sizes**: columns with `logical` in the name are the uncompressed data size (BSON), `disk` is what it actually takes on disk (compressed by WiredTiger), and `cached` is what it takes in the in-memory cache (uncompressed). The three can differ several times over for the same data.
- **Need monitoring privileges**, such as the `clusterMonitor` role. Without them, or when `mt.repl()` / `mt.oplog()` runs on a standalone server, or `mt.slow()` / `mt.top()` / `mt.locks()` / `mt.cache()` on a mongos, they print a one-line explanation instead of throwing.
- **Work in both the legacy mongo shell and mongosh**, tested in CI on a replica set for every version; sharded clusters (mongos) are not tested yet.

### mt.ps(): running operations

Like `SHOW PROCESSLIST`. It runs `db.adminCommand({currentOp: 1, active: true})`.

| Option | Meaning |
|---|---|
| `secs` | Only operations running for at least this many seconds, e.g. `{secs: 5}` |
| `ns` | Only one database or collection: `'shop'` matches every collection in `shop`, `'shop.orders'` only that one |
| `all` | `true` uses `$all: true` instead, including idle connections and internal threads |
| `sort` | `'desc'` (default, longest running first), `'asc'` (shortest first), `'opid'`, or a sort document on the column names such as `{ns: 1, secs: -1}`; ties fall back to longest running first |

| Column | Meaning |
|---|---|
| `opid` | Operation ID, the one `db.killOp(opid)` takes |
| `secs` | Seconds it has been running |
| `op` | `query`, `getmore`, `insert`, `update`, `remove`, `command`; `idle` for idle connections |
| `ns` | database.collection |
| `client` | Client IP:port |
| `app` | The client's appName, e.g. `mongosh 2.14.2`, `OplogFetcher` |
| `lock` | `WAIT` while waiting for a lock |
| `plan` | Plan summary; `COLLSCAN` is a full collection scan |
| `command` | The command, without driver fields such as `lsid` and `$clusterTime` |

Hidden by default: idle connections, internal threads with no client, drivers' awaitable `hello` polls, and the `mt.ps()` query itself.

```
> mt.ps()
-- db.adminCommand({currentOp: 1, active: true})
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| opid | secs | op      | ns             | client              | app            | lock | plan                                | command                                  |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
| 1867 |    9 | query   | shop.orders    | 192.168.117.5:55214 | mongosh 2.14.2 |      | IXSCAN { status: 1, createdAt: -1 } | {find: orders, filter: {$where: sleep... |
| 2032 |    0 | getmore | local.oplog.rs | 192.168.117.3:38576 | OplogFetcher   |      | COLLSCAN                            | {getMore: 3734861326900604230, collec... |
| 2033 |    0 | getmore | local.oplog.rs | 192.168.117.4:59068 | OplogFetcher   |      | COLLSCAN                            | {getMore: 6599645867319134113, collec... |
+------+------+---------+----------------+---------------------+----------------+------+-------------------------------------+------------------------------------------+
3 rows in set
```

```
> mt.ps({all: true, cols: 'opid,secs,op,ns,client,app', limit: 5})
-- db.adminCommand({currentOp: 1, $all: true})
+------+------+---------+-------------+---------------------+----------------+
| opid | secs | op      | ns          | client              | app            |
+------+------+---------+-------------+---------------------+----------------+
| 1867 |    9 | query   | shop.orders | 192.168.117.5:55214 | mongosh 2.14.2 |
| 1876 |    8 | command | admin.$cmd  | 192.168.117.5:55198 | mongosh 2.14.2 |
| 2037 |    0 | command | admin.$cmd  | 192.168.117.6:60902 | mongosh 2.14.2 |
|      |    0 | idle    |             | 192.168.117.3:38586 |                |
|      |    0 | idle    |             | 192.168.117.2:39932 |                |
+------+------+---------+-------------+---------------------+----------------+
5 rows in set  (showing the first 5 of 74 rows)
```

### mt.slow(): slow queries

Like the MySQL slow query log. It reads what the profiler writes to the `system.profile` collection.

```js
mt.slow()                           // current database
mt.slow('shop')                     // another database; a db object works too: mt.slow(db.getSiblingDB('shop'))
mt.slow({ms: 500, ns: 'orders'})    // only those over 500 ms, only the orders collection
mt.slow('shop', {sort: 'ms'})       // slowest first
```

| Option | Meaning |
|---|---|
| `ms` | Only operations that took at least this many milliseconds; becomes `{millis: {$gte: ms}}` |
| `ns` | A collection name (`'orders'`) or a full `'db.collection'` |
| `sort` | `'desc'` (default, `{ts: -1}`, newest first), `'asc'` (`{ts: 1}`, oldest first), `'ms'` (`{millis: -1, ts: -1}`, slowest first), or a sort document such as `{docsExamined: -1}` |

The header shows the profiler settings:

- The profiler is set per database: `level` 0 is off, 1 records operations slower than `slowms` milliseconds, 2 records everything; `sampleRate` is the fraction sampled.
- It is off by default. When it is, `mt.slow()` tells you to turn it on with `db.setProfilingLevel(1, {slowms: 100})`, which you run in each database.

| Column | Meaning |
|---|---|
| `#` | Row number, used by `mt.explain(n)` |
| `ts` | When the operation finished |
| `ms` | Duration in milliseconds (`millis`) |
| `op` | `query`, `update`, `command`... |
| `ns` | database.collection |
| `plan` | Plan summary, e.g. `COLLSCAN`, `IXSCAN { status: 1 }` |
| `keysExamined` / `docsExamined` | Index keys and documents scanned |
| `nreturned` | Documents returned |
| `client` / `user` | Client IP and user; without authentication `user` is always empty, so that column is hidden |
| `command` | The command, without driver fields |

```
> mt.slow()
-- db.getSiblingDB('shop').system.profile.find({}).sort({ts: -1})
        db: shop
     level: 1
    slowms: 20
sampleRate: 1
*************************** 1. row ***************************
           #: 1
          ts: 2026-11-22 12:51:23.118
          ms: 30
          op: command
          ns: shop.orders
        plan: COLLSCAN
keysExamined: 0
docsExamined: 20000
   nreturned: 2
      client: 192.168.107.6
     command: {aggregate: orders, pipeline: [{$group: {_id: $status, n: {$sum: 1}, total: {$sum: $amount}}}, {$sort: {_id: 1}}], cursor: {}}
*************************** 2. row ***************************
           #: 2
          ts: 2026-11-22 12:51:22.888
          ms: 10295
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 101
docsExamined: 101
   nreturned: 101
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(100) || true, status: NEW}}
*************************** 3. row ***************************
           #: 3
          ts: 2026-11-22 12:51:11.812
          ms: 43
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
          ts: 2026-11-22 12:51:11.764
          ms: 178
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
          ts: 2026-11-22 12:51:22.888
          ms: 10295
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
          ts: 2026-11-22 12:51:11.764
          ms: 178
          op: query
          ns: shop.orders
        plan: IXSCAN { status: 1, createdAt: -1 }
keysExamined: 80
docsExamined: 80
   nreturned: 80
      client: 192.168.107.5
     command: {find: orders, filter: {$where: sleep(1) || true, status: NEW}, limit: 80}
2 rows in set  (showing the first 2 of 4 rows)
```

```
> mt.slow('crm')
-- db.getSiblingDB('crm').system.profile.find({}).sort({ts: -1})
        db: crm
     level: 0
    slowms: 20
sampleRate: 1
Empty set
the profiler is off (level 0); turn it on with db.setProfilingLevel(1, {slowms: 100})
```

How it works:

- It runs `profile: -1` for the header (the same as `db.getProfilingStatus()`), `count` for the number of matching entries, then `find(filter).sort(sort).limit(limit)`. So by default you get the 50 newest, and with `{sort: 'ms'}` the 50 slowest; when there are more than `limit`, the footer gives the total.
- Reads of `system.profile` itself and `profile` commands are always left out, so at level 2 you do not see `mt.slow()` itself.
- `docsExamined` far above `nreturned`, or a `COLLSCAN` plan, usually means a missing index. Run `mt.explain(n)` on that row to see its plan, see [Explaining commands from a slow log](#explaining-commands-from-a-slow-log).
- `system.profile` is a 1 MB capped collection that overwrites its oldest entries when full, so it only covers recent activity.

### mt.explain(): query plans

Like MySQL's `EXPLAIN ANALYZE`: turns the long JSON of `explain('executionStats')` into a table, so you can see at a glance which index was used, how much was scanned and which step was slow.

```js
mt.explain(db.orders.find({status: 'PAID'}).sort({createdAt: -1}))   // a cursor: the query really runs once
mt.explain(db.orders.find({status: 'PAID'}), {analyze: false})       // plan only, nothing runs (queryPlanner)
mt.explain(db.orders.explain('executionStats').aggregate([...]))     // aggregation: explain it, then pass the result in
mt.explain(db.orders.aggregate([...]))                               // in mongosh an aggregation cursor works too
mt.explain(1)                                                        // row 1 of the last mt.slow() / mt.log(), see below
```

Aggregation cursors in the legacy mongo shell have no `explain()`; use the third form above, or `db.orders.aggregate([...], {explain: true})` (plan only, no execution statistics). Any explain result you ran yourself can be passed in as well.

The lines on top are the overall picture:

| Field | Meaning |
|---|---|
| `ns` | database.collection |
| `engine` | Execution engine: `classic`, or `sbe`, the newer slot-based engine (used for some queries since 5.0) |
| `executionTimeMillis` | Total time (ms) |
| `nReturned` | Documents returned |
| `totalKeysExamined` / `totalDocsExamined` | Index keys and documents scanned in total |
| `docsExaminedPerReturned` | Documents scanned per document returned. 1 is ideal; tens or hundreds mean the index does not fit |
| `rejectedPlans` | Number of candidate plans that lost |

The table is the plan tree, **read top to bottom from the result toward the data**: the top row is the last step, the most indented row runs first (reading an index or the collection).

| Column | Meaning |
|---|---|
| `stage` | Step: `IXSCAN` index scan, `FETCH` fetch documents by index, `COLLSCAN` scan the whole collection, `SORT`, `LIMIT`...; aggregation stages show as `$group`, `$sort` and so on |
| `index` | Index used |
| `nReturned` | Rows this step produced |
| `keysExamined` / `docsExamined` | Index keys and documents this step scanned |
| `ms` | Estimated time of this step (ms) |
| `detail` | Index bounds, filter, sort fields, limit and so on |
| `note` | `full scan` (COLLSCAN), `in-memory sort` (SORT without an index: slow with much data, and it can run out of memory), `spilled to disk`, `filtered after fetch` (FETCH still filters, so the index does not cover every condition), `multikey` |

A query using the right index: every step scans and returns 5.

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

No suitable index: it scans all 20,000 documents to return 1,000, then sorts them in memory. An index such as `{'customer.name': 1, amount: -1}` would fix it.

```
> mt.explain(db.orders.find({'customer.name': 'Bob', amount: {$gt: 400}}).sort({amount: -1}))
-- cursor.explain('executionStats')
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 6
              nReturned: 1000
      totalKeysExamined: 0
      totalDocsExamined: 20000
docsExaminedPerReturned: 20
          rejectedPlans: 0
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------------+
| stage      | index | nReturned | keysExamined | docsExamined | ms | detail                                   | note           |
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------------+
| SORT       |       |      1000 |              |              |  1 | sort {amount: -1}                        | in-memory sort |
|   COLLSCAN |       |      1000 |              |        20000 |  1 | filter {$and: [{customer.name: {$eq: ... | full scan      |
+------------+-------+-----------+--------------+--------------+----+------------------------------------------+----------------+
2 rows in set
Note: in-memory sort; full scan
```

An aggregation: `$match` became an index scan, with `$group` and `$sort` above it.

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
| $sort                  |                       |         4 |              |              |  5 | {sortKey: {total: -1}}                   |      |
|   $group               |                       |         4 |              |              |  5 | {_id: $customer.name, total: {$sum: $... |      |
|     PROJECTION_DEFAULT |                       |      6667 |              |              |  0 | {amount: 1, customer.name: 1, _id: 0}    |      |
|       FETCH            |                       |      6667 |              |         6667 |  0 |                                          |      |
|         IXSCAN         | status_1_createdAt_-1 |      6667 |         6667 |              |  0 | status ["NEW", "NEW"], createdAt [Max... |      |
+------------------------+-----------------------+-----------+--------------+--------------+----+------------------------------------------+------+
5 rows in set
```

- By default (`executionStats`) the query really runs once to collect statistics; mind the time on big queries, and use `{analyze: false}` to see only the plan.
- With the `sbe` engine only rows returned and time are available per step; scan counts are only in the totals on top.
- Plans from a sharded cluster (mongos) are shown per shard, but this is not tested yet.

#### Explaining commands from a slow log

No need to rewrite a slow query as `find().sort().limit()` yourself. Pick the form that matches what you have:

| What you have | How to write it |
|---|---|
| Rows that `mt.slow()` / `mt.log()` just listed | `mt.explain(n)` |
| A whole line from the log file (4.4+ JSON, or older text) | The whole line in backticks: ``mt.explain(`whole line`)`` |
| Just the command part of a log line, from `{` | In backticks: ``mt.explain(`{ find: ... }`)`` |
| An entry in `system.profile` | `mt.explain(db.system.profile.findOne(...))` |
| A command you write yourself | `mt.explain({find: 'orders', filter: {...}, ...}, {db: 'name'})` |

**1. By row number (easiest)**

```js
mt.slow({sort: 'ms'})                       // slow queries from the profiler; every row starts with a row number #
mt.explain(1)                               // plan of row 1

mt.log('Slow query', {n: 10})               // slow queries from the log (4.4+)
mt.log('command: find', {n: 10})            // how to find them in text logs before 4.4
mt.explain(3)                               // plan of row 3
```

`mt.explain(n)` uses the rows of the **most recent** `mt.slow()` or `mt.log()`.

**2. A whole line copied from the log file**

Find the line on the server first, for example:

```bash
grep 'Slow query' /var/log/mongodb/mongod.log | grep orders | tail -1          # 4.4+
grep 'command: find' /var/log/mongodb/mongod.log | grep orders | tail -1      # before 4.4
```

Copy the line as is and pass it in mongosh wrapped in **backticks** (no need to touch the single or double quotes inside):

```js
mt.explain(`2026-11-21T15:46:55.624+0000 I COMMAND  [conn2166] command shop.orders appName: "order-service" command: find { find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, projection: { $sortKey: { $meta: "sortKey" } }, sort: { createdAt: -1 }, limit: 20, shardVersion: [ Timestamp(0, 0), ObjectId('000000000000000000000000') ], $clusterTime: { clusterTime: Timestamp(1795276015, 2), signature: { hash: BinData(0, D9414CF6101A9BBBE43BC15ACE884BFEDC177A72), keyId: 7710591826859655200 } }, $db: "shop" } planSummary: COLLSCAN keysExamined:0 docsExamined:1005163 hasSortStage:1 nreturned:1 465ms`)
```

What actually runs:

```js
db.getSiblingDB('shop').runCommand({explain: {find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, verbosity: 'executionStats'})
```

The database and collection come from the line; `shardVersion`, `$clusterTime`, `$sortKey` and the like are dropped. A 4.4+ JSON log line is passed whole in the same way. The legacy mongo shell has no backticks: use single quotes and write the single quotes inside the line as `\'`.

**3. Just the command part**

Copy from the `{` after `command: find ` to its matching `}` (extra text after it, such as `planSummary: ...`, is fine), again in backticks:

```js
mt.explain(`{ find: "orders", filter: { userId: 24530, status: { $in: [ "paid", "shipped", "completed" ] } }, sort: { createdAt: -1 }, limit: 20, $db: "shop" }`)
```

The database is the command's `$db`; without one, `use` the database first or pass `{db: 'shop'}`.

**4. Writing the command yourself**

Pick the parts that matter and write them as a JS object (with quoted strings):

```js
mt.explain({find: 'orders', filter: {userId: 24530, status: {$in: ['paid', 'shipped', 'completed']}}, sort: {createdAt: -1}, limit: 20}, {db: 'shop'})
```

**Forms that fail**

- Copying a command from the `mt.slow()` / `mt.log()` **table**: the table drops quotes and types, so it cannot be restored. Use the row number.
- Copying from `command: find {` or `find {`: start from the `{`.
- Pasting the log's command as a JS object **without quotes**: hex in `BinData(0, D941...)` and dotted field names like `customer.name` are not valid JS and give a syntax error. Wrap it in backticks as a string.
- Log lines over 10 KB are truncated by MongoDB, with `...` in the middle, and cannot be parsed; use `mt.slow()` instead.

How it works:

- Fields added by mongos and drivers are dropped (`shardVersion`, `databaseVersion`, `lsid`, `$clusterTime`, `readConcern`, `$sortKey` in the projection...), then it runs `db.runCommand({explain: command, verbosity: 'executionStats'})`.
- The database is the command's `$db` or the database part of `ns`; failing that the `{db: 'shop'}` option, and failing that the current database.
- `find`, `aggregate`, `count`, `distinct`, `update`, `delete` and `findAndModify` are supported. Single update / remove statements from the profiler or the log are wrapped into `update` / `delete` commands; a getMore uses its original command (`originatingCommand`). Explaining a write does not modify any data.
- `{"$date": ...}`, `{"$oid": ...}`, `{"$numberLong": ...}` and friends in JSON logs are turned back into real types; otherwise the filter would not match.
- In text logs from before 4.4 the command is in shell syntax: unquoted field names, `ObjectId('...')`, `Timestamp(1, 2)`, `new Date(...)`, hex `BinData(0, D941...)`. These are parsed into the matching types (no `eval`), and integers above 2^53 become `NumberLong`.

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
| 1 | 53 | query | IXSCAN { status: 1 } |        66667 |        40 | {find: orders, filter: {status: shipp... |
+---+----+-------+----------------------+--------------+-----------+------------------------------------------+
1 row in set
```

```
> mt.explain(1)
-- db.getSiblingDB('shop').runCommand({explain: {find: orders, filter: {status: shipped, amount: {$gte: 3000}}, sort: {createdAt: -1}, limit: 40}, verbosity: 'executionStats'})
                     ns: shop.orders
                 engine: classic
    executionTimeMillis: 44
              nReturned: 40
      totalKeysExamined: 66667
      totalDocsExamined: 66667
docsExaminedPerReturned: 1666.7
          rejectedPlans: 0
+------------+----------+-----------+--------------+--------------+----+-------------------------------+----------------------+
| stage      | index    | nReturned | keysExamined | docsExamined | ms | detail                        | note                 |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+----------------------+
| SORT       |          |        40 |              |              |  1 | sort {createdAt: -1}          | in-memory sort       |
|   FETCH    |          |     26667 |              |        66667 |  1 | filter {amount: {$gte: 3000}} | filtered after fetch |
|     IXSCAN | status_1 |     66667 |        66667 |              |  0 | status ["shipped", "shipped"] |                      |
+------------+----------+-----------+--------------+--------------+----+-------------------------------+----------------------+
3 rows in set
Note: in-memory sort; filtered after fetch
```

It scanned over 66,000 documents to return 40 (`docsExaminedPerReturned: 1666.7`): `status_1` can only find by `status`, `amount` is filtered after fetching each document, and `createdAt` is sorted in memory. An index on `{status: 1, createdAt: -1, amount: 1}` (equality, then sort, then range fields) returns rows already sorted and filters `amount` inside the index.

### mt.top(): time per collection

Like mongotop: which collections are busiest.

```js
mt.top()                    // two samples 1 second apart: time spent in that second
mt.top({interval: 5})       // 5 seconds apart
mt.top({interval: 0})       // one sample: totals since startup
mt.top({ns: 'shop'})        // only the shop database; 'shop.orders' for one collection
```

| Column | Meaning |
|---|---|
| `ns` | database.collection |
| `totalMs` | Time spent by all operations in the interval (ms) |
| `readMs` / `writeMs` | Of which under read locks / write locks |
| `ops` | Number of operations |

```
> mt.top()
-- db.adminCommand({top: 1}), sampled twice 1s apart; time spent in between (ms)
+----------------+---------+--------+---------+-----+
| ns             | totalMs | readMs | writeMs | ops |
+----------------+---------+--------+---------+-----+
| shop.orders    |   10338 |  10338 |       0 |   1 |
| local.oplog.rs |       0 |      0 |       0 |   2 |
+----------------+---------+--------+---------+-----+
2 rows in set
```

```
> mt.top({interval: 0, ns: 'shop'})
-- db.adminCommand({top: 1}), totals since startup (ms)
+---------------------+---------+--------+---------+-----+
| ns                  | totalMs | readMs | writeMs | ops |
+---------------------+---------+--------+---------+-----+
| shop.orders         |   10818 |  10537 |     280 |  49 |
| shop.users          |       7 |      0 |       7 |   1 |
| shop.system.profile |       0 |      0 |       0 |   4 |
| shop.system.js      |       0 |      0 |       0 |   4 |
+---------------------+---------+--------+---------+-----+
4 rows in set
```

How it works:

- It runs `db.adminCommand({top: 1})`. mongod keeps per-collection totals since startup, time in microseconds and count:

  ```js
  totals: {
    "shop.orders": {
      total:     { time: 244000, count: 22 },   // all operations
      readLock:  { time: 2000,   count: 5 },    // reads
      writeLock: { time: 242000, count: 17 },   // writes
      ...
    },
    ...
  }
  ```

- By default it takes two samples with a 1-second `sleep` in between; the difference is the time each collection used in that second. `totalMs`, `readMs` and `writeMs` come from the `time` of `total`, `readLock` and `writeLock` (converted to milliseconds, rounded); `ops` comes from `total.count`.
- Collections with no activity in the interval are left out; rows are sorted by `totalMs`, highest first.
- `top` records time when an operation **finishes**, all at once. That is why the 1-second sample above shows over 10,000 ms for `shop.orders`: a long query had just finished a batch. Use `mt.ps()` for operations still running.
- Some operations take neither a read nor a write lock, so `readMs + writeMs` can be less than `totalMs`.

### mt.locks(): lock waits

Like MySQL's `sys.innodb_lock_waits`: which operations are queued for a lock, and who holds it.

```js
mt.locks()              // only locks with waiters, and the holders blocking them
mt.locks({all: true})   // every lock that is held, waiters or not
```

It runs `db.adminCommand({lockInfo: 1})` for each lock resource's holders (granted) and waiters (pending), then joins `currentOp` by opid for run time, client and command.

| Column | Meaning |
|---|---|
| `resource` | The lock resource, e.g. `Database shop`, `Collection shop.orders`; global-level locks show as a number such as `Global 3`, which varies by version |
| `mode` | `IS` / `IX` intent shared / intent exclusive, `S` shared, `X` exclusive (`r` / `w` / `R` / `W` in `currentOp`) |
| `state` | `HOLD` holds it, `WAIT` is queued |
| `opid` / `secs` | Operation ID and seconds running; `db.killOp(opid)` kills it |
| `client` / `desc` | Client; `desc` is the connection name (e.g. `conn31`) or an internal thread (e.g. `fsyncLockWorker`) |
| `op` / `ns` / `command` | Operation type, database.collection, the command |

This is what it looks like after `db.fsyncLock()`: `fsyncLockWorker` holds the global lock in `S` mode and every write (`IX`) queues until `db.fsyncUnlock()`. A backup that locked the server and never unlocked it looks exactly like this.

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

- By default only holders that conflict with a waiter are listed: `IS` and `S` do not conflict, so running reads do not show up above. Use `{all: true}` to see everything.
- WiredTiger has document-level concurrency: conflicts between ordinary reads and writes are retried (WriteConflict), not lock waits, so they do not appear here. Lock waits usually come from operations that need an exclusive lock, such as `fsyncLock`, the start and end of an index build, `collMod`, `renameCollection` and `drop`.
- On 4.2 the global lock is not in `lockInfo`; then the waits come from `waitingForLock` in `currentOp`: a waiter is queued for the last entry in its `locks`, and the holders are operations with a conflicting mode on that lock.

### mt.txns(): open transactions

Like MySQL's `INFORMATION_SCHEMA.INNODB_TRX`. Transactions exist since MongoDB 4.0.

```js
mt.txns()                 // open longest first
mt.txns({secs: 10})       // only those open for 10 seconds or more
mt.txns({sort: 'asc'})    // shortest first; or a sort document such as {client: 1}
```

It runs `db.adminCommand({currentOp: 1, $all: true})` and keeps entries with a `transaction` field; transactions idle between statements are included (`type: idleSession`).

| Column | Meaning |
|---|---|
| `lsid` / `txnNumber` | Session ID and transaction number within the session |
| `state` | `active` running a statement, `idle` between statements |
| `openSecs` | How long the transaction has been open |
| `activeSecs` / `idleSecs` | Of which running statements / idle |
| `start` | When the transaction started |
| `expiresIn` | Seconds until it is aborted automatically (`transactionLifetimeLimitSeconds`, 60 by default) |
| `opid` / `ns` | Operation ID and database.collection while running |
| `client` / `app` | Client and appName |

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

- A transaction left open keeps old versions of data in the WiredTiger cache; a large `idleSecs` usually means the application forgot to commit or abort.
- To end one right away: `db.adminCommand({killSessions: [{id: UUID('<lsid>')}]})`.

### mt.repl(): replica set status

Like `SHOW REPLICA STATUS`. It runs `rs.status()` and only works on a replica set member.

| Column | Meaning |
|---|---|
| `name` | Member address |
| `state` | `PRIMARY`, `SECONDARY`, `ARBITER`, `RECOVERING`... |
| `health` | 1 is up, 0 is unreachable |
| `lagSecs` | Replication lag in seconds: the primary's optime minus this member's; without a primary, compared with the member with the latest optime |
| `optime` | Time of the last operation this member applied |
| `syncSource` | The member it syncs from |
| `pingMs` | Heartbeat round-trip time |
| `lastHeartbeat` | When the last heartbeat arrived |
| `self` | `*` marks the member you are connected to |

```
> mt.repl()
-- rs.status()
 set: rs0
date: 2026-11-22 08:06:23.473
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| name      | state     | health | lagSecs | optime              | syncSource | pingMs | lastHeartbeat           | self |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
| db1:27017 | PRIMARY   |      1 |       0 | 2026-11-22 08:06:12 |            |        |                         | *    |
| db2:27017 | SECONDARY |      1 |       0 | 2026-11-22 08:06:12 | db1:27017  |      0 | 2026-11-22 08:06:22.561 |      |
| db3:27017 | SECONDARY |      1 |       0 | 2026-11-22 08:06:12 | db1:27017  |      0 | 2026-11-22 08:06:22.562 |      |
+-----------+-----------+--------+---------+---------------------+------------+--------+-------------------------+------+
3 rows in set
```

### mt.dbs(): database sizes

Like `SHOW DATABASES`. It runs `listDatabases`, sorts by name and ends with the total. `disk` is disk usage (`sizeOnDisk`).

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
Total 4.2 MB
```

### mt.colls(): collection sizes

Like `SHOW TABLE STATUS`.

```js
mt.colls()          // current database
mt.colls('shop')    // another database; a db object works too
```

It runs `$collStats` for each collection (views are skipped) and sorts by `disk + indexDisk` (disk usage), largest first.

| Column | Meaning |
|---|---|
| `count` | Number of documents |
| `logical` | Logical data size (uncompressed BSON) |
| `disk` | Disk space used by the data (compressed) |
| `indexes` | Number of indexes |
| `indexDisk` | Disk space used by the indexes |

```
> mt.colls()
-- db.getSiblingDB('shop').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}])
+----------------+-------+---------+----------+---------+-----------+
| name           | count | logical | disk     | indexes | indexDisk |
+----------------+-------+---------+----------+---------+-----------+
| orders         | 20000 |  3.6 MB | 964.0 KB |       4 |    1.2 MB |
| users          |     2 |    68 B |  20.0 KB |       1 |   20.0 KB |
| system.profile |     5 |  7.0 KB |   4.0 KB |       0 |       0 B |
+----------------+-------+---------+----------+---------+-----------+
3 rows in set
```

### mt.frag(): reusable disk space

Like `DATA_FREE` in MySQL's `information_schema.TABLES`: after deleting a lot of data, which collections have space in their files that can be reclaimed.

```js
mt.frag()          // current database
mt.frag('shop')    // another database; a db object works too
```

WiredTiger does not shrink files when data is deleted; the freed blocks stay in the file for later writes. It runs `$collStats` for each collection and reads `wiredTiger['block-manager']['file bytes available for reuse']`, for indexes too; rows are sorted by reusable data plus indexes, most first, and the last line is the total.

| Column | Meaning |
|---|---|
| `disk` | Size of the data file on disk |
| `reusable` | Space in it that can be reused |
| `pct` | Reusable as a share of the data file |
| `indexDisk` / `indexReusable` | Size of the index files on disk and reusable space in them |

```
> mt.frag('shop')
-- db.getSiblingDB('shop').getCollectionInfos(); each: aggregate([{$collStats: {storageStats: {}}}]) → wiredTiger['block-manager']
+----------------+---------+----------+-------+-----------+---------------+
| name           | disk    | reusable | pct   | indexDisk | indexReusable |
+----------------+---------+----------+-------+-----------+---------------+
| orders         |  2.0 MB | 956.0 KB | 46.0% |    3.6 MB |        1.2 MB |
| system.profile | 20.0 KB |      0 B |  0.0% |       0 B |           0 B |
| users          | 20.0 KB |      0 B |  0.0% |   20.0 KB |           0 B |
+----------------+---------+----------+-------+-----------+---------------+
3 rows in set
Total reusable 2.1 MB (data 956.0 KB, indexes 1.2 MB)
```

- New writes use the reusable space first. To give it back to the operating system, run `compact` on the collection (it no longer blocks reads and writes since 4.4, but it does use I/O), or resync a secondary from scratch.
- The numbers are as of WiredTiger's last checkpoint (every 60 seconds by default), so data you just deleted takes a moment to show up.

### mt.idx(): indexes

Like `SHOW INDEX FROM t`.

```js
mt.idx('orders')          // orders in the current database
mt.idx('shop.orders')     // another database
mt.idx(db.orders)         // a collection object
```

It uses `getIndexes()` for the definitions, `$indexStats` for usage and `$collStats` for each index's size.

| Column | Meaning |
|---|---|
| `name` | Index name |
| `key` | Index key |
| `disk` | Disk usage |
| `ops` | Times queries used it since `since`; an index that stays at 0 may be worth dropping |
| `since` | When counting started (reset when mongod restarts or the index is rebuilt) |
| `options` | `unique`, `sparse`, `ttl=seconds`, `partial=filter`, `hidden`, `collation=locale` |

```
> mt.idx('orders')
-- db.getSiblingDB('shop').getCollection('orders').getIndexes(); aggregate([{$indexStats: {}}])
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
| name                  | key                        | disk     | ops | since                   | options        |
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
| _id_                  | {_id: 1}                   | 508.0 KB |   6 | 2026-11-22 10:33:40.712 |                |
| orderNo_1             | {orderNo: 1}               | 248.0 KB |   1 | 2026-11-22 10:33:40.948 | unique         |
| status_1_createdAt_-1 | {status: 1, createdAt: -1} | 232.0 KB |  32 | 2026-11-22 10:33:41.037 |                |
| ttl_createdAt         | {createdAt: 1}             | 232.0 KB |   0 | 2026-11-22 10:33:41.121 | ttl=315360000s |
+-----------------------+----------------------------+----------+-----+-------------------------+----------------+
4 rows in set
```

### mt.unusedIdx(): unused indexes

Like MySQL's `sys.schema_unused_indexes`: indexes that no query has used, candidates for dropping to save disk, cache and write time.

```js
mt.unusedIdx()          // every user database (admin, local and config are skipped)
mt.unusedIdx('shop')    // one database only; a db object works too
```

It runs `$indexStats` for each collection and lists indexes whose `accesses.ops` is 0, largest on disk first. The `uptime` line on top is how long mongod has been running.

| Column | Meaning |
|---|---|
| `ns` / `index` / `key` | database.collection, index name, index key |
| `disk` | Disk space the index takes, i.e. what dropping it would save |
| `since` | When counting started (mongod startup or when the index was built) |
| `options` | `unique`, `ttl=seconds`, `partial=filter`, `sparse`, `hidden`, `collation=locale` |

```
> mt.unusedIdx()
-- every user db: each collection getIndexes() + aggregate([{$indexStats: {}}]) → accesses.ops = 0
uptime: 14s
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| ns          | index           | key                 | disk     | since                   | options        |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
| shop.orders | ttl_createdAt   | {createdAt: 1}      | 232.0 KB | 2026-11-22 11:07:23.899 | ttl=315360000s |
| shop.orders | customer.name_1 | {customer.name: 1}  | 168.0 KB | 2026-11-22 11:07:23.777 |                |
| shop.orders | status_1        | {status: 1}         | 116.0 KB | 2026-11-22 11:07:23.519 |                |
| shop.users  | email_1_name_1  | {email: 1, name: 1} |  20.0 KB | 2026-11-22 11:07:24.179 |                |
+-------------+-----------------+---------------------+----------+-------------------------+----------------+
4 rows in set
```

Before dropping one, check:

- **Has it been counting long enough?** Counts reset when mongod restarts or the index is rebuilt. If `uptime` or `since` is only a few days, monthly or yearly reports may not have run yet.
- **Check every member.** Counts are per node; with reads on secondaries, those queries are counted only there, so run it on each member.
- **`unique` indexes** enforce uniqueness even if no query uses them, and **`ttl` indexes** drive expiry; do not drop those.
- When unsure, hide it first with `db.orders.hideIndex('status_1')` (4.4+) and watch for a while; `unhideIndex` brings it back if queries slow down. That is safer than dropping it.
- The `_id_` index cannot be dropped and is not listed.

### mt.dupIdx(): redundant indexes

Like MySQL's `sys.schema_redundant_indexes`: an index whose key is a leading prefix of another index's key (same fields, same directions). Whatever `{status: 1}` can do, `{status: 1, createdAt: -1}` can do too, so the former is redundant.

```js
mt.dupIdx()          // every user database (admin, local and config are skipped)
mt.dupIdx('shop')    // one database only; a db object works too
```

| Column | Meaning |
|---|---|
| `ns` / `index` / `key` | The redundant index |
| `disk` | Disk space it takes |
| `coveredBy` / `coveredKey` | The index that can replace it; the one with the shortest key if there are several |

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

To avoid false alarms, these are never reported:

- The prefix index is `unique`, `ttl`, `partial`, `sparse` or `hidden`: it does something extra, or is not in use anyway.
- The longer index is `partial` or `sparse`: it does not cover every document, so it cannot replace the other.
- The two indexes have different collations, or one is a special index such as `text`, `2dsphere` or `hashed`.
- Directions differ, e.g. `{d: -1}` and `{d: 1, e: 1}`.

Hiding a redundant index with `hideIndex` before dropping it is a good idea here too.

### mt.builds(): index builds in progress

Like watching the progress of MySQL online DDL (`ALTER TABLE ... ADD INDEX`): building an index on a big collection takes a while, so see which phase it is in and how far along it is.

```js
mt.builds()
```

It runs `db.adminCommand({currentOp: 1, $all: true})` and picks the operations that are building indexes.

| Column | Meaning |
|---|---|
| `ns` / `index` / `key` | database.collection, index name, index key (comma-separated when several are built together) |
| `phase` | `scanning collection`, `inserting keys from external sorter into index` (writing the sorted keys into the index), `draining writes received during build` (applying writes that arrived during the build); `background` and similar on old versions |
| `done` / `total` / `pct` | Progress of the current phase; empty for phases that do not report progress |
| `secs` | Seconds it has been running |
| `opid` / `client` | Operation ID and the client that started the build |

```
> mt.builds()
-- db.adminCommand({currentOp: 1, $all: true}) → msg /Index Build/ or command.createIndexes
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
| ns          | index                        | key                               | phase                                    | done    | total   | pct   | secs | opid | client              |
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
| shop.orders | customer.name_1_createdAt_-1 | {customer.name: 1, createdAt: -1} | inserting keys from external sorter i... | 1447924 | 3000000 | 48.3% |    4 | 1048 | 192.168.107.3:39170 |
+-------------+------------------------------+-----------------------------------+------------------------------------------+---------+---------+-------+------+------+---------------------+
1 row in set
```

- Since 4.4 indexes are built on a background thread while the client's `createIndexes` waits alongside; the two are shown as one row.
- A client `createIndexes` with no build thread shows as `waiting`: it either has not started yet (waiting for a lock, say) or has finished building and is waiting to commit (since 4.4 a majority of members must finish first).
- To stop one: since 4.4 drop it with `db.orders.dropIndex('name')`; on earlier versions use `db.killOp(opid)`.
- On a replica set, secondaries build the index too (at the same time since 4.4); connect to a secondary to see its progress.

### mt.conns(): where connections come from

Counts connections per client IP, so you can see which machine or application holds the most.

- The lines on top come from `db.serverStatus().connections`: `current` open connections, `available` how many more can be opened, `totalCreated` how many were opened since startup.
- The table comes from `currentOp` with `$all: true`: `conns` connections, `active` how many of them are running an operation, `apps` their appNames.

```
> mt.conns()
-- db.serverStatus().connections; db.adminCommand({currentOp: 1, $all: true})
     current: 17
   available: 8175
totalCreated: 66
+---------------+-------+--------+----------------+
| client        | conns | active | apps           |
+---------------+-------+--------+----------------+
| 192.168.117.3 |     4 |      1 | OplogFetcher   |
| 192.168.117.4 |     4 |      1 | OplogFetcher   |
| 192.168.117.5 |     4 |      2 | mongosh 2.14.2 |
| 192.168.117.6 |     4 |      1 | mongosh 2.14.2 |
| 192.168.117.2 |     1 |      0 |                |
+---------------+-------+--------+----------------+
5 rows in set
```

### mt.oplog(): oplog window

Like `SHOW BINARY LOGS`; it answers the same question as `rs.printReplicationInfo()`: how much time the oplog covers. Only works on a replica set member.

| Field | Meaning |
|---|---|
| `maxLogical` | Oplog size limit (in logical size, i.e. `--oplogSize`) |
| `usedLogical` | How much is used (logical size) |
| `disk` | Disk space the oplog takes (compressed) |
| `firstEvent` / `lastEvent` | Times of the oldest and newest entries |
| `window` | The difference. A secondary that is down or behind for longer than this needs a full resync |
| `now` | Current time |

```
> mt.oplog()
-- rs.printReplicationInfo()
 maxLogical: 1.4 GB
usedLogical: 9.5 MB
       disk: 1.4 MB
 firstEvent: 2026-11-22 10:33:24
  lastEvent: 2026-11-22 10:33:41
     window: 17s (0.00 h)
        now: 2026-11-22 10:33:55.564
```

The example is a freshly created replica set, so the window is only seconds long; in production it is usually dozens of hours or more.

### mt.status(): key metrics

Like `SHOW GLOBAL STATUS`: the `serverStatus` metrics people look at most.

```js
mt.status()                 // two samples 1 second apart; ops/s and network/s are per second
mt.status({interval: 5})    // 5 seconds apart
mt.status({interval: 0})    // one sample: opcounters totals since startup
```

| Field | Meaning |
|---|---|
| `host` / `version` / `role` / `uptime` | Host, version, role (with the replica set name), uptime |
| `ops/s.*` | insert / query / update / delete / getmore / command per second |
| `connections.*` | Open connections and how many more are available |
| `activeClients.*` | Clients running reads / writes right now |
| `queue.*` | Reads / writes waiting for a lock; staying above 0 means pressure |
| `network/s.*` | Bytes in / out per second |
| `mem.*` | Resident and virtual memory |
| `cache.*` | WiredTiger cache: used, maximum, dirty |

```
> mt.status()
-- db.serverStatus(), sampled twice 1s apart for ops/s
                 host: db1
              version: 7.0.48
                 role: PRIMARY (rs0)
               uptime: 33s
         ops/s.insert: 0
          ops/s.query: 0
         ops/s.update: 0
         ops/s.delete: 0
        ops/s.getmore: 0
        ops/s.command: 4
  connections.current: 18
connections.available: 8174
activeClients.readers: 1
activeClients.writers: 0
        queue.readers: 0
        queue.writers: 0
         network/s.in: 1.0 KB
        network/s.out: 76.0 KB
         mem.resident: 215.0 MB
          mem.virtual: 1.1 GB
           cache.used: 22.2 MB
            cache.max: 7.3 GB
          cache.dirty: 11.0 MB
```

### mt.cache(): what is in the cache

Like MySQL's `sys.innodb_buffer_stats_by_table`: which collections take up the WiredTiger cache.

```js
mt.cache()          // every database
mt.cache('shop')    // one database only; a db object works too
```

The lines on top come from `serverStatus().wiredTiger.cache`: `used` (in parentheses, the share of the maximum), `max` (by default half of RAM minus 1 GB, at least 256 MB) and `dirty`, data not yet written back to disk. The table runs `$collStats` for each collection and reads `wiredTiger.cache['bytes currently in the cache']`.

| Column | Meaning |
|---|---|
| `ns` | database.collection |
| `cached` | Data plus indexes in the cache |
| `dataCached` / `indexCached` | Of which data / indexes |
| `share` | Share of the cache in use |

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
| shop.system.profile       | 10.5 KB |    10.5 KB |         0 B |  0.0% |
| config.system.indexBuilds |  6.2 KB |     4.5 KB |      1.7 KB |  0.0% |
| local.startup_log         |  4.7 KB |     3.5 KB |      1.2 KB |  0.0% |
+---------------------------+---------+------------+-------------+-------+
6 rows in set  (showing the first 6 of 25 rows)
These collections hold 32.8 MB in the cache, 96.1% of the cache in use
```

- The cache holds uncompressed data, so a collection can take more cache than its file takes on disk.
- The collections add up to a little less than `used`; the rest is WiredTiger's own metadata and so on.
- It runs `$collStats` once per collection, which is slow with thousands of collections; use `mt.cache('shop')` to look at one database.
- It must run on a mongod; a mongos has no cache.
- `dirty` staying above roughly 20% of the maximum means writes are coming in faster than they can be written back.

### mt.ttl(): TTL indexes

Like checking MySQL's scheduled cleanup EVENTs (`information_schema.EVENTS`): which collections delete expired data automatically, and whether the deletes keep up.

```js
mt.ttl()          // every database
mt.ttl('shop')    // one database only; a db object works too
```

The lines on top are the TTL background thread: `ttlMonitorEnabled` whether it runs, `ttlMonitorSleepSecs` how often it scans (60 seconds by default), `passes` how many scans it made and `deletedDocuments` how many documents it deleted (both since startup). Below, one row per TTL:

| Column | Meaning |
|---|---|
| `ns` | database.collection |
| `index` | TTL index name; `(timeseries)` for time series collections and `(clustered)` for clustered collections, whose expiry is set on the collection rather than an index |
| `field` | The date field expiry is based on |
| `expireAfterSeconds` / `expire` | Expiry in seconds and as a duration |
| `oldest` | The oldest value of that field (read along the TTL index, so it is fast) |
| `overdueSecs` | How many seconds the oldest document is past its expiry |
| `options` | `partial=filter`, `hidden` |

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
| shop.sessions | lastSeen_1    | lastSeen  |               1800 | 30m 0s     | 2026-11-21 19:55:49.627 |       49742 |         |
| shop.orders   | ttl_createdAt | createdAt |           31536000 | 365d 0h 0m | 2026-05-06 10:14:49.538 |           0 |         |
| shop.metrics  | (timeseries)  | ts        |             604800 | 7d 0h 0m   |                         |             |         |
+---------------+---------------+-----------+--------------------+------------+-------------------------+-------------+---------+
3 rows in set
```

- `overdueSecs` should normally be 0 or about the TTL thread interval (60 seconds). Much more means TTL cannot keep up (too much expired data), or the thread is not running (`ttlMonitorEnabled: false` as above). Documents whose field is not a date are never deleted by TTL and are not counted in `oldest`.
- Only plain TTL indexes get `oldest` / `overdueSecs`; they are left empty for indexes with a `partialFilterExpression`, time series and clustered collections.
- Secondaries do not delete on their own; the deletes replicate from the primary.

### mt.log(): recent log lines

Like MySQL's `performance_schema.error_log`: read the recent log from the shell without logging in to the server.

```js
mt.log()                        // last 20 lines
mt.log(100)                     // last 100 lines
mt.log('Slow query')            // only lines containing this text (case-insensitive)
mt.log(/COLLSCAN|IXSCAN/)       // a regex
mt.log({sev: 'W'})              // only warnings (W), errors (E) and fatal (F)
mt.log({startup: true})         // startup warnings, e.g. no access control, too few file descriptors
mt.log('Slow query', {n: 5, vertical: true})   // same options as t()
```

It runs `db.adminCommand({getLog: 'global'})` and shows the last `n` lines, oldest first.

| Option | Meaning |
|---|---|
| `n` | How many of the last lines to show, 20 by default |
| `grep` | Text (case-insensitive) or a regex; a string or regex as the first argument is `grep` |
| `sev` | `'F'`, `'E'`, `'W'`, `'I'` or `'D'`: this level and more severe |
| `startup` | `true` shows the startup warnings (`getLog: 'startupWarnings'`) |

| Column | Meaning |
|---|---|
| `#` | Row number, used by `mt.explain(n)` (rows with a command, such as slow queries) |
| `time` | Time, in the `tz` time zone |
| `sev` | Severity: `F` fatal, `E` error, `W` warning, `I` info, `D1`–`D5` debug |
| `comp` | Component: `NETWORK`, `COMMAND`, `REPL`, `STORAGE`... |
| `ctx` | Thread, e.g. `conn89`, `listener` |
| `id` / `attr` | Only in 4.4+ logs: message ID and details |
| `msg` | Message |

```
> mt.log({n: 6, cols: 'time,sev,comp,ctx,msg'})
-- db.adminCommand({getLog: 'global'})
+-------------------------+-----+---------+----------+------------------------------------------+
| time                    | sev | comp    | ctx      | msg                                      |
+-------------------------+-----+---------+----------+------------------------------------------+
| 2026-11-22 09:50:17.576 | I   | NETWORK | listener | Connection accepted                      |
| 2026-11-22 09:50:17.579 | I   | NETWORK | conn84   | client metadata                          |
| 2026-11-22 09:50:17.579 | I   | ACCESS  | conn84   | Connection not authenticating            |
| 2026-11-22 09:50:17.580 | I   | NETWORK | conn85   | client metadata                          |
| 2026-11-22 09:50:17.580 | I   | ACCESS  | conn85   | Connection not authenticating            |
| 2026-11-22 09:50:17.581 | I   | NETWORK | conn85   | Received first command on ingress con... |
+-------------------------+-----+---------+----------+------------------------------------------+
6 rows in set
(showing the last 6 of 755 rows)
```

```
> mt.log('COLLSCAN', {n: 1, vertical: true})
-- db.adminCommand({getLog: 'global'})
*************************** 1. row ***************************
   #: 1
time: 2026-11-22 12:51:55.234
 sev: I
comp: WRITE
 ctx: conn87
  id: 51803
 msg: Slow query
attr: {type: remove, ns: shop.orders, appName: mongosh 2.14.2, command: {q: {amount: {$lt: {$numberDecimal: 300}}}, limit: 0}, planSummary: COLLSCAN, planningTimeMicros: 197, totalOplogSlotDurationMicros: 10094, keysExamined: 0, docsExamined: 13333, ndeleted: 8000, keysDeleted: 32000, numYields: 13, locks: {ParallelBatchWriterMode: {acquireCount: {r: 14}}, FeatureCompatibilityVersion: {acquireCount: {w: 14}}, ReplicationStateTransition: {acquireCount: {w: 14}}, Global: {acquireCount: {w: 14}}, Database: {acquireCount: {w: 14}}, Collection: {acquireCount: {w: 14}}}, flowControl: {acquireCount: 14}, readConcern: {level: local, provenance: implicitDefault}, storage: {data: {bytesRead: 124878, timeReadingMicros: 208}}, cpuNanos: 72781484, remote: "192.168.107.6:33382", durationMillis: 76}
1 row in set
(showing the last 1 of 5 rows)
```

```
> mt.log({startup: true})
-- db.adminCommand({getLog: 'startupWarnings'})
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
| # | time                    | sev | comp    | ctx           | id    | msg                                      | attr                                     |
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
| 1 | 2026-11-22 12:51:27.314 | W   | CONTROL | initandlisten | 22120 | Access control is not enabled for the... |                                          |
| 2 | 2026-11-22 12:51:27.314 | W   | CONTROL | initandlisten | 22184 | Soft rlimits for open file descriptor... | {currentValue: 20480, recommendedMini... |
+---+-------------------------+-----+---------+---------------+-------+------------------------------------------+------------------------------------------+
2 rows in set
```

- `getLog` keeps only the last 1024 lines in memory; for older lines, read the log file.
- Since 4.4 the log is JSON: `msg` is a fixed template (such as `Slow query`) and the details are in `attr`, which is cut in a table; use `{vertical: true}` or `{maxCol: 0}` to see it all. Before 4.4 each line is plain text, all in `msg`, with no `id` / `attr` columns.
- Filters (`grep`, `sev`) apply first, then the last `n` lines are taken; the footer shows how many lines matched.
- On 4.2 and earlier, startup warnings are multi-line text at level `I` (`** WARNING: ...`), so `{sev: 'W'}` filters them out; use `mt.log({startup: true})` instead.

### Or wrap the native commands yourself

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

Defaults and meanings of every option are in [All options](#all-options); change them in a session with [`mt.config()`](#session-defaults-mtconfig).

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
