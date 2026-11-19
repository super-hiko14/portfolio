/* ===================== トイエバ UI =====================
 * 解釈は engine.js (Toieba.interpret) に任せ、ここは表示と保存だけを受け持つ。
 * Windows 版はこのページを WebView2 で開いているだけなので、ここを直せばアプリにも反映される。
 * (アプリとのやりとりは末尾の「Windows 版との橋渡し」) */
(function () {
'use strict';

const T = window.Toieba;
const $ = s => document.querySelector(s);
const root = document.documentElement;
const host = window.chrome && window.chrome.webview ? window.chrome.webview : null;
const isApp = root.classList.contains('app');

// ---- 保存 (ブラウザの localStorage)
const store = {
  get(k, d) { try { const v = localStorage.getItem('toieba:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('toieba:' + k, JSON.stringify(v)); } catch (e) {} },
};
const arr = (k) => { const v = store.get(k, []); return Array.isArray(v) ? v : []; };

// ===================== 文言 =====================
const STR = {
  ja: {
    title: 'トイエバ — 打てば返る万能ボックス', mark: 'トイエバ', placeholder: '例: 3980 + 10%',
    tBookmark: 'この結果をブックマーク', tHelp: '使い方の例を見る', tSettings: '設定', tShowBookmarks: 'ブックマークを見る',
    tRegen: 'もう一度生成', tCopy: 'クリックでコピー', tHue: '色相', tAlpha: '不透明度', tHex: 'HEXコード', tPicker: 'クリックでカラーピッカーを開く',
    done: '決定', passLen: '長さ', passAmbig: '紛らわしい文字も使う',
    todoPh: '新しいToDoを入力してEnter', todoEmpty: 'まだ何もありません', timerPh: '例: 5m 集中タイム (Enterで追加)', timerEmpty: 'タイマーがありません',
    setTheme: 'テーマ', setLang: '言語', setAccent: 'テーマカラー', auto: '自動', light: 'ライト', dark: 'ダーク', customColor: '好きな色を選ぶ',
    bookmarks: 'ブックマーク', clearAll: '全部消去', bmEmpty: 'まだありません。結果を出して栞のボタンを押すと残せます',
    copied: 'コピーしました ✓', alts: '別の解釈',
    kCopy: 'コピー', kRegen: '再生成', kAgain: 'もう一度', kConfirm: '確定', kAlt: '別の解釈に切り替え', kClose: '閉じる',
    todoAdded: 'ToDo追加 ✓', todoDone: 'ToDo完了 ✓', todoRemoved: 'ToDo削除 ✓', todoStart: 'まずは1件追加しよう', todoProgress: (d, n) => d + ' / ' + n + ' 完了',
    timerAdded: 'タイマー開始 ✓', timerRemoved: 'タイマー削除 ✓', timerRestarted: 'タイマーリスタート ✓', timerDone: '終了', timerUp: '時間です',
    notFound: s => '「' + s + '」は見つかりませんでした', applied: '切り替えました ✓', accentSet: 'テーマカラーを変更 ✓',
    aCheck: '完了切り替え', aDelete: '削除', aRestart: 'リスタート',
    hintNote: 'たとえばこんな入力ができる (クリックで試す):',
    noteApp: k => k + ' で呼び出し・Esc で閉じる。終了はトレイアイコンから',
    appSettings: 'アプリの設定 (呼び出しキー・起動時に開始)', getWindows: 'Windows 版 — どの画面からでも Alt+Space で呼び出せます',
  },
  en: {
    title: 'Toieba — type it, get it', mark: 'TOIEBA', placeholder: 'e.g. 3980 + 10%',
    tBookmark: 'Bookmark this result', tHelp: 'Show examples', tSettings: 'Settings', tShowBookmarks: 'Show bookmarks',
    tRegen: 'Generate again', tCopy: 'Click to copy', tHue: 'Hue', tAlpha: 'Opacity', tHex: 'HEX code', tPicker: 'Click to open the color picker',
    done: 'Done', passLen: 'Length', passAmbig: 'Include look-alikes',
    todoPh: 'Type a to-do and press Enter', todoEmpty: 'Nothing here yet', timerPh: 'e.g. 5m focus (Enter to add)', timerEmpty: 'No timers',
    setTheme: 'Theme', setLang: 'Language', setAccent: 'Accent color', auto: 'Auto', light: 'Light', dark: 'Dark', customColor: 'Pick any color',
    bookmarks: 'BOOKMARKS', clearAll: 'Clear all', bmEmpty: 'Nothing yet. Get a result and press the bookmark button to keep it',
    copied: 'Copied ✓', alts: 'OTHER READINGS',
    kCopy: 'copy', kRegen: 'regenerate', kAgain: 'again', kConfirm: 'confirm', kAlt: 'switch reading', kClose: 'close',
    todoAdded: 'To-do added ✓', todoDone: 'To-do done ✓', todoRemoved: 'To-do removed ✓', todoStart: 'Add your first one', todoProgress: (d, n) => d + ' / ' + n + ' done',
    timerAdded: 'Timer started ✓', timerRemoved: 'Timer removed ✓', timerRestarted: 'Timer restarted ✓', timerDone: 'Done', timerUp: "Time's up",
    notFound: s => 'Could not find "' + s + '"', applied: 'Switched ✓', accentSet: 'Accent color changed ✓',
    aCheck: 'Toggle done', aDelete: 'Delete', aRestart: 'Restart',
    hintNote: 'Things you can type (click to try):',
    noteApp: k => k + ' to summon · Esc to close. Quit from the tray icon',
    appSettings: 'App settings (hotkey, start with Windows)', getWindows: 'Windows app — summon it anywhere with Alt+Space',
  },
};
// 使い方の例
const HINTS = {
  ja: [
    ['計算', ['(120+80)*1.1', '3万5千 × 12', '3980の10%引き', '税込 2980', '1500は6000の何%']],
    ['単位', ['5kmは何マイル', '30℃', '20坪', '大さじ2', '500MBをGBに']],
    ['日付・時間', ['12/25まで', '90日後', '7/5 〜 12/25', '来週の金曜', '令和8年', '9:00から17:30', '45分後', 'ニューヨークの時間']],
    ['色', ['#1e90ff', 'rgba(30,144,255,0.5)', '#1e90ff 50%', 'カラーピッカー']],
    ['生成', ['pass 20', 'パスワード 16文字 記号なし', 'pin 6', 'uuid', '2d6', 'コイン', 'どれ ラーメン カレー 寿司']],
    ['メモ・タイマー', ['todo 牛乳を買う', 'todo', '5分タイマー', 'タイマー']],
    ['設定', ['ダークモード', 'english', 'テーマ #d97757', '設定']],
  ],
  en: [
    ['Math', ['(120+80)*1.1', '3980 - 10%', '15% of 240', '50 is what % of 200', '5 squared']],
    ['Units', ['5 km to miles', '86 f', '10 pounds to kg', '500 MB to GB', '90 min']],
    ['Dates & time', ['days until dec 25', 'in 90 days', 'from 7/5 to 12/25', 'next friday', '9am to 5:30pm', 'in 45 minutes', 'time in tokyo']],
    ['Color', ['#1e90ff', 'rgba(30,144,255,0.5)', '#1e90ff 50%', 'color picker']],
    ['Generate', ['pass 20', 'pass 16 no symbols', 'pin 6', 'uuid', '2d6', 'coin', 'pick pizza sushi ramen']],
    ['Notes & timers', ['todo buy milk', 'todo', '5 min timer', 'timer']],
    ['Settings', ['dark mode', '日本語', 'theme #d97757', 'settings']],
  ],
};

// ===================== 設定 =====================
const DEFAULT_ACCENT = '#95af9d';
const ACCENTS = [DEFAULT_ACCENT, '#d97757', '#5b8fd9', '#c9a243', '#9a6fb0', '#d9708f', '#4fa3a5', '#7d7f86'];
const settings = Object.assign({ theme: 'auto', lang: 'auto', accent: DEFAULT_ACCENT }, store.get('settings', {}));
if (!/^#[0-9a-f]{6}$/i.test(settings.accent)) settings.accent = DEFAULT_ACCENT;
const darkMq = matchMedia('(prefers-color-scheme: dark)');
let lang = 'ja';
let hostInfo = { hotkey: 'Alt+Space' };
const t = k => (STR[lang][k] !== undefined ? STR[lang][k] : STR.ja[k]);

function resolveLang() {
  if (settings.lang === 'ja' || settings.lang === 'en') return settings.lang;
  return (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
function luminance(hex) {
  const c = T.parseColor(hex) || { r: 0, g: 0, b: 0 };
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function applySettings() {
  root.dataset.theme = settings.theme === 'dark' || (settings.theme !== 'light' && darkMq.matches) ? 'dark' : 'light';
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--on-accent', luminance(settings.accent) > 0.5 ? '#2E2C28' : '#fff');
  lang = resolveLang();
  root.lang = lang;
  applyI18n();
  syncSettingsUI();
  postTheme();
}
function saveSettings() { store.set('settings', settings); applySettings(); }
function applyI18n() {
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
  renderSetNote();
  buildHints();
  renderBookmarks();
}
// 設定のいちばん下のひとこと。アプリの中ならアプリの設定へ、ブラウザなら Windows 版へ案内する
function renderSetNote() {
  const note = $('#setNote');
  note.textContent = '';
  if (isApp) {
    note.append(t('noteApp')(hostInfo.hotkey));
    if (!hostInfo.version) return;   // 古いアプリは「アプリの設定」を開けない
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'set-link'; b.textContent = t('appSettings') + ' ›';
    b.addEventListener('click', () => post({ type: 'appSettings' }));
    note.append(document.createElement('br'), b);
  } else if (/Windows/.test(navigator.userAgent)) {
    const a = document.createElement('a');
    a.className = 'set-link'; a.href = '/monooki/toieba-windows/'; a.textContent = t('getWindows') + ' ›';
    note.append(a);
  }
}
darkMq.addEventListener('change', () => { if (settings.theme === 'auto') applySettings(); });

// ===================== 要素 =====================
const wrap = $('#wrap'), qEl = $('#q'), resEl = $('#result'), labelEl = $('#rlabel'), bigEl = $('#rbig'), rowsEl = $('#rrows'),
      footEl = $('#rfoot'), altsEl = $('#alts'), regenBtn = $('#regen'),
      settingsEl = $('#settings'), hintsEl = $('#hints'), histWrap = $('#histwrap'), histEl = $('#hist'),
      bmToggleWrap = $('#bmToggleWrap'), bmToggle = $('#bmToggle'), bookmarkBtn = $('#bookmark'), infoBtn = $('#info'), gearBtn = $('#gear'),
      cpanel = $('#cpanel'), ppanel = $('#ppanel'), tpanel = $('#tpanel'), tmpanel = $('#tmpanel'),
      tpInput = $('#tpInput'), tpList = $('#tpList'), tpEmpty = $('#tpEmpty'),
      tmInput = $('#tmInput'), tmList = $('#tmList'), tmEmpty = $('#tmEmpty'), toastEl = $('#toast');
if (isApp) $('#inputbox').appendChild($('#tools'));   // アプリではボタンを入力欄の右に入れる

let results = [], sel = 0, current = null;
let bookmarks = arr('bookmarks').slice(0, 50), todos = arr('todos'), timers = arr('timers'), history = arr('history');
const prefs = store.get('prefs', {});   // 解釈が割れたとき、前に選んだほうを覚えておく
let histIdx = -1;

// 利用者が打った文字は必ずこれを通してから HTML に入れる (属性値にも使うので引用符も変換する)
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s).replace(/[&<>"']/g, c => ESC[c]); }
function swatchHtml(css) {
  return '<span class="swatch" title="' + esc(t('tPicker')) + '"><i style="background:' + esc(css) + '"></i></span>';
}

// ===================== 描画 =====================
let liveTimer = null, flashTimer = null;
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
const prefKey = () => results.map(r => r.id).sort().join('|');

function evaluate() {
  results = qEl.value.trim() ? T.interpret(qEl.value, { lang, app: isApp }) : [];
  if (results.length > 1) {
    const i = results.findIndex(r => r.id === prefs[prefKey()]);
    if (i > 0) results.unshift(results.splice(i, 1)[0]);
  }
  sel = 0;
  render();
}

const drawers = { settings: settingsEl, help: hintsEl, bookmarks: histWrap };
let cmdDrawer = null;   // 「設定」などのコマンドで開いた引き出し (入力が変わったら閉じる)
function setDrawer(name, open) {
  drawers[name].hidden = !open;
  gearBtn.classList.toggle('on', !settingsEl.hidden);
  infoBtn.classList.toggle('on', !hintsEl.hidden);
  bmToggle.classList.toggle('open', !histWrap.hidden);
  postSize();
}

function render() {
  clearTimeout(flashTimer);
  stopLive();
  const r = current = results[sel] || null;
  const want = r && r.kind === 'panel' ? r.panel : null;
  if (cmdDrawer && cmdDrawer !== want) { setDrawer(cmdDrawer, false); cmdDrawer = null; }
  if (want && drawers[want].hidden) { setDrawer(want, true); cmdDrawer = want; }
  if (!r || want) {
    resEl.hidden = true; altsEl.innerHTML = '';
    pickerOpen = false;
    updateBookmarkBtn(); postSize();
    return;
  }
  resEl.hidden = false;
  labelEl.textContent = r.label;
  regenBtn.hidden = !r.regen;

  const hasBig = r.big !== '' && r.big != null;
  bigEl.hidden = !hasBig;
  bigEl.classList.toggle('long', hasBig && String(r.big).length > 22);
  bigEl.innerHTML = (r.swatch ? swatchHtml(r.swatch) : '') + '<span class="bigtext">' + esc(r.big) + '</span><span class="copied" id="copied">' + esc(t('copied')) + '</span>';
  const rows = r.rows || [];
  rowsEl.hidden = !rows.length;
  rowsEl.innerHTML = rows.map(([k, v]) =>
    '<button type="button" class="res-row" data-v="' + esc(v) + '"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></button>').join('');

  // パネル
  if (r.panel === 'picker') { pickerOpen = true; paintPicker(); }
  else if (r.kind !== 'color') pickerOpen = false;
  else if (pickerOpen && !pushing) { setCp(T.parseColor(r.big)); paintPicker(); }   // 入力欄で色を書き換えたらピッカーも追従
  cpanel.hidden = !pickerOpen;
  ppanel.hidden = !r.pass;
  if (r.pass) syncPassPanel(r.pass);
  tpanel.hidden = r.panel !== 'todo';
  tmpanel.hidden = r.panel !== 'timer';
  if (r.panel === 'todo') renderTodoList();
  if (r.panel === 'timer') { renderTimerList(); liveTimer = setInterval(renderTimerList, 1000); }
  for (const p of [cpanel, ppanel, tpanel, tmpanel]) p.classList.toggle('first', !hasBig && !rows.length);

  // 毎秒かわる結果 (時計など)
  if (r.refresh) liveTimer = setInterval(() => {
    if (current !== r) return;
    const n = r.refresh();
    r.big = n.big; r.rows = n.rows;
    const bt = bigEl.querySelector('.bigtext');
    if (bt) bt.textContent = n.big;
    rowsEl.querySelectorAll('.res-row').forEach((el, i) => {
      if (!n.rows[i]) return;
      el.dataset.v = n.rows[i][1]; el.querySelector('.v').textContent = n.rows[i][1];
    });
  }, 1000);

  // キー操作のヒント
  const keys = [];
  const kb = (k, label) => keys.push('<span><kbd>' + k + '</kbd>' + esc(label) + '</span>');
  if (r.action) kb('Enter', t('kConfirm'));
  else if (!r.panel) {
    if (r.regen && r.enter === 'regen') { kb('Enter', t('kAgain')); kb('Shift+Enter', t('kCopy')); }
    else { kb('Enter', t('kCopy')); if (r.regen) kb('Shift+Enter', t('kRegen')); }
  }
  if (results.length > 1) kb('Tab', t('kAlt'));
  if (isApp) kb('Esc', t('kClose'));
  footEl.innerHTML = keys.join('');

  // 別の解釈
  altsEl.innerHTML = results.length < 2 ? '' : '<div class="alts-head">' + esc(t('alts')) + '</div>' + results.map((a, i) => i === sel ? '' :
    '<button type="button" class="alt" data-i="' + i + '"><span class="alt-label">' + esc(a.label) + '</span>' +
    '<span class="alt-big">' + (a.swatch ? swatchHtml(a.swatch) : '') + esc(a.big) + '</span></button>').join('');

  updateBookmarkBtn();
  postSize();
}
// 別の解釈を主役にする。次から同じ形の入力ではこちらを先に出す
function promote(i) {
  if (!results[i]) return;
  sel = i;
  prefs[prefKey()] = results[i].id;
  store.set('prefs', prefs);
  render();
}
altsEl.addEventListener('click', e => { const b = e.target.closest('.alt'); if (b) { promote(+b.dataset.i); qEl.focus(); } });

// 操作の結果を一瞬だけ見せる (ToDo追加 ✓ など)
function flash(label, big, swatch) {
  results = []; sel = 0; current = null; stopLive();
  qEl.value = '';
  if (cmdDrawer) { setDrawer(cmdDrawer, false); cmdDrawer = null; }
  resEl.hidden = false;
  labelEl.textContent = label;
  bigEl.hidden = false; bigEl.classList.toggle('long', big.length > 22);
  bigEl.innerHTML = (swatch ? swatchHtml(swatch) : '') + '<span class="bigtext">' + esc(big) + '</span>';
  rowsEl.hidden = true; regenBtn.hidden = true; footEl.innerHTML = ''; altsEl.innerHTML = '';
  for (const p of [cpanel, ppanel, tpanel, tmpanel]) p.hidden = true;
  pickerOpen = false;
  updateBookmarkBtn(); postSize();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (!qEl.value.trim()) render(); }, 1100);
}
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 6000);
}

// ===================== コピー =====================
async function copyText(text) {
  if (host) { post({ type: 'copy', text }); return; }
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  }
}
async function copyPrimary() {
  if (!current || current.panel || current.action) return;
  await copyText(String(current.copy !== undefined ? current.copy : current.big));
  const c = $('#copied');
  if (c) { c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 1200); }
  remember(qEl.value);
}
bigEl.addEventListener('click', e => {
  if (!current) return;
  if (current.kind === 'color' && e.target.closest('.swatch')) { togglePicker(); return; }
  copyPrimary();
});
bigEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  copyPrimary();
});
rowsEl.addEventListener('click', async e => {
  const row = e.target.closest('.res-row'); if (!row) return;
  await copyText(row.dataset.v);
  row.classList.add('done');
  setTimeout(() => row.classList.remove('done'), 1000);
});
regenBtn.addEventListener('click', () => { evaluate(); qEl.focus(); });

// ===================== カラーピッカー (透明度つき) =====================
const cpSquare = $('#cpSquare'), cpCursor = $('#cpCursor'), cpHue = $('#cpHue'), cpAlpha = $('#cpAlpha'),
      cpPreview = $('#cpPreview'), cpHex = $('#cpHex'), cpAlphaVal = $('#cpAlphaVal'), cpPresets = $('#cpPresets');
const cp = { h: 150, s: 0.35, v: 0.75, a: 1 };
let pickerOpen = false, pushing = false;

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
function setCp(c) {
  if (!c) return;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d !== 0) h = 60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  if (d !== 0) cp.h = (h + 360) % 360;   // 無彩色のときは色相を動かさない
  cp.s = mx === 0 ? 0 : d / mx; cp.v = mx; cp.a = c.a === undefined ? 1 : c.a;
}
function cpColor() { return Object.assign(hsvToRgb(cp.h, cp.s, cp.v), { a: cp.a }); }
function paintPicker() {
  const c = cpColor(), hex = T.colorHex(c);
  cpSquare.style.backgroundColor = 'hsl(' + cp.h.toFixed(0) + ',100%,50%)';
  cpCursor.style.left = (cp.s * 100) + '%';
  cpCursor.style.top = ((1 - cp.v) * 100) + '%';
  cpHue.value = Math.round(cp.h);
  cpAlpha.value = Math.round(cp.a * 100);
  cpAlpha.style.setProperty('--cp-color', hex.slice(0, 7));
  cpAlphaVal.textContent = Math.round(cp.a * 100) + '%';
  cpPreview.style.background = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + c.a + ')';
  if (document.activeElement !== cpHex) cpHex.value = hex.slice(1);
  return hex;
}
// ピッカーで動かした色を入力欄に書き戻す
function pushLive() {
  pushing = true;
  qEl.value = paintPicker();
  evaluate();
  pushing = false;
}
function togglePicker() {
  if (pickerOpen) { pickerOpen = false; cpanel.hidden = true; postSize(); return; }
  pickerOpen = true;
  setCp(T.parseColor(current.big));
  cpanel.hidden = false;
  paintPicker(); postSize();
}
function squareToSV(x, y) {
  const r = cpSquare.getBoundingClientRect();
  cp.s = r.width ? Math.min(Math.max(x - r.left, 0), r.width) / r.width : 0;
  cp.v = r.height ? 1 - Math.min(Math.max(y - r.top, 0), r.height) / r.height : 0;
}
cpSquare.addEventListener('pointerdown', e => { e.preventDefault(); cpSquare.setPointerCapture(e.pointerId); squareToSV(e.clientX, e.clientY); pushLive(); });
cpSquare.addEventListener('pointermove', e => { if (e.buttons !== 1) return; e.preventDefault(); squareToSV(e.clientX, e.clientY); pushLive(); });
cpSquare.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
cpSquare.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
cpHue.addEventListener('input', () => { cp.h = +cpHue.value; pushLive(); });
cpAlpha.addEventListener('input', () => { cp.a = +cpAlpha.value / 100; pushLive(); });
cpHex.addEventListener('input', () => {
  const v = cpHex.value.replace(/[^0-9a-f]/gi, '').slice(0, 8);
  if (v !== cpHex.value) cpHex.value = v;
  if ([3, 4, 6, 8].includes(v.length)) { setCp(T.parseColor('#' + v)); pushLive(); }
});
$('#cpApply').addEventListener('click', () => { pickerOpen = false; cpanel.hidden = true; postSize(); qEl.focus(); });
for (const hx of ['#7C9885', '#D97757', '#4A6FA5', '#C9A96E', '#8B5A6B', '#3D5A4C', '#E8927C', '#5B7C99', '#B08968', '#2E2C28', '#FFFFFF', '#9B968C']) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cp-swatch'; b.style.background = hx; b.title = hx; b.setAttribute('aria-label', hx);
  b.addEventListener('click', () => { const a = cp.a; setCp(T.parseColor(hx)); cp.a = a; pushLive(); });
  cpPresets.appendChild(b);
}

