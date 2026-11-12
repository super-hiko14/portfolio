/* ===================== トイエバ engine =====================
 * DOM に依存しない解釈エンジン。Web 版も Windows 版 (WebView) もこのファイルを読む。
 *
 *   Toieba.interpret(raw, { lang: 'ja' | 'en', app: boolean }) -> Result[]
 *
 * 先頭が第一候補、2 件目以降は「別の解釈」(例: 12/6 → 日付 と 割り算)。
 * Result: {
 *   kind, id, label, big, copy?, rows?: [[見出し, 値], ...], swatch?,
 *   regen?,            // 評価するたびに値が変わる (パスワード・サイコロなど)
 *   enter?,            // 'regen' なら Enter で振り直し (既定はコピー)
 *   action?,           // Enter で実行する操作 { type, ... }
 *   panel?,            // 'todo' | 'timer' | 'picker' | 'settings' | 'help' | 'bookmarks'
 *   refresh?,          // () => { big, rows }  時計などの毎秒更新
 *   pass?              // パスワードの生成条件 (UI のパネル用)
 * }
 */
(function (root) {
'use strict';

let lang = 'ja';
const L = (ja, en) => (lang === 'en' ? en : ja);

// ---------- 数値
const KANSUJI = { 兆: 1e12, 億: 1e8, 万: 1e4, 千: 1e3 };
// 3980 / 3,980 / 3万5千 / 1.5億
const JN = '\\d[\\d,]*(?:\\.\\d+)?(?:[兆億万千](?:\\d[\\d,]*(?:\\.\\d+)?)?)*';

function num(s) {
  s = String(s).replace(/,/g, '');
  if (!/[兆億万千]/.test(s)) return parseFloat(s);
  let total = 0, m;
  const re = /(\d+(?:\.\d+)?)([兆億万千]?)/g;
  while ((m = re.exec(s))) total += parseFloat(m[1]) * (KANSUJI[m[2]] || 1);
  return total;
}
function fmt(n, sig) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(6);
  return Number(n.toPrecision(sig || 12)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}
const fu = n => fmt(n, 7);   // 単位変換用 (有効7桁)
function jpNum(n) {
  if (!Number.isInteger(n) || Math.abs(n) < 1e4 || Math.abs(n) >= 1e16) return null;
  let a = Math.abs(n), s = '';
  for (const u of ['兆', '億', '万']) {
    const k = Math.floor(a / KANSUJI[u]);
    if (k) { s += k.toLocaleString('en-US') + u; a -= k * KANSUJI[u]; }
  }
  if (a) s += a.toLocaleString('en-US');
  return (n < 0 ? '-' : '') + s;
}
const pad2 = n => String(n).padStart(2, '0');

// 全角英数・記号を半角にそろえる (１２＋３ → 12+3, ％ → %, ㎡ → m2)
function normalize(s) {
  return s.normalize('NFKC').replace(/[−‒-―]/g, '-').replace(/[〜～]/g, '~')
    .replace(/\s+/g, ' ').trim();
}
// 正規化で文字数が変わっていなければ、利用者が打ったままの文字を取り出す
function rawTail(q, q0, pos) { return (q.length === q0.length ? q0 : q).slice(pos).trim(); }
function stripMoney(s) { return s.replace(/[¥$]\s*(?=\d)/g, '').replace(/(\d)\s*円/g, '$1'); }

// ===================== 計算 =====================
const FN = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, abs: Math.abs, exp: Math.exp,
  round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

// 「120足す80」「3の2乗」「ルート16」「3万5千×12」などを式に直す
function mathPrep(src) {
  src = stripMoney(src);
  src = src.replace(new RegExp('\\d[\\d,]*(?:\\.\\d+)?(?:[兆億万千](?:\\d[\\d,]*(?:\\.\\d+)?)?)+', 'g'), m => String(num(m)));
  return src
    .replace(/足す|たす|プラス|\bplus\b/gi, '+').replace(/引く|ひく|マイナス|\bminus\b/gi, '-')
    .replace(/掛ける|かける|\btimes\b|\bmultiplied by\b/gi, '*').replace(/割る|わる|\bdivided by\b/gi, '/')
    .replace(/の?(\d+)乗/g, '^$1').replace(/の?(?:二乗|自乗)|\bsquared\b/gi, '^2').replace(/の?三乗|\bcubed\b/gi, '^3')
    .replace(/ルート|平方根/g, 'sqrt ').replace(/\bmod\b/gi, '%')
    .replace(/√/g, 'sqrt ').replace(/∛/g, 'cbrt ')
    .replace(/[×✕✖]/g, '*').replace(/÷/g, '/').replace(/[ー―]/g, '-').replace(/π/g, 'pi')
    .replace(/(\d)\s*x\s*(?=\d)/gi, '$1*')
    .replace(/\s*(?:=|は|って)?\s*[?]*\s*$/, '');
}

function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      let txt = src.slice(i, j);
      const ex = src.slice(j).match(/^e[+-]?\d+(?![a-z])/i);   // 1e5, 2.5e-3
      if (ex) { txt += ex[0]; j += ex[0].length; }
      const v = Number(txt.replace(/,/g, ''));
      if (isNaN(v)) return null;
      toks.push({ t: 'num', v }); i = j; continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9]/i.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j).toLowerCase() }); i = j; continue;
    }
    if ('+-*/^%()!'.includes(c)) { toks.push({ t: c }); i++; continue; }
    return null;
  }
  return toks;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw 0;
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

// shunting-yard。スタックの値は { v, p } (p = パーセント表記だった値)
function evalMath(input) {
  const toks = tokenize(mathPrep(input));
  if (!toks || !toks.length) return null;
  if (!toks.some(t => t.t === 'num' || (t.t === 'id' && t.v === 'pi'))) return null;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, neg: 2.5, '^': 3 };
  const out = [], ops = [];
  const apply = op => {
    if (op.t === 'fn') { const a = out.pop(); if (!a) throw 0; out.push({ v: FN[op.v](a.v) }); return; }
    if (op.t === 'neg') { const a = out.pop(); if (!a) throw 0; out.push({ v: -a.v, p: a.p }); return; }
    const b = out.pop(), a = out.pop();
    if (!a || !b) throw 0;
    let v;
    switch (op.t) {
      case '+': v = b.p && !a.p ? a.v * (1 + b.v) : a.v + b.v; break;   // 3980 + 10% → 1割増し
      case '-': v = b.p && !a.p ? a.v * (1 - b.v) : a.v - b.v; break;
      case '*': v = a.v * b.v; break;
      case '/': v = a.v / b.v; break;
      case '%': v = a.v % b.v; break;
      case '^': v = Math.pow(a.v, b.v); break;
      default: throw 0;
    }
    out.push({ v });
  };
  const pushOp = op => {
    while (ops.length) {
      const top = ops[ops.length - 1];
      if (top.t === '(') break;
      if (top.t === 'fn' || prec[top.t] > prec[op] || (prec[top.t] === prec[op] && op !== '^')) apply(ops.pop());
      else break;
    }
    ops.push({ t: op });
  };
  let lastVal = false, lastTok = null;
  try {
    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k], next = toks[k + 1];
      if (lastVal) {
        // 2(3+4), 2pi, (1+2)(3+4) は掛け算。"12 6" のような数字の並びは式とみなさない
        if (tk.t === 'id' || tk.t === '(' || (tk.t === 'num' && lastTok.t === ')')) pushOp('*');
        else if (tk.t === 'num') return null;
      }
      if (tk.t === 'num') { out.push({ v: tk.v }); lastVal = true; }
      else if (tk.t === 'id') {
        if (tk.v in CONST) { out.push({ v: CONST[tk.v] }); lastVal = true; }
        else if (tk.v in FN) { ops.push({ t: 'fn', v: tk.v }); lastVal = false; }
        else return null;
      }
      else if (tk.t === '(') { ops.push(tk); lastVal = false; }
      else if (tk.t === ')') {
        while (ops.length && ops[ops.length - 1].t !== '(') apply(ops.pop());
        if (!ops.length) return null;
        ops.pop();
        if (ops.length && ops[ops.length - 1].t === 'fn') apply(ops.pop());
        lastVal = true;
      }
      else if (tk.t === '!') {
        if (!lastVal) return null;
        out.push({ v: factorial(out.pop().v) });
      }
      else if (tk.t === '%' && lastVal && !(next && (next.t === 'num' || next.t === 'id' || next.t === '('))) {
        out.push({ v: out.pop().v / 100, p: true });           // 後置の % (10% → 0.1)
      }
      else if (!lastVal) {
        if (tk.t === '-') ops.push({ t: 'neg' });
        else if (tk.t !== '+') return null;
      }
      else { pushOp(tk.t); lastVal = false; }
      lastTok = tk;
    }
    while (ops.length) {
      const top = ops.pop();
      if (top.t === '(') return null;
      apply(top);
    }
  } catch (e) { return null; }
  if (out.length !== 1 || typeof out[0].v !== 'number' || isNaN(out[0].v)) return null;
  return out[0].v;
}

function tryMath(q) {
  const v = evalMath(q);
  if (v === null) return null;
  if (!isFinite(v)) return { kind: 'math', label: L('計算', 'Calculation'), big: v > 0 ? '∞' : '−∞',
    rows: [[L('メモ', 'Note'), L('0 で割っています', 'Division by zero')]] };
  const pure = /^-?[\d,.]+$/.test(q.replace(/\s/g, ''));
  const rows = [];
  const plain = String(Number(v.toPrecision(12)));
  if (Math.abs(v) >= 1000 && !/e/.test(plain)) rows.push([L('区切りなし', 'No separators'), plain]);
  const jp = lang === 'ja' ? jpNum(v) : null;
  if (jp) rows.push(['日本語表記', jp]);
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53 && Math.abs(v) > 9)
    rows.push([L('16進数', 'Hex'), (v < 0 ? '-' : '') + '0x' + Math.abs(v).toString(16).toUpperCase()]);
  if (!Number.isInteger(v)) {
    const r2 = fmt(Math.round(v * 100) / 100);
    if (r2 !== fmt(v)) rows.push([L('四捨五入 (小数第2位)', 'Rounded (2 places)'), r2]);
  }
  return { kind: 'math', label: pure ? L('数値', 'Number') : L('計算', 'Calculation'), big: fmt(v), rows };
}

