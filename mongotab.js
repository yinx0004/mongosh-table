// MongoTab (mongotab.js) — 在 mongosh 里把结果排成 MySQL 风格的表格 / \G 竖排
//
//   load('/path/to/mongotab.js')
//   t(db.orders.find({status: 'PAID'}))          // 表格（太宽自动竖排）
//   g(db.orders.findOne())                         // 竖排，相当于 MySQL 的 \G
//   t(rs.status().members, 'name,stateStr,health,optimeDate')
//   mt.help()
//
// 只新增三个全局函数 t、g、mt（名字已被占用就跳过，并提示改用 mongotab.xxx），
// 不改 mongosh 的任何对象、prototype 和配置；退出会话即失效。
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var MARK = '__mongotab__';

  // ───────────────────────── 配置 ─────────────────────────
  var cfg = {
    limit: 50,          // 游标 / 数组最多显示多少行
    maxCol: 40,         // 表格单列最大显示宽度
    tz: 'UTC',          // 'UTC' | 'local' | '+08:00' | 'Asia/Shanghai'
    nullText: 'NULL',
    color: null,        // null = 终端里自动开启
    width: null,        // 终端宽度，null = 自动检测
    depth: null,        // 嵌套展开层数，null = 全部展开
    lang: detectLang()  // 'zh' | 'en'：MONGOTAB_LANG > LC_ALL / LC_MESSAGES / LANG > 系统区域
  };

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  // ───────────────────────── 提示信息（中 / 英） ─────────────────────────
  function normLang(l) { return /^zh/i.test(String(l || '')) ? 'zh' : 'en'; }
  function detectLang() {
    var v = safe(function () {
      var e = process.env;
      return e.MONGOTAB_LANG || e.LC_ALL || e.LC_MESSAGES || e.LANG;
    }, '');
    if (!v) v = safe(function () { return Intl.DateTimeFormat().resolvedOptions().locale; }, '');
    return normLang(v);
  }
  function helpRow(label, desc) { return '  ' + (label.length < 29 ? label + ' '.repeat(29 - label.length) : label + '   ') + desc; }
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
      more: function (n, next, fn) { return '(只显示前 ' + n + ' 行，还有更多；用 ' + fn + '(x, {limit: ' + next + '}) 看更多)'; },
      partial: function (n, total) { return '(共 ' + total + ' 行，只显示前 ' + n + ' 行)'; },
      loaded: function (v, tz) { return 'MongoTab ' + v + ' 已加载：t(x) 表格 / g(x) 竖排 / mt.help()   时区 ' + tz; },
      skipped: function (names) {
        return '  注意：' + names.join('、') + ' 已被占用，未覆盖；请用 mongotab.table / mongotab.vertical / mongotab.help()';
      },
      help: function (limit) {
        return [
          helpRow('t(x)', '表格；太宽自动改竖排。x 可以是游标、数组、文档'),
          helpRow('g(x)', '竖排（MySQL \\G）'),
          helpRow("t(x, 'a,b,c.*')", '只看这些列；支持 * 通配，写 a 等于 a.* 全部'),
          helpRow("t(x, {exclude: 'big,raw.*'})", '排除列'),
          helpRow('t(x, {limit: 200})', '游标/数组最多显示行数（默认 ' + limit + '，0 = 不限）'),
          helpRow('t(x, {table: true})', '强制表格，不自动改竖排'),
          helpRow("t(x, {tz: '+08:00'})", '本次用指定时区显示时间'),
          helpRow('mt.csv(x, ...)', '输出 CSV（贴进 Excel）'),
          helpRow("mt.config({tz: 'local', maxCol: 60, lang: 'en'})", '改本会话默认值'),
          '',
          '  示例：'
        ].concat(HELP_EXAMPLES, ['', '  显示约定：NULL = 值为 null；空白 = 该文档没有这个字段']);
      }
    },
    en: {
      badTz: function (s) { return "mongotab: unknown time zone '" + s + "'; try 'UTC', 'local', '+08:00' or 'Asia/Shanghai'"; },
      more: function (n, next, fn) { return '(showing the first ' + n + ' rows, more available; use ' + fn + '(x, {limit: ' + next + '}) to see more)'; },
      partial: function (n, total) { return '(showing the first ' + n + ' of ' + total + ' rows)'; },
      loaded: function (v, tz) { return 'MongoTab ' + v + ' loaded: t(x) table / g(x) vertical / mt.help()   time zone ' + tz; },
      skipped: function (names) {
        return '  Note: ' + names.join(', ') + ' already defined, left untouched; use mongotab.table / mongotab.vertical / mongotab.help()';
      },
      help: function (limit) {
        return [
          helpRow('t(x)', 'Table; switches to vertical when too wide. x: cursor, array or document'),
          helpRow('g(x)', 'Vertical (like MySQL \\G)'),
          helpRow("t(x, 'a,b,c.*')", 'Only these columns; * wildcards allowed, a means all of a.*'),
          helpRow("t(x, {exclude: 'big,raw.*'})", 'Exclude columns'),
          helpRow('t(x, {limit: 200})', 'Max rows for cursors/arrays (default ' + limit + ', 0 = no limit)'),
          helpRow('t(x, {table: true})', 'Always a table, never switch to vertical'),
          helpRow("t(x, {tz: '+08:00'})", 'Show times in this time zone for this call'),
          helpRow('mt.csv(x, ...)', 'Print CSV (paste into Excel)'),
          helpRow("mt.config({tz: 'local', maxCol: 60, lang: 'zh'})", 'Change defaults for this session'),
          '',
          '  Examples:'
        ].concat(HELP_EXAMPLES, ['', '  Conventions: NULL = value is null; blank = the document has no such field']);
      }
    }
  };
  function L(lang) { return MSG[normLang(lang)]; }

  var envTz = safe(function () { return process.env.MONGOTAB_TZ; });
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
  function bsonType(v) {
    if (v === null || typeof v !== 'object') return null;
    var bt = safe(function () { return v._bsontype; });
    return typeof bt === 'string' ? bt : null;
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
    var sub = v.sub_type;
    var hex = safe(function () { return v.toString('hex'); }, '');
    if ((sub === 4 || sub === 3) && hex.length === 32) {
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    var b64 = safe(function () { return v.toString('base64'); }, '');
    var n = hex.length / 2;
    return 'Binary(' + sub + ', ' + (b64.length > 24 ? b64.slice(0, 24) + '...' : b64) + ', ' + n + ' bytes)';
  }
  function bsonText(v, bt, o) {
    switch (bt) {
      case 'ObjectId': case 'ObjectID': return v.toHexString();
      case 'Long': case 'Int32': case 'Double': case 'Decimal128': return v.toString();
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
      case 'DBRef': return 'DBRef(' + (v.collection || v.namespace) + ', ' + valText(v.oid, true, o) + ')';
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
      case 'function': return '[Function]';
    }
    if (isDate(v)) return dateText(v, o._tz);
    if (isRegExp(v)) return String(v);
    var bt = bsonType(v);
    if (bt) return bsonText(v, bt, o);
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
    c = Number(safe(function () { return process.env.COLUMNS; }));
    return c > 0 ? c : 160;
  }

  // ───────────────────────── 展开 / 选列 ─────────────────────────
  // 嵌套文档展开成 a.b.c；subs 不为空时，把“文档数组”单独收集起来做子表
  function flatten(doc, o, subs) {
    var out = new Map();
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
  var reCache = new Map();
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
      var out = [], seen = new Set();
      for (var i = 0; i < inc.length; i++) {
        for (var j = 0; j < cols.length; j++) {
          if (!seen.has(cols[j]) && matchCol(cols[j], inc[i])) { seen.add(cols[j]); out.push(cols[j]); }
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
        if (!f.has(c)) return null;          // 字段不存在：留空
        var v = f.get(c);
        if (v !== null && v !== undefined) { if (isNumeric(v)) hasNum[j] = true; else numeric[j] = false; }
        var s = clip(cellText(v, o), o.maxCol);
        if (dw(s) > widths[j]) widths[j] = dw(s);
        return { s: s, isNull: v === null || v === undefined };
      });
    });
    numeric = numeric.map(function (n, j) { return n && hasNum[j]; });
    var sep = '+' + widths.map(function (w) { return '-'.repeat(w + 2); }).join('+') + '+';
    var lines = [sep, '| ' + head.map(function (h, j) { return paint(o, BOLD, padR(h, widths[j])); }).join(' | ') + ' |', sep];
    body.forEach(function (row) {
      lines.push('| ' + row.map(function (cell, j) {
        if (!cell) return ' '.repeat(widths[j]);
        var p = numeric[j] ? padL(cell.s, widths[j]) : padR(cell.s, widths[j]);
        return cell.isNull ? paint(o, DIM, p) : p;
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
    var flats = [], cols = [], seen = new Set();
    rows.forEach(function (r) {
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      f.forEach(function (_, k) { if (!seen.has(k)) { seen.add(k); cols.push(k); } });
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
    var flats = [], cols = [], seen = new Set();
    rows.forEach(function (r) {
      var f = flatten(isDoc(r) ? r : { value: r }, o, null);
      flats.push(f);
      f.forEach(function (_, k) { if (!seen.has(k)) { seen.add(k); cols.push(k); } });
    });
    cols = selectCols(cols, o.cols, o.exclude);
    var q = function (s) { return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    out.push(cols.map(q).join(','));
    flats.forEach(function (f) {
      out.push(cols.map(function (c) {
        if (!f.has(c)) return '';
        var v = f.get(c);
        return v === null || v === undefined ? '' : q(valText(v, false, o));
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
  function help() {
    emit(['MongoTab ' + VERSION + ' — Make mongosh readable', ''].concat(L(cfg.lang).help(cfg.limit)));
  }

  var api = { table: t, vertical: g, csv: csv, config: config, help: help, version: VERSION };
  t[MARK] = g[MARK] = api[MARK] = true;

  var root = typeof globalThis !== 'undefined' ? globalThis : this;
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