// ===================== パスワードの条件パネル =====================
const ppLen = $('#ppLen'), ppLenVal = $('#ppLenVal'), ppToggles = $('#ppToggles');
let passOpts = null;
function syncPassPanel(o) {
  passOpts = Object.assign({}, o);
  ppLen.value = Math.min(o.len, 64);
  ppLenVal.textContent = o.len;
  for (const b of ppToggles.children) b.setAttribute('aria-pressed', String(!!o[b.dataset.k]));
}
// パネルを触ったら、その条件を入力欄の文字に書き戻す (ブックマークや履歴にそのまま残せる)
function pushPass() { qEl.value = T.passQuery(passOpts); evaluate(); }
ppLen.addEventListener('input', () => { if (!passOpts) return; passOpts.len = +ppLen.value; pushPass(); });
ppToggles.addEventListener('click', e => {
  const b = e.target.closest('.tgl'); if (!b || !passOpts) return;
  const k = b.dataset.k;
  passOpts[k] = !passOpts[k];
  if (!passOpts.upper && !passOpts.lower && !passOpts.digit && !passOpts.sym) passOpts[k] = true;   // 最後の1つは外せない
  pushPass();
});

// ===================== ToDo =====================
function saveTodos() { store.set('todos', todos); }
function addTodo(text) { todos.unshift({ id: 't' + Date.now() + Math.random().toString(36).slice(2, 7), text, done: false }); saveTodos(); }
function findTodo(name, openFirst) {
  const nl = name.toLowerCase();
  return (openFirst && todos.find(x => !x.done && x.text.toLowerCase().includes(nl))) || todos.find(x => x.text.toLowerCase().includes(nl)) || null;
}
function renderTodoList() {
  tpEmpty.hidden = todos.length > 0;
  const sorted = [...todos].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  tpList.innerHTML = sorted.map(x =>
    '<div class="tp-item ' + (x.done ? 'done' : '') + '" data-id="' + esc(x.id) + '">' +
      '<button type="button" class="tp-check" aria-label="' + esc(t('aCheck')) + '">✓</button>' +
      '<span class="tp-text">' + esc(x.text) + '</span>' +
      '<button type="button" class="mini-btn del" aria-label="' + esc(t('aDelete')) + '">×</button>' +
    '</div>').join('');
  const done = todos.filter(x => x.done).length;
  bigEl.hidden = false; bigEl.classList.remove('long');
  bigEl.innerHTML = '<span class="bigtext">' + esc(todos.length ? t('todoProgress')(done, todos.length) : t('todoStart')) + '</span>';
  tpanel.classList.remove('first');
  postSize();
}
tpList.addEventListener('click', e => {
  const item = e.target.closest('.tp-item'); if (!item) return;
  if (e.target.closest('.del')) todos = todos.filter(x => x.id !== item.dataset.id);
  else { const x = todos.find(y => y.id === item.dataset.id); if (x) x.done = !x.done; }
  saveTodos(); renderTodoList();
});
tpInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  const v = tpInput.value.trim(); if (!v) return;
  addTodo(v); tpInput.value = ''; renderTodoList();
});

