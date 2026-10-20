/* エアホッケー（1対1・勝ち抜き戦）
   ・パックは「今パックがある側のスマホ」が計算する（自分の陣地で打つ瞬間は通信の遅れゼロ）。
   ・センターラインを越えたら「位置・速さ・時刻」を相手に渡す。受け取った側は、遅れた時間ぶん先に進めてから続きを計算する。
   ・点数は幹事が数える。「2台をくっつけて1つの台」モードでは、パックが相手のスマホの画面へ飛んでいく。 */
(() => {
  const T = { L: 3.2, mid: 1.6, rP: 0.042, rM: 0.08, goalW: 0.38, maxV: 7.5, fr: 0.3, e: 0.9 };
  const COL = { me: '#e3a20d', foe: '#e0352b', a: '#2563d9', b: '#e0352b' };

  Party.register({
    id: 'hockey', title: 'エアホッケー', min: 2, max: 16, tags: ['1対1', '勝ち抜き'],
    short: '指でマレットを動かして打ち合う。2台をくっつけると1つの台になる',
    settings: [
      { k: 'view', label: '画面', def: 'full', opts: [['full', '1台で台全体'], ['join', '2台くっつけて1つの台']], hint: '2台モード：対戦する2人のスマホの上の端どうしをくっつけて机に置く。パックが相手の画面へ飛んでいく' },
      { k: 'target', label: '何点先取', def: 5, opts: [[3, '3点'], [5, '5点'], [7, '7点']] },
      { k: 'matches', label: '試合数', def: 0, opts: [[1, '1試合'], [3, '3試合'], [5, '5試合'], [0, '全員が1回は出る']], hint: '勝ち抜き戦：勝った人は残って、次の人が挑戦する' }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>1対1の勝ち抜き戦。勝った人は台に残って、次の人が挑戦する。対戦していない人は観戦（台とパックがリアルタイムで見える）。</li>
<li>自分の陣地の中で、指でマレット（打つ道具）を動かしてパックを打つ。相手のゴールに入れたら1点。</li>
<li>決めた点数を先に取った人の勝ち。点を取られた人のところからパックが始まる。</li>
</ul><h3>2台くっつけモード</h3><ul>
<li>対戦する2人は、スマホの<b>上の端どうし</b>をくっつけて、机に置く。2台で1つの台になって、パックが相手の画面へ飛んでいく。</li>
<li>このモードの時は、画面の上のメニューは隠れる。右下の「≡」でメニューが出る。</li>
</ul><h3>通信のしくみ</h3><ul><li>パックは「パックがある側」のスマホが計算するから、自分が打つ時に遅れは出ない。相手の陣地に入った瞬間に、位置と速さを相手に渡している。</li></ul>`,
    describe: m => ({ goal: 'ゴール', ho: 'パックを相手に渡した' })[m.k] || '',

    hostInit(ctx, players, o) {
      const order = players.map(p => p.id);
      const n = order.length;
      const g = { players, mode: o.view, target: +o.target, total: +o.matches || Math.max(1, n - 1), played: 0, wins: {}, diff: {}, queue: order.slice(2), phase: 'play', m: null };
      order.forEach(id => { g.wins[id] = 0; g.diff[id] = 0; });
      newMatch(ctx, g, order[0], order[1]);
      return g;
    },
    hostInput(ctx, m) {
      const g = ctx.g; if (!g || g.phase !== 'play' || m.k !== 'goal') return;
      const M = g.m; if (m.mid !== M.id || m.rs !== M.rs || ctx.now() < M.serveAt) return;
      if (m.f !== M.a && m.f !== M.b) return;
      const scorer = m.by === 'a' ? M.a : M.b, conceded = scorer === M.a ? M.b : M.a;
      if (scorer === m.f) return;   // ゴールは「入れられた側」のスマホが知らせる
      if (scorer === M.a) M.sa++; else M.sb++;
      g.diff[scorer]++; g.diff[conceded]--;
      M.last = scorer; M.rs++;
      if (M.sa >= g.target || M.sb >= g.target) {
        M.winner = scorer; g.wins[scorer]++; g.played++; g.phase = 'between'; g.nextAt = ctx.now() + 3500;
      } else { M.serve = conceded; M.serveAt = ctx.now() + 1800; }
      ctx.setG(g);
    },
    hostTick(ctx) {
      const g = ctx.g; if (!g || g.phase !== 'between' || ctx.now() < g.nextAt) return;
      if (g.played >= g.total) return endHockey(ctx);
      const M = g.m, champ = M.winner, loser = champ === M.a ? M.b : M.a;
      g.queue.push(loser);
      const next = g.queue.shift();
      g.phase = 'play';
      newMatch(ctx, g, champ, next);
      ctx.setG(g);
    },

    mount(ctx, stage) {
      const V = ctx.H.view = { P: null, own: '', s: 0, ml: { x: 0.5, y: 2.6, px: 0.5, py: 2.6, vx: 0, vy: 0 }, foe: { x: 0.5, y: 0.6, tx: 0.5, ty: 0.6, at: 0 }, lastPk: 0, lastSend: 0, lastMl: 0, mid: '', rs: -1, flash: 0, fx: [] };
      const cv = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;touch-action:none' });
      const menu = h('button', { type: 'button', 'aria-label': 'メニュー', style: 'position:absolute;right:max(10px,env(safe-area-inset-right,0px));bottom:calc(env(safe-area-inset-bottom,0px) + 10px);width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--surface);font-size:20px;display:none;z-index:6', onclick: () => $('#hudMenu').click() }, '≡');
      const info = h('div', { style: 'position:absolute;left:0;right:0;pointer-events:none;text-align:center;font-weight:700;z-index:4' });
      stage.append(cv, info, menu);
      Object.assign(V, { cv, menu, info });
      const resize = () => { const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; V.d = d; V.w = r.width; V.h = r.height; V.hudB = document.body.classList.contains('nohud') ? 0 : $('#hud').getBoundingClientRect().bottom; };
      V.resize = resize;
      resize(); ctx.listen(window, 'resize', resize);
      // 指でマレットを動かす
      let pid = null;
      const move = e => {
        const role = roleOf(ctx); if (!role) return;
        const p = fromScreen(ctx, e.clientX, e.clientY); if (!p) return;
        const lo = role === 'a' ? T.mid + T.rM : T.rM, hi = role === 'a' ? T.L - T.rM : T.mid - T.rM;
        V.ml.x = clamp(p.x, T.rM, 1 - T.rM); V.ml.y = clamp(p.y, lo, hi);
      };
      ctx.listen(cv, 'pointerdown', e => { if (pid !== null) return; pid = e.pointerId; try { cv.setPointerCapture(pid); } catch (_) {} move(e); e.preventDefault(); });
      ctx.listen(cv, 'pointermove', e => { if (e.pointerId === pid) { move(e); e.preventDefault(); } });
      const up = e => { if (e.pointerId === pid) pid = null; };
      ctx.listen(cv, 'pointerup', up); ctx.listen(cv, 'pointercancel', up);
      ctx.onCleanup(() => document.body.classList.remove('nohud'));
      ctx.raf((dt) => frame(ctx, dt));
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      const M = g.m, role = roleOf(ctx);
      document.body.classList.toggle('nohud', g.mode === 'join' && !!role && g.phase === 'play');
      V.menu.style.display = document.body.classList.contains('nohud') ? 'block' : 'none';
      requestAnimationFrame(V.resize);
      if (V.mid !== M.id || V.rs !== M.rs) {
        const newMatch = V.mid !== M.id;
        V.mid = M.id; V.rs = M.rs;
        // サーブ：点を取られた人の陣地のまん中から
        const sy = M.serve === M.a ? T.mid + 0.8 : T.mid - 0.8;
        V.P = { x: 0.5, y: sy, vx: 0, vy: 0 }; V.own = M.serve; V.s = M.rs * 1000; V.lastPk = performance.now();
        if (newMatch) { V.ml = role === 'b' ? { x: 0.5, y: 0.35, px: 0.5, py: 0.35, vx: 0, vy: 0 } : { x: 0.5, y: T.L - 0.35, px: 0.5, py: T.L - 0.35, vx: 0, vy: 0 }; if (role) toast('あなたの試合！' + (g.mode === 'join' && role ? 'スマホの上の端どうしをくっつけて置いてね' : ''), 2600); }
        else if (M.last) { V.flash = performance.now(); Sound.fanfare(); }
      }
      if (g.phase === 'between' && V.endSeen !== M.id) { V.endSeen = M.id; Sound.fanfare(); }
      paintInfo(ctx);
      ctx.sub(ctx.nameOf(M.a) + ' ' + M.sa + ' - ' + M.sb + ' ' + ctx.nameOf(M.b) + '　（' + (g.played + (g.phase === 'play' ? 1 : 0)) + '/' + g.total + '試合）');
    },
    onEvent(ctx, m) {
      const V = ctx.H.view, g = ctx.g; if (!V || !g || m.k !== 'ho' || m.mid !== V.mid || m.s <= V.s) return;
      // パックを受け取った（または観戦中に持ち主が変わった）
      V.s = m.s; V.own = m.o;
      V.P = { x: m.x, y: m.y, vx: m.vx, vy: m.vy };
      advance(V.P, Math.max(0, Math.min(0.5, (ctx.now() - m.t) / 1000)));
      V.lastPk = performance.now();
    },
    onFast(ctx, m) {
      const V = ctx.H.view, g = ctx.g; if (!V || !g || m.mid !== V.mid) return;
      if (m.k === 'pk') {
        if (m.s < V.s || m.f === ctx.me.id || V.own === ctx.me.id) return;
        V.s = m.s; V.own = m.f;
        V.P = { x: m.x, y: m.y, vx: m.vx, vy: m.vy };
        advance(V.P, Math.max(0, Math.min(0.4, (ctx.now() - m.t) / 1000)));
        V.lastPk = performance.now();
      } else if (m.k === 'ml') {
        const M = g.m;
        if (m.f === M.a) V.mlA = { x: m.x, y: m.y, at: performance.now() };
        if (m.f === M.b) V.mlB = { x: m.x, y: m.y, at: performance.now() };
      }
    }
  });

  function newMatch(ctx, g, a, b) {
    const id = randomId(4);
    g.m = { id, a, b, sa: 0, sb: 0, serve: b, serveAt: ctx.now() + 3500, rs: 1, last: '', winner: '' };
  }
  const roleOf = ctx => { const g = ctx.g; if (!g || !g.m || g.phase !== 'play') return ''; return g.m.a === ctx.me.id ? 'a' : g.m.b === ctx.me.id ? 'b' : ''; };

  /* パックを進める（マレットなし）：通信の遅れぶんを先に進める時と、相手側の予測に使う */
  function advance(P, sec) {
    let t = sec;
    while (t > 0) { const h = Math.min(0.01, t); t -= h; physics(P, h, null, () => {}); if (P.goal) break; }
  }
  function physics(P, dt, M, ev) {
    const sub = 3, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      P.x += P.vx * h; P.y += P.vy * h;
      if (P.x < T.rP) { P.x = T.rP; P.vx = Math.abs(P.vx) * T.e; ev('wall'); }
      if (P.x > 1 - T.rP) { P.x = 1 - T.rP; P.vx = -Math.abs(P.vx) * T.e; ev('wall'); }
      const mouth = Math.abs(P.x - 0.5) < T.goalW / 2 - T.rP * 0.5;
      if (!mouth) {
        if (P.y < T.rP) { P.y = T.rP; P.vy = Math.abs(P.vy) * T.e; ev('wall'); }
        if (P.y > T.L - T.rP) { P.y = T.L - T.rP; P.vy = -Math.abs(P.vy) * T.e; ev('wall'); }
      } else {
        if (P.y < -T.rP) { P.goal = 'b'; ev('goal'); return; }        // b のゴールに入った（a の得点）
        if (P.y > T.L + T.rP) { P.goal = 'a'; ev('goal'); return; }
      }
      if (M) {
        const k = (i + 1) / sub, mx = M.px + (M.x - M.px) * k, my = M.py + (M.y - M.py) * k;
        const dx = P.x - mx, dy = P.y - my, dist = Math.hypot(dx, dy), R = T.rP + T.rM;
        if (dist < R && dist > 1e-6) {
          const nx = dx / dist, ny = dy / dist;
          P.x = mx + nx * R; P.y = my + ny * R;
          const rvx = P.vx - M.vx, rvy = P.vy - M.vy, vn = rvx * nx + rvy * ny;
          if (vn < 0) { P.vx -= (1 + T.e) * vn * nx; P.vy -= (1 + T.e) * vn * ny; ev('hit', -vn); }
        }
      }
    }
    const f = Math.exp(-T.fr * dt); P.vx *= f; P.vy *= f;
    const sp = Math.hypot(P.vx, P.vy); if (sp > T.maxV) { P.vx *= T.maxV / sp; P.vy *= T.maxV / sp; }
  }

  /* 画面と台の座標：自分の陣地を手前（下）に。2台モードは自分の陣地だけを画面いっぱいに */
  function view(ctx) {
    const V = ctx.H.view, g = ctx.g, role = roleOf(ctx);
    const top = V.hudB + 8, W = V.w, H = V.h;
    if (g.mode === 'join' && role) {
      const s = W; return { s, ox: 0, oy: 0, half: true, flip: role === 'b', role };
    }
    const aw = W - 16, ah = H - top - 104;
    const s = Math.min(aw / 1, ah / T.L);
    return { s, ox: (W - s) / 2, oy: top + (ah - s * T.L) / 2, half: false, flip: role === 'b', role };
  }
  function toScreen(vw, x, y) {
    if (vw.half) {
      if (vw.flip) return [vw.ox + (1 - x) * vw.s, vw.oy + (T.mid - y) * vw.s];
      return [vw.ox + x * vw.s, vw.oy + (y - T.mid) * vw.s];
    }
    if (vw.flip) return [vw.ox + (1 - x) * vw.s, vw.oy + (T.L - y) * vw.s];
    return [vw.ox + x * vw.s, vw.oy + y * vw.s];
  }
  function fromScreen(ctx, cx, cy) {
    const vw = view(ctx), u = (cx - vw.ox) / vw.s, v = (cy - vw.oy) / vw.s;
    if (vw.half) return vw.flip ? { x: 1 - u, y: T.mid - v } : { x: u, y: v + T.mid };
    return vw.flip ? { x: 1 - u, y: T.L - v } : { x: u, y: v };
  }

  function frame(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g || !V.P || !g.m) return;
    const M = g.m, role = roleOf(ctx), me = ctx.me.id, now = performance.now();
    // 自分のマレットの速さ
    const m = V.ml; m.vx = m.vx * 0.5 + ((m.x - m.px) / Math.max(dt, 0.008)) * 0.5; m.vy = m.vy * 0.5 + ((m.y - m.py) / Math.max(dt, 0.008)) * 0.5;
    const live = g.phase === 'play' && ctx.now() >= M.serveAt;
    if (live && V.own === me && role) {
      // パックの持ち主：自分で計算
      physics(V.P, dt, m, (k, power) => {
        if (k === 'hit') { Sound.tone(220 + Math.min(power, 6) * 60, 0.05, 'triangle', 0.18); V.fx.push({ x: V.P.x, y: V.P.y, t: now }); }
        else if (k === 'wall') Sound.tone(160, 0.03, 'square', 0.05);
      });
      if (V.P.goal) {
        // 自分のゴールに入った（入れられた）
        const by = V.P.goal === 'a' ? 'b' : 'a';
        if ((by === 'a' && role === 'b') || (by === 'b' && role === 'a')) ctx.send({ k: 'goal', by, mid: M.id, rs: M.rs }, true);
        V.P = { x: 0.5, y: V.P.goal === 'a' ? T.L - 0.5 : 0.5, vx: 0, vy: 0 };
      } else {
        const crossed = role === 'a' ? V.P.y < T.mid : V.P.y > T.mid;
        if (crossed) {
          const o = role === 'a' ? M.b : M.a;
          V.s++; V.own = o;
          ctx.broadcast({ k: 'ho', mid: M.id, s: V.s, o, x: +V.P.x.toFixed(4), y: +V.P.y.toFixed(4), vx: +V.P.vx.toFixed(3), vy: +V.P.vy.toFixed(3), t: ctx.now() }, true);
          V.lastPk = now;
        } else if (now - V.lastSend > 50) {
          V.lastSend = now;
          ctx.fast({ k: 'pk', mid: M.id, s: V.s, x: +V.P.x.toFixed(4), y: +V.P.y.toFixed(4), vx: +V.P.vx.toFixed(3), vy: +V.P.vy.toFixed(3), t: ctx.now() });
        }
      }
    } else if (live) {
      // 相手が計算中：予測で動かす
      advance(V.P, dt);
      if (V.P.goal) { V.P.vx = 0; V.P.vy = 0; V.P.y = clamp(V.P.y, 0, T.L); delete V.P.goal; }
      // 持ち主から1.2秒なにも来ず、パックが自分の陣地なら引き取る
      if (role && now - V.lastPk > 1200 && (role === 'a' ? V.P.y > T.mid : V.P.y < T.mid)) {
        V.s++; V.own = me; V.lastPk = now;
        ctx.broadcast({ k: 'ho', mid: M.id, s: V.s, o: me, x: V.P.x, y: V.P.y, vx: V.P.vx, vy: V.P.vy, t: ctx.now() }, true);
      }
    }
    m.px = m.x; m.py = m.y;
    if (role && now - V.lastMl > 50) { V.lastMl = now; ctx.fast({ k: 'ml', mid: M.id, x: +m.x.toFixed(3), y: +m.y.toFixed(3) }); }
    draw(ctx, now);
  }

  function draw(ctx, now) {
    const V = ctx.H.view, g = ctx.g, M = g.m, role = roleOf(ctx), d = V.d;
    const cv = V.cv, x = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = col('--bg'); x.fillRect(0, 0, cv.width, cv.height);
    x.setTransform(d, 0, 0, d, 0, 0);
    const vw = view(ctx), S = (a, b) => toScreen(vw, a, b);
    // 台
    const ya = vw.half ? (vw.flip ? 0 : T.mid) : 0, yb = vw.half ? (vw.flip ? T.mid : T.L) : T.L;
    const [x0, y0] = S(0, ya), [x1, y1] = S(1, yb);
    const L = Math.min(x0, x1), Tp = Math.min(y0, y1), Wd = Math.abs(x1 - x0), Ht = Math.abs(y1 - y0);
    x.fillStyle = '#dff3fb'; x.strokeStyle = '#1d2d5c'; x.lineWidth = 5;
    x.beginPath(); x.roundRect ? x.roundRect(L, Tp, Wd, Ht, vw.half ? [0, 0, 18, 18] : 18) : x.rect(L, Tp, Wd, Ht); x.fill(); x.stroke();
    // 線
    x.strokeStyle = 'rgba(224,53,43,.55)'; x.lineWidth = 3;
    const [, cy] = S(0.5, T.mid); x.beginPath(); x.moveTo(L, cy); x.lineTo(L + Wd, cy); x.stroke();
    x.strokeStyle = 'rgba(37,99,217,.4)'; x.lineWidth = 2;
    const [ccx, ccy] = S(0.5, T.mid); x.beginPath(); x.arc(ccx, ccy, 0.18 * vw.s, 0, 7); x.stroke();
    x.save(); x.beginPath(); x.rect(L, Tp, Wd, Ht); x.clip();
    // ゴール
    [0, T.L].forEach(gy => {
      if (vw.half && gy === (vw.flip ? T.L : 0)) return;
      const [gx0, gyy] = S(0.5 - T.goalW / 2, gy), [gx1] = S(0.5 + T.goalW / 2, gy);
      x.fillStyle = '#1d2d5c'; x.fillRect(Math.min(gx0, gx1), gyy - 6, Math.abs(gx1 - gx0), 12);
      x.strokeStyle = 'rgba(37,99,217,.4)'; x.lineWidth = 2; x.beginPath(); x.arc((gx0 + gx1) / 2, gyy, 0.22 * vw.s, 0, 7); x.stroke();
    });
    // マレット
    const mal = (mx, my, c) => {
      const [sx, sy] = S(mx, my), r = T.rM * vw.s;
      x.fillStyle = c; x.beginPath(); x.arc(sx, sy, r, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(sx, sy, r * 0.55, 0, 7); x.fill();
      x.fillStyle = c; x.beginPath(); x.arc(sx, sy, r * 0.35, 0, 7); x.fill();
    };
    const fresh = o => o && now - o.at < 1000;
    if (role) {
      const foe = role === 'a' ? V.mlB : V.mlA;
      if (fresh(foe)) { V.foe.x += (foe.x - V.foe.x) * 0.4; V.foe.y += (foe.y - V.foe.y) * 0.4; mal(V.foe.x, V.foe.y, COL.foe); }
      mal(V.ml.x, V.ml.y, COL.me);
    } else {
      if (fresh(V.mlA)) mal(V.mlA.x, V.mlA.y, COL.a);
      if (fresh(V.mlB)) mal(V.mlB.x, V.mlB.y, COL.b);
    }
    // パック
    if (g.phase === 'play') {
      const [px, py] = S(V.P.x, V.P.y), r = T.rP * vw.s;
      x.fillStyle = '#1b1b1d'; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
      x.strokeStyle = '#555'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, r * 0.65, 0, 7); x.stroke();
    }
    V.fx = V.fx.filter(f => now - f.t < 250);
    V.fx.forEach(f => { const [fx, fy] = S(f.x, f.y), k = (now - f.t) / 250; x.strokeStyle = 'rgba(227,162,13,' + (1 - k) + ')'; x.lineWidth = 3; x.beginPath(); x.arc(fx, fy, (0.05 + k * 0.12) * vw.s, 0, 7); x.stroke(); });
    x.restore();
    // ゴールの光
    if (now - V.flash < 900) { x.fillStyle = 'rgba(227,162,13,' + (0.35 * (1 - (now - V.flash) / 900)) + ')'; x.fillRect(0, 0, V.w, V.h); }
    // サーブ前
    const wait = (M.serveAt - ctx.now()) / 1000;
    if (g.phase === 'play' && wait > 0) {
      x.fillStyle = col('--fg'); x.font = '400 ' + 40 + 'px ' + col('--f-display'); x.textAlign = 'center'; x.textBaseline = 'middle';
      const [sx, sy] = S(0.5, M.serve === M.a ? T.mid + 0.8 : T.mid - 0.8);
      x.fillText(Math.ceil(wait), sx, sy - 70);
    }
  }

  function paintInfo(ctx) {
    const V = ctx.H.view, g = ctx.g, M = g.m, role = roleOf(ctx);
    V.info.textContent = '';
    const vwJoin = g.mode === 'join' && role;
    V.info.style.top = ''; V.info.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + 14px)';
    if (g.phase === 'between') {
      V.info.style.top = '40%'; V.info.style.bottom = '';
      add(V.info, h('p', { class: 'st-big' }, ctx.nameOf(M.winner) + ' の勝ち！'), h('p', { class: 'm0' }, M.sa + ' - ' + M.sb + (g.played < g.total ? '　次の試合がもうすぐ始まるよ' : '')));
      return;
    }
    const mine = role === 'a' ? M.sa : M.sb, foe = role === 'a' ? M.sb : M.sa;
    if (role) add(V.info, h('div', { style: 'display:inline-flex;gap:14px;align-items:center;padding:6px 16px;border-radius:999px;background:var(--surface);border:1px solid var(--line)' },
      h('span', { style: 'color:' + COL.me }, 'あなた ' + mine), h('span', { class: 'muted' }, '-'), h('span', { style: 'color:' + COL.foe }, foe + ' ' + ctx.nameOf(role === 'a' ? M.b : M.a))));
    else add(V.info, h('div', { style: 'display:inline-flex;gap:14px;align-items:center;padding:6px 16px;border-radius:999px;background:var(--surface);border:1px solid var(--line)' },
      h('span', { style: 'color:' + COL.a }, ctx.nameOf(M.a) + ' ' + M.sa), h('span', { class: 'muted' }, '-'), h('span', { style: 'color:' + COL.b }, M.sb + ' ' + ctx.nameOf(M.b))),
      h('p', { class: 'm0 small muted', style: 'margin-top:4px' }, '観戦中（次は ' + (g.queue[0] ? ctx.nameOf(g.queue[0]) : '…') + ' が挑戦）'));
    if (vwJoin) V.info.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + 64px)';
  }

  function endHockey(ctx) {
    const g = ctx.g; g.phase = 'end';
    const rows = g.players.map(p => ({ id: p.id, w: g.wins[p.id], d: g.diff[p.id] })).sort((a, b) => b.w - a.w || b.d - a.d);
    rows.forEach((r, i) => { r.pos = i && r.w === rows[i - 1].w && r.d === rows[i - 1].d ? rows[i - 1].pos : i + 1; });
    ctx.finish({ title: ctx.nameOf(rows[0].id) + ' が最強！', note: g.total + '試合の勝ち抜き戦', rows: rows.map(r => ({ id: r.id, pos: r.pos, label: r.w + '勝', sub: '得失点 ' + (r.d > 0 ? '+' : '') + r.d })) });
  }
})();