// ===================== 単位変換 =====================
const CATS = {
  len: ['長さ', 'Length'], wt: ['重さ', 'Weight'], vol: ['体積', 'Volume'], area: ['面積', 'Area'],
  spd: ['速さ', 'Speed'], data: ['データ量', 'Data size'], time: ['時間', 'Time'], temp: ['温度', 'Temperature'],
};
const U = {}, UAL = {};
// unit(分類, キー, 基準単位への係数, 表示記号, 日本語名, 英語名, 別名...)
function unit(cat, key, f, sym, ja, en, aliases) {
  // sym が [日本語, 英語] の配列なら表示言語で出し分ける
  U[key] = { cat, f, ja, en, get sym() { return Array.isArray(sym) ? L(sym[0], sym[1]) : sym; } };
  const names = [key, ...[].concat(sym), ja, ...(/^[a-z]+$/i.test(en) ? [en] : []), ...(aliases ? aliases.split(' ') : [])];
  for (const a of names) {
    if (!a) continue;
    const k = a.toLowerCase();
    if (!UAL[k]) UAL[k] = [];
    if (!UAL[k].includes(key)) UAL[k].push(key);
  }
}
unit('len', 'mm', 0.001, 'mm', 'ミリメートル', 'millimeters', 'ミリ millimeter millimetre');
unit('len', 'cm', 0.01, 'cm', 'センチメートル', 'centimeters', 'センチ centimeter centimetre');
unit('len', 'm', 1, 'm', 'メートル', 'meters', 'meter metre metres');
unit('len', 'km', 1000, 'km', 'キロメートル', 'kilometers', 'キロ kilometer kilometre');
unit('len', 'in', 0.0254, 'in', 'インチ', 'inches', 'inch');
unit('len', 'ft', 0.3048, 'ft', 'フィート', 'feet', 'foot フット');
unit('len', 'yd', 0.9144, 'yd', 'ヤード', 'yards', 'yard');
unit('len', 'mi', 1609.344, 'mi', 'マイル', 'miles', 'mile');
unit('wt', 'mg', 1e-6, 'mg', 'ミリグラム', 'milligrams', 'milligram');
unit('wt', 'g', 0.001, 'g', 'グラム', 'grams', 'gram');
unit('wt', 'kg', 1, 'kg', 'キログラム', 'kilograms', 'キロ kilogram kilo kilos');
unit('wt', 't', 1000, 't', 'トン', 'tonnes', 'ton tons tonne');
unit('wt', 'oz', 0.028349523125, 'oz', 'オンス', 'ounces', 'ounce');
unit('wt', 'lb', 0.45359237, 'lb', 'ポンド', 'pounds', 'lbs pound');
unit('vol', 'ml', 0.001, 'mL', 'ミリリットル', 'milliliters', 'cc milliliter');
unit('vol', 'l', 1, 'L', 'リットル', 'liters', 'liter litre litres');
unit('vol', 'gal', 3.785411784, 'gal', 'ガロン', 'gallons (US)', 'gallon gallons');
unit('vol', 'tsp', 0.005, ['小さじ', 'tsp'], '小さじ', 'teaspoons', '小さじ teaspoon');
unit('vol', 'tbsp', 0.015, ['大さじ', 'tbsp'], '大さじ', 'tablespoons', '大さじ tablespoon');
unit('vol', 'gou', 0.18039, '合', '合', 'gō (Japanese cup)', '合');
unit('area', 'cm2', 1e-4, 'cm²', '平方センチ', 'sq cm', '平方センチメートル cm^2');
unit('area', 'm2', 1, 'm²', '平方メートル', 'sq meters', '平米 m^2 sqm');
unit('area', 'km2', 1e6, 'km²', '平方キロ', 'sq km', '平方キロメートル km^2');
unit('area', 'ha', 1e4, 'ha', 'ヘクタール', 'hectares', 'hectare');
unit('area', 'acre', 4046.8564224, 'acre', 'エーカー', 'acres', 'acres');
unit('area', 'ft2', 0.09290304, 'ft²', '平方フィート', 'sq ft', 'ft^2 sqft');
unit('area', 'tsubo', 3.305785, '坪', '坪', 'tsubo', '坪');
unit('area', 'jo', 1.62, '畳', '畳', 'tatami mats', '畳 帖 tatami');
unit('spd', 'm/s', 1, 'm/s', 'メートル毎秒', 'meters/sec', 'mps');
unit('spd', 'km/h', 1 / 3.6, 'km/h', 'キロ毎時', 'km/hour', 'kph kmh');
unit('spd', 'mph', 0.44704, 'mph', 'マイル毎時', 'miles/hour', '');
unit('spd', 'kt', 1852 / 3600, 'kt', 'ノット', 'knots', 'knot kn');
unit('data', 'b', 1, 'B', 'バイト', 'bytes', 'byte');
unit('data', 'kb', 1024, 'KB', 'キロバイト', 'kilobytes', 'kib');
unit('data', 'mb', 1024 ** 2, 'MB', 'メガバイト', 'megabytes', 'メガ mib');
unit('data', 'gb', 1024 ** 3, 'GB', 'ギガバイト', 'gigabytes', 'ギガ gib');
unit('data', 'tb', 1024 ** 4, 'TB', 'テラバイト', 'terabytes', 'テラ tib');
unit('time', 's', 1, ['秒', 's'], '秒', 'seconds', '秒 s sec secs second');
unit('time', 'min', 60, ['分', 'min'], '分', 'minutes', '分 min mins minute m');
unit('time', 'h', 3600, ['時間', 'h'], '時間', 'hours', '時間 h hr hrs hour');
unit('time', 'd', 86400, ['日', 'd'], '日', 'days', '日 d day');
unit('time', 'w', 604800, ['週間', 'wk'], '週間', 'weeks', '週間 週 w wk week');
unit('time', 'y', 31557600, ['年', 'yr'], '年', 'years', '年 y yr year');
unit('temp', 'c', 1, '°C', '摂氏', 'Celsius', '℃ 度 摂氏');
unit('temp', 'f', 1, '°F', '華氏', 'Fahrenheit', '℉ 華氏');
unit('temp', 'k', 1, 'K', 'ケルビン', 'Kelvin', '');
const UAL_SORTED = Object.keys(UAL).sort((a, b) => b.length - a.length);
// 単位だけ書かれたときに真っ先に見せる相手
const PAIR = {
  km: 'mi', mi: 'km', m: 'ft', ft: 'm', cm: 'in', in: 'cm', mm: 'cm', yd: 'm',
  kg: 'lb', lb: 'kg', g: 'oz', oz: 'g', mg: 'g', t: 'kg',
  l: 'ml', ml: 'l', gal: 'l', tsp: 'ml', tbsp: 'ml', gou: 'ml',
  m2: 'tsubo', tsubo: 'm2', jo: 'm2', ha: 'm2', km2: 'ha', acre: 'm2', ft2: 'm2', cm2: 'm2',
  'km/h': 'mph', mph: 'km/h', 'm/s': 'km/h', kt: 'km/h',
  b: 'kb', kb: 'mb', mb: 'gb', gb: 'mb', tb: 'gb',
  s: 'min', min: 'h', h: 'min', d: 'h', w: 'd', y: 'd',
  c: 'f', f: 'c', k: 'c',
};

function conv(v, a, b) {
  if (U[a].cat !== 'temp') return v * U[a].f / U[b].f;
  const c = a === 'c' ? v : a === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
  return b === 'c' ? c : b === 'f' ? c * 9 / 5 + 32 : c + 273.15;
}
const uname = k => L(U[k].ja, U[k].en);
const uval = (v, k) => fu(v) + ' ' + U[k].sym;

// "は何マイル" "to mi" "をkgに" などから変換先を取り出す。null = 変換先なし, undefined = 読めない
function parseTarget(r) {
  const t = r.trim();
  if (!t) return null;
  const head = t.replace(/^(?:to|in|into|as|->|→|=>|⇒|=|を|は|って|から)\s*/i, '').replace(/^(?:何|なん)\s*/, '');
  const tail = /\s*(?:に変換|に換算|へ変換|に直すと?|にすると?|にして|に|へ|で言うと|でいうと|で|だと|なら|は)?\s*(?:いくつ|いくら|何|なに)?\s*[?]*$/;
  let sawEmpty = false;
  for (const c of [t, head, t.replace(tail, ''), head.replace(tail, '')]) {
    const k = c.trim().toLowerCase();
    if (!k) { sawEmpty = true; continue; }
    if (UAL[k]) return UAL[k];
  }
  return sawEmpty ? null : undefined;
}