// ===================== タイマー =====================
let audio = null;
function saveTimers() { store.set('timers', timers); postTimers(); }
function addTimer(ms, label) {
  timers.unshift({ id: 'tm' + Date.now() + Math.random().toString(36).slice(2, 7), label: label || T.fmtDuration(ms), durationMs: ms, endAt: Date.now() + ms });
  saveTimers();
  if (isApp) return;
  // 終了を知らせる準備 (どちらも利用者の操作の直後でないと許可されない)
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
}
function restartTimer(x) { x.endAt = Date.now() + x.durationMs; delete x.notified; saveTimers(); }
// ラベルの部分一致、なければ長さ (5m など) の一致で探す
function findTimer(query) {
  const nl = query.toLowerCase();
  const byLabel = timers.find(x => x.label.toLowerCase().includes(nl));
  if (byLabel) return byLabel;
  const p = T.parseDuration(query);
  return (p && !p.rest && timers.find(x => x.durationMs === p.ms)) || null;
}
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), p = n => String(n).padStart(2, '0');
  return (h > 0 ? h + ':' : '') + p(mi) + ':' + p(s % 60);
}
function renderTimerList() {
  tmEmpty.hidden = timers.length > 0;
  tmList.innerHTML = [...timers].sort((a, b) => a.endAt - b.endAt).map(x => {
    const remain = x.endAt - Date.now(), done = remain <= 0;
    return '<div class="tm-item ' + (done ? 'done' : '') + '" data-id="' + esc(x.id) + '">' +
      '<span class="tm-time">' + (done ? esc(t('timerDone')) : fmtCountdown(remain)) + '</span>' +
      '<span class="tm-label">' + esc(x.label) + '</span>' +
      '<button type="button" class="mini-btn restart" aria-label="' + esc(t('aRestart')) + '">⟲</button>' +
      '<button type="button" class="mini-btn del" aria-label="' + esc(t('aDelete')) + '">×</button>' +
    '</div>';
  }).join('');
}
tmList.addEventListener('click', e => {
  const item = e.target.closest('.tm-item'); if (!item) return;
  const x = timers.find(y => y.id === item.dataset.id); if (!x) return;
  if (e.target.closest('.del')) { timers = timers.filter(y => y !== x); saveTimers(); }
  else if (e.target.closest('.restart')) restartTimer(x);
  else return;
  renderTimerList(); postSize();
});
tmInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  const p = T.parseDuration(tmInput.value); if (!p) return;
  addTimer(p.ms, p.rest || null);
  tmInput.value = ''; renderTimerList(); postSize();
});
function beep() {
  if (!audio) return;
  try {
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + i * 0.32;
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      o.start(at); o.stop(at + 0.27);
    }
  } catch (e) {}
}
// 終了したタイマーを知らせる。Windows 版は本体側が通知と音を出すので、ここでは画面内の表示だけ
function tickTimers() {
  const now = Date.now(); let changed = false;
  for (const x of timers) {
    if (x.notified || x.endAt > now) continue;
    x.notified = true; changed = true;
    if (now - x.endAt > 60000) continue;        // ページを閉じている間に終わったものは鳴らさない
    toast('⏰ ' + x.label + ' — ' + t('timerUp'));
    if (isApp) continue;
    beep();
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(t('mark'), { body: '⏰ ' + x.label + ' — ' + t('timerUp') }); } catch (e) {}
    if (document.hidden) document.title = '⏰ ' + x.label;
  }
  if (changed) { store.set('timers', timers); if (!tmpanel.hidden) renderTimerList(); }
}
setInterval(tickTimers, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = t('title'); });

