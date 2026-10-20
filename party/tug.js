/* 綱引き：スマホを振る（または画面を連打する）回数でチームで引っぱり合う。
   ・幹事のスマホが綱の位置を計算して、1秒に10回みんなに配る。
   ・みんなは「今までに引いた回数（合計）」を5回/秒で幹事に送るだけ。途中で1つ届かなくても合計なのでズレない。 */
(() => {
  const TEAM = { A: { name: '赤', color: '#e0352b', soft: 'rgba(224,53,43,.16)' }, B: { name: '白', color: '#5b6b9a', soft: 'rgba(91,107,154,.16)' } };
  const K = 0.045;      // 1人あたり1回多く引くと、綱がどれだけ動くか（端まで1.0）
  const TAP_W = 0.6;    // 「振る」モードでセンサーがない人の連打は 0.6回ぶん

  Party.register({
    id: 'tug', title: '綱引き', min: 2, max: 16, tags: ['チーム戦', '振る'],
    short: '2チームに分かれて、スマホを全力で振って綱を引っぱる',
    settings: [
      { k: 'mode', label: '引き方', def: 'shake', opts: [['shake', 'スマホを振る'], ['tap', '画面を連打']], hint: '振るモードでもセンサーが使えない人は連打で参加できる（1回が0.6回ぶん）' },
      { k: 'time', label: '時間', def: 30, opts: [[20, '20秒'], [30, '30秒'], [45, '45秒']] },
      { k: 'team', label: 'チーム分け', def: 'seat', opts: [['seat', '席順で交互'], ['random', 'ランダム']] }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>赤チームと白チームに分かれて綱引き。人数がちがっても、1人あたりの引いた回数で比べるから公平。</li>
<li>「スマホを振る」モード：スマホをしっかり握って、上下に全力で振る。振った回数が引く力になる。</li>
<li>「画面を連打」モード：画面の下半分をひたすら連打。</li>
<li>綱の目印（リボン）が自分のチームの線まで来たら勝ち。時間切れの時は、リボンが近い方の勝ち。</li>
</ul><h3>ポイント</h3><ul><li>勝ったチーム全員 6pt、負けたチーム 2pt。いちばん多く引いた人（MVP）に +2pt。</li></ul>
<h3>注意</h3><ul><li>スマホを飛ばさないように、手首にストラップをかけるか、しっかり握ってね。まわりの人とぶつからないように少し離れよう。</li></ul>`,
    describe: m => m.k === 'pull' ? '引いた回数（合計 ' + Math.round(m.n) + '回）' : m.k === 'end' ? '勝負あり' : '',

    hostInit(ctx, players, o) {
      const order = o.team === 'random' ? shuffle(players) : players;
      const teams = {};
      order.forEach((p, i) => { teams[p.id] = i % 2 ? 'B' : 'A'; });
      ctx.H.count = {}; ctx.H.prev = {}; ctx.H.pos = 0; ctx.H.last = 0; ctx.H.rate = { A: 0, B: 0 };
      return { players, teams, mode: o.mode, dur: +o.time, startAt: ctx.now() + 4500, endAt: ctx.now() + 4500 + o.time * 1000, phase: 'go' };
    },
    hostInput(ctx, m) {
      const g = ctx.g; if (!g || !(m.f in g.teams) || g.phase !== 'go') return;
      const n = +m.n || 0, prev = ctx.H.count[m.f] || 0;
      // 1秒に15回より速いのはありえないので切る（センサーの誤作動よけ）
      const el = Math.max(0.2, (ctx.now() - g.startAt) / 1000);
      ctx.H.count[m.f] = Math.min(Math.max(prev, n), el * 15);
    },
    hostTick(ctx) {
      const g = ctx.g, H = ctx.H; if (!g || g.phase !== 'go') return;
      const now = ctx.now();
      if (now < g.startAt) return;
      if (now - H.last < 100) return;
      const dt = H.last ? (now - H.last) / 1000 : 0.1; H.last = now;
      const sum = { A: 0, B: 0 }, size = { A: 0, B: 0 };
      Object.entries(g.teams).forEach(([id, t]) => {
        size[t]++;
        const c = H.count[id] || 0; sum[t] += c - (H.prev[id] || 0); H.prev[id] = c;
      });
      const per = t => size[t] ? sum[t] / size[t] : 0;
      H.pos = clamp(H.pos + (per('A') - per('B')) * K, -1, 1);
      ['A', 'B'].forEach(t => { H.rate[t] = H.rate[t] * 0.7 + (per(t) / dt) * 0.3; });
      ctx.fast({ k: 'rope', p: +H.pos.toFixed(4), a: +H.rate.A.toFixed(2), b: +H.rate.B.toFixed(2), t: now });
      if (H.view) { H.view.pos = H.pos; H.view.rate = { A: H.rate.A, B: H.rate.B }; }   // 幹事の画面は自分で更新
      if (Math.abs(H.pos) >= 1 || now >= g.endAt) {
        g.phase = 'end'; g.pos = H.pos;
        g.winner = H.pos > 0.0005 ? 'A' : H.pos < -0.0005 ? 'B' : '';
        g.counts = Object.fromEntries(Object.keys(g.teams).map(id => [id, Math.round(H.count[id] || 0)]));
        ctx.setG(g);
        ctx.later(3200, () => finishTug(ctx));
      }
    },

    mount(ctx, stage) {
      const V = ctx.H.view = { pos: 0, shown: 0, rate: { A: 0, B: 0 }, myCount: 0, sentAt: 0, sentN: 0, sparks: [], lastPull: 0 };
      const cv = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
      const pad = h('div', { style: 'position:absolute;left:0;right:0;bottom:0;height:32%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 12px);background:var(--surface);border-top:3px solid var(--line);border-radius:22px 22px 0 0;text-align:center' });
      stage.append(cv, pad);
      V.cv = cv; V.pad = pad;
      const resize = () => {
        const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
        cv.width = r.width * d; cv.height = r.height * d; V.dpr = d;
        V.topY = $('#hud').getBoundingClientRect().bottom * d; V.botY = pad.getBoundingClientRect().top * d;
      };
      resize(); ctx.listen(window, 'resize', resize);
      const pull = w => {
        const g = ctx.g; if (!g || g.phase !== 'go' || ctx.now() < g.startAt || !(ctx.me.id in g.teams)) return;
        V.myCount += w; V.lastPull = performance.now();
        if (Math.floor(V.myCount) % 5 === 0) Sound.tone(520 + Math.random() * 120, 0.05, 'triangle', 0.08);
        V.sparks.push({ x: Math.random(), life: 1 });
      };
      V.pull = pull;
      ctx.shaker(() => { const g = ctx.g; if (g && g.mode === 'shake') pull(1); }, { hi: 12, lo: 5, gap: 75 });
      ctx.listen(pad, 'pointerdown', e => {
        e.preventDefault();
        const g = ctx.g; if (!g) return;
        if (g.mode === 'tap') pull(1); else if (!Motion.ok) pull(TAP_W);
      });
      // 引いた回数（合計）を5回/秒で幹事へ
      ctx.every(200, () => {
        const g = ctx.g; if (!g || g.phase !== 'go' || !(ctx.me.id in g.teams)) return;
        if (V.myCount !== V.sentN || performance.now() - V.sentAt > 1000) { V.sentN = V.myCount; V.sentAt = performance.now(); ctx.send({ k: 'pull', n: +V.myCount.toFixed(1) }); }
      });
      ctx.raf((dt) => drawTug(ctx, dt));
      ctx.H.cd = null;
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      const mine = g.teams[ctx.me.id];
      V.mine = mine;
      if (!ctx.H.cd && g.phase === 'go') ctx.H.cd = ctx.countdown(g.startAt);
      if (g.phase === 'end') { V.pos = g.pos; V.end = true; }
      paintInfo(ctx, g);
      if (g.mode === 'shake' && mine && !Motion.ok && !V.asked) { V.asked = true; ctx.needSensor(() => paintInfo(ctx, g)); }
    },
    onFast(ctx, m) {
      const V = ctx.H.view;
      if (!V || m.k !== 'rope' || !S || m.f !== S.host) return;   // 綱の位置は幹事からのものだけ使う
      V.pos = clamp(+m.p || 0, -1, 1); V.rate = { A: +m.a || 0, B: +m.b || 0 };
    }
  });

  function paintInfo(ctx, g) {
    const V = ctx.H.view, mine = g.teams[ctx.me.id];
    V.names = { A: g.players.filter(p => g.teams[p.id] === 'A').map(p => p.name).join('・'), B: g.players.filter(p => g.teams[p.id] === 'B').map(p => p.name).join('・') };
    V.pad.textContent = '';
    if (g.phase === 'end') {
      const win = g.winner;
      add(V.pad, h('p', { class: 'st-big', style: 'color:' + (win ? TEAM[win].color : 'var(--fg)') }, win ? TEAM[win].name + 'チームの勝ち！' : '引き分け！'),
        h('p', { class: 'm0 muted' }, mine ? 'あなたは ' + Math.round(g.counts[ctx.me.id] || V.myCount) + '回 引いた' : ''));
      ctx.sub('勝負あり');
      return;
    }
    if (!mine) { add(V.pad, h('p', { class: 'st-big' }, '観戦中'), h('p', { class: 'm0 muted' }, '次のゲームから参加できるよ')); ctx.sub('観戦中'); return; }
    const tap = g.mode === 'tap' || !Motion.ok;
    V.big = h('p', { class: 'st-big', style: 'color:' + TEAM[mine].color }, tap ? 'ここを連打！' : 'スマホを振れ！');
    V.cnt = h('p', { class: 'm0', style: 'font-weight:700;font-variant-numeric:tabular-nums' }, '0回');
    add(V.pad, h('p', { class: 'm0', style: 'font-weight:700' }, 'あなたは' + TEAM[mine].name + 'チーム。リボンを下の線まで引っぱれ'), V.big, V.cnt);
    V.pad.style.background = tap ? TEAM[mine].soft : 'var(--surface)';
    ctx.sub(TEAM[mine].name + 'チーム');
  }

  function drawTug(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g || !V.topY) return;
    const cv = V.cv, x = cv.getContext('2d'), d = V.dpr, W = cv.width;
    V.shown += (V.pos - V.shown) * Math.min(1, dt * 8);
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
    x.clearRect(0, 0, W, cv.height);
    x.fillStyle = col('--bg'); x.fillRect(0, 0, W, cv.height);
    // 自分のチームを下に描く（観戦は赤が下）
    const bottom = V.mine || 'A', top = bottom === 'A' ? 'B' : 'A';
    const sgn = bottom === 'A' ? 1 : -1;   // pos>0 は赤の勝ち方向
    const y0 = V.topY + 30 * d, y1 = V.botY - 6 * d, cx = W / 2;
    const mid = (y0 + y1) / 2, range = (y1 - y0) * 0.36;
    const lineT = mid - range, lineB = mid + range;
    // 陣地
    x.fillStyle = TEAM[top].soft; x.fillRect(0, y0, W, lineT - y0);
    x.fillStyle = TEAM[bottom].soft; x.fillRect(0, lineB, W, y1 - lineB);
    x.lineWidth = 3 * d; x.setLineDash([10 * d, 8 * d]);
    [[lineT, TEAM[top].color], [lineB, TEAM[bottom].color]].forEach(([yy, c]) => { x.strokeStyle = c; x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); });
    x.setLineDash([]);
    // チーム名
    x.textAlign = 'left'; x.textBaseline = 'middle';
    const label = (t, yy) => {
      x.fillStyle = TEAM[t].color; x.font = '700 ' + 13 * d + 'px ' + col('--f-body');
      const txt = TEAM[t].name + 'チーム：' + (V.names ? V.names[t] : '');
      x.fillText(txt.length > 26 ? txt.slice(0, 25) + '…' : txt, 12 * d, yy);
    };
    label(top, (y0 + lineT) / 2 - 10 * d); label(bottom, (lineB + y1) / 2 + 10 * d);
    // 引く力のメーター（1人あたり1秒に何回）
    const meter = (t, yy) => {
      const r = Math.min(1, V.rate[t] / 10);
      x.fillStyle = col('--surface-2'); x.fillRect(12 * d, yy, W - 24 * d, 7 * d);
      x.fillStyle = TEAM[t].color; x.fillRect(12 * d, yy, (W - 24 * d) * r, 7 * d);
    };
    meter(top, (y0 + lineT) / 2 + 6 * d); meter(bottom, (lineB + y1) / 2 - 18 * d);
    // まん中の目印
    x.strokeStyle = col('--muted'); x.lineWidth = 2 * d; x.beginPath(); x.moveTo(cx - 44 * d, mid); x.lineTo(cx + 44 * d, mid); x.stroke();
    // 綱（ゆらゆら）
    const off = V.shown * sgn * range;
    const t = performance.now() / 1000, wob = Math.min(8, (V.rate.A + V.rate.B) * 0.5) * d;
    x.save(); x.beginPath(); x.rect(0, y0, W, y1 - y0); x.clip();
    x.strokeStyle = '#b8894a'; x.lineWidth = 12 * d; x.lineCap = 'round';
    x.beginPath();
    for (let i = 0; i <= 48; i++) {
      const yy = y0 - range + (y1 - y0 + 2 * range) * i / 48;
      const xx = cx + Math.sin(t * 9 + i * 0.7) * wob;
      i ? x.lineTo(xx, yy + off) : x.moveTo(xx, yy + off);
    }
    x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.2)'; x.lineWidth = 2 * d;
    for (let i = 0; i < 48; i++) { const yy = y0 - range + (y1 - y0 + 2 * range) * i / 48 + off, xx = cx + Math.sin(t * 9 + i * 0.7) * wob; x.beginPath(); x.moveTo(xx - 6 * d, yy); x.lineTo(xx + 6 * d, yy + 6 * d); x.stroke(); }
    // リボン
    const ry = mid + off;
    x.fillStyle = '#e3a20d'; x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1.5 * d;
    x.beginPath(); x.moveTo(cx, ry - 10 * d); x.lineTo(cx + 34 * d, ry - 22 * d); x.lineTo(cx + 34 * d, ry + 22 * d); x.lineTo(cx, ry + 10 * d); x.lineTo(cx - 34 * d, ry + 22 * d); x.lineTo(cx - 34 * d, ry - 22 * d); x.closePath(); x.fill(); x.stroke();
    // 火花
    V.sparks = V.sparks.filter(s => (s.life -= dt * 2.5) > 0);
    V.sparks.slice(-30).forEach(s => { x.globalAlpha = s.life; x.fillStyle = TEAM[bottom].color; x.beginPath(); x.arc(cx + (s.x - 0.5) * 140 * d, y1 - (1 - s.life) * 50 * d, 5 * d * s.life, 0, 7); x.fill(); });
    x.globalAlpha = 1;
    x.restore();
    // 残り時間
    if (g.phase === 'go') {
      const now = ctx.now(), left = Math.max(0, (g.endAt - now) / 1000);
      x.fillStyle = col('--surface-2'); x.fillRect(0, V.topY, W, 6 * d);
      x.fillStyle = left < 5 ? '#c3352b' : '#e3a20d'; x.fillRect(0, V.topY, W * (now < g.startAt ? 1 : left / g.dur), 6 * d);
      x.fillStyle = col('--fg'); x.textAlign = 'right'; x.font = '700 ' + 13 * d + 'px ' + col('--f-body');
      x.fillText(now < g.startAt ? 'まもなくスタート' : '残り ' + Math.ceil(left) + '秒', W - 12 * d, V.topY + 18 * d);
      if (V.cnt) V.cnt.textContent = Math.floor(V.myCount) + '回 引いた';
      if (V.big) V.big.style.transform = performance.now() - V.lastPull < 120 ? 'scale(1.08)' : 'none';
    }
  }

  function finishTug(ctx) {
    const g = ctx.g; if (!g) return;
    const ids = Object.keys(g.teams);
    const mvp = ids.reduce((a, id) => (g.counts[id] || 0) > (g.counts[a] || 0) ? id : a, ids[0]);
    const gains = {}, rows = [];
    ids.forEach(id => {
      const t = g.teams[id], win = !g.winner ? null : t === g.winner;
      gains[id] = (win === null ? 4 : win ? 6 : 2) + (id === mvp && g.counts[id] > 0 ? 2 : 0);
      rows.push({ id, pos: win === false ? 2 : 1, label: (g.counts[id] || 0) + '回', sub: TEAM[t].name + 'チーム' + (id === mvp && g.counts[id] > 0 ? '・MVP' : '') });
    });
    rows.sort((a, b) => a.pos - b.pos || (g.counts[b.id] || 0) - (g.counts[a.id] || 0));
    ctx.finish({ title: g.winner ? TEAM[g.winner].name + 'チームの勝ち！' : '引き分け！', note: 'MVP：' + ctx.nameOf(mvp) + '（' + (g.counts[mvp] || 0) + '回）', rows, gains });
  }
})();