function tryUnits(q) {
  // 摂氏30度 / 時速60キロ のような前置きの書き方
  const s = q
    .replace(/^(摂氏|華氏)\s*(-?[\d.,]+)\s*度?/, (m, k, n) => n + (k === '摂氏' ? '°c' : '°f'))
    .replace(/^時速\s*([\d.,]+)\s*(?:キロメートル|キロ|km)/i, '$1km/h').replace(/^時速\s*([\d.,]+)\s*マイル/, '$1mph')
    .replace(/^秒速\s*([\d.,]+)\s*(?:メートル|m)/i, '$1m/s')
    .replace(/^(大さじ|小さじ)\s*([\d.,]+)/, '$2$1');
  const m = s.match(/^(-?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(.+)$/);
  if (!m) return null;
  const v = num(m[1]), rest = m[2], low = rest.toLowerCase();
  for (const al of UAL_SORTED) {
    if (!low.startsWith(al)) continue;
    const to = parseTarget(rest.slice(al.length));
    if (to === undefined) continue;
    const from = UAL[al];
    if (to) {
      for (const a of from) for (const b of to)
        if (a !== b && U[a].cat === U[b].cat) return unitPair(v, a, b);
      continue;
    }
    if (rest.slice(0, al.length) === 'k') continue;   // "5k" はケルビンとみなさない
    return from.filter(a => !(a === 'y' && v >= 1000)).map(a => unitLone(v, a));   // "2026年" は年数ではなく西暦
  }
  return null;
}
function unitPair(v, a, b) {
  const A = U[a], cat = CATS[A.cat];
  const rows = [[L('元の値', 'Input'), uval(v, a)]];
  if (A.cat !== 'temp') rows.push([L('逆向き', 'Reverse'), '1 ' + U[b].sym + ' = ' + uval(conv(1, b, a), a)]);
  if (A.cat === 'time') rows.push([L('時間表記', 'As a duration'), fmtDuration(v * A.f * 1000)]);
  return { kind: 'unit', id: 'unit:' + A.cat, label: L(cat[0] + 'の変換', cat[1] + ' conversion'), big: uval(conv(v, a, b), b), rows };
}
function unitLone(v, a) {
  const A = U[a], cat = CATS[A.cat];
  const others = Object.keys(U).filter(k => U[k].cat === A.cat && k !== a);
  const first = a === 'min' && v < 60 ? 's' : PAIR[a] || others[0];
  const rows = others.filter(k => k !== first).map(k => [uname(k), uval(conv(v, a, k), k)]);
  if (A.cat === 'time') rows.push([L('時間表記', 'As a duration'), fmtDuration(v * A.f * 1000)]);
  return { kind: 'unit', id: 'unit:' + A.cat, label: L(cat[0], cat[1]) + ' · ' + uval(v, a), big: uval(conv(v, a, first), first), rows };
}

// ===================== パーセント・税 =====================
function tryPercent(q0) {
  let q = stripMoney(q0).replace(/パーセント|percent/gi, '%');
  // 2割5分 → 25%
  q = q.replace(/(\d+(?:\.\d+)?)割(?:(\d)分)?/g, (m, a, b) => (parseFloat(a) * 10 + (b ? +b : 0)) + '%');
  const N = '(' + JN + ')', P = '(\\d+(?:\\.\\d+)?)\\s*%';
  const rx = (s) => new RegExp(s, 'i');
  let m;
  if ((m = q.match(rx('^' + N + '\\s*(?:の|から|を)?\\s*' + P + '\\s*(?:引き?|びき|オフ|off|割引|値引き?|減|ダウン|down|discount)$'))))
    return pctChange(num(m[1]), -(+m[2]));
  if ((m = q.match(rx('^' + N + '\\s*(?:の|に|を)?\\s*' + P + '\\s*(?:増し?|まし|アップ|up|増|上乗せ|プラス|markup)$'))))
    return pctChange(num(m[1]), +m[2]);
  if ((m = q.match(rx('^' + N + '\\s*([+\\-])\\s*' + P + '$'))))
    return pctChange(num(m[1]), m[2] === '+' ? +m[3] : -(+m[3]));
  if ((m = q.match(rx('^' + N + '\\s*の\\s*' + P + '\\s*(?:は|って)?\\s*(?:いくら|いくつ|何)?[?]?$'))))
    return pctOf(num(m[1]), +m[2]);
  if ((m = q.match(rx('^' + P + '\\s*(?:of|の)\\s*' + N + '$'))))
    return pctOf(num(m[2]), +m[1]);
  if ((m = q.match(rx('^' + N + '\\s*(?:は|って)\\s*' + N + '\\s*の\\s*何\\s*(?:%|割)\\s*[?]?$'))) ||
      (m = q.match(rx('^' + N + '\\s*(?:is what % of|is what percentage of|as a % of|out of)\\s*' + N + '\\s*[?]?$')))) {
    const a = num(m[1]), b = num(m[2]);
    return { kind: 'percent', label: L('割合', 'Ratio'), big: fmt(a / b * 100) + ' %',
      rows: [[L(fmt(b) + ' を 100% とすると', fmt(b) + ' = 100%'), L(fmt(a) + ' は ' + fmt(a / b * 100) + '%', fmt(a) + ' = ' + fmt(a / b * 100) + '%')],
             [L('残り', 'Remaining'), fmt(100 - a / b * 100) + ' %']] };
  }
  if ((m = q.match(rx('^' + N + '\\s*(?:から|→|->)\\s*' + N + '\\s*(?:は|って)?\\s*何\\s*%\\s*(?:増減|増|減|アップ|ダウン|変化)?\\s*[?]?$'))) ||
      (m = q.match(rx('^%\\s*change\\s*(?:from\\s*)?' + N + '\\s*(?:to|→|->)\\s*' + N + '$')))) {
    const a = num(m[1]), b = num(m[2]), r = (b - a) / a * 100;
    return { kind: 'percent', label: L('増減率', 'Percent change'), big: (r > 0 ? '+' : '') + fmt(r) + ' %',
      rows: [[L('差分', 'Difference'), (b - a > 0 ? '+' : '') + fmt(b - a)], [L('倍率', 'Ratio'), fmt(b / a) + L(' 倍', '×')]] };
  }
  // 税込・税抜 (日本の消費税)
  if ((m = q.match(rx('^(?:税込み?|with tax|incl\\.? tax|tax)\\s*' + N + '$'))) ||
      (m = q.match(rx('^' + N + '\\s*(?:の)?\\s*(?:税込み?|\\+\\s*tax|with tax|plus tax)$')))) {
    const base = num(m[1]), inc = Math.round(base * 1.1);
    return { kind: 'percent', label: L('税込価格 (10%)', 'Price incl. tax (JP 10%)'), big: fmt(inc),
      rows: [[L('消費税', 'Tax'), fmt(inc - base)], [L('軽減税率 8% なら', 'At reduced 8%'), fmt(Math.round(base * 1.08))],
             [L('税抜', 'Before tax'), fmt(base)]] };
  }
  if ((m = q.match(rx('^(?:税抜き?|without tax|excl\\.? tax|ex\\.? tax|before tax)\\s*' + N + '$'))) ||
      (m = q.match(rx('^' + N + '\\s*(?:の)?\\s*(?:税抜き?|before tax|ex\\.? tax)$')))) {
    const inc = num(m[1]), base = Math.round(inc / 1.1);
    return { kind: 'percent', label: L('税抜価格 (10%)', 'Price before tax (JP 10%)'), big: fmt(base),
      rows: [[L('消費税', 'Tax'), fmt(inc - base)], [L('軽減税率 8% なら', 'At reduced 8%'), fmt(Math.round(inc / 1.08))],
             [L('税込', 'Incl. tax'), fmt(inc)]] };
  }
  return null;
}
function pctChange(base, p) {
  const r = base * (1 + p / 100);
  return { kind: 'percent', label: p >= 0 ? L(fmt(p) + '% 増し', '+' + fmt(p) + '%') : L(fmt(-p) + '% 引き', fmt(-p) + '% off'),
    big: fmt(r), rows: [[L('差分', 'Difference'), fmt(Math.abs(r - base))], [L('元の値', 'Original'), fmt(base)]] };
}
function pctOf(base, p) {
  return { kind: 'percent', label: L('パーセント計算', 'Percentage'), big: fmt(base * p / 100),
    rows: [[L(fmt(base) + ' の ' + fmt(p) + '%', fmt(p) + '% of ' + fmt(base)), fmt(base * p / 100)],
           [L('残り (' + fmt(100 - p) + '%)', 'Remaining (' + fmt(100 - p) + '%)'), fmt(base * (100 - p) / 100)]] };
}

// ===================== 日付 =====================
const WD_JA = '日月火水木金土';
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ERAS = [['令和', 2019, 5, 1], ['平成', 1989, 1, 8], ['昭和', 1926, 12, 25], ['大正', 1912, 7, 30], ['明治', 1868, 1, 25]];
const ERA_ABBR = { R: '令和', H: '平成', S: '昭和', T: '大正', M: '明治' };

function today0() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
// 1/31 + 1ヶ月 = 2/28 (月末でとめる)
function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
function dstr(d) {
  return lang === 'en'
    ? WD_EN[d.getDay()] + ', ' + MON_EN[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
    : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' (' + WD_JA[d.getDay()] + ')';
}
function warekiOf(d) {
  for (const [name, y, mo, da] of ERAS) {
    if (d >= new Date(y, mo - 1, da)) { const k = d.getFullYear() - y + 1; return name + (k === 1 ? '元' : k) + '年'; }
  }
  return null;
}
function eraToYear(name, k) {
  const e = ERAS.find(x => x[0] === (ERA_ABBR[name] || name));
  return e ? e[1] + (k === '元' ? 1 : +k) - 1 : null;
}
function monthIndex(word) {
  if (word.length < 3) return -1;
  return MON_FULL.findIndex(f => f.startsWith(word) || (word === 'sept' && f === 'september'));
}
function weekdayDate(mod, wd) {
  const t = today0(), cur = t.getDay();
  const inWeek = k => addDays(t, -((cur + 6) % 7) + ((wd + 6) % 7) + 7 * k);   // 月曜はじまり
  if (mod === '今週' || mod === 'this') return inWeek(0);
  if (mod === '来週') return inWeek(1);
  if (mod === '再来週') return inWeek(2);
  if (mod === '先週') return inWeek(-1);
  if (mod === 'last') return addDays(t, -(((cur - wd + 7) % 7) || 7));
  return addDays(t, ((wd - cur + 7) % 7) || 7);                               // 次の○曜 (今日は含めない)
}
const NAMED_DAYS = [
  [/^(?:元日|元旦|正月|お正月|new year'?s?(?: day)?)$/, 1, 1],
  [/^(?:クリスマス\s*イブ|christmas eve)$/, 12, 24],
  [/^(?:クリスマス|christmas|xmas)$/, 12, 25],
  [/^(?:大晦日|大みそか|new year'?s? eve)$/, 12, 31],
  [/^(?:バレンタイン(?:デー)?|valentine'?s?(?: day)?)$/, 2, 14],
  [/^(?:ハロウィン|ハロウィーン|halloween)$/, 10, 31],
];

// 1つの日付を読む。{ d: Date, noYear: 年が省略されていたか } | null
function parseDate(str) {
  const s = str.trim().toLowerCase(), t = today0();
  const ok = (d, noYear) => (d ? { d, noYear: !!noYear } : null);
  if (!s) return null;
  if (/^(?:today|今日|きょう|本日)$/.test(s)) return ok(t);
  if (/^(?:tomorrow|明日|あした|あす)$/.test(s)) return ok(addDays(t, 1));
  if (/^(?:yesterday|昨日|きのう)$/.test(s)) return ok(addDays(t, -1));
  if (/^(?:day after tomorrow|明後日|あさって)$/.test(s)) return ok(addDays(t, 2));
  if (/^(?:day before yesterday|一昨日|おととい)$/.test(s)) return ok(addDays(t, -2));
  let m;
  if ((m = s.match(/^(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})日?$/))) return ok(validDate(+m[1], +m[2], +m[3]));
  if ((m = s.match(/^(\d{1,2})[/月]\s*(\d{1,2})日?$/))) return ok(validDate(t.getFullYear(), +m[1], +m[2]), true);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/)) && +m[1] >= 1900 && +m[1] <= 2200) return ok(validDate(+m[1], +m[2], +m[3]));
  if ((m = str.trim().match(/^(令和|平成|昭和|大正|明治)\s*(\d{1,2}|元)年\s*(\d{1,2})月\s*(\d{1,2})日?$/)))
    return ok(validDate(eraToYear(m[1], m[2]), +m[3], +m[4]));
  if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/)) && monthIndex(m[1]) >= 0)
    return ok(validDate(m[3] ? +m[3] : t.getFullYear(), monthIndex(m[1]) + 1, +m[2]), !m[3]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s*(\d{4}))?$/)) && monthIndex(m[2]) >= 0)
    return ok(validDate(m[3] ? +m[3] : t.getFullYear(), monthIndex(m[2]) + 1, +m[1]), !m[3]);
  if ((m = s.match(/^(今週|来週|再来週|先週|次|今度|こんど)?の?([日月火水木金土])曜日?$/)))
    return ok(weekdayDate(m[1], WD_JA.indexOf(m[2])));
  if ((m = s.match(/^(?:(next|this|last|coming)\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)$/)))
    return ok(weekdayDate(m[1], ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'].indexOf(m[2].slice(0, 2))));
  if (/^(?:月末|今月末|end of (?:the )?month)$/.test(s)) return ok(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  if (/^(?:年末|end of (?:the )?year)$/.test(s)) return ok(new Date(t.getFullYear(), 11, 31));
  for (const [re, mo, da] of NAMED_DAYS) if (re.test(s)) return ok(validDate(t.getFullYear(), mo, da), true);
  return null;
}
// 年が省略されていて過ぎた日付は、次に来る同じ日にする (「1/1まで」→ 来年の元日)
function rollFuture(pd) {
  if (!pd.noYear || pd.d >= today0()) return pd.d;
  return validDate(pd.d.getFullYear() + 1, pd.d.getMonth() + 1, pd.d.getDate()) || addMonths(pd.d, 12);
}

const DU = '(?:日間?|週間?|ヶ月|か月|カ月|ヵ月|ケ月|月|年間?|days?|weeks?|wks?|months?|mos?|years?|yrs?|d|w|m|y)';
// 「3ヶ月後」のような書き方では、まぎらわしい "月" "m" を単位にしない
const DUN = '(?:日間?|週間?|ヶ月|か月|カ月|ヵ月|ケ月|年間?|days?|weeks?|wks?|months?|mos?|years?|yrs?|d|w|y)';
function addDateUnit(d, n, u) {
  u = u.toLowerCase();
  if (/^(?:日間?|days?|d)$/.test(u)) return addDays(d, n);
  if (/^(?:週間?|weeks?|wks?|w)$/.test(u)) return addDays(d, n * 7);
  if (/^(?:年間?|years?|yrs?|y)$/.test(u)) return addMonths(d, n * 12);
  return addMonths(d, n);
}
function applyDateChain(base, chain, unitPat, sign) {
  let r = new Date(base), mm;
  const re = new RegExp('([+\\-])?\\s*(\\d+)\\s*(' + unitPat + ')', 'gi');
  while ((mm = re.exec(chain))) r = addDateUnit(r, +mm[2] * (mm[1] === '-' ? -1 : 1) * (sign || 1), mm[3]);
  return r;
}
function ymdBetween(a, b) {
  if (b < a) [a, b] = [b, a];
  let mo = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (addMonths(a, mo) > b) mo--;
  return { y: Math.floor(mo / 12), m: mo % 12, d: dayDiff(addMonths(a, mo), b) };
}
function ymdStr(a, b) {
  const x = ymdBetween(a, b), parts = [];
  if (x.y) parts.push(x.y + L('年', x.y === 1 ? ' year' : ' years'));
  if (x.m) parts.push(x.m + L('ヶ月', x.m === 1 ? ' month' : ' months'));
  if (x.d || !parts.length) parts.push(x.d + L('日', x.d === 1 ? ' day' : ' days'));
  return parts.join(L('', ' '));
}
function weekdaysBetween(a, b) {   // a の翌日から b までの平日 (土日を除く)
  if (b < a) [a, b] = [b, a];
  const n = dayDiff(a, b);
  let c = Math.floor(n / 7) * 5;
  for (let i = 1; i <= n % 7; i++) { const w = (a.getDay() + i) % 7; if (w !== 0 && w !== 6) c++; }
  return c;
}
const nDays = n => L(n + '日', n + (n === 1 ? ' day' : ' days'));
function fromToday(d) {
  const n = dayDiff(today0(), d);
  return n === 0 ? L('今日', 'Today') : n > 0 ? L(n + '日後', 'in ' + nDays(n)) : L(-n + '日前', nDays(-n) + ' ago');
}
function spanRows(a, b) {
  const n = Math.abs(dayDiff(a, b)), rows = [];
  if (n >= 7) rows.push([L('週に直すと', 'In weeks'), L('約 ' + (n / 7).toFixed(1) + '週間', '~' + (n / 7).toFixed(1) + ' weeks')]);
  if (n >= 28) rows.push([L('年月日', 'Calendar span'), ymdStr(a, b)]);
  if (n > 0) rows.push([L('平日のみ (土日を除く)', 'Weekdays only'), nDays(weekdaysBetween(a, b))]);
  return rows;
}

function tryDate(q) {
  let m;
  // 起点 ± N単位 (today+5y+3m+5d のような連続指定も可)
  if ((m = q.match(new RegExp('^(.+?)((?:\\s*[+\\-]\\s*\\d+\\s*' + DU + ')+)$', 'i')))) {
    const base = parseDate(m[1]);
    if (base) return dateCalc(base.d, applyDateChain(base.d, m[2], DU));
  }
  // 90日後 / 今日から3週間後 / 12/25の3日前
  if ((m = q.match(new RegExp('^(?:(.+?)\\s*(?:から|の|より)\\s*)?((?:\\d+\\s*' + DUN + '\\s*と?\\s*)+)(後|ご|先|あと|前|まえ)$', 'i')))) {
    const base = m[1] ? parseDate(m[1]) : { d: today0() };
    if (base) return dateCalc(base.d, applyDateChain(base.d, m[2], DUN, /前|まえ/.test(m[3]) ? -1 : 1));
  }
  // in 90 days / 3 weeks ago / 2 weeks before christmas
  const EN_CHAIN = '((?:\\d+\\s*' + DUN + '\\s*(?:and\\s+|,\\s*)?)+)';
  if ((m = q.match(new RegExp('^in\\s+' + EN_CHAIN + '$', 'i'))))
    return dateCalc(today0(), applyDateChain(today0(), m[1], DUN));
  if ((m = q.match(new RegExp('^' + EN_CHAIN + '\\s*(ago|from now|from today|later)$', 'i'))))
    return dateCalc(today0(), applyDateChain(today0(), m[1], DUN, /ago/i.test(m[2]) ? -1 : 1));
  if ((m = q.match(new RegExp('^' + EN_CHAIN + '\\s*(before|after|from|since)\\s+(.+)$', 'i')))) {
    const base = parseDate(m[3]);
    if (base) return dateCalc(base.d, applyDateChain(base.d, m[1], DUN, /before/i.test(m[2]) ? -1 : 1));
  }
  // 日付 〜 日付
  if ((m = q.match(/^(?:days? between\s+|between\s+|from\s+)?(.+?)\s*(?:~|から|→|->|\s-\s|\s+to\s+|\s+until\s+|\s+and\s+)\s*(.+?)(?:まで)?(?:\s*(?:は|の)?\s*(?:何日間?|日数))?\s*[?]?$/i))) {
    const a = parseDate(m[1]), b = parseDate(m[2]);
    if (a && b) {
      let bd = b.d;
      if (b.noYear && bd < a.d) bd = validDate(bd.getFullYear() + 1, bd.getMonth() + 1, bd.getDate()) || bd;   // 12/25 〜 1/5
      const n = dayDiff(a.d, bd);
      return { kind: 'date', label: L('日数の差', 'Days between'), big: nDays(Math.abs(n)),
        rows: [[dstr(a.d) + ' → ' + dstr(bd), (n >= 0 ? '' : '−') + nDays(Math.abs(n))],
               [L('両端を含めると', 'Including both ends'), nDays(Math.abs(n) + 1)], ...spanRows(a.d, bd)] };
    }
  }
  // 12/25まで / クリスマスまであと何日 / days until 12/25
  if ((m = q.match(/^(.+?)\s*まで\s*(?:に|は|の|って)?\s*(?:あと)?\s*(?:何日|なんにち|何週間?|どれくらい|どのくらい)?\s*[?]?$/)) ||
      (m = q.match(/^あと何日で\s*(.+?)\s*[?]?$/)) ||
      (m = q.match(/^(?:how (?:many days|long) (?:until|till|to)|days? (?:until|till|to|before)|until|till|countdown(?: to)?)\s+(.+?)\s*[?]?$/i))) {
    const pd = parseDate(m[1]);
    if (pd) {
      const d = rollFuture(pd), n = dayDiff(today0(), d);
      return { kind: 'date', label: L('カウントダウン', 'Countdown'),
        big: n === 0 ? L('今日', 'Today') : n > 0 ? L('あと ' + n + '日', nDays(n) + ' left') : L(-n + '日前', nDays(-n) + ' ago'),
        rows: [[L('日付', 'Date'), dstr(d)], ...spanRows(today0(), d)] };
    }
  }
  // 12/25から何日 / days since 4/1
  if ((m = q.match(/^(.+?)\s*から\s*(?:何日目?|なんにち|どれくらい|どのくらい)\s*(?:経った|たった|経過)?\s*[?]?$/)) ||
      (m = q.match(/^(?:days? since|since|how (?:many days|long) since)\s+(.+?)\s*[?]?$/i))) {
    const pd = parseDate(m[1]);
    if (pd) {
      const n = dayDiff(pd.d, today0());
      return { kind: 'date', label: L('経過日数', 'Days since'), big: nDays(Math.abs(n)),
        rows: [[L('日付', 'Date'), dstr(pd.d)], ...spanRows(pd.d, today0())] };
    }
  }
  // 単独の日付
  const pd = parseDate(q);
  if (pd) {
    const d = pd.d, t = today0(), rows = [];
    rows.push([L('今日から', 'From today'), fromToday(d)]);
    if (pd.noYear && d < t) rows.push([L('次の' + (d.getMonth() + 1) + '/' + d.getDate(), 'Next ' + MON_EN[d.getMonth()] + ' ' + d.getDate()), fromToday(rollFuture(pd))]);
    const doy = dayDiff(new Date(d.getFullYear(), 0, 1), d) + 1, left = dayDiff(d, new Date(d.getFullYear(), 11, 31));
    rows.push([L('年内', 'Day of year'), L(d.getFullYear() + '年の' + doy + '日目 (残り' + left + '日)', 'Day ' + doy + ' of ' + d.getFullYear() + ' (' + left + ' left)')]);
    const w = lang === 'ja' ? warekiOf(d) : null;
    if (w) rows.push(['和暦', w + (d.getMonth() + 1) + '月' + d.getDate() + '日']);
    return { kind: 'date', label: L('日付', 'Date'), big: dstr(d), rows };
  }
  return null;
}
function dateCalc(base, r) {
  const rows = [[L('起点', 'From'), dstr(base)]];
  if (dayDiff(base, today0()) !== 0) rows.push([L('今日から', 'From today'), fromToday(r)]);
  rows.push([L('起点から', 'Offset'), nDays(Math.abs(dayDiff(base, r))) + (r < base ? L('前', ' earlier') : L('後', ' later'))]);
  return { kind: 'date', label: L('日付の計算', 'Date math'), big: dstr(r), rows };
}

// ---------- 和暦・年齢
const ETO_JA = '子丑寅卯辰巳午未申酉戌亥';
const ETO_EN = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
function eto(y) { const i = ((y - 4) % 12 + 12) % 12; return L(ETO_JA[i] + '年', 'Year of the ' + ETO_EN[i]); }
function yearToWareki(y) {
  const a = warekiOf(new Date(y, 0, 1)), b = warekiOf(new Date(y, 11, 31));
  return b ? (a && a !== b ? a + ' / ' + b : b) : null;
}
function parseYearish(s) {
  s = s.trim();
  let m = s.match(/^(?:西暦)?(\d{4})年?$/);
  if (m) return +m[1];
  m = s.match(/^(令和|平成|昭和|大正|明治|[RHSTM])\s*(\d{1,2}|元)年?$/);
  return m ? eraToYear(m[1], m[2]) : null;
}
function tryEraAge(q) {
  let m;
  const now = new Date().getFullYear();
  if ((m = q.match(/^(.+?)\s*(?:生まれ|うまれ)\s*(?:は|って)?\s*(?:今)?(?:何歳|なんさい|いくつ)?\s*[?]?$/)) ||
      (m = q.match(/^(?:born(?:\s+(?:in|on))?|age(?:\s+of)?|birthday)\s+(.+?)\s*[?]?$/i))) {
    const y = parseYearish(m[1]);
    if (y && y <= now) {
      const rows = [[L('誕生日の前は', 'Before the birthday'), L(now - y - 1 + '歳', String(now - y - 1))], [L('干支', 'Zodiac'), eto(y)]];
      const w = lang === 'ja' ? yearToWareki(y) : null;
      if (w) rows.push(['和暦', w]);
      return { kind: 'age', label: L(y + '年生まれの年齢', 'Age if born in ' + y), big: L('今年 ' + (now - y) + '歳', (now - y) + ' this year'), rows };
    }
    const pd = parseDate(m[1]);
    if (pd && !pd.noYear && pd.d <= today0()) {
      const b = pd.d, t = today0();
      const age = ymdBetween(b, t).y;
      let next = validDate(t.getFullYear(), b.getMonth() + 1, b.getDate()) || new Date(t.getFullYear(), b.getMonth() + 1, 0);
      if (next < t) next = validDate(t.getFullYear() + 1, b.getMonth() + 1, b.getDate()) || new Date(t.getFullYear() + 1, b.getMonth() + 1, 0);
      return { kind: 'age', label: L('年齢', 'Age'), big: L(age + '歳', age + ' years old'),
        rows: [[L('生年月日', 'Born'), dstr(b)], [L('次の誕生日', 'Next birthday'), fromToday(next)],
               [L('生まれてから', 'Days alive'), nDays(dayDiff(b, t))], [L('干支', 'Zodiac'), eto(b.getFullYear())]] };
    }
    return null;
  }
  if ((m = q.match(/^(令和|平成|昭和|大正|明治|[RHSTM])\s*(\d{1,2}|元)年?\s*(?:って|は)?\s*(?:西暦)?(?:で)?(?:何年|いつ)?\s*[?]?$/))) {
    const y = eraToYear(m[1], m[2]);
    if (!y) return null;
    return { kind: 'era', label: L('和暦 → 西暦', 'Japanese era → year'), big: L(y + '年', String(y)),
      rows: [[L('今年から', 'From this year'), y === now ? L('今年', 'This year') : y < now ? L(now - y + '年前', now - y + ' years ago') : L(y - now + '年後', 'in ' + (y - now) + ' years')],
             [L('干支', 'Zodiac'), eto(y)]] };
  }
  if ((m = q.match(/^(?:西暦)?(\d{4})年\s*(?:って|は)?\s*(?:和暦|元号|令和|平成|昭和)?(?:で)?(?:何年|なに年)?\s*[?]?$/))) {
    const y = +m[1], w = yearToWareki(y);
    if (!w) return null;
    return { kind: 'era', label: L('西暦 → 和暦', 'Year → Japanese era'), big: w,
      rows: [[L('干支', 'Zodiac'), eto(y)], [L('その年に生まれた人', 'Born that year'), L('今年 ' + (now - y) + '歳', (now - y) + ' this year')]] };
  }
  return null;
}

// ===================== 時刻 =====================
const TU = '(?:時間|分|秒|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)';
function tuMs(n, u) {
  u = u.toLowerCase();
  if (/^(?:時間|hours?|hrs?|h)$/.test(u)) return n * 3600000;
  if (/^(?:分|minutes?|mins?|m)$/.test(u)) return n * 60000;
  return n * 1000;
}
function chainMs(s) {
  let mm, total = 0;
  const re = new RegExp('([+\\-])?\\s*(\\d+(?:\\.\\d+)?)\\s*(' + TU + ')', 'gi');
  while ((mm = re.exec(s))) total += tuMs(+mm[2] * (mm[1] === '-' ? -1 : 1), mm[3]);
  return Math.round(total);
}
// 5000 → "5秒", 3661000 → "1時間1分1秒"
function fmtDuration(ms) {
  let s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), sec = s % 60, parts = [];
  if (d) parts.push(d + L('日', 'd'));
  if (h) parts.push(h + L('時間', 'h'));
  if (mi) parts.push(mi + L('分', 'm'));
  if (sec || !parts.length) parts.push(sec + L('秒', 's'));
  return parts.join(L('', ' '));
}
function tzParts(d, tz) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  for (const x of f.formatToParts(d)) if (x.type !== 'literal') p[x.type] = +x.value;
  return p;
}
function clockResult(offsetMs, zone) {
  const make = () => {
    const d = new Date(Date.now() + offsetMs);
    if (!zone) return { big: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()), rows: [[L('日付', 'Date'), dstr(d)]] };
    const p = tzParts(d, zone.tz);
    const utcOff = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - d.getTime()) / 60000);
    const diff = (utcOff + d.getTimezoneOffset()) / 60;
    const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
    return { big: pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second),
      rows: [[L('日付', 'Date'), dstr(new Date(p.year, p.month - 1, p.day))],
             [L('ここからの時差', 'Offset from here'), diff === 0 ? L('なし', 'None') : sign(diff) + L('時間', ' h')],
             ['UTC', 'UTC' + sign(utcOff / 60)]] };
  };
  const label = zone ? L(zone.ja + 'の現在時刻', 'Time in ' + zone.en)
    : offsetMs === 0 ? L('現在時刻', 'Current time')
    : offsetMs > 0 ? L(fmtDuration(offsetMs) + '後の時刻', 'Time in ' + fmtDuration(offsetMs))
    : L(fmtDuration(offsetMs) + '前の時刻', 'Time ' + fmtDuration(offsetMs) + ' ago');
  return Object.assign({ kind: 'clock', label, refresh: make }, make());
}
function tryClock(q) {
  const s = q.replace(/(\d+)\s*時間半/g, '$1時間30分');
  let m;
  if ((m = s.match(new RegExp('^(?:now|clock|time|current time|what time is it|時刻|現在時刻|いま何時|今何時|何時|なんじ|いま|今)\\s*[?]?((?:\\s*[+\\-]\\s*\\d+(?:\\.\\d+)?\\s*' + TU + ')*)$', 'i'))))
    return clockResult(m[1] ? chainMs(m[1]) : 0);
  if ((m = s.match(new RegExp('^((?:\\d+(?:\\.\\d+)?\\s*' + TU + '\\s*と?\\s*)+)(後|ご|前|まえ)\\s*(?:は|って)?\\s*(?:何時|なんじ)?\\s*[?]?$', 'i'))))
    return clockResult(chainMs(m[1]) * (/前|まえ/.test(m[2]) ? -1 : 1));
  const EN = '((?:\\d+(?:\\.\\d+)?\\s*' + TU + '\\s*(?:and\\s+|,\\s*)?)+)';
  if ((m = s.match(new RegExp('^in\\s+' + EN + '$', 'i')))) return clockResult(chainMs(m[1]));
  if ((m = s.match(new RegExp('^' + EN + '\\s*(ago|from now|later)$', 'i')))) return clockResult(chainMs(m[1]) * (/ago/i.test(m[2]) ? -1 : 1));
  return null;
}