// ===================== Enter で実行する操作 =====================
function runAction(a) {
  let x;
  switch (a.type) {
    case 'todoAdd': addTodo(a.text); flash(t('todoAdded'), a.text); break;
    case 'todoCheck':
      if ((x = findTodo(a.text, true))) { x.done = true; saveTodos(); flash(t('todoDone'), x.text); } else flash('ToDo', t('notFound')(a.text)); break;
    case 'todoRemove':
      if ((x = findTodo(a.text))) { todos = todos.filter(y => y !== x); saveTodos(); flash(t('todoRemoved'), x.text); } else flash('ToDo', t('notFound')(a.text)); break;
    case 'timerAdd': addTimer(a.ms, a.label); flash(t('timerAdded'), a.label); break;
    case 'timerRemove':
      if ((x = findTimer(a.text))) { timers = timers.filter(y => y !== x); saveTimers(); flash(t('timerRemoved'), x.label); } else flash(lang === 'en' ? 'Timers' : 'タイマー', t('notFound')(a.text)); break;
    case 'timerRestart':
      if ((x = findTimer(a.text))) { restartTimer(x); flash(t('timerRestarted'), x.label); } else flash(lang === 'en' ? 'Timers' : 'タイマー', t('notFound')(a.text)); break;
    case 'theme': { settings.theme = a.value; saveSettings(); flash(t('applied'), a.value === 'auto' ? t('auto') : t(a.value)); break; }
    case 'lang': { settings.lang = a.value; saveSettings(); flash(t('applied'), a.value === 'en' ? 'English' : '日本語'); break; }
    case 'accent': { settings.accent = a.value || DEFAULT_ACCENT; saveSettings(); flash(t('accentSet'), settings.accent.toUpperCase(), settings.accent); break; }
    case 'quit': post({ type: 'quit' }); break;
  }
}
function onEnter(alt) {
  const r = current; if (!r) return;
  if (r.action) { remember(qEl.value); runAction(r.action); return; }
  if (r.panel) return;
  if (r.regen && (r.enter === 'regen') !== alt) { evaluate(); return; }   // 振り直し
  copyPrimary().then(() => { if (isApp) setTimeout(hideApp, 160); });
}

