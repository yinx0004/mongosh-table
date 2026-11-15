# MongoTab

[![version](https://img.shields.io/badge/version-0.1.0-blue)](mongotab.js)
[![license](https://img.shields.io/github/license/yinx0004/mongosh-table)](LICENSE)
[![mongosh](https://img.shields.io/badge/mongosh-2.x-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/docs/mongodb-shell/)
[![MongoDB](https://img.shields.io/badge/tested%20on-MongoDB%207.0-47A248?logo=mongodb&logoColor=white)](#)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](mongotab.js)

**中文** | [English](README.en.md)

**Make mongosh readable.**

MongoTab 在 mongosh 里把查询结果排成 MySQL 风格的表格 / `\G` 竖排，不改变你写 MongoDB 命令的方式。单个 JS 文件，无依赖。

**零侵入**：只新增 `t`、`g`、`mt` 三个全局函数（名字被占用就跳过，改用 `mongotab.xxx`）。
不改 mongosh 的对象、prototype、`.mongoshrc` 或任何配置，退出会话即失效。

## 加载

```js
// 已连上后
load('/path/to/mongotab.js')
```

```bash
# 连接时一起加载
mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

```bash
# 想省事可以在自己的 ~/.bashrc 里加 alias（改的是 bash，不是 mongosh）
alias msh='mongosh --shell /path/to/mongotab.js'
```

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

已在 mongosh 2.14.2 + MongoDB 7.0（副本集）上测试。

## License

[MIT](LICENSE) © 2026 Sherry Yin