// ---------- 世界の時刻
const ZONES = {};
function zone(tz, ja, en, aliases) {
  const z = { tz, ja, en };
  for (const a of (ja + ' ' + en.replace(/ /g, '_') + ' ' + aliases).split(' ')) if (a) ZONES[a.toLowerCase().replace(/_/g, ' ')] = z;
}
zone('Asia/Tokyo', '東京', 'Tokyo', '日本 japan jst');
zone('Asia/Seoul', 'ソウル', 'Seoul', '韓国 korea');
zone('Asia/Shanghai', '北京', 'Beijing', '上海 中国 shanghai china');
zone('Asia/Hong_Kong', '香港', 'Hong Kong', 'hongkong');
zone('Asia/Taipei', '台北', 'Taipei', '台湾 taiwan');
zone('Asia/Singapore', 'シンガポール', 'Singapore', '');
zone('Asia/Bangkok', 'バンコク', 'Bangkok', 'タイ thailand');
zone('Asia/Kolkata', 'インド', 'India', 'デリー ムンバイ delhi mumbai ist');
zone('Asia/Dubai', 'ドバイ', 'Dubai', '');
zone('Europe/Moscow', 'モスクワ', 'Moscow', 'ロシア russia');
zone('Europe/Istanbul', 'イスタンブール', 'Istanbul', 'トルコ turkey');
zone('Europe/London', 'ロンドン', 'London', 'イギリス 英国 uk england');
zone('Europe/Paris', 'パリ', 'Paris', 'フランス france');
zone('Europe/Berlin', 'ベルリン', 'Berlin', 'ドイツ germany');
zone('Europe/Rome', 'ローマ', 'Rome', 'イタリア italy');
zone('Europe/Madrid', 'マドリード', 'Madrid', 'スペイン spain');
zone('America/New_York', 'ニューヨーク', 'New York', 'ny nyc newyork');
zone('America/Chicago', 'シカゴ', 'Chicago', '');
zone('America/Denver', 'デンバー', 'Denver', '');
zone('America/Los_Angeles', 'ロサンゼルス', 'Los Angeles', 'ロス la サンフランシスコ san_francisco sf シアトル seattle');
zone('America/Vancouver', 'バンクーバー', 'Vancouver', '');
zone('America/Toronto', 'トロント', 'Toronto', '');
zone('America/Sao_Paulo', 'サンパウロ', 'São Paulo', 'sao_paulo ブラジル brazil');
zone('Pacific/Honolulu', 'ハワイ', 'Hawaii', 'ホノルル honolulu');
zone('Australia/Sydney', 'シドニー', 'Sydney', 'オーストラリア australia');
zone('Pacific/Auckland', 'オークランド', 'Auckland', 'ニュージーランド new_zealand');
zone('UTC', '協定世界時', 'UTC', 'utc gmt');
function tryWorldClock(q) {
  let s = q.toLowerCase().replace(/[?]+$/, '').trim(), timeWord = false;
  for (const re of [/^(?:what time is it in|what'?s the time in|current time in|time in|now in)\s+/,
                    /\s*(?:の|は|って)?\s*(?:現在時刻|時刻|時間|いま何時|今何時|何時|なんじ|いま|今)$/,
                    /\s+(?:time|now|current time)$/]) {
    const t = s.replace(re, '');
    if (t !== s) { timeWord = true; s = t.trim(); }
  }
  const z = ZONES[s];
  if (!z || (!timeWord && s.length <= 2)) return null;   // "la" や "タイ" だけでは反応しない
  return clockResult(0, z);
}

// ---------- 9:00から17:30 / 9:30 + 45分
function parseHM(str) {
  const s = str.trim().toLowerCase();
  let m, h, mi = 0;
  if ((m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/))) { h = +m[1]; mi = +m[2]; if (m[3]) h = h % 12 + (m[3] === 'pm' ? 12 : 0); }
  else if ((m = s.match(/^(\d{1,2})\s*(am|pm)$/))) { h = +m[1] % 12 + (m[2] === 'pm' ? 12 : 0); }
  else if ((m = s.match(/^(午前|午後)?\s*(\d{1,2})時(?:(\d{1,2})分|(半))?$/))) {
    h = +m[2]; mi = m[3] ? +m[3] : m[4] ? 30 : 0;
    if (m[1] === '午後' && h < 12) h += 12;
  }
  else return null;
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
}
function tryTimeRange(q) {
  let m;
  if ((m = q.match(/^(.+?)\s*(?:~|から|→|->|-|\s+to\s+)\s*(.+?)(?:まで)?\s*(?:は|って)?\s*(?:何時間|何分)?\s*[?]?$/i))) {
    const a = parseHM(m[1]), b = parseHM(m[2]);
    if (a !== null && b !== null) {
      const min = b >= a ? b - a : b + 1440 - a;
      const rows = [[L('分に直すと', 'In minutes'), L(min + '分', min + ' min')], [L('時間に直すと', 'In hours'), fmt(min / 60, 4) + L('時間', ' h')]];
      if (b < a) rows.push([L('メモ', 'Note'), L('日付をまたぐものとして計算', 'Counted as crossing midnight')]);
      return { kind: 'time', label: L('時間の長さ', 'Duration'), big: fmtDuration(min * 60000), rows };
    }
  }
  if ((m = q.replace(/(\d+)\s*時間半/g, '$1時間30分').match(new RegExp('^(.+?)((?:\\s*[+\\-]\\s*\\d+(?:\\.\\d+)?\\s*' + TU + ')+)$', 'i')))) {
    const a = parseHM(m[1]);
    if (a !== null) {
      const total = a + Math.round(chainMs(m[2]) / 60000), day = Math.floor(total / 1440), r = ((total % 1440) + 1440) % 1440;
      const rows = [[L('起点', 'From'), pad2(Math.floor(a / 60)) + ':' + pad2(a % 60)]];
      if (day !== 0) rows.push([L('日付', 'Day'), day > 0 ? L(day + '日後', '+' + day + ' day') : L(-day + '日前', day + ' day')]);
      return { kind: 'time', label: L('時刻の計算', 'Time math'), big: pad2(Math.floor(r / 60)) + ':' + pad2(r % 60), rows };
    }
  }
  return null;
}