// ===================== ブックマーク =====================
function bookmarkable(r) { return !!r && !r.action && !r.panel; }
function updateBookmarkBtn() {
  bookmarkBtn.disabled = !bookmarkable(current);
  bookmarkBtn.classList.toggle('saved', bookmarkable(current) && bookmarks.some(b => b.q === qEl.value.trim()));
}
function renderBookmarks() {
  bmToggleWrap.hidden = bookmarks.length === 0;
  if (!bookmarks.length && !isApp) histWrap.hidden = true;
  $('#clear').hidden = !bookmarks.length;
  histEl.innerHTML = bookmarks.length ? bookmarks.map((h, i) =>
    '<li tabindex="0" data-i="' + i + '"><span class="hq">' + esc(h.q) + '</span><span class="ha">' + esc(h.a) + '</span></li>').join('')
    : '<div class="hist-empty">' + esc(t('bmEmpty')) + '</div>';
  bmToggle.classList.toggle('open', !histWrap.hidden);
  postSize();
}
bookmarkBtn.addEventListener('click', () => {
  if (bookmarkBtn.disabled || !current) return;
  const q = qEl.value.trim(); if (!q) return;
  const idx = bookmarks.findIndex(b => b.q === q);
  if (idx >= 0) bookmarks.splice(idx, 1);
  else { bookmarks.unshift({ q, a: String(current.big), label: current.label }); bookmarks.length = Math.min(bookmarks.length, 50); }
  store.set('bookmarks', bookmarks);
  renderBookmarks(); updateBookmarkBtn();
  bookmarkBtn.classList.add('pulse');
  setTimeout(() => bookmarkBtn.classList.remove('pulse'), 320);
});
function openBookmark(li) {
  if (!li || !bookmarks[+li.dataset.i]) return;
  qEl.value = bookmarks[+li.dataset.i].q;
  setDrawer('bookmarks', false); cmdDrawer = null;
  evaluate(); qEl.focus();
}
histEl.addEventListener('click', e => openBookmark(e.target.closest('li')));
histEl.addEventListener('keydown', e => { if (e.key === 'Enter') openBookmark(e.target.closest('li')); });
$('#clear').addEventListener('click', () => { bookmarks = []; store.set('bookmarks', bookmarks); renderBookmarks(); updateBookmarkBtn(); });
bmToggle.addEventListener('click', () => { cmdDrawer = null; setDrawer('bookmarks', histWrap.hidden); });

