# MongoTab

[![release](https://img.shields.io/github/v/release/yinx0004/mongosh-table)](https://github.com/yinx0004/mongosh-table/releases/latest)
[![license](https://img.shields.io/github/license/yinx0004/mongosh-table)](LICENSE)
[![compat](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml/badge.svg)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![mongosh](https://img.shields.io/badge/mongosh-1.x%20%7C%202.x-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/docs/mongodb-shell/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4.0%20%7C%204.4%20%7C%205.0%20%7C%206.0%20%7C%207.0%20%7C%208.0-47A248?logo=mongodb&logoColor=white)](https://github.com/yinx0004/mongosh-table/actions/workflows/compat.yml)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](#compatibility)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](mongotab.js)

[中文](README.md) | **English**

**Make mongosh readable.**

MongoTab renders query results in mongosh as MySQL-style tables or `\G`-style vertical records, without changing how you write MongoDB commands. A single JS file with no dependencies.

**Non-intrusive**: it only adds three globals, `t`, `g` and `mt` (any name already taken is skipped; use `mongotab.xxx` instead).
It does not touch mongosh objects, prototypes, `.mongoshrc` or any config, and it is gone when the session ends.

## Download

It is a single file, `mongotab.js`. Put it anywhere on **the machine where you run mongosh** (your computer or a jump host). When you connect to a remote MongoDB, nothing goes on the server; see [Connecting to a remote MongoDB](#connecting-to-a-remote-mongodb). For MongoDB 4.0 you need mongosh 1.x; see [MongoDB 4.0](#mongodb-40).

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

`limit` 50 · `maxCol` 40 · `tz` `'UTC'` · `nullText` `'NULL'` · `missingText` follows `lang` · `color` auto · `width` auto · `depth` fully expanded · `lang` auto

When `missingText` is unset it shows `(missing)` / `(无字段)` depending on the language; once you set it, that value is used in every language, e.g. `mt.config({missingText: '-'})`, and `''` leaves the cell blank.

Environment variables, read when the script loads:

- `MONGOTAB_TZ=+08:00`: default time zone. An invalid value falls back to UTC with a warning.
- `MONGOTAB_LANG=en` or `zh`: language of help text and messages. If unset, it follows `LC_ALL` / `LC_MESSAGES` / `LANG` (`zh*` means Chinese, anything else English). You can also switch in the session with `mt.config({lang: 'en'})`.

## Compatibility

Every PR and every push to main runs [test/compat.js](test/compat.js) in GitHub Actions, once for each pairing of these MongoDB and mongosh versions (12 jobs):

- MongoDB: 4.4, 5.0, 6.0, 7.0, 8.0 (single-node replica sets)
- mongosh: 1.8.0 and the newest 2.x
- MongoDB 4.0 with mongosh 1.x only: 1.8.0 and 1.10.6 (mongosh 2.x cannot connect to 4.0)

To run it locally (needs Docker):

```bash
test/run.sh mongo:7.0
```

```bash
# the mongo:4.4 image has no mongosh; the second argument picks the client image (mongo:6.0.4 ships mongosh 1.8.0)
test/run.sh mongo:4.4 mongo:6.0.4
```

It also runs [test/format.js](test/format.js) on Linux, macOS and Windows with mongosh 1.8.0 and 2.14.2 (6 jobs). That test needs no database; it covers formatting, `load()` paths (including Windows forward- and backslash forms) and the `MONGOTAB_LANG` / `MONGOTAB_TZ` environment variables. To run it locally:

```bash
mongosh --nodb test/format.js
```

### MongoDB 4.0

Connect to MongoDB 4.0 with **mongosh 1.x**:

- mongosh 2.x needs MongoDB 4.2 or later; against 4.0 it fails with `requires at least 8 (MongoDB 4.2)`.
- The legacy `mongo` command that ships with MongoDB 5.0 and earlier (prompt like `rs0:PRIMARY>`) is not mongosh, and MongoTab does not support it. Since v0.1.1, `load()` there prints a message pointing to mongosh instead of failing with `root is undefined`; CI checks this with the legacy `mongo` from 3.6, 4.0, 4.2, 4.4 and 5.0.

mongosh 1.x runs straight from the archive, needs no root and leaves the existing `mongo` alone. On Linux x64 (1.10.6 is the last 1.x release):

```bash
curl -fLO https://downloads.mongodb.com/compass/mongosh-1.10.6-linux-x64.tgz && tar xzf mongosh-1.10.6-linux-x64.tgz
```

```bash
./mongosh-1.10.6-linux-x64/bin/mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

For other systems, replace `linux-x64.tgz` in the link with `darwin-arm64.zip` (Apple silicon Mac), `darwin-x64.zip` (Intel Mac) or `win32-x64.zip` (Windows).

## License

[MIT](LICENSE) © 2026 Sherry Yin