// ===================== 進数 =====================
function baseRows(n) {
  return [[L('10進数', 'Decimal'), n.toLocaleString('en-US')], [L('16進数', 'Hex'), '0x' + n.toString(16).toUpperCase()],
          [L('2進数', 'Binary'), '0b' + n.toString(2)], [L('8進数', 'Octal'), '0o' + n.toString(8)]];
}
function fromBase(digits, radix, ja, en) {
  const n = parseInt(digits, radix);
  if (!Number.isSafeInteger(n)) return null;
  return { kind: 'base', label: L(ja + ' → 各進数', en + ' → other bases'), big: n.toLocaleString('en-US'), rows: baseRows(n) };
}
function tryBase(q) {
  let m;
  if ((m = q.match(/^0x([0-9a-f]+)$/i))) return fromBase(m[1], 16, '16進数', 'Hex');
  if ((m = q.match(/^0b([01]+)$/i))) return fromBase(m[1], 2, '2進数', 'Binary');
  if ((m = q.match(/^0o([0-7]+)$/i))) return fromBase(m[1], 8, '8進数', 'Octal');
  if ((m = q.match(/^(?:hex|16進数?)\s+([0-9a-f]+)$/i))) return fromBase(m[1], 16, '16進数', 'Hex');
  if ((m = q.match(/^(?:bin|binary|2進数?)\s+([01]+)$/i))) return fromBase(m[1], 2, '2進数', 'Binary');
  if ((m = q.match(/^(?:oct|octal|8進数?)\s+([0-7]+)$/i))) return fromBase(m[1], 8, '8進数', 'Octal');
  if ((m = q.match(/^([0-9a-f]+)\s*(?:to|in|as|→|->|を|は)?\s*(?:dec|decimal|10進数?)\s*(?:に|で|へ)?(?:変換)?$/i)) && /[a-f]/i.test(m[1]))
    return fromBase(m[1], 16, '16進数', 'Hex');
  if ((m = q.match(/^(\d+)\s*(?:to|in|as|→|->|を|は|の)?\s*(hex|hexadecimal|bin|binary|oct|octal|16進数?|2進数?|8進数?)\s*(?:に|で|へ)?(?:変換|すると)?\s*[?]?$/i))) {
    const n = parseInt(m[1], 10), t = m[2].toLowerCase();
    if (!Number.isSafeInteger(n)) return null;
    const big = /hex|16/.test(t) ? '0x' + n.toString(16).toUpperCase() : /bin|2/.test(t) ? '0b' + n.toString(2) : '0o' + n.toString(8);
    return { kind: 'base', label: L('進数変換', 'Base conversion'), big, rows: baseRows(n) };
  }
  return null;
}