// ===================== 設定・使い方 =====================
gearBtn.addEventListener('click', () => { cmdDrawer = null; setDrawer('settings', settingsEl.hidden); });
infoBtn.addEventListener('click', () => { cmdDrawer = null; setDrawer('help', hintsEl.hidden); });
for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    settings[seg.dataset.set] = b.dataset.v;
    saveSettings();
    if (qEl.value.trim()) evaluate();
  });
}
const accList = $('#accList');
for (const hx of ACCENTS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'acc'; b.style.background = hx; b.dataset.v = hx; b.title = hx; b.setAttribute('aria-label', hx);
  b.addEventListener('click', () => { settings.accent = hx; saveSettings(); });
  accList.appendChild(b);
}
const accCustom = document.createElement('label');
accCustom.className = 'acc custom';
accCustom.innerHTML = '<input type="color">';
accList.appendChild(accCustom);
accCustom.firstChild.addEventListener('input', e => { settings.accent = e.target.value; saveSettings(); });
function syncSettingsUI() {
  for (const seg of document.querySelectorAll('.seg'))
    for (const b of seg.children) b.setAttribute('aria-pressed', String(settings[seg.dataset.set] === b.dataset.v));
  const custom = !ACCENTS.includes(settings.accent.toLowerCase());
  for (const b of accList.querySelectorAll('button.acc')) b.setAttribute('aria-pressed', String(b.dataset.v === settings.accent.toLowerCase()));
  accCustom.setAttribute('aria-pressed', String(custom));
  accCustom.title = t('customColor');
  accCustom.firstChild.value = settings.accent;
}
function buildHints() {
  hintsEl.innerHTML = '<div class="hint-note">' + esc(t('hintNote')) + '</div>' + HINTS[lang].map(([cat, list]) =>
    '<div class="hint-group"><div class="hint-cat">' + esc(cat) + '</div>' +
    list.map(h => '<button type="button" class="chip">' + esc(h) + '</button>').join('') + '</div>').join('');
}
hintsEl.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  qEl.value = b.textContent;
  setDrawer('help', false); cmdDrawer = null;
  evaluate(); qEl.focus();
});

