/* 爆弾リレー：爆弾を持ったら、ミッションをこなして隣の人へスワイプで渡す。爆発した時に持ってた人がアウト。
   ・爆発までの時間は幹事のスマホだけが知っている（ほかのスマホには送らない）。
   ・渡す操作は幹事が受け付けた時点で成立。幹事が受け付ける前に爆発したら、渡そうとした人がアウト。 */
(() => {
  const FUSE = { short: [9, 18], normal: [14, 32], long: [24, 48] };
  const SAY = ['赤いもの', '丸いもの', '冷たいもの', '旅館にあるもの', 'コンビニで買えるもの', '動物の名前', '果物', '駅弁に入ってそうなもの', '白いもの', 'ふわふわしたもの', '夏といえば', '冬といえば', '温泉にあるもの', '甘いもの', '乗り物', '国の名前', '野菜', 'スポーツ', '学校にあるもの', '四角いもの', '飲み物', 'お寿司のネタ', '鳴き声を出す生き物', '空にあるもの', '台所にあるもの', '光るもの', '「ん」で終わる言葉', '3文字の食べ物', '虫の名前', '楽器'];

  Party.register({
    id: 'bomb', title: '爆弾リレー', min: 2, max: 16, tags: ['席順', 'ドキドキ'],
    short: '爆弾が回ってきたら、ミッションをこなして隣へスワイプ。爆発したら負け',
    settings: [
      { k: 'task', label: '渡す前のミッション', def: 'tap', opts: [['none', 'なし'], ['tap', '数字タッチ'], ['shake', '5回振る'], ['say', 'お題を言う']], hint: '数字タッチ：1→2→3の順に押す。お題を言う：画面のお題に合う物を1つ声に出してから渡す' },
      { k: 'fuse', label: '導火線', def: 'normal', opts: [['short', '短め'], ['normal', 'ふつう'], ['long', '長め']], hint: '爆発までの時間は毎回ランダム。誰にもわからない' },
      { k: 'rounds', label: '回数', def: 5, opts: [[3, '3回'], [5, '5回'], [8, '8回']], hint: '1回爆発するごとに1ラウンド' }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>待合室の席の番号の順に、時計回りで輪になって座る（離れて遊ぶ時は気にしなくていい）。</li>
<li>爆弾が回ってきたら、画面のミッションをこなしてから、渡したい人の方向へスワイプ（または矢印のボタン）。右か左の隣の人にしか渡せない。</li>
<li>爆発した時に爆弾を持っていた人に×が1つ。決めた回数だけ爆発したら終わり。×が少ない人ほど上の順位。</li>
<li>爆発までの時間は毎回ランダムで、幹事にもわからない（幹事のスマホの中だけで決めて、画面には出さない）。</li>
</ul><h3>ミッション</h3><ul>
<li>数字タッチ：光った丸を 1→2→3 の順に押す。まちがえたら並びが変わってやり直し。</li>
<li>5回振る：スマホを5回振る（センサーがない人は10回タップ）。</li>
<li>お題を言う：「赤いもの」などのお題に合うものを1つ声に出してから渡す。言えてなかったら、まわりがツッコもう。</li>
</ul>`,
    describe: m => m.k === 'pass' ? '爆弾を渡す' : '',

    hostInit(ctx, players, o) {
      const g = { players, task: o.task, rounds: +o.rounds, round: 0, strikes: {}, holder: '', seq: 0, phase: 'wait', fuseKind: o.fuse };
      players.forEach(p => { g.strikes[p.id] = 0; });
      nextRound(ctx, g, pick(players).id);
      return g;
    },
    hostInput(ctx, m) {
      const g = ctx.g; if (!g || g.phase !== 'play' || m.k !== 'pass') return;
      if (m.f !== g.holder || m.n !== g.seq || ctx.now() < g.startAt) return;
      const nb = neighbors(g, m.f);
      if (m.to !== nb.left && m.to !== nb.right) return;
      g.from = g.holder; g.holder = m.to; g.seq++; g.dir = m.to === nb.left ? 'L' : 'R'; g.task2 = taskFor(g);
      ctx.setG(g);
    },
    hostTick(ctx) {
      const g = ctx.g, H = ctx.H, now = ctx.now(); if (!g) return;
      if (g.phase === 'play' && now >= H.fuse) {
        g.phase = 'boom'; g.loser = g.holder; g.strikes[g.holder]++; g.boomAt = now; g.seq++;
        ctx.setG(g);
      } else if (g.phase === 'boom' && now - g.boomAt > 3800) {
        if (g.round >= g.rounds) return endBomb(ctx);
        nextRound(ctx, g, g.loser);
        ctx.setG(g);
      }
    },

    mount(ctx, stage) {
      const V = ctx.H.view = { sparks: [], seq: -1, flyIn: null, flyOut: null, task: null, taskDone: false, shakeN: 0, tickAt: 0 };
      const cv = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
      const ui = h('div', { style: 'position:absolute;left:0;right:0;bottom:0;padding:10px 14px calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;flex-direction:column;gap:8px;align-items:stretch' });
      const msg = h('div', { style: 'position:absolute;left:0;right:0;top:calc(var(--top) + 10px);text-align:center;font-weight:700;padding:0 12px' });
      stage.append(cv, msg, ui);
      Object.assign(V, { cv, ui, msg });
      const resize = () => { const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; V.d = d; };
      resize(); ctx.listen(window, 'resize', resize);
      // スワイプで渡す
      let sw = null;
      ctx.listen(stage, 'pointerdown', e => { if (e.target.closest('button')) return; sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
      ctx.listen(stage, 'pointerup', e => {
        if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = performance.now() - sw.t; sw = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 700) tryPass(ctx, dx < 0 ? 'L' : 'R');
      });
      ctx.shaker(() => { if (V.task && V.task.kind === 'shake' && !V.taskDone) { V.shakeN++; Sound.pop(); if (V.shakeN >= 5) doneTask(ctx); else paintUI(ctx); } }, { hi: 12, lo: 5, gap: 110 });
      ctx.raf(dt => drawBomb(ctx, dt));
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      if (g.seq !== V.seq) {
        const prevHolder = V.holder, prevRound = V.round;
        V.seq = g.seq; V.holder = g.holder; V.round = g.round;
        if (g.phase === 'play' && g.holder === ctx.me.id && (prevHolder !== ctx.me.id || prevRound !== g.round || V.sentSeq != null)) {
          V.sentSeq = null;
          // 自分に来た
          V.flyIn = { t: performance.now(), dir: g.from ? (g.dir === 'L' ? 1 : -1) : 0 };
          V.task = g.task2 ? Object.assign({}, g.task2) : null; V.taskDone = !V.task; V.shakeN = 0; V.tapNext = 1;
          if (V.task && V.task.kind === 'tap') V.task.pts = layoutTap();
          V.gotAt = performance.now();
          if (g.from) Sound.tone(880, 0.08, 'square', 0.12);
          if (V.task && V.task.kind === 'say') setTimeout(() => { if (V.holder === ctx.me.id && V.seq === g.seq) doneTask(ctx); }, 1200);
        }
        if (g.phase === 'boom' && V.boomSeen !== g.boomAt) { V.boomSeen = g.boomAt; V.boomT = performance.now(); boomSound(); if (navigator.vibrate) try { navigator.vibrate(400); } catch (e) {} }
        if (g.phase === 'play' && V.cdFor !== g.round && ctx.now() < g.startAt) { V.cdFor = g.round; ctx.countdown(g.startAt); }
      }
      paintUI(ctx);
      const nm = id => ctx.nameOf(id);
      ctx.sub(g.round + '/' + g.rounds + '回目' + (g.phase === 'play' ? '　' + nm(g.holder) + 'が持ってる' : ''));
      if (g.task === 'shake' && !Motion.ok && !V.asked && g.players.some(p => p.id === ctx.me.id)) { V.asked = true; ctx.needSensor(() => paintUI(ctx)); }
    }
  });

  function neighbors(g, id) {
    const n = g.players.length, i = g.players.findIndex(p => p.id === id);
    // 時計回りに座っている時、自分の左手側が次の番号の人
    return { left: g.players[(i + 1) % n].id, right: g.players[(i - 1 + n) % n].id };
  }
  function taskFor(g) {
    if (g.task === 'say') return { kind: 'say', text: pick(SAY) };
    if (g.task === 'none') return null;
    return { kind: g.task };
  }
  function nextRound(ctx, g, first) {
    const [a, b] = FUSE[g.fuseKind] || FUSE.normal;
    g.round++; g.phase = 'play'; g.holder = first; g.from = ''; g.seq++; g.loser = ''; g.task2 = taskFor(g);
    g.startAt = ctx.now() + 3500;
    ctx.H.fuse = g.startAt + (a + Math.random() * (b - a)) * 1000;   // 幹事のスマホの中だけ
  }
  function layoutTap() {
    const pts = [];
    while (pts.length < 3) {
      const p = { x: 0.18 + Math.random() * 0.64, y: 0.2 + Math.random() * 0.6 };
      if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 0.28)) pts.push(p);
    }
    return pts;
  }
  function doneTask(ctx) { const V = ctx.H.view; V.taskDone = true; Sound.ding(); paintUI(ctx); }
  function tryPass(ctx, dir) {
    const V = ctx.H.view, g = ctx.g; if (!g || g.phase !== 'play' || g.holder !== ctx.me.id) return;
    if (ctx.now() < g.startAt) return;
    if (!V.taskDone) { toast('先にミッションをクリアしてね', 1200); return; }
    const nb = neighbors(g, ctx.me.id), to = dir === 'L' ? nb.left : nb.right;
    V.flyOut = { t: performance.now(), dir: dir === 'L' ? -1 : 1 }; V.sentSeq = g.seq;
    ctx.send({ k: 'pass', to, n: g.seq }, true);
    Sound.tone(440, 0.1, 'triangle', 0.12);
    paintUI(ctx);
  }

  function paintUI(ctx) {
    const V = ctx.H.view, g = ctx.g; if (!g) return;
    V.ui.textContent = ''; V.msg.textContent = '';
    const meIn = g.players.some(p => p.id === ctx.me.id);
    if (g.phase === 'boom') {
      add(V.msg, h('p', { class: 'st-big', style: 'color:#e0352b' }, 'ドカーン！'), h('p', { class: 'm0' }, g.loser === ctx.me.id ? 'あなたが持ってた…！' : ctx.nameOf(g.loser) + ' がアウト'));
      add(V.ui, strikes(ctx, g));
      return;
    }
    const mine = g.holder === ctx.me.id && V.sentSeq !== g.seq;
    if (!mine) {
      const nb = meIn ? neighbors(g, ctx.me.id) : null;
      const near = nb && (g.holder === nb.left || g.holder === nb.right);
      add(V.msg, h('p', { class: 'm0', style: 'font-size:18px' }, ctx.nameOf(g.holder) + ' が持ってる'), near ? h('p', { class: 'm0', style: 'color:#e0352b' }, 'となりまで来てる！') : null);
      add(V.ui, strikes(ctx, g));
      return;
    }
    const nb = neighbors(g, ctx.me.id), same = nb.left === nb.right;
    if (V.task && !V.taskDone) {
      if (V.task.kind === 'tap') add(V.msg, h('p', { class: 'm0', style: 'font-size:18px' }, '光った丸を 1→2→3 の順にタッチ！'));
      if (V.task.kind === 'shake') add(V.msg, h('p', { class: 'm0', style: 'font-size:18px' }, Motion.ok ? 'スマホを5回振れ！（' + V.shakeN + '/5）' : '画面を10回タップ！（' + V.shakeN + '/10）'));
      if (V.task.kind === 'say') add(V.msg, h('p', { class: 'm0' }, 'お題に合うものを1つ言ってから渡せ！'), h('p', { class: 'st-big' }, '「' + V.task.text + '」'));
    } else {
      if (V.task && V.task.kind === 'say') add(V.msg, h('p', { class: 'm0' }, 'お題：「' + V.task.text + '」を言った？'), h('p', { class: 'st-big' }, 'スワイプで渡せ！'));
      else add(V.msg, h('p', { class: 'st-big' }, 'スワイプで渡せ！'));
    }
    const ok = V.taskDone;
    const btn = (dir, label) => h('button', { class: 'btn big ' + (ok ? 'gold' : ''), type: 'button', disabled: !ok, style: 'flex:1;min-width:0', onclick: () => tryPass(ctx, dir) }, label);
    add(V.ui, h('div', { style: 'display:flex;gap:8px' }, same ? btn('L', ctx.nameOf(nb.left) + ' へ渡す') : [btn('L', '← ' + ctx.nameOf(nb.left)), btn('R', ctx.nameOf(nb.right) + ' →')]));
    if (V.task && V.task.kind === 'shake' && !Motion.ok && !V.taskDone) V.ui.prepend(h('button', { class: 'btn big', type: 'button', onclick: () => { V.shakeN++; if (V.shakeN >= 10) doneTask(ctx); else paintUI(ctx); } }, 'タップ！'));
  }
  function strikes(ctx, g) {
    const box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center' });
    g.players.forEach((p, i) => box.append(h('span', { class: 'pill' + (p.id === g.holder && g.phase === 'play' ? ' warn' : p.id === ctx.me.id ? ' gold' : ''), style: 'font-size:13px' }, (i + 1) + ' ' + p.name + (g.strikes[p.id] ? ' ' + '×'.repeat(g.strikes[p.id]) : ''))));
    return box;
  }
  function boomSound() { Sound.noise(0.9, 0.5, 120); Sound.noise(0.5, 0.35, 600, 0.05); Sound.tone(70, 0.6, 'sawtooth', 0.25); }

  /* 絵：自分が持っている時は大きな爆弾、持っていない時は座席の輪 */
  function drawBomb(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g) return;
    const cv = V.cv, x = cv.getContext('2d'), d = V.d, W = cv.width, H = cv.height, now = performance.now();
    const cs = getComputedStyle(document.documentElement);
    x.fillStyle = cs.getPropertyValue('--bg'); x.fillRect(0, 0, W, H);
    if (g.phase === 'boom') {
      const k = Math.min(1, (now - V.boomT) / 900);
      x.fillStyle = 'rgba(255,' + Math.round(140 + 100 * k) + ',40,' + (1 - k * 0.7) + ')'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283, r = (60 + k * 400) * d; x.fillStyle = i % 2 ? '#ffd23f' : '#ff6a2a'; x.beginPath(); x.arc(W / 2 + Math.cos(a) * r, H * 0.45 + Math.sin(a) * r, (18 - k * 14) * d, 0, 7); x.fill(); }
      return;
    }
    const mine = g.holder === ctx.me.id && V.sentSeq !== g.seq;
    const holdingShown = g.holder === ctx.me.id;
    if (holdingShown || (V.flyOut && now - V.flyOut.t < 450)) {
      // 大きな爆弾
      let bx = W / 2, by = H * 0.46;
      if (V.flyIn && now - V.flyIn.t < 350 && V.flyIn.dir) { const k = (now - V.flyIn.t) / 350; bx += V.flyIn.dir * W * (1 - k) * (1 - k); }
      if (V.flyOut && now - V.flyOut.t < 450) { const k = (now - V.flyOut.t) / 450; bx += V.flyOut.dir * W * k * k; by -= Math.sin(k * 3.14) * 60 * d; }
      const el = (now - (V.gotAt || now)) / 1000;
      const wob = mine ? Math.sin(now / 60) * Math.min(6, 1 + el * 0.4) * d : 0;
      drawBombBody(x, bx + wob, by, Math.min(W, H) * 0.2, now, d, V);
      // カチカチ（だんだん速く。でも本当の残り時間とは関係ない）
      if (mine && g.phase === 'play' && ctx.now() >= g.startAt) {
        const iv = Math.max(160, 700 - el * 25);
        if (now - V.tickAt > iv) { V.tickAt = now; Sound.tone(1200, 0.03, 'square', 0.06); }
      }
      // 数字タッチ
      if (mine && V.task && V.task.kind === 'tap' && !V.taskDone && V.task.pts) {
        V.task.pts.forEach((p, i) => {
          if (i + 1 < V.tapNext) return;
          const px = p.x * W, py = p.y * H, r = 34 * d;
          x.fillStyle = i + 1 === V.tapNext ? '#e3a20d' : 'rgba(227,162,13,.35)'; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
          x.fillStyle = '#1d1d1f'; x.font = '700 ' + 28 * d + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(i + 1, px, py);
        });
        if (!V.tapBound) {
          V.tapBound = true;
          ctx.listen(V.cv, 'pointerdown', e => {
            const g2 = ctx.g; if (!V.task || V.task.kind !== 'tap' || V.taskDone || !g2 || g2.holder !== ctx.me.id) return;
            const r = V.cv.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
            const hit = V.task.pts.findIndex(p => Math.hypot((p.x - px) * r.width, (p.y - py) * r.height) < 40);
            if (hit < 0) return;
            if (hit + 1 === V.tapNext) { V.tapNext++; Sound.pop(); if (V.tapNext > 3) doneTask(ctx); }
            else { Sound.buzz(); V.task.pts = layoutTap(); V.tapNext = 1; }
          });
        }
      }
      return;
    }
    // 座席の輪
    const n = g.players.length, cx = W / 2, cy = H * 0.47, R = Math.min(W, H) * 0.33;
    x.strokeStyle = cs.getPropertyValue('--line'); x.lineWidth = 2 * d; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    let hp = null;
    g.players.forEach((p, i) => {
      const a = -Math.PI / 2 + i / n * Math.PI * 2, px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
      const isMe = p.id === ctx.me.id, has = p.id === g.holder;
      x.fillStyle = has ? '#e0352b' : isMe ? '#e3a20d' : cs.getPropertyValue('--surface-2');
      x.beginPath(); x.arc(px, py, 22 * d, 0, 7); x.fill();
      x.fillStyle = has ? '#fff' : cs.getPropertyValue('--fg'); x.font = '700 ' + 14 * d + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(i + 1, px, py);
      x.fillStyle = cs.getPropertyValue('--fg'); x.font = '700 ' + 12 * d + 'px system-ui';
      x.fillText(p.name.slice(0, 6), px, py + 34 * d);
      if (has) hp = [px, py];
    });
    if (hp) {
      const k = Math.min(1, (now - (V.moveT || 0)) / 300);
      if (!V.bp || V.bpFor !== g.seq) { V.bpFrom = V.bp || hp; V.bpFor = g.seq; V.moveT = now; }
      const bx = V.bpFrom[0] + (hp[0] - V.bpFrom[0]) * k, by = V.bpFrom[1] + (hp[1] - V.bpFrom[1]) * k;
      V.bp = [bx, by];
      drawBombBody(x, bx + (cx - bx) * 0.28, by + (cy - by) * 0.28, 20 * d, now, d, V);
    }
  }
  function drawBombBody(x, bx, by, r, now, d, V) {
    // 導火線
    x.strokeStyle = '#8a6a3c'; x.lineWidth = Math.max(2, r * 0.08); x.lineCap = 'round';
    x.beginPath(); x.moveTo(bx + r * 0.45, by - r * 0.75); x.quadraticCurveTo(bx + r * 0.9, by - r * 1.3, bx + r * 0.7, by - r * 1.45); x.stroke();
    // 火花
    const sx = bx + r * 0.7, sy = by - r * 1.45;
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.283, l = r * (0.1 + Math.random() * 0.25); x.strokeStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff6a2a'; x.lineWidth = Math.max(1, r * 0.04); x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke(); }
    // 本体
    const gr = x.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
    gr.addColorStop(0, '#6b6f7a'); gr.addColorStop(0.35, '#2a2c33'); gr.addColorStop(1, '#0c0d10');
    x.fillStyle = gr; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
    x.fillStyle = '#3b3e47'; x.fillRect(bx + r * 0.25, by - r * 0.92, r * 0.42, r * 0.3);
    x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(bx - r * 0.38, by - r * 0.4, r * 0.18, r * 0.1, -0.6, 0, 7); x.fill();
  }

  function endBomb(ctx) {
    const g = ctx.g; g.phase = 'end';
    const rows = g.players.map(p => ({ id: p.id, s: g.strikes[p.id] })).sort((a, b) => a.s - b.s);
    rows.forEach((r, i) => { r.pos = i && r.s === rows[i - 1].s ? rows[i - 1].pos : i + 1; r.label = r.s ? '×' + r.s : '無傷！'; });
    const worst = rows.filter(r => r.s === rows[rows.length - 1].s).map(r => ctx.nameOf(r.id));
    ctx.finish({ title: rows[0].s === 0 ? rows.filter(r => r.s === 0).map(r => ctx.nameOf(r.id)).join('、') + ' は無傷！' : '爆弾リレー終了！', note: 'いちばん爆発させたのは ' + worst.join('、'), rows: rows.map(r => ({ id: r.id, pos: r.pos, label: r.label })) });
  }
})();
