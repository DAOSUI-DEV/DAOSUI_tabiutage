/* ダーツ：順番に3本ずつ投げる。
   ・投げる人：スマホの傾きで狙う（センサーがなければ指でなぞる）。
     「振って投げる」…画面を押さえたまま、スマホを前にシュッと振る（振りの強さで上下にずれる）
     「はじいて投げる」…画面を下から上へシュッとはじく（はじく速さで上下にずれる）
   ・刺さった場所だけ幹事に送る。点数は幹事が計算してみんなに配る（順番に投げるので通信の遅れは関係ない）。
   ・みんなの画面に、投げる人の照準がリアルタイムで映る。 */
(() => {
  const NUMS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const R = { bull: 0.0935, tin: 0.582, tout: 0.629, din: 0.953 };   // 本物の比率（外側のダブルの線を1）
  const DIFF = { easy: { sway: 0.02, err: 0.025 }, normal: { sway: 0.05, err: 0.045 }, hard: { sway: 0.09, err: 0.07 } };
  const AIM_DEG = 22;     // 22度かたむけると、照準が的の端まで動く

  function score(x, y) {
    const r = Math.hypot(x, y);
    if (r <= R.bull) return { v: 50, l: 'BULL', k: 'bull' };
    if (r > 1) return { v: 0, l: 'はずれ', k: 'miss' };
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360 + 9) % 360;
    const n = NUMS[Math.floor(deg / 18)];
    if (r >= R.tin && r <= R.tout) return { v: n * 3, l: 'トリプル' + n, k: 'triple' };
    if (r >= R.din) return { v: n * 2, l: 'ダブル' + n, k: 'double' };
    return { v: n, l: String(n), k: 'single' };
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  Party.register({
    id: 'darts', title: 'ダーツ', min: 1, max: 16, tags: ['順番', '傾き'],
    short: 'スマホを傾けて狙って、振るかはじいて投げる。照準はみんなに丸見え',
    settings: [
      { k: 'mode', label: 'ルール', def: 'count', opts: [['count', 'カウントアップ'], ['301', '301']], hint: 'カウントアップ：8ラウンドの合計点が高い人の勝ち。301：301点からぴったり0にした人の勝ち（超えたらその番はなかったことに）' },
      { k: 'rounds', label: 'ラウンド数', def: 8, opts: [[3, '3'], [5, '5'], [8, '8']], show: o => o.mode === 'count' },
      { k: 'diff', label: '手ぶれ', def: 'normal', opts: [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']] }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>順番に1人3本ずつ投げる。投げる人の照準は、みんなのスマホにリアルタイムで映る。</li>
<li><b>狙う</b>：スマホを傾けると照準が動く（ビー玉を転がす感じ。右を下げると右、上を向こうに倒すと上）。センサーがない時は的を指でなぞる。照準は少しフラフラするよ。</li>
<li><b>振って投げる</b>：下のパネルを親指で押さえたまま、スマホを前にシュッと振る。押さえた瞬間の場所に向かって飛ぶ。強すぎると上に、弱すぎると下にずれる。</li>
<li><b>はじいて投げる</b>：下のパネルを下から上へシュッとはじく。速すぎると上、遅すぎると下にずれる。</li>
<li>「構え直す」を押すと、今の持ち方がまっすぐ（的のまん中）になる。</li>
</ul><h3>点数</h3><ul>
<li>外側の細い輪はダブル（2倍）、内側の細い輪はトリプル（3倍）。まん中（BULL）は50点。</li>
<li>カウントアップ：合計点が高い人の勝ち。</li>
<li>301：301点から引いていって、ぴったり0で上がり。0より下になったらバースト（その番の3本はなかったことに）。</li>
</ul><h3>注意</h3><ul><li>振る時はスマホを離さないように、しっかり握ってね。</li></ul>`,
    describe: m => m.k === 'throw' ? '投げた（刺さった場所）' : m.k === 'skip' ? '順番をとばす' : '',

    hostInit(ctx, players, o) {
      const order = shuffle(players);
      const g = { players: order, mode: o.mode, rounds: o.mode === 'count' ? +o.rounds : 15, diff: o.diff, ix: 0, round: 1, dart: 0, turn: [], sc: {}, rem: {}, wait: 0, bust: false, done: '', phase: 'play', seq: 0 };
      order.forEach(p => { g.sc[p.id] = 0; g.rem[p.id] = 301; });
      g.turnRem = 301;
      return g;
    },
    hostInput(ctx, m) {
      const g = ctx.g; if (!g || g.phase !== 'play') return;
      const pid = g.players[g.ix].id;
      if (m.k === 'skip' && m.f === S.host) { g.wait = ctx.now(); g.dart = 3; ctx.setG(g); return; }
      if (m.k !== 'throw' || m.f !== pid || m.d !== g.dart || g.wait) return;
      const x = clamp(+m.x || 0, -1.4, 1.4), y = clamp(+m.y || 0, -1.4, 1.4), s = score(x, y);
      g.turn.push({ x: +x.toFixed(4), y: +y.toFixed(4), v: s.v, l: s.l, k: s.k });
      g.dart++; g.seq++;
      if (g.mode === 'count') g.sc[pid] += s.v;
      else {
        const rem = g.rem[pid] - s.v;
        if (rem < 0) { g.bust = true; g.rem[pid] = g.turnRem; }
        else { g.rem[pid] = rem; if (rem === 0) g.done = pid; }
      }
      if (g.dart >= 3 || g.bust || g.done) g.wait = ctx.now() + 2200;
      ctx.setG(g);
    },
    hostTick(ctx) {
      const g = ctx.g; if (!g || g.phase !== 'play' || !g.wait || ctx.now() < g.wait) return;
      if (g.done) return endDarts(ctx);
      g.ix++; if (g.ix >= g.players.length) { g.ix = 0; g.round++; }
      if (g.round > g.rounds) return endDarts(ctx);
      g.dart = 0; g.turn = []; g.bust = false; g.wait = 0; g.seq++;
      g.turnRem = g.rem[g.players[g.ix].id];
      ctx.setG(g);
    },

    mount(ctx, stage) {
      const V = ctx.H.view = { aim: { x: 0, y: 0 }, show: { x: 0, y: 0 }, ref: null, ori: null, lock: null, hold: null, flying: [], method: store.get('tabi.party.darts.method', 'shake'), lastSeq: -1, myTurn: false, remote: { x: 0, y: 0, at: 0 }, t0: performance.now() };
      const top = h('div', { style: 'position:absolute;left:0;right:0;top:var(--top);padding:6px 12px;display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px' });
      const cv = h('canvas', { style: 'position:absolute;left:0;right:0;margin:auto;touch-action:none' });
      const pad = h('div', { style: 'position:absolute;left:0;right:0;bottom:0;padding:10px 14px calc(env(safe-area-inset-bottom,0px) + 10px);background:var(--surface);border-top:3px solid var(--line);border-radius:22px 22px 0 0;display:flex;flex-direction:column;gap:8px' });
      stage.append(top, cv, pad);
      Object.assign(V, { top, cv, pad });
      const layout = () => {
        const sr = stage.getBoundingClientRect(), tr = top.getBoundingClientRect(), pr = pad.getBoundingClientRect();
        const avail = Math.max(120, pr.top - tr.bottom - 8), size = Math.min(sr.width - 16, avail);
        const d = Math.min(2, devicePixelRatio || 1);
        cv.style.width = size + 'px'; cv.style.height = size + 'px'; cv.style.top = (tr.bottom + (avail - size) / 2) + 'px';
        cv.width = size * d; cv.height = size * d; V.d = d; V.size = size;
        V.boardImg = renderBoard(size * d);
      };
      V.layout = layout;
      ctx.listen(window, 'resize', layout);
      // 傾き
      ctx.motion((type, e) => {
        if (type === 'orient' && e.beta != null) {
          V.ori = { b: e.beta, g: e.gamma };
          if (!V.ref) V.ref = { b: e.beta, g: e.gamma };
          if (V.myTurn && !V.lock) { V.aim.x = clamp((e.gamma - V.ref.g) / AIM_DEG, -1.25, 1.25); V.aim.y = clamp((e.beta - V.ref.b) / AIM_DEG, -1.25, 1.25); }
        }
        if (type === 'motion' && V.hold && V.method === 'shake') {
          const a = e.acceleration; if (!a || a.x == null) return;
          const m = Math.hypot(a.x, a.y, a.z);
          if (m > 12) { if (m > (V.hold.peak || 0)) V.hold.peak = m; }
          else if (V.hold.peak && m < V.hold.peak * 0.55) throwDart(ctx, 'shake', V.hold.peak);
        }
      });
      // 指で狙う（センサーがない時）
      let drag = null;
      ctx.listen(cv, 'pointerdown', e => { if (!V.myTurn || V.lock) return; e.preventDefault(); drag = { x: e.clientX, y: e.clientY, ax: V.aim.x, ay: V.aim.y }; });
      ctx.listen(cv, 'pointermove', e => { if (!drag) return; const k = 2.4 / V.size; V.aim.x = clamp(drag.ax + (e.clientX - drag.x) * k, -1.25, 1.25); V.aim.y = clamp(drag.ay + (e.clientY - drag.y) * k, -1.25, 1.25); });
      ctx.listen(window, 'pointerup', () => { drag = null; });
      // 投げる（下のパネル）
      ctx.listen(pad, 'pointerdown', e => {
        if (!V.myTurn || e.target.closest('button')) return;
        e.preventDefault();
        V.lock = swayed(ctx, V.aim);
        V.hold = { y: e.clientY, t: performance.now(), peak: 0 };
        paintPad(ctx);
      });
      ctx.listen(pad, 'pointerup', e => {
        if (!V.hold) return;
        const dy = V.hold.y - e.clientY, dt = performance.now() - V.hold.t;
        if (V.method === 'flick' || !Motion.ok) {
          if (dy > 40 && dt < 600) { throwDart(ctx, 'flick', dy / Math.max(dt, 16)); return; }
          toast('下から上へ、シュッとはじいてね');
        } else toast('押さえたまま、スマホを前にシュッと振ってね');
        V.hold = null; V.lock = null; paintPad(ctx);
      });
      ctx.listen(pad, 'pointercancel', () => { V.hold = null; V.lock = null; });
      // 自分の照準をみんなへ（10回/秒、動いた時だけ）
      ctx.every(100, () => {
        if (!V.myTurn) return;
        const a = V.lock || swayed(ctx, V.aim);
        if (V.sentA && Math.abs(a.x - V.sentA.x) < 0.004 && Math.abs(a.y - V.sentA.y) < 0.004) return;
        V.sentA = a; ctx.fast({ k: 'aim', x: +a.x.toFixed(3), y: +a.y.toFixed(3), l: V.lock ? 1 : 0 });
      });
      ctx.raf(dt => drawDarts(ctx, dt));
      layout();
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      const cur = g.players[g.ix], mine = g.phase === 'play' && cur && cur.id === ctx.me.id && !g.wait;
      if (mine && !V.myTurn) { V.ref = null; V.aim = { x: 0, y: 0 }; Sound.ding(); toast('あなたの番！', 1500); }
      V.myTurn = mine;
      if (!mine) { V.lock = null; V.hold = null; }
      // 新しく刺さった矢を飛ばす
      if (g.seq !== V.lastSeq) {
        if (V.lastSeq >= 0 && g.turn.length && g.turn.length > (V.turnLen || 0)) {
          const t = g.turn[g.turn.length - 1];
          if (!V.flying.some(f => f.local && Math.abs(f.x - t.x) < 0.001)) V.flying.push({ x: t.x, y: t.y, t: performance.now() });
          land(t, g);
        }
        V.lastSeq = g.seq; V.turnLen = g.turn.length;
      }
      paintTop(ctx, g); paintPad(ctx);
      ctx.sub(cur ? (g.mode === 'count' ? 'R' + g.round + '/' + g.rounds : '301・R' + g.round) + '　' + cur.name + 'の番' : '');
      if (mine && !Motion.ok && !V.asked) { V.asked = true; ctx.needSensor(() => { V.ref = null; paintPad(ctx); }); }
    },
    onFast(ctx, m) {
      const V = ctx.H.view, g = ctx.g; if (!V || !g || m.k !== 'aim') return;
      const cur = g.players[g.ix]; if (!cur || m.f !== cur.id) return;
      V.remote = { x: +m.x || 0, y: +m.y || 0, l: !!m.l, at: performance.now() };
    }
  });

  /* 手ぶれ：ゆっくりした揺れ＋細かいふるえ */
  function swayed(ctx, a) {
    const t = performance.now() / 1000, D = DIFF[(ctx.g && ctx.g.diff) || 'normal'];
    const sx = Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1) * 0.3 + Math.sin(t * 7.1) * 0.1;
    const sy = Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.3) * 0.3 + Math.sin(t * 6.3 + 1) * 0.1;
    return { x: a.x + sx * D.sway, y: a.y + sy * D.sway };
  }
  function throwDart(ctx, how, power) {
    const V = ctx.H.view, g = ctx.g; if (!V.myTurn || !V.lock || !g) return;
    const D = DIFF[g.diff] || DIFF.normal;
    // 強さのずれ：ちょうどいい強さより強いと上、弱いと下
    const dy = how === 'shake' ? -clamp((power - 24) * 0.012, -0.45, 0.45) : -clamp((power - 2) * 0.15, -0.45, 0.45);
    const x = V.lock.x + gauss() * D.err, y = V.lock.y + dy + gauss() * D.err;
    V.hold = null; V.lock = null; V.myTurn = false;
    V.flying.push({ x, y, t: performance.now(), local: true });
    ctx.send({ k: 'throw', x: +x.toFixed(4), y: +y.toFixed(4), d: g.dart }, true);
    Sound.tone(300, 0.08, 'triangle', 0.1);
    paintPad(ctx);
  }
  function land(t, g) {
    setTimeout(() => {
      if (t.k === 'bull' || t.k === 'triple') Sound.ding();
      else if (t.k === 'miss') Sound.buzz();
      else Sound.noise(0.06, 0.25, 900);
    }, 260);
    if (g.bust) setTimeout(() => toast('バースト！この番はなかったことに', 2000), 400);
    if (g.done) setTimeout(() => toast('ぴったり0！上がり！', 2200), 400);
  }

  function paintTop(ctx, g) {
    const V = ctx.H.view, cur = g.players[g.ix];
    const val = id => g.mode === 'count' ? g.sc[id] + '点' : '残り' + g.rem[id];
    const sum = g.turn.reduce((a, t) => a + t.v, 0);
    V.top.textContent = '';
    V.top.style.flexDirection = 'column'; V.top.style.alignItems = 'stretch';
    const chips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' });
    g.players.forEach(p => chips.append(h('span', { class: 'pill' + (cur && p.id === cur.id ? ' gold' : ''), style: 'font-size:12px;padding:2px 8px' }, p.name + ' ' + val(p.id))));
    add(V.top,
      h('div', { style: 'display:flex;gap:8px;align-items:center' },
        h('b', { style: 'font-size:16px' }, cur ? cur.name + 'の番' : ''),
        h('span', { class: 'spacer' }),
        h('span', { class: 'small' }, 'この番 ' + (g.bust ? 'バースト' : sum + '点') + '・' + Math.min(3, g.turn.length) + '/3本')),
      chips);
  }
  function paintPad(ctx) {
    const V = ctx.H.view, g = ctx.g; if (!g) return;
    V.pad.textContent = '';
    if (g.phase !== 'play') return;
    if (V.myTurn) {
      const canShake = Motion.ok;
      const seg = h('div', { class: 'seg' },
        h('button', { type: 'button', 'aria-pressed': String(V.method === 'shake' && canShake), disabled: !canShake, onclick: () => { V.method = 'shake'; store.set('tabi.party.darts.method', 'shake'); paintPad(ctx); } }, '振って投げる'),
        h('button', { type: 'button', 'aria-pressed': String(V.method === 'flick' || !canShake), onclick: () => { V.method = 'flick'; store.set('tabi.party.darts.method', 'flick'); paintPad(ctx); } }, 'はじいて投げる'));
      const how = V.method === 'shake' && canShake
        ? (V.lock ? '狙いを固定した！そのままスマホを前にシュッと振れ' : 'ここを親指で押さえて、スマホを前にシュッと振る')
        : (V.lock ? 'そのまま上へシュッとはじけ' : 'ここを下から上へシュッとはじく');
      add(V.pad, 
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('b', { style: 'font-size:18px' }, (g.dart + 1) + '本目'), h('span', { class: 'spacer' }),
          canShake ? h('button', { class: 'btn sm', type: 'button', onclick: () => { V.ref = V.ori ? { b: V.ori.b, g: V.ori.g } : null; V.aim = { x: 0, y: 0 }; toast('今の持ち方をまん中にしたよ', 1400); } }, '構え直す') : h('span', { class: 'small muted' }, '的をなぞって狙う')),
        seg,
        h('div', { style: 'min-height:84px;border-radius:16px;border:2px dashed var(--gold);background:' + (V.lock ? 'var(--gold)' : 'var(--gold-soft)') + ';display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;padding:10px;color:' + (V.lock ? 'var(--on-gold)' : 'var(--fg)') }, how));
    } else {
      const ol = h('ol', { class: 'ranks', style: 'max-height:28vh;overflow:auto' });
      const rows = g.players.map(p => ({ p, v: g.mode === 'count' ? g.sc[p.id] : g.rem[p.id] }));
      rows.forEach(r => ol.append(h('li', { class: g.players[g.ix] && r.p.id === g.players[g.ix].id ? 'top' : '', style: 'padding:6px 12px' }, h('span', { class: 'pos', style: 'font-size:14px' }, g.players.indexOf(r.p) + 1 + '番'), h('span', { class: 'nm', style: 'font-size:15px' }, r.p.name + (r.p.id === ctx.me.id ? '（自分）' : '')), h('span', { class: 'sc' }, g.mode === 'count' ? r.v + '点' : '残り' + r.v))));
      const cur = g.players[g.ix];
      add(V.pad, h('p', { class: 'm0', style: 'font-weight:700' }, cur ? (g.wait ? cur.name + 'の番おわり' : cur.name + 'が投げてる（照準が動いてるのが見える）') : ''), ol);
      if (isHost && cur && cur.id !== ctx.me.id) add(V.pad, h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { if (await ask(cur.name + 'の番をとばす？（スマホが止まってる時など）', { ok: 'とばす' })) ctx.send({ k: 'skip' }, true); } }, cur.name + 'の番をとばす'));
    }
    if (V.layout) requestAnimationFrame(V.layout);
  }

  /* 的の絵（大きさが変わった時だけ描き直す） */
  function renderBoard(px) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const x = c.getContext('2d'), cx = px / 2, Rr = px / 2 * 0.84;
    x.fillStyle = '#1b1b1d'; x.beginPath(); x.arc(cx, cx, px / 2 - 1, 0, 7); x.fill();
    const wedge = (r0, r1, i, col) => {
      const a0 = (-90 - 9 + i * 18) * Math.PI / 180, a1 = a0 + 18 * Math.PI / 180;
      x.fillStyle = col; x.beginPath(); x.arc(cx, cx, r1, a0, a1); x.arc(cx, cx, r0, a1, a0, true); x.closePath(); x.fill();
    };
    for (let i = 0; i < 20; i++) {
      const dark = i % 2 === 0;
      wedge(R.bull * Rr, R.tin * Rr, i, dark ? '#202022' : '#efe3c4');
      wedge(R.tin * Rr, R.tout * Rr, i, dark ? '#d23a2e' : '#1f8a4c');
      wedge(R.tout * Rr, R.din * Rr, i, dark ? '#202022' : '#efe3c4');
      wedge(R.din * Rr, Rr, i, dark ? '#d23a2e' : '#1f8a4c');
    }
    x.fillStyle = '#1f8a4c'; x.beginPath(); x.arc(cx, cx, R.bull * Rr, 0, 7); x.fill();
    x.fillStyle = '#d23a2e'; x.beginPath(); x.arc(cx, cx, R.bull * Rr * 0.45, 0, 7); x.fill();
    x.strokeStyle = 'rgba(200,200,200,.55)'; x.lineWidth = Math.max(1, px / 500);
    [R.tin, R.tout, R.din, 1].forEach(r => { x.beginPath(); x.arc(cx, cx, r * Rr, 0, 7); x.stroke(); });
    x.fillStyle = '#f3f0e6'; x.font = '700 ' + Math.round(px * 0.05) + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    NUMS.forEach((n, i) => { const a = (-90 + i * 18) * Math.PI / 180; x.fillText(n, cx + Math.cos(a) * Rr * 1.1, cx + Math.sin(a) * Rr * 1.1); });
    return c;
  }
  function drawDarts(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g || !V.boardImg) return;
    const cv = V.cv, x = cv.getContext('2d'), px = cv.width, cx = px / 2, Rr = px / 2 * 0.84, d = V.d;
    x.clearRect(0, 0, px, px);
    x.drawImage(V.boardImg, 0, 0);
    const P = (a, b) => [cx + a * Rr, cx + b * Rr];
    // この番の矢
    const now = performance.now();
    g.turn.forEach((t, i) => {
      const fly = V.flying.find(f => Math.abs(f.x - t.x) < 0.002 && Math.abs(f.y - t.y) < 0.002);
      const k = fly ? Math.min(1, (now - fly.t) / 260) : 1;
      if (k >= 1) drawDart(x, ...P(t.x, t.y), d, i);
    });
    V.flying = V.flying.filter(f => now - f.t < 1500);
    V.flying.forEach(f => {
      const k = Math.min(1, (now - f.t) / 260); if (k >= 1 && !f.local) return;
      if (k >= 1 && f.local && !g.turn.some(t => Math.abs(f.x - t.x) < 0.002)) { drawDart(x, ...P(f.x, f.y), d, 9); return; }
      if (k >= 1) return;
      const [tx, ty] = P(f.x, f.y), s = 1 + (1 - k) * 3;
      x.globalAlpha = 0.4 + k * 0.6;
      x.fillStyle = '#e3a20d'; x.beginPath(); x.arc(tx, ty + (1 - k) * px * 0.4, 6 * d * s, 0, 7); x.fill();
      x.globalAlpha = 1;
    });
    // 照準
    let a = null, locked = false;
    if (V.myTurn) { a = V.lock || swayed(ctx, V.aim); locked = !!V.lock; }
    else if (g.phase === 'play' && !g.wait && now - V.remote.at < 2500) { V.show.x += (V.remote.x - V.show.x) * Math.min(1, dt * 12); V.show.y += (V.remote.y - V.show.y) * Math.min(1, dt * 12); a = V.show; locked = V.remote.l; }
    if (a) {
      const [ax, ay] = P(a.x, a.y), r = 16 * d;
      x.strokeStyle = locked ? '#ff4d3d' : '#ffd23f'; x.lineWidth = 3 * d;
      x.beginPath(); x.arc(ax, ay, r, 0, 7); x.stroke();
      x.beginPath(); x.moveTo(ax - r * 1.6, ay); x.lineTo(ax - r * 0.5, ay); x.moveTo(ax + r * 0.5, ay); x.lineTo(ax + r * 1.6, ay); x.moveTo(ax, ay - r * 1.6); x.lineTo(ax, ay - r * 0.5); x.moveTo(ax, ay + r * 0.5); x.lineTo(ax, ay + r * 1.6); x.stroke();
      x.fillStyle = locked ? '#ff4d3d' : '#ffd23f'; x.beginPath(); x.arc(ax, ay, 2.5 * d, 0, 7); x.fill();
    }
    // 最後の矢の点数
    const last = g.turn[g.turn.length - 1];
    if (last && (!V.flying.length || now - V.flying[V.flying.length - 1].t > 260)) {
      const [lx, ly] = P(last.x, last.y);
      x.font = '700 ' + 20 * d + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--f-display');
      x.textAlign = 'center'; x.lineWidth = 5 * d; x.strokeStyle = 'rgba(0,0,0,.75)'; x.fillStyle = last.v ? '#ffd23f' : '#ffffff';
      const ty = Math.max(24 * d, ly - 28 * d), txt = last.l + (last.v ? '  ' + last.v + '点' : '');
      x.strokeText(txt, clamp(lx, 80 * d, px - 80 * d), ty); x.fillText(txt, clamp(lx, 80 * d, px - 80 * d), ty);
    }
  }
  function drawDart(x, px, py, d, i) {
    x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 3 * d; x.beginPath(); x.moveTo(px, py); x.lineTo(px + 14 * d, py - 18 * d); x.stroke();
    x.fillStyle = ['#ffd23f', '#5ad1ff', '#ff7ad9', '#ffffff'][i % 4]; x.beginPath(); x.moveTo(px + 12 * d, py - 16 * d); x.lineTo(px + 24 * d, py - 20 * d); x.lineTo(px + 18 * d, py - 28 * d); x.closePath(); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(px, py, 3.2 * d, 0, 7); x.fill();
    x.strokeStyle = '#000'; x.lineWidth = 1 * d; x.stroke();
  }

  function endDarts(ctx) {
    const g = ctx.g; g.phase = 'end';
    let rows;
    if (g.mode === 'count') {
      rows = g.players.map(p => ({ id: p.id, s: g.sc[p.id] })).sort((a, b) => b.s - a.s);
      rows.forEach((r, i) => { r.pos = i && r.s === rows[i - 1].s ? rows[i - 1].pos : i + 1; r.label = r.s + '点'; });
    } else {
      rows = g.players.map(p => ({ id: p.id, s: g.rem[p.id] })).sort((a, b) => a.s - b.s);
      rows.forEach((r, i) => { r.pos = i && r.s === rows[i - 1].s ? rows[i - 1].pos : i + 1; r.label = r.s ? '残り' + r.s : '上がり！'; });
    }
    const top = rows.filter(r => r.pos === 1).map(r => ctx.nameOf(r.id));
    ctx.finish({ title: top.join('、') + ' の勝ち！', note: g.mode === 'count' ? 'カウントアップ ' + g.rounds + 'ラウンド' : '301', rows: rows.map(r => ({ id: r.id, pos: r.pos, label: r.label })) });
  }
})();