// ===================== 入力 =====================
function remember(q) {
  q = q.trim(); if (!q) return;
  history = [q, ...history.filter(x => x !== q)].slice(0, 30);
  store.set('history', history);
  histIdx = -1;
}
qEl.addEventListener('input', () => { histIdx = -1; evaluate(); });
qEl.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;   // 日本語入力の変換中 (確定の Enter など) は何もしない
  if (e.key === 'Enter') { e.preventDefault(); onEnter(e.shiftKey || e.ctrlKey); return; }
  if (e.key === 'Escape') {
    const anyDrawer = Object.values(drawers).some(d => !d.hidden);
    if (qEl.value || !resEl.hidden || (isApp && anyDrawer)) {
      qEl.value = ''; histIdx = -1;
      if (isApp) for (const k of Object.keys(drawers)) setDrawer(k, false);
      results = []; render();
    } else if (isApp) hideApp();
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    if (results.length > 1) { e.preventDefault(); promote((sel + 1) % results.length); }
    return;
  }
  // ↑↓ で前に使った入力を呼び戻す (空欄のとき、または呼び戻している最中)
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length && (!qEl.value || histIdx >= 0)) {
    e.preventDefault();
    histIdx = Math.max(-1, Math.min(history.length - 1, histIdx + (e.key === 'ArrowUp' ? 1 : -1)));
    qEl.value = histIdx < 0 ? '' : history[histIdx];
    const keep = histIdx;
    evaluate();
    histIdx = keep;
  }
});

