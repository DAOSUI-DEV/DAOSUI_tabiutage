/* だるまさんがころんだ：
   ・鬼はボタンを1回押すごとに「だ・る・ま・さ・ん・が・こ・ろ・ん・だ」を1文字ずつ進める（速さは鬼しだい）。
   ・10文字目で鬼が振り向く。振り向いている間（2.5秒）にスマホが動いた人は、スタートにもどる。
   ・ほかの人はスマホを振って（または連打で）1歩ずつ進む。先に鬼のところまで着いた人の勝ち。
   ・振り向いたのを知ってから0.5秒だけは動いてもセーフ（通信の遅れと、止まるまでの時間）。 */
(() => {
  const CHANT = ['だ', 'る', 'ま', 'さ', 'ん', 'が', 'こ', 'ろ', 'ん', 'だ'];
  const LOOK_MS = 2500, GRACE_MS = 500, ROUND_MS = 120000;
  const STILL = 2.2;   // これより強い動き（m/s²）は「動いた」

  Party.register({
    id: 'daruma', title: 'だるまさんがころんだ', min: 3, max: 16, tags: ['振る', '鬼1人'],
    short: '鬼が振り向いた瞬間にスマホが動いたらスタートへ逆もどり',
    settings: [
      { k: 'move', label: '進み方', def: 'shake', opts: [['shake', 'スマホを振る'], ['tap', '画面を連打']], hint: 'センサーが使えない人は連打で進む' },
      { k: 'goal', label: '鬼までの距離', def: 40, opts: [[25, '近い'], [40, 'ふつう'], [60, '遠い']] },
      { k: 'rounds', label: '鬼の回数', def: 3, opts: [[1, '1回'], [3, '3回'], [0, '全員が1回ずつ']] }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>鬼が1人。鬼は大きなボタンを押すたびに「だ・る・ま・さ・ん・が・こ・ろ・ん・だ」が1文字ずつ進む。ゆっくりでも、一気に連打してもいい。</li>
<li>10文字目で鬼が振り向く。振り向いている2.5秒の間に<b>スマホが動いた人はスタートにもどる</b>。</li>
<li>ほかの人は、鬼が唱えている間にスマホを振って1歩ずつ進む（連打モードは画面をタップ）。みんなの画面にも唱えている文字が出る。</li>
<li>先に鬼のところまで着いた人の勝ち。2分たっても誰も着かなければ鬼の勝ち。</li>
<li>振り向いたのが画面に出てから0.5秒はセーフ。そのあとは、スマホをピタッと止めよう。</li>
</ul><h3>ポイント</h3><ul><li>着いた人 +3、鬼は1人つかまえるごとに +1、時間切れなら鬼 +3。合計で順位を決める。</li></ul>`,
    describe: m => ({ chant: '鬼が唱えた', turn: '鬼が振り向いた', step: '進んだ歩数', caught: '動いてつかまった' })[m.k] || '',

    hostInit(ctx, players, o) {
      const order = shuffle(players);
      const n = +o.rounds || order.length;
      const g = { players, onis: order.slice(0, n).map(p => p.id), round: 0, rounds: Math.min(n, order.length), goal: +o.goal, move: o.move, pts: {}, phase: 'count', seq: 0, caught: [] };
      players.forEach(p => { g.pts[p.id] = 0; });
      ctx.H.steps = {}; ctx.H.ep = {};
      startRound(ctx, g);
      return g;
    },
    hostInput(ctx, m) {
      const g = ctx.g, H = ctx.H; if (!g || g.phase === 'win' || g.phase === 'end') return;
      if (m.k === 'turn' && m.f === g.oni && g.phase === 'count' && ctx.now() >= g.startAt) {
        g.phase = 'look'; g.lookAt = ctx.now(); g.lookEnd = g.lookAt + LOOK_MS; g.caught = []; g.seq++;
        ctx.setG(g); return;
      }
      if (m.f === g.oni) return;
      if (m.k === 'step') {
        const e = +m.e || 0; if (e < (H.ep[m.f] || 0)) return;
        H.ep[m.f] = e; H.steps[m.f] = Math.max(0, Math.min(g.goal, +m.n || 0));
        if (H.steps[m.f] >= g.goal && g.phase === 'count') {
          g.phase = 'win'; g.winner = m.f; g.pts[m.f] += 3; g.seq++; g.endAt = ctx.now() + 3500;
          ctx.setG(g);
        }
      }
      if (m.k === 'caught' && g.phase === 'look' && !g.caught.includes(m.f)) {
        H.ep[m.f] = Math.max(H.ep[m.f] || 0, +m.e || 0); H.steps[m.f] = 0;
        g.caught.push(m.f); g.pts[g.oni] += 1; g.seq++;
        ctx.setG(g);
      }
    },
    hostTick(ctx) {
      const g = ctx.g, H = ctx.H, now = ctx.now(); if (!g) return;
      if (now - (H.posAt || 0) > 200 && (g.phase === 'count' || g.phase === 'look')) {
        H.posAt = now;
        const s = {}; g.players.forEach(p => { if (p.id !== g.oni) s[p.id] = H.steps[p.id] || 0; });
        ctx.fast({ k: 'pos', s }); if (H.view) H.view.pos = s;
      }
      if (g.phase === 'look' && now >= g.lookEnd) { g.phase = 'count'; g.seq++; g.caught = []; ctx.setG(g); }
      else if (g.phase === 'count' && now > g.roundEnd) { g.phase = 'win'; g.winner = g.oni; g.pts[g.oni] += 3; g.timeout = true; g.seq++; g.endAt = now + 3500; ctx.setG(g); }
      else if (g.phase === 'win' && now > g.endAt) {
        if (g.round >= g.rounds) return endDaruma(ctx);
        startRound(ctx, g); ctx.setG(g);
      }
    },

    mount(ctx, stage) {
      const V = ctx.H.view = { pos: {}, steps: 0, ep: 0, chant: -1, look: null, lastStep: 0, sentN: -1, sentAt: 0, level: 0, flash: 0 };
      const cv = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
      const top = h('div', { style: 'position:absolute;left:0;right:0;top:calc(var(--top) + 8px);display:flex;justify-content:center;gap:4px;padding:0 8px' });
      const ui = h('div', { style: 'position:absolute;left:0;right:0;bottom:0;padding:10px 14px calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:center' });
      stage.append(cv, top, ui);
      Object.assign(V, { cv, top, ui });
      CHANT.forEach(() => top.append(h('span', { style: 'width:30px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-size:20px;background:var(--surface-2);color:var(--muted)' })));
      const resize = () => { const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; V.d = d; V.topB = top.getBoundingClientRect().bottom * d; V.uiT = ui.getBoundingClientRect().top * d; };
      V.resize = resize;
      resize(); ctx.listen(window, 'resize', resize);
      // 進む
      const step = () => {
        const g = ctx.g; if (!g || g.oni === ctx.me.id || !inGame(ctx, g)) return;
        if (g.phase !== 'count' || ctx.now() < g.startAt) { if (V.look) checkMove(ctx, 99); return; }
        if (V.look) { checkMove(ctx, 99); return; }
        V.steps = Math.min(g.goal, V.steps + 1); V.lastStep = performance.now(); Sound.tone(300 + V.steps * 8, 0.04, 'triangle', 0.07);
      };
      ctx.shaker(() => { const g = ctx.g; if (g && g.move === 'shake' && Motion.ok) step(); }, { hi: 11, lo: 4.5, gap: 120 });
      ctx.listen(ui, 'pointerdown', e => {
        if (e.target.closest('button')) return;
        const g = ctx.g; if (!g || g.oni === ctx.me.id) return;
        e.preventDefault();
        if (g.move === 'tap' || !Motion.ok) step(); else if (V.look) checkMove(ctx, 99);
      });
      // 止まっているか見張る
      ctx.motion((type, e) => {
        if (type !== 'motion') return;
        const a = e.acceleration; if (!a || a.x == null) return;
        const m = Math.hypot(a.x, a.y, a.z);
        V.level = V.level * 0.8 + m * 0.2;
        if (V.look) checkMove(ctx, m);
      });
      // 歩数を幹事へ（5回/秒）
      ctx.every(200, () => {
        const g = ctx.g; if (!g || g.oni === ctx.me.id || !inGame(ctx, g)) return;
        if (V.steps !== V.sentN || performance.now() - V.sentAt > 1500) { V.sentN = V.steps; V.sentAt = performance.now(); ctx.send({ k: 'step', n: V.steps, e: V.ep }); }
      });
      ctx.raf(dt => drawField(ctx, dt));
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      if (V.round !== g.round) {
        V.round = g.round; V.steps = 0; V.ep = 0; V.chant = -1; V.look = null; V.sentN = -1; V.pos = {};
        if (ctx.now() < g.startAt) ctx.countdown(g.startAt);
        if (g.oni === ctx.me.id) toast('あなたが鬼！', 1800);
      }
      if (g.phase === 'look') {
        // 鬼の10文字目が先に届いていたら、その時から数える（早く知った方に合わせる）
        if (!V.look) V.look = { at: g.lookAt, start: performance.now(), end: g.lookEnd };
        else { V.look.at = g.lookAt; V.look.end = g.lookEnd; }
        V.chant = 9;
      } else if (V.look && (V.look.at || performance.now() - V.look.start > LOOK_MS + 2500)) { V.look = null; V.chant = -1; }
      if (g.phase === 'win' && V.winSeen !== g.seq) { V.winSeen = g.seq; Sound.fanfare(); }
      paintTop(ctx); paintUI(ctx);
      ctx.sub('鬼：' + ctx.nameOf(g.oni) + '（' + g.round + '/' + g.rounds + '）');
      if (g.move === 'shake' && !Motion.ok && !V.asked && g.oni !== ctx.me.id && inGame(ctx, g)) { V.asked = true; ctx.needSensor(() => paintUI(ctx)); }
    },
    onEvent(ctx, m) {
      const V = ctx.H.view, g = ctx.g; if (!V || !g || m.k !== 'chant' || m.f !== g.oni || m.r !== g.round) return;
      if (g.phase === 'look') return;
      V.chant = m.i;
      if (m.f !== ctx.me.id) Sound.tone(500 + m.i * 40, 0.06, 'sine', 0.1);
      if (m.i === 9 && !V.look) { V.look = { at: 0, start: performance.now(), end: ctx.now() + LOOK_MS }; Sound.tone(220, 0.3, 'square', 0.12); }
      paintTop(ctx); paintUI(ctx);
    },
    onFast(ctx, m) { const V = ctx.H.view; if (V && m.k === 'pos' && S && m.f === S.host) V.pos = m.s || {}; }
  });

  const inGame = (ctx, g) => g.players.some(p => p.id === ctx.me.id);
  function startRound(ctx, g) {
    g.round++; g.oni = g.onis[(g.round - 1) % g.onis.length]; g.phase = 'count'; g.winner = ''; g.timeout = false; g.caught = []; g.seq++;
    g.startAt = ctx.now() + 4000; g.roundEnd = g.startAt + ROUND_MS;
    ctx.H.steps = {}; ctx.H.ep = {};
  }
  /* 振り向き中に動いたか */
  function checkMove(ctx, m) {
    const V = ctx.H.view, g = ctx.g; if (!V.look || !g || g.oni === ctx.me.id || !inGame(ctx, g)) return;
    if (performance.now() - V.look.start < GRACE_MS) return;
    if (ctx.now() > V.look.end) return;
    if (m < STILL || V.look.caught) return;
    V.look.caught = true; V.ep++; V.steps = 0; V.flash = performance.now();
    ctx.send({ k: 'caught', e: V.ep }, true);
    Sound.buzz(); toast('動いた！スタートにもどる', 1800);
    paintUI(ctx);
  }
  function chant(ctx) {
    const V = ctx.H.view, g = ctx.g; if (!g || g.oni !== ctx.me.id || g.phase !== 'count' || ctx.now() < g.startAt || V.look) return;
    V.chant = Math.min(9, V.chant + 1);
    ctx.broadcast({ k: 'chant', i: V.chant, r: g.round });
    if (V.chant === 9) ctx.send({ k: 'turn' }, true);
    Sound.tone(500 + V.chant * 40, 0.08, 'sine', 0.14);
  }

  function paintTop(ctx) {
    const V = ctx.H.view;
    [...V.top.children].forEach((el, i) => {
      const on = i <= V.chant;
      el.textContent = CHANT[i];
      el.style.background = on ? (V.look ? '#e0352b' : 'var(--gold)') : 'var(--surface-2)';
      el.style.color = on ? (V.look ? '#fff' : 'var(--on-gold)') : 'var(--muted)';
      el.style.transform = i === V.chant && !V.look ? 'scale(1.15)' : 'none';
    });
  }
  function paintUI(ctx) {
    const V = ctx.H.view, g = ctx.g; if (!g) return;
    V.ui.textContent = '';
    if (g.phase === 'win') {
      add(V.ui, h('p', { class: 'st-big' }, g.timeout ? '時間切れ！鬼の勝ち' : ctx.nameOf(g.winner) + ' がタッチ！'), pts(ctx, g));
      requestAnimationFrame(V.resize); return;
    }
    if (g.oni === ctx.me.id) {
      const can = g.phase === 'count' && !V.look;
      add(V.ui, 
        h('p', { class: 'm0', style: 'font-weight:700' }, V.look ? '振り向いた！動いた人はスタートにもどる' : 'あなたが鬼。押すたびに1文字すすむ。10文字目で振り向く'),
        h('button', { class: 'btn big ' + (can ? 'gold' : ''), type: 'button', disabled: !can, style: 'min-height:120px;font-size:30px;font-family:var(--f-display)', onclick: () => chant(ctx) }, V.look ? '見てるぞ…' : V.chant < 0 ? 'だ' : V.chant < 9 ? CHANT[V.chant + 1] : 'だ'),
        g.caught.length ? h('p', { class: 'm0', style: 'color:#e0352b;font-weight:700' }, 'つかまえた：' + g.caught.map(id => ctx.nameOf(id)).join('、')) : null);
    } else if (!inGame(ctx, g)) {
      add(V.ui, h('p', { class: 'st-big' }, '観戦中'));
    } else {
      const tap = g.move === 'tap' || !Motion.ok;
      const looking = !!V.look;
      V.ui.style.background = looking ? 'rgba(224,53,43,.12)' : 'transparent';
      add(V.ui, 
        h('p', { class: 'st-big', style: 'color:' + (looking ? '#e0352b' : 'var(--fg)') }, looking ? '止まれ！' : tap ? 'ここを連打で進め！' : 'スマホを振って進め！'),
        h('p', { class: 'm0', style: 'font-weight:700' }, '鬼まであと ' + Math.max(0, g.goal - V.steps) + '歩' + (g.caught.includes(ctx.me.id) ? '（動いてスタートにもどった）' : '')),
        h('div', { style: 'height:' + (tap ? '110px' : '24px') + ';border-radius:16px;' + (tap ? 'border:2px dashed var(--gold);background:var(--gold-soft)' : '') }));
    }
    requestAnimationFrame(V.resize);
  }
  function pts(ctx, g) {
    const box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center' });
    g.players.forEach(p => box.append(h('span', { class: 'pill' + (p.id === ctx.me.id ? ' gold' : '') }, p.name + ' ' + g.pts[p.id] + '点')));
    return box;
  }

  /* 鬼が上、スタートが下。みんなが1列ずつのレーンを上がっていく */
  function drawField(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g || !V.topB) return;
    const cv = V.cv, x = cv.getContext('2d'), d = V.d, W = cv.width, now = performance.now();
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
    x.fillStyle = col('--bg'); x.fillRect(0, 0, W, cv.height);
    const y0 = V.topB + 70 * d, y1 = V.uiT - 30 * d; if (y1 - y0 < 40 * d) return;
    if (V.look) { x.fillStyle = 'rgba(224,53,43,' + (0.10 + 0.05 * Math.sin(now / 90)) + ')'; x.fillRect(0, 0, W, cv.height); }
    if (now - V.flash < 600) { x.fillStyle = 'rgba(224,53,43,.35)'; x.fillRect(0, 0, W, cv.height); }
    // 鬼
    const ox = W / 2, oy = V.topB + 38 * d;
    x.fillStyle = V.look ? '#e0352b' : col('--ai');
    x.beginPath(); x.arc(ox, oy, 24 * d, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = '700 ' + 13 * d + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('鬼', ox, oy);
    if (V.look) { x.fillStyle = '#fff'; x.beginPath(); x.arc(ox - 8 * d, oy - 6 * d, 3 * d, 0, 7); x.arc(ox + 8 * d, oy - 6 * d, 3 * d, 0, 7); x.fill(); }
    x.fillStyle = col('--fg'); x.font = '700 ' + 12 * d + 'px system-ui'; x.fillText(ctx.nameOf(g.oni).slice(0, 8), ox + 52 * d, oy);
    // ゴールとスタート
    x.strokeStyle = col('--line'); x.setLineDash([8 * d, 6 * d]); x.lineWidth = 2 * d;
    [y0, y1].forEach(yy => { x.beginPath(); x.moveTo(16 * d, yy); x.lineTo(W - 16 * d, yy); x.stroke(); });
    x.setLineDash([]);
    // 走る人
    const rs = g.players.filter(p => p.id !== g.oni), n = rs.length;
    rs.forEach((p, i) => {
      const lx = 44 * d + (W - 88 * d) * (n === 1 ? 0.5 : i / (n - 1));
      const isMe = p.id === ctx.me.id;
      const st = isMe ? V.steps : (V.pos[p.id] || 0);
      const k = Math.min(1, st / g.goal), yy = y1 - (y1 - y0) * k;
      const caught = g.caught.includes(p.id);
      x.strokeStyle = col('--surface-2'); x.lineWidth = 6 * d; x.beginPath(); x.moveTo(lx, y0); x.lineTo(lx, y1); x.stroke();
      x.fillStyle = caught ? '#e0352b' : isMe ? '#e3a20d' : col('--muted');
      const bob = isMe && now - V.lastStep < 150 ? -4 * d : 0;
      x.beginPath(); x.arc(lx, yy + bob, (isMe ? 13 : 10) * d, 0, 7); x.fill();
      x.fillStyle = col('--fg'); x.font = '700 ' + 10 * d + 'px system-ui';
      x.fillText(p.name.slice(0, 4), lx, y1 + 16 * d);
    });
    // 自分の止まり具合（振り向き中）
    if (V.look && g.oni !== ctx.me.id && inGame(ctx, g) && Motion.ok) {
      const lv = Math.min(1, V.level / (STILL * 1.5));
      x.fillStyle = col('--surface-2'); x.fillRect(16 * d, y1 + 26 * d, W - 32 * d, 8 * d);
      x.fillStyle = lv > 0.66 ? '#e0352b' : '#17804f'; x.fillRect(16 * d, y1 + 26 * d, (W - 32 * d) * lv, 8 * d);
    }
  }

  function endDaruma(ctx) {
    const g = ctx.g; g.phase = 'end';
    const rows = g.players.map(p => ({ id: p.id, s: g.pts[p.id] })).sort((a, b) => b.s - a.s);
    rows.forEach((r, i) => { r.pos = i && r.s === rows[i - 1].s ? rows[i - 1].pos : i + 1; r.label = r.s + '点'; });
    ctx.finish({ title: rows.filter(r => r.pos === 1).map(r => ctx.nameOf(r.id)).join('、') + ' の勝ち！', note: '鬼 ' + g.rounds + '回', rows: rows.map(r => ({ id: r.id, pos: r.pos, label: r.label })) });
  }
})();