// ===================== 色 =====================
const NAMED_COLORS = {};
function colorNames(hex, names) { for (const n of names.split(' ')) NAMED_COLORS[n] = hex; }
colorNames('ff0000', 'red 赤 赤色'); colorNames('0000ff', 'blue 青 青色'); colorNames('008000', 'green 緑 緑色');
colorNames('ffff00', 'yellow 黄色 黄'); colorNames('ffa500', 'orange オレンジ オレンジ色 橙'); colorNames('800080', 'purple 紫 紫色');
colorNames('ffc0cb', 'pink ピンク ピンク色 桃色'); colorNames('ffffff', 'white 白 白色'); colorNames('000000', 'black 黒 黒色');
colorNames('808080', 'gray grey 灰色 グレー'); colorNames('00ffff', 'cyan aqua シアン'); colorNames('ff00ff', 'magenta マゼンタ');
colorNames('87ceeb', 'skyblue 水色 空色'); colorNames('000080', 'navy 紺 紺色 ネイビー'); colorNames('a52a2a', 'brown 茶色 茶');
colorNames('008080', 'teal ティール'); colorNames('ffd700', 'gold 金色'); colorNames('c0c0c0', 'silver 銀色');

function hexToRgba(h) {
  if (h.length <= 4) h = h.split('').map(c => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
           a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.min(1, s); l = Math.min(1, l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
const alphaVal = s => { const v = parseFloat(s); return Math.max(0, Math.min(1, /%$/.test(s) || v > 1 ? v / 100 : v)); };
const chan = s => Math.max(0, Math.min(255, Math.round(/%$/.test(s) ? parseFloat(s) * 2.55 : parseFloat(s))));

// #rgb #rgba #rrggbb #rrggbbaa / rgb() rgba() / hsl() hsla() / 色の名前 / 「#1e90ff 50%」
function parseColor(str) {
  let s = str.trim().toLowerCase(), m, alpha = null;
  if ((m = s.match(/^(#?[0-9a-f]{3,8}|[^\s\d(),/]+)\s*(?:\s|\/)\s*(?:透明度|不透明度|アルファ|alpha|opacity)?\s*[:=]?\s*(\d+(?:\.\d+)?%?)$/))) {
    s = m[1]; alpha = alphaVal(m[2]);
  }
  let c = null;
  if ((m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/))) c = hexToRgba(m[1]);
  else if ((m = s.match(/^([0-9a-f]{6}|[0-9a-f]{8})$/)) && /[a-f]/.test(m[1])) c = hexToRgba(m[1]);
  else if ((m = s.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)?$/)))
    c = { r: chan(m[1]), g: chan(m[2]), b: chan(m[3]), a: m[4] ? alphaVal(m[4]) : 1 };
  else if ((m = s.match(/^hsla?\(\s*([\d.]+)(?:deg|°)?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,/]\s*([\d.]+%?)\s*)?\)?$/)))
    c = Object.assign(hslToRgb(+m[1], +m[2] / 100, +m[3] / 100), { a: m[4] ? alphaVal(m[4]) : 1 });
  else if ((m = s.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1|0|0?\.\d+))?$/)) && +m[1] < 256 && +m[2] < 256 && +m[3] < 256)
    c = { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? +m[4] : 1 };
  else if (NAMED_COLORS[s]) c = hexToRgba(NAMED_COLORS[s]);
  if (!c) return null;
  if (alpha !== null) c.a = alpha;
  return c;
}
const hex2 = n => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
function colorHex(c) { return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a < 1 ? hex2(c.a * 255) : ''); }
function colorCss(c) { return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(2)})` : `rgb(${c.r}, ${c.g}, ${c.b})`; }
function relLum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function tryColor(q) {
  const c = parseColor(q);
  if (!c) return null;
  const r1 = c.r / 255, g1 = c.g / 255, b1 = c.b / 255;
  const mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r1 ? (g1 - b1) / d + (g1 < b1 ? 6 : 0) : mx === g1 ? (b1 - r1) / d + 2 : (r1 - g1) / d + 4) * 60;
  }
  const a = +c.a.toFixed(2), H = Math.round(h), S = Math.round(s * 100), Lp = Math.round(l * 100);
  const lum = relLum(c), cw = (1.05) / (lum + 0.05), cb = (lum + 0.05) / 0.05;
  const rows = [];
  if (c.a < 1) {
    rows.push(['RGBA', `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`], ['HSLA', `hsla(${H}, ${S}%, ${Lp}%, ${a})`],
              [L('不透明度', 'Opacity'), Math.round(c.a * 100) + '%'], [L('HEX (透明度なし)', 'HEX (opaque)'), colorHex(Object.assign({}, c, { a: 1 }))]);
  } else {
    rows.push(['RGB', `rgb(${c.r}, ${c.g}, ${c.b})`], ['RGBA', `rgba(${c.r}, ${c.g}, ${c.b}, 1)`], ['HSL', `hsl(${H}, ${S}%, ${Lp}%)`]);
  }
  rows.push([L('明るさ', 'Brightness'), lum > 0.4 ? L('明るい色 (黒文字向き)', 'Light (use dark text)') : L('暗い色 (白文字向き)', 'Dark (use light text)')],
            [L('コントラスト比', 'Contrast ratio'), L('白文字 ', 'white ') + cw.toFixed(1) + ' : 1 · ' + L('黒文字 ', 'black ') + cb.toFixed(1) + ' : 1']);
  return { kind: 'color', label: L('カラーコード', 'Color'), big: colorHex(c), swatch: colorCss(c), rows };
}
function tryPicker(q) {
  if (!/^(?:cp|colorpicker|color picker|picker|カラーピッカー|カラピ|色選び|色を選ぶ)$/i.test(q)) return null;
  return { kind: 'picker', label: L('カラーピッカー', 'Color picker'), big: '', panel: 'picker', rows: [] };
}

// ===================== 生成 =====================
function rnd(n) {
  const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
  if (!c) return Math.floor(Math.random() * n);
  const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
  do { c.getRandomValues(a); } while (a[0] >= lim);   // 偏りが出ないように捨てる
  return a[0] % n;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = rnd(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// [ふだん使う文字, 紛らわしいので既定では外す文字]
const PW_SETS = {
  upper: ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'IO'],
  lower: ['abcdefghijkmnopqrstuvwxyz', 'l'],
  digit: ['23456789', '01'],
  sym: ['!#$%&*+-=?@', '|:;.,'],
};
const PW_NAMES = { upper: 'A-Z', lower: 'a-z', digit: '0-9' };
const PASS_WORDS = {};
function passWords(cls, words) { for (const w of words.split(' ')) PASS_WORDS[w] = cls; }
passWords('upper', '大文字 upper uppercase caps');
passWords('lower', '小文字 lower lowercase');
passWords('letters', '英字 英語 英 アルファベット alpha alphabet letters letter abc');
passWords('digit', '数字 数値 num nums number numbers digit digits 0-9 123');
passWords('alnum', '英数字 英数 alnum alphanumeric');
passWords('sym', '記号 特殊文字 sym syms symbol symbols special !#$');
passWords('ambig', '紛らわしい文字 紛らわしい 似た文字 全文字 ambiguous similar lookalike all');
passWords('hex', 'hex 16進 16進数');
passWords('strong', '強い 強力 最強 strong');
const PW_EXPAND = { letters: ['upper', 'lower'], alnum: ['upper', 'lower', 'digit'] };

// "20 記号なし x3" / "16文字 数字のみ" / "A-Z a-z 0-9" を生成条件にする
function parsePassArgs(str) {
  const o = { len: 0, count: 1, upper: true, lower: true, digit: true, sym: true, ambig: false, hex: false, unknown: 0 };
  const pos = new Set(), neg = new Set();
  str = (str || '')
    .replace(/\b(?:no|without|non)[\s-]+/gi, 'no-')
    .replace(/\s+(なし|無し|抜き|ぬき|以外|のみ|だけ|あり|入り|only)(?=\s|$)/g, '$1')
    .replace(/[、,・]/g, ' ').replace(/の(?!み)/g, ' ').replace(/で/g, ' ')
    .replace(/(文字|桁)(?=\S)/g, '$1 ').replace(/([^\s\dx×*-])(\d+(?:文字|桁|字))/g, '$1 $2');
  for (const t of str.split(/\s+/).filter(Boolean)) {
    let m, w = t, negate = false;
    if ((m = t.match(/^(\d+)(?:文字|桁|字|chars?|characters?)?$/i))) { o.len = +m[1]; continue; }
    if ((m = t.match(/^[x×*](\d+)$/i)) || (m = t.match(/^(\d+)(?:個|つ|本|件|こ)$/))) { o.count = +m[1]; continue; }
    if (t === 'A-Z') { pos.add('upper'); continue; }
    if (t === 'a-z') { pos.add('lower'); continue; }
    w = w.toLowerCase();
    if ((m = w.match(/^(?:-|no-?)(.+)$/))) { negate = true; w = m[1]; }
    else if ((m = w.match(/^(.+?)(?:なし|無し|抜き|ぬき|以外|を除く|除外)$/))) { negate = true; w = m[1]; }
    w = w.replace(/(?:のみ|だけ|only|あり|入り|を含む|含む)$/, '');
    const cls = PASS_WORDS[w];
    if (!cls) { o.unknown++; continue; }
    if (cls === 'ambig') o.ambig = !negate;
    else if (cls === 'hex') o.hex = !negate;
    else if (cls === 'strong') o.len = o.len || 24;
    else for (const c of PW_EXPAND[cls] || [cls]) (negate ? neg : pos).add(c);
  }
  let cls = (pos.size ? [...pos] : Object.keys(PW_SETS)).filter(c => !neg.has(c));
  if (!cls.length) cls = Object.keys(PW_SETS);
  for (const k of Object.keys(PW_SETS)) o[k] = cls.includes(k);
  return o;
}
function passQuery(o) {
  let s = 'pass ' + o.len;
  if (!(o.upper && o.lower && o.digit && o.sym))
    s += (o.upper ? ' A-Z' : '') + (o.lower ? ' a-z' : '') + (o.digit ? ' 0-9' : '') + (o.sym ? ' sym' : '');
  if (o.ambig) s += ' all';
  if (o.count > 1) s += ' x' + o.count;
  return s;
}
function passResult(o, pin) {
  const len = Math.min(Math.max(o.len || (pin ? 4 : o.hex ? 32 : 16), pin ? 3 : 4), 128);
  const count = Math.min(Math.max(o.count, 1), 20);
  const sets = o.hex ? ['0123456789abcdef'] : Object.keys(PW_SETS).filter(k => o[k]).map(k => PW_SETS[k][0] + (o.ambig ? PW_SETS[k][1] : ''));
  const pool = sets.join('');
  const gen = () => {
    // 選んだ文字種が必ず1つずつ入るようにしてから混ぜる
    const ch = sets.slice(0, len).map(s => s[rnd(s.length)]);
    while (ch.length < len) ch.push(pool[rnd(pool.length)]);
    return shuffle(ch).join('');
  };
  const list = Array.from({ length: count }, gen);
  const bits = Math.round(len * Math.log2(pool.length));
  const strength = bits < 45 ? L('弱い', 'Weak') : bits < 70 ? L('ふつう', 'Fair') : bits < 100 ? L('強い', 'Strong') : L('とても強い', 'Very strong');
  const kinds = o.hex ? 'hex (0-9 a-f)' : Object.keys(PW_SETS).filter(k => o[k]).map(k => k === 'sym' ? L('記号', 'symbols') : PW_NAMES[k]).join(' ');
  const rows = list.slice(1).map((p, i) => ['#' + (i + 2), p]);
  rows.push([L('強度', 'Strength'), strength + L(' (約 ' + bits + ' bit)', ' (~' + bits + ' bits)')], [L('文字種', 'Characters'), kinds]);
  if (!o.hex) rows.push([L('紛らわしい文字 (0/O, 1/l)', 'Look-alikes (0/O, 1/l)'), o.ambig ? L('使う', 'Included') : L('除外', 'Excluded')]);
  return { kind: 'pass', label: pin ? L('暗証番号 (' + len + '桁)', 'PIN (' + len + ' digits)') : L('パスワード生成 (' + len + '文字)', 'Password (' + len + ' chars)'),
    big: list[0], copy: list.join('\n'), rows, regen: true,
    pass: o.hex || pin ? null : { len, count, upper: o.upper, lower: o.lower, digit: o.digit, sym: o.sym, ambig: o.ambig } };
}
function tryGen(q) {
  let m;
  if ((m = q.match(/^uuid(?:\s*v?4)?(?:\s*[x×*]\s*(\d+))?$/i))) {
    const one = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (c === 'x' ? rnd(16) : (rnd(4) | 8)).toString(16));
    const list = Array.from({ length: Math.min(Math.max(+(m[1] || 1), 1), 20) }, one);
    return { kind: 'uuid', label: 'UUID v4', big: list[0], copy: list.join('\n'), rows: list.slice(1).map((u, i) => ['#' + (i + 2), u]), regen: true };
  }
  // パスワード
  const pq = q.replace(/\s*を?\s*(?:生成|作成|作って|つくって|作る|generate|gen)\s*$/i, '');
  if ((m = pq.match(/^(?:pin|暗証番号)\s*(\d+)?\s*桁?(?:\s*[x×*]\s*(\d+))?$/i)))
    return passResult(Object.assign(parsePassArgs('数字 all'), { len: +(m[1] || 0), count: +(m[2] || 1) }), true);
  if ((m = pq.match(/^(?:password|passwd|pass|pwd|pw|パスワード|ぱすわーど|パス)(?:(?=[\s\d])(.*)|$)/i)))
    return passResult(parsePassArgs(m[1]));
  // "パスワード16文字記号なし" "20文字のパスワード" "strong password"。条件として読めない語があれば生成しない
  if ((m = pq.match(/^パスワード(.+)$/)) || (m = pq.match(/^(.+?)\s*(?:パスワード|password)$/i))) {
    const o = parsePassArgs(m[1]);
    if (!o.unknown) return passResult(o);
  }
  // サイコロ・コイン・乱数
  if ((m = q.match(/^(\d*)d(\d+)(?:\s*([+\-])\s*(\d+))?$/i)) || (/^(?:dice|サイコロ|さいころ|ダイス)$/i.test(q) && (m = [0, '1', '6']))) {
    const cnt = Math.min(Math.max(+(m[1] || 1), 1), 100), faces = +m[2], mod = m[3] ? +m[4] * (m[3] === '-' ? -1 : 1) : 0;
    if (faces >= 2) {
      const rolls = Array.from({ length: cnt }, () => rnd(faces) + 1);
      const sum = rolls.reduce((a, b) => a + b, 0) + mod;
      return { kind: 'dice', label: L(cnt + 'd' + faces + ' を振る', 'Roll ' + cnt + 'd' + faces), big: String(sum),
        rows: [[L('出目', 'Rolls'), rolls.join(' + ') + (mod ? (mod > 0 ? ' + ' : ' − ') + Math.abs(mod) : '')]], regen: true, enter: 'regen' };
    }
  }
  if (/^(?:coin|coin ?flip|coin ?toss|flip a coin|コイン|コイントス|表裏)$/i.test(q))
    return { kind: 'coin', label: L('コイントス', 'Coin flip'), big: rnd(2) ? L('表', 'Heads') : L('裏', 'Tails'), rows: [], regen: true, enter: 'regen' };
  if ((m = q.match(/^(?:random|rand|rnd|乱数|ランダム)\s*(\d+)?\s*[-~, ]?\s*(\d+)?$/i)) ||
      (m = q.match(/^(\d+)\s*(?:から|~|-)\s*(\d+)\s*(?:まで)?(?:の|で)?\s*(?:乱数|ランダム)$/))) {
    // random → 1〜100, random 10 → 1〜10, random 5-20 → 5〜20
    const x = m[1] === undefined ? 100 : +m[1], y = m[2] === undefined ? 1 : +m[2];
    const a = Math.min(x, y), b = Math.max(x, y);
    return { kind: 'random', label: L('乱数 (' + a + '〜' + b + ')', 'Random (' + a + '–' + b + ')'), big: String(a + rnd(b - a + 1)),
      rows: [[L('範囲', 'Range'), a + ' 〜 ' + b]], regen: true, enter: 'regen' };
  }
  if ((m = q.match(/^(pick|choose|choice|shuffle|どれ|選んで|選ぶ|抽選|くじ|シャッフル|並び替え|ランダム|random)\s+(.+)$/i))) {
    const items = m[2].split(/[,、/]+/).map(s => s.trim()).filter(Boolean);
    const list = items.length > 1 ? items : m[2].split(/\s+/).filter(Boolean);
    if (list.length > 1) {
      if (/^(?:shuffle|シャッフル|並び替え)$/i.test(m[1])) {
        const sh = shuffle(list.slice());
        return { kind: 'pick', label: L('シャッフル', 'Shuffle'), big: sh.join(', '), rows: sh.map((x, i) => [String(i + 1), x]), regen: true, enter: 'regen' };
      }
      return { kind: 'pick', label: L('ランダムに1つ', 'Random pick'), big: list[rnd(list.length)],
        rows: [[L('候補', 'Options'), L(list.length + '個', String(list.length))]], regen: true, enter: 'regen' };
    }
  }
  if (/^(?:unix|unixtime|unix time|timestamp|epoch|タイムスタンプ|unix時間)$/i.test(q)) {
    const make = () => ({ big: String(Math.floor(Date.now() / 1000)), rows: [[L('ミリ秒', 'Milliseconds'), String(Date.now())], ['ISO 8601', new Date().toISOString()]] });
    return Object.assign({ kind: 'unix', label: L('Unix タイムスタンプ', 'Unix timestamp'), refresh: make }, make());
  }
  return null;
}

// ===================== 文字列ツール =====================
function textStats(text) {
  const chars = [...text].length, noSpace = [...text.replace(/\s/g, '')].length;
  const words = (text.trim().match(/\S+/g) || []).length, lines = text.split('\n').length;
  let bytes = 0;
  for (const ch of text) { const c = ch.codePointAt(0); bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  return { kind: 'text', label: L('文字数カウント', 'Character count'), big: L(chars + ' 文字', chars + (chars === 1 ? ' character' : ' characters')),
    copy: String(chars),
    rows: [[L('空白を除く', 'Without spaces'), L(noSpace + ' 文字', String(noSpace))], [L('単語数', 'Words'), L(words + ' 語', String(words))],
           ['UTF-8', L(bytes + ' バイト', bytes + ' bytes')], ...(lines > 1 ? [[L('行数', 'Lines'), L(lines + ' 行', String(lines))]] : [])] };
}
function b64enc(s) { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); }
function b64dec(s) { const bin = atob(s.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const TEXT_TOOLS = [
  [/^(?:count|文字数|もじすう|length|len|wc)(?=\s)/i, t => textStats(t)],
  [/^(?:upper|uppercase|大文字)(?=\s)/i, t => ({ label: L('大文字に', 'Uppercase'), big: t.toUpperCase() })],
  [/^(?:lower|lowercase|小文字)(?=\s)/i, t => ({ label: L('小文字に', 'Lowercase'), big: t.toLowerCase() })],
  [/^(?:reverse|逆順|反転)(?=\s)/i, t => ({ label: L('逆順', 'Reversed'), big: [...t].reverse().join('') })],
  [/^(?:base64\s*decode|base64\s*デコード|unbase64|b64d|decode64)(?=\s)/i, t => ({ label: L('Base64 デコード', 'Base64 decode'), big: b64dec(t) })],
  [/^(?:base64(?:\s*encode|\s*エンコード)?|b64)(?=\s)/i, t => ({ label: L('Base64 エンコード', 'Base64 encode'), big: b64enc(t) })],
  [/^(?:url\s*decode|urldecode|url\s*デコード)(?=\s)/i, t => ({ label: L('URL デコード', 'URL decode'), big: decodeURIComponent(t) })],
  [/^(?:url\s*encode|urlencode|url\s*エンコード)(?=\s)/i, t => ({ label: L('URL エンコード', 'URL encode'), big: encodeURIComponent(t) })],
];
function tryTextTool(q, q0) {
  for (const [re, fn] of TEXT_TOOLS) {
    const m = q.match(re);
    if (!m) continue;
    const text = rawTail(q, q0, m[0].length);
    if (!text) return null;
    try { return Object.assign({ kind: 'text', rows: [] }, fn(text)); }
    catch (e) { return { kind: 'text', label: L('変換できません', 'Cannot convert'), big: L('入力を確認してください', 'Check the input'), rows: [] }; }
  }
  return null;
}

// ===================== ToDo・タイマー (保存はアプリ側。ここは Enter 前のプレビューだけ) =====================
// "todo add 牛乳" → { sub: 'add', arg: '牛乳' } / "todo 牛乳" → { sub: null, arg: '牛乳' }
function splitCmd(q, q0, headRe, subs) {
  const m = q.match(headRe);
  if (!m) return null;
  const after = q.slice(m[0].length);
  if (after && /[a-z0-9]$/i.test(m[0]) && /^[a-z0-9]/i.test(after)) return null;   // "todos" "timerx" は別物
  let pos = m[0].length + after.match(/^[\s::]*/)[0].length;
  const rest = q.slice(pos);
  for (const [name, re] of subs) {
    const sm = rest.match(re);
    if (!sm) continue;
    pos += sm[0].length;
    pos += q.slice(pos).match(/^[\s::]*/)[0].length;
    return { sub: name, arg: rawTail(q, q0, pos) };
  }
  return { sub: null, arg: rawTail(q, q0, pos) };
}
const TODO_SUBS = [
  ['add', /^(?:(?:add|new)(?=[\s::]|$)|追加|ついか|\+)/i],
  ['check', /^(?:(?:check|done|finish)(?=[\s::]|$)|完了|済み?|チェック)/i],
  ['remove', /^(?:(?:remove|rm|del|delete)(?=[\s::]|$)|削除|消す|消去)/i],
  ['view', /^(?:(?:view|list|show)(?=[\s::]|$)|一覧|リスト)/i],
];
function tryTodo(q, q0) {
  const c = splitCmd(q, q0, /^(?:to-?do|やること|タスク|tasks?)/i, TODO_SUBS);
  if (!c) return null;
  const E = L(' (Enterで確定)', ' (press Enter)');
  if (c.sub === 'view' || !c.arg) return { kind: 'todo', label: 'ToDo', big: '', panel: 'todo', rows: [] };
  if (c.sub === 'check') return { kind: 'todo', label: L('ToDoを完了にする', 'Mark to-do done') + E, big: c.arg, action: { type: 'todoCheck', text: c.arg }, rows: [] };
  if (c.sub === 'remove') return { kind: 'todo', label: L('ToDoを削除する', 'Remove to-do') + E, big: c.arg, action: { type: 'todoRemove', text: c.arg }, rows: [] };
  return { kind: 'todo', label: L('ToDoに追加', 'Add to-do') + E, big: c.arg, action: { type: 'todoAdd', text: c.arg }, rows: [] };
}

// 先頭の "5m" "1時間30分" "90秒" を長さ(ms)として切り出し、残りをラベルにする
function parseDuration(str) {
  const s = str.trim().replace(/(\d+)\s*時間半/g, '$1時間30分');
  const re = new RegExp('\\s*(\\d+(?:\\.\\d+)?)\\s*(' + TU + ')(?![a-z])', 'gi');
  let mm, last = 0, ms = 0;
  while ((mm = re.exec(s))) {
    if (mm.index !== last) break;
    ms += tuMs(+mm[1], mm[2]);
    last = re.lastIndex;
  }
  if (!last) {                                      // 単位なしの数字は「分」
    const m = s.match(/^(\d+(?:\.\d+)?)(?:\s+(.*))?$/);
    if (!m) return null;
    ms = +m[1] * 60000; last = m[1].length;
  }
  ms = Math.round(ms);
  return ms > 0 ? { ms, rest: s.slice(last).trim() } : null;
}
const TIMER_SUBS = [
  ['add', /^(?:(?:add|start|set|new)(?=[\s::]|$)|追加|開始|スタート|セット)/i],
  ['remove', /^(?:(?:remove|rm|del|delete|stop|cancel)(?=[\s::]|$)|削除|消す|停止|キャンセル|止める)/i],
  ['restart', /^(?:(?:restart|reset|again)(?=[\s::]|$)|再開|リスタート|リセット|もう一回)/i],
  ['view', /^(?:(?:view|list|show)(?=[\s::]|$)|一覧|リスト)/i],
];
function timerAdd(p) {
  const end = new Date(Date.now() + p.ms);
  return { kind: 'timer', label: L('タイマーを開始 (Enterで確定)', 'Start timer (press Enter)'),
    big: fmtDuration(p.ms) + (p.rest ? ' · ' + p.rest : ''),
    rows: [[L('終了時刻', 'Ends at'), pad2(end.getHours()) + ':' + pad2(end.getMinutes())]],
    action: { type: 'timerAdd', ms: p.ms, label: p.rest || fmtDuration(p.ms) } };
}
function tryTimer(q, q0) {
  let m;
  // 5分タイマー / 3分タイマー ラーメン / 5 min timer / 3分計って
  if ((m = q.match(/^(.+?)\s*(?:の)?\s*(?:タイマー|たいまー|timer)\s*(?:を)?\s*(?:セット|開始|スタート|かけて|start|set)?\s*(.*)$/i)) ||
      (m = q.match(/^(.+?)\s*(?:を)?\s*(?:計って|測って|はかって|計測)()$/))) {
    const p = /^\d/.test(m[1]) ? parseDuration(m[1]) : null;
    if (p && !p.rest) return timerAdd({ ms: p.ms, rest: (m[2] || '').trim() });
  }
  const c = splitCmd(q, q0, /^(?:timer|タイマー|たいまー)/i, TIMER_SUBS);
  if (!c) return null;
  const E = L(' (Enterで確定)', ' (press Enter)');
  if (c.sub === 'view' || !c.arg) return { kind: 'timer', label: L('タイマー', 'Timers'), big: '', panel: 'timer', rows: [] };
  if (c.sub === 'remove') return { kind: 'timer', label: L('タイマーを削除する', 'Remove timer') + E, big: c.arg, action: { type: 'timerRemove', text: c.arg }, rows: [] };
  if (c.sub === 'restart') return { kind: 'timer', label: L('タイマーをリスタートする', 'Restart timer') + E, big: c.arg, action: { type: 'timerRestart', text: c.arg }, rows: [] };
  const p = parseDuration(c.arg);
  return p ? timerAdd(p) : null;
}

// ===================== 設定・ヘルプ =====================
function act(label, big, action, extra) { return Object.assign({ kind: 'action', label, big, action, rows: [] }, extra); }
function tryMeta(q, q0, opts) {
  const s = q.toLowerCase();
  const E = L('Enter で切り替え', 'Press Enter to switch');
  let m;
  if (/^(?:dark|dark ?mode|ダーク|ダークモード)(?:にして|に)?$/.test(s)) return act(E, L('ダークモード', 'Dark mode'), { type: 'theme', value: 'dark' });
  if (/^(?:light|light ?mode|ライト|ライトモード)(?:にして|に)?$/.test(s)) return act(E, L('ライトモード', 'Light mode'), { type: 'theme', value: 'light' });
  if (/^(?:english|英語|英語にして|lang(?:uage)?\s*(?:en|english))$/.test(s)) return act(E, 'English', { type: 'lang', value: 'en' });
  if (/^(?:japanese|日本語|日本語にして|lang(?:uage)?\s*(?:ja|jp|japanese))$/.test(s)) return act(E, '日本語', { type: 'lang', value: 'ja' });
  if ((m = s.match(/^(?:theme|accent|テーマカラー|テーマ|アクセントカラー|アクセント)\s*(?:colou?r|カラー|色)?\s*[::]?\s*(.+)$/))) {
    const a = m[1].trim();
    if (/^(?:auto|system|自動|システム)$/.test(a)) return act(E, L('テーマ: 自動', 'Theme: auto'), { type: 'theme', value: 'auto' });
    if (/^(?:dark|ダーク)$/.test(a)) return act(E, L('ダークモード', 'Dark mode'), { type: 'theme', value: 'dark' });
    if (/^(?:light|ライト)$/.test(a)) return act(E, L('ライトモード', 'Light mode'), { type: 'theme', value: 'light' });
    if (/^(?:reset|default|リセット|デフォルト|元に戻す)$/.test(a))
      return act(L('Enter でテーマカラーを元に戻す', 'Press Enter to reset the accent color'), L('テーマカラーをリセット', 'Reset accent color'), { type: 'accent', value: null });
    const c = parseColor(a);
    if (c) { const hex = colorHex(Object.assign(c, { a: 1 })); return act(L('Enter でテーマカラーを変更', 'Press Enter to set the accent color'), hex, { type: 'accent', value: hex }, { swatch: hex }); }
    return null;
  }
  if (/^(?:settings?|設定|せってい|config|preferences|prefs)$/.test(s)) return { kind: 'panel', label: '', big: '', panel: 'settings', rows: [] };
  if (/^(?:help|ヘルプ|使い方|つかいかた|\?|examples?|例)$/.test(s)) return { kind: 'panel', label: '', big: '', panel: 'help', rows: [] };
  if (/^(?:bookmarks?|ブックマーク|お気に入り)$/.test(s)) return { kind: 'panel', label: '', big: '', panel: 'bookmarks', rows: [] };
  if (opts.app && /^(?:quit|exit|終了)$/.test(s)) return act(L('Enter でアプリを終了', 'Press Enter to quit the app'), L('トイエバを終了', 'Quit Toieba'), { type: 'quit' });
  return null;
}

// ===================== 数字だけのときの「別の解釈」 =====================
function tryNumberAlt(q) {
  const out = [];
  let m;
  if (lang === 'ja' && (m = q.match(/^(\d{4})$/)) && +m[1] >= 1868 && +m[1] <= 2100)
    out.push({ kind: 'era', label: '西暦 → 和暦', big: yearToWareki(+m[1]), rows: [['干支', eto(+m[1])]] });
  if ((m = q.match(/^(\d{10}|\d{13})$/))) {
    const d = new Date(m[1].length === 13 ? +m[1] : +m[1] * 1000);
    if (d.getFullYear() >= 2001 && d.getFullYear() <= 2100)
      out.push({ kind: 'unix', label: L('Unix タイムスタンプ → 日時', 'Unix timestamp → date'),
        big: dstr(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()), rows: [['ISO 8601', d.toISOString()]] });
  }
  return out;
}

// ===================== メイン =====================
// 1つに決まるもの (コマンド類)
const EXCLUSIVE = [tryMeta, tryTodo, tryTimer, tryGen, tryTextTool, tryPicker];
// 解釈が割れうるもの。当てはまったものを全部ならべる
const OPEN = [tryColor, tryBase, tryEraAge, tryPercent, tryClock, tryWorldClock, tryTimeRange, tryDate, tryUnits, tryMath, tryNumberAlt];

function interpret(raw, opts) {
  opts = opts || {};
  lang = opts.lang === 'en' ? 'en' : 'ja';
  const q0 = String(raw).trim();
  if (!q0) return [];
  const q = normalize(q0);
  const done = list => { for (const r of list) r.id = r.id || r.kind; return list; };
  for (const f of EXCLUSIVE) {
    let r = null;
    try { r = f(q, q0, opts); } catch (e) {}
    if (r) return done([r]);
  }
  const out = [];
  for (const f of OPEN) {
    let r = null;
    try { r = f(q, q0, opts); } catch (e) {}
    for (const x of r ? [].concat(r) : []) if (x && !out.some(o => o.big === x.big)) out.push(x);
  }
  if (!out.length) out.push(textStats(q0));
  return done(out.slice(0, 4));
}

root.Toieba = { interpret, fmtDuration, parseDuration, passQuery, parseColor, colorHex,
  setLang(l) { lang = l === 'en' ? 'en' : 'ja'; } };
if (typeof module !== 'undefined' && module.exports) module.exports = root.Toieba;
})(typeof window !== 'undefined' ? window : globalThis);