// ===================== Windows 版との橋渡し =====================
// ページ → 本体: ready / size / hide / copy / timers / theme / quit
// 本体 → ページ: hello { hotkey } / shown
function post(msg) { if (host) { try { host.postMessage(msg); } catch (e) {} } }
let lastHeight = -1;
function postSize() {
  if (!isApp) return;
  const h = Math.ceil(wrap.getBoundingClientRect().height);
  if (h === lastHeight) return;
  lastHeight = h;
  post({ type: 'size', height: h });
}
function postTheme() {
  if (!host) return;
  const cs = getComputedStyle(root);
  post({ type: 'theme', bg: cs.getPropertyValue('--card').trim(), border: cs.getPropertyValue('--line').trim(), dark: root.dataset.theme === 'dark' });
}
function postTimers() {
  post({ type: 'timers', timers: timers.filter(x => !x.notified).map(x => ({ id: x.id, label: x.label, endAt: x.endAt })) });
}
function hideApp() { post({ type: 'hide' }); }
if (host) {
  host.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'hello') { hostInfo = d; applyI18n(); }
    if (d.type === 'shown') {
      if (current && !current.regen && !current.panel) evaluate();   // 日付や時刻を出し直す
      qEl.focus(); qEl.select();
      lastHeight = -1; postSize();
    }
  });
}
if (isApp && 'ResizeObserver' in window) new ResizeObserver(postSize).observe(wrap);

// ===================== 起動 =====================
applySettings();
renderBookmarks();
tickTimers();
postTimers();
post({ type: 'ready' });
// …/toieba/?q=5km のように、入力を URL で渡せる (リンクで共有する用)
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) { qEl.value = initialQ; evaluate(); }
postSize();
qEl.focus();
// オフラインでも開けるように (Windows 版をネットなしで使うときのため)
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
