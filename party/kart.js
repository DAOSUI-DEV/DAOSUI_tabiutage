/* カートレース「旅宴グランプリ」
   ・画面：地面を1枚の大きな絵にして、WebGLで斜め後ろから見た3Dのように描く（昔のレースゲームと同じしくみ）。
   ・自分のカートは自分のスマホで計算（遅れゼロ）。ほかの人のカートは1秒に10回届く位置から、なめらかに先読みして描く。
   ・アイテムが当たったかどうかは「当てられた側」のスマホが判定する。順位はチェックポイントと時計あわせした時刻で決める。 */
(() => {
  const WS = 1600, TEX = 2048, TW = 92, KERB = 8;
  const VMAX = 128, VKERB = 96, VGRASS = 52, VWATER = 36, VBOOST = 165, ACC = 1.5, TURN = 1.85, DRIFT_TURN = 2.55;
  const CAM_D = 30, CAM_H = 12.5, PILLOW_V = 230;
  const PTS = [[300, 1300], [700, 1330], [1100, 1300], [1360, 1215], [1450, 1050], [1390, 900], [1210, 860], [1060, 780], [1150, 630], [1360, 530], [1420, 330], [1260, 200], [1000, 240], [700, 300], [450, 250], [250, 360], [210, 600], [380, 760], [560, 870], [470, 1030], [290, 1090], [200, 1210]];
  const POND = { x: 820, y: 620, rx: 170, ry: 110 };
  const KCOL = ['#e0352b', '#2563d9', '#17a34a', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  const ITEMS = { peel: { name: '枝豆の皮', short: '枝豆' }, pillow: { name: 'まくら投げ', short: 'まくら' }, steam: { name: '湯けむり', short: '湯けむり' }, dash: { name: '浴衣ダッシュ', short: 'ダッシュ' } };
  let TR = null;   // コース（最初に1回だけ作る）

  Party.register({
    id: 'kart', title: 'カートレース', min: 1, max: 8, tags: ['傾き', '横持ち'],
    short: 'スマホをハンドルにして温泉街サーキットを走る。アイテムで逆転',
    settings: [
      { k: 'laps', label: '周回', def: 3, opts: [[2, '2周'], [3, '3周'], [5, '5周']] },
      { k: 'items', label: 'アイテム', def: 'on', opts: [['on', 'あり'], ['off', 'なし']] }
    ],
    rules: `<h3>遊び方</h3><ul>
<li>スマホを<b>横向き</b>にして、ハンドルみたいに両手で持つ。左右に回すと曲がる。アクセルは自動。</li>
<li>スタート前の「3・2・1」の間にハンドルをまっすぐ持っておくと、それがまん中になる。</li>
<li>右下の「ドリフト」を押したままカーブを曲がると、きつく曲がれる。長く曲がってから離すと加速。</li>
<li>コースの「福袋」を取るとアイテムがもらえる。左下のボタンで使う。</li>
<li>芝生や温泉の池に入ると遅くなる。決めた周回を先に走りきった人の勝ち。1人ゴールしたら、ほかの人はあと25秒以内にゴールしないとリタイア。</li>
<li>センサーが使えない時は、画面の ◀ ▶ ボタンでハンドルを切る。</li>
</ul><h3>アイテム</h3><ul>
<li>枝豆の皮：うしろに置く。踏んだカートはスピン。</li>
<li>まくら投げ：まっすぐ前に飛ぶ。当たったカートはスピン。</li>
<li>湯けむり：自分より前を走っている全員の画面が、しばらく湯気でくもる。</li>
<li>浴衣ダッシュ：少しの間、すごく速くなる。</li>
</ul><h3>人数</h3><ul><li>1レース8人まで。9人目からは観戦（先頭のカートを追いかける画面）。</li></ul>`,
    describe: m => ({ fin: 'ゴールした', it: 'アイテムを使った', rm: 'アイテムに当たった', fx: '湯けむりを使った' })[m.k] || '',

    hostInit(ctx, players, o) {
      const order = shuffle(players);
      return { players: order, laps: +o.laps, items: o.items !== 'off', startAt: ctx.now() + 7000, fin: {}, endBy: 0, phase: 'race' };
    },
    hostInput(ctx, m) {
      const g = ctx.g; if (!g || g.phase !== 'race' || m.k !== 'fin' || g.fin[m.f] != null) return;
      if (!g.players.some(p => p.id === m.f)) return;
      g.fin[m.f] = Math.max(1000, Math.round(+m.t || 0));
      if (!g.endBy) g.endBy = ctx.now() + 25000;
      if (Object.keys(g.fin).length >= g.players.length) g.endBy = ctx.now() + 2500;
      ctx.setG(g);
    },
    hostTick(ctx) {
      const g = ctx.g; if (!g || g.phase !== 'race' || !g.endBy || ctx.now() < g.endBy) return;
      endKart(ctx);
    },

    mount(ctx, stage) {
      if (!TR) TR = buildTrack();
      const g = ctx.g;
      const V = ctx.H.view = { others: {}, items: new Map(), bagGone: {}, fx: [], steer: 0, steerTilt: 0, steerBtn: 0, phi0: null, drift: false, fog: 0, lastSend: 0, msg: '', msgAt: 0, sparks: [], shake: 0 };
      const gl = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
      const ov = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
      const ctl = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
      const rot = h('div', { style: 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(13,20,48,.82);color:#fff;text-align:center;padding:24px;z-index:7;font-weight:700' },
        h('div', { style: 'font-size:56px;line-height:1' }, '⟲'), h('p', { class: 'st-big', style: 'color:#fff' }, 'スマホを横にしてね'), h('p', { class: 'm0' }, 'ハンドルみたいに両手で持つと走りやすい'),
        h('button', { class: 'btn', type: 'button', style: 'pointer-events:auto', onclick: () => { V.portraitOk = true; rot.style.display = 'none'; } }, 'このまま縦で走る'));
      stage.append(gl, ov, ctl, rot);
      Object.assign(V, { glc: gl, ov, ctl, rot });
      V.gl = initGL(gl, TR.tex);
      // 自分のカート（グリッドの位置）
      const me = g.players.findIndex(p => p.id === ctx.me.id);
      V.racer = me >= 0;
      g.players.forEach((p, i) => {
        const s = gridSpot(i);
        if (p.id === ctx.me.id) V.K = { x: s.x, y: s.y, a: s.a, v: 0, idx: s.idx, lap: 0, passed: new Set([0, 1, 2, 3]), spin: 0, boost: 0, charge: 0, item: '', roll: 0, done: false, col: KCOL[i % 8] };
        else V.others[p.id] = { x: s.x, y: s.y, a: s.a, v: 0, t: 0, dx: s.x, dy: s.y, da: s.a, p: -TR.L, l: 0, col: KCOL[i % 8], name: p.name };
      });
      buildControls(ctx);
      const resize = () => {
        const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
        V.W = r.width; V.H = r.height; V.d = d;
        gl.width = Math.round(r.width * d); gl.height = Math.round(r.height * d);
        ov.width = gl.width; ov.height = gl.height;
        V.portrait = r.height > r.width;
        rot.style.display = V.portrait && V.racer && !V.portraitOk ? 'flex' : 'none';
      };
      resize(); ctx.listen(window, 'resize', resize);
      // ハンドル：スマホを回した角度（重力の向き）で曲がる
      ctx.motion((type, e) => {
        if (type !== 'motion') return;
        const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
        if (Math.hypot(a.x, a.y) < 3) return;
        const phi = Math.atan2(a.x, a.y);
        if (V.phi0 == null) V.phi0 = phi;
        let dlt = V.phi0 - phi; while (dlt > Math.PI) dlt -= 2 * Math.PI; while (dlt < -Math.PI) dlt += 2 * Math.PI;
        const s = dlt / (32 * Math.PI / 180);
        V.steerTilt = Math.abs(s) < 0.05 ? 0 : clamp(s, -1, 1);
      });
      ctx.raf((dt) => frame(ctx, dt));
      if (V.racer) ctx.countdown(g.startAt);
      // スタート前にハンドルのまん中を決め直す
      ctx.later(Math.max(0, g.startAt - ctx.now() - 1200), () => { V.phi0 = null; });
      if (V.racer && !Motion.ok) ctx.needSensor(() => { V.phi0 = null; });
    },
    onState(ctx, g) {
      const V = ctx.H.view; if (!V || !g) return;
      ctx.sub(V.racer ? '' : '観戦中');
    },
    onEvent(ctx, m) {
      const V = ctx.H.view; if (!V) return;
      if (m.k === 'it') { if (!V.items.has(m.id)) V.items.set(m.id, { t: m.t, x: m.x, y: m.y, a: m.a, t0: m.t0, by: m.f }); if (m.t === 'pillow' && m.f !== ctx.me.id) Sound.tone(500, 0.08, 'triangle', 0.08); }
      else if (m.k === 'rm') { V.items.delete(m.id); }
      else if (m.k === 'fx' && m.t === 'steam' && m.f !== ctx.me.id && V.K && progress(V.K) > m.p && !V.K.done) { V.fog = performance.now() + 3800; flash(V, ctx.nameOf(m.f) + ' の湯けむり！'); Sound.noise(0.6, 0.15, 400); }
    },
    onFast(ctx, m) {
      const V = ctx.H.view; if (!V || m.k !== 'kt') return;
      const o = V.others[m.f]; if (!o) return;
      if (m.t < o.t) return;
      Object.assign(o, { x: m.x, y: m.y, a: m.a, v: m.v, t: m.t, p: m.p, l: m.l, s: m.s, b: m.b, dr: m.d, done: m.dn });
      if (!o.seen) { o.seen = true; o.dx = m.x; o.dy = m.y; o.da = m.a; }
    }
  });

  /* ===== コース ===== */
  function buildTrack() {
    const n = PTS.length, raw = [];
    for (let i = 0; i < n; i++) {
      const p0 = PTS[(i - 1 + n) % n], p1 = PTS[i], p2 = PTS[(i + 1) % n], p3 = PTS[(i + 2) % n];
      for (let k = 0; k < 40; k++) {
        const t = k / 40, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const L = cum[cum.length - 1] + Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]);
    const N = 720, p = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const s = L * k / N;
      while (j < raw.length - 1 && cum[j + 1] < s) j++;
      const a = raw[j], b = raw[(j + 1) % raw.length], seg = (j + 1 < cum.length ? cum[j + 1] : L) - cum[j], u = seg ? (s - cum[j]) / seg : 0;
      p.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    const dir = p.map((q, i) => { const r = p[(i + 1) % N]; return Math.atan2(r[1] - q[1], r[0] - q[0]); });
    const T = { p, dir, N, L, seg: L / N };
    T.tex = paintTrack(T);
    T.mask = paintMask(T);
    T.deco = makeDeco(T);
    T.bags = [0.2, 0.47, 0.76].flatMap(f => { const i = Math.floor(f * N); return [-33, -11, 11, 33].map(off => offsetAt(T, i, off)); });
    return T;
  }
  function offsetAt(T, i, off) { const q = T.p[(i + T.N) % T.N], a = T.dir[(i + T.N) % T.N]; return { x: q[0] - Math.sin(a) * off, y: q[1] + Math.cos(a) * off, a }; }
  function gridSpot(i) { const idx = TR.N - 6 - Math.floor(i / 2) * 7, s = offsetAt(TR, idx, i % 2 ? 20 : -20); return { x: s.x, y: s.y, a: s.a, idx: (idx + TR.N) % TR.N }; }
  function trackPath(x, T, k) { x.beginPath(); T.p.forEach((q, i) => i ? x.lineTo(q[0] * k, q[1] * k) : x.moveTo(q[0] * k, q[1] * k)); x.closePath(); }
  function paintTrack(T) {
    const c = document.createElement('canvas'); c.width = c.height = TEX;
    const x = c.getContext('2d'), k = TEX / WS, R = rng('onsen-grass');
    x.fillStyle = '#5ea548'; x.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 14000; i++) { x.fillStyle = R() < 0.5 ? 'rgba(20,70,10,.10)' : 'rgba(255,255,190,.07)'; x.beginPath(); x.arc(R() * TEX, R() * TEX, 2 + R() * 9, 0, 7); x.fill(); }
    // 芝生のしま模様
    x.fillStyle = 'rgba(255,255,255,.035)'; for (let i = 0; i < TEX; i += 64) x.fillRect(i, 0, 32, TEX);
    // 温泉の池
    x.fillStyle = '#c9b48a'; x.beginPath(); x.ellipse(POND.x * k, POND.y * k, (POND.rx + 14) * k, (POND.ry + 14) * k, 0, 0, 7); x.fill();
    const pg = x.createRadialGradient(POND.x * k, POND.y * k, 10, POND.x * k, POND.y * k, POND.rx * k);
    pg.addColorStop(0, '#9fe3f2'); pg.addColorStop(1, '#4fb2d6');
    x.fillStyle = pg; x.beginPath(); x.ellipse(POND.x * k, POND.y * k, POND.rx * k, POND.ry * k, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(120,120,130,.9)';
    for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283; x.beginPath(); x.arc((POND.x + Math.cos(a) * (POND.rx + 8)) * k, (POND.y + Math.sin(a) * (POND.ry + 8)) * k, (5 + R() * 4) * k, 0, 7); x.fill(); }
    // 温泉マーク（湯気3本と丸）
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 6 * k; x.lineCap = 'round';
    x.beginPath(); x.ellipse(POND.x * k, (POND.y + 30) * k, 46 * k, 16 * k, 0, 0, 7); x.stroke();
    [-26, 0, 26].forEach(dx => { x.beginPath(); for (let t = 0; t <= 1; t += 0.05) { const yy = POND.y + 10 - t * 80, xx = POND.x + dx + Math.sin(t * 9) * 8; t ? x.lineTo(xx * k, yy * k) : x.moveTo(xx * k, yy * k); } x.stroke(); });
    // 砂（コースの外側に少し）
    x.lineJoin = 'round'; x.lineCap = 'round';
    trackPath(x, T, k); x.strokeStyle = 'rgba(214,196,150,.55)'; x.lineWidth = (TW + 46) * k; x.stroke();
    // 縁石・道路
    trackPath(x, T, k); x.strokeStyle = '#f4f4f4'; x.lineWidth = (TW + KERB * 2) * k; x.stroke();
    trackPath(x, T, k); x.strokeStyle = '#d6332a'; x.setLineDash([12 * k, 12 * k]); x.stroke(); x.setLineDash([]);
    trackPath(x, T, k); x.strokeStyle = '#5a5d66'; x.lineWidth = TW * k; x.stroke();
    for (let i = 0; i < 9000; i++) { const q = T.p[Math.floor(R() * T.N)], rr = (R() - 0.5) * TW; x.fillStyle = R() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.07)'; x.fillRect((q[0] + rr * 0.7 + (R() - 0.5) * 30) * k, (q[1] + rr * 0.7 + (R() - 0.5) * 30) * k, 2, 2); }
    trackPath(x, T, k); x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 2.2 * k; x.setLineDash([22 * k, 30 * k]); x.stroke(); x.setLineDash([]);
    // スタートライン（市松模様）
    const a = T.dir[0], q = T.p[0], cs = 7;
    for (let r = 0; r < 2; r++) for (let w = -TW / 2; w < TW / 2; w += cs) {
      const ox = q[0] + Math.cos(a) * (r * cs - cs) - Math.sin(a) * w, oy = q[1] + Math.sin(a) * (r * cs - cs) + Math.cos(a) * w;
      x.save(); x.translate(ox * k, oy * k); x.rotate(a); x.fillStyle = ((Math.round(w / cs) + r) % 2) ? '#111' : '#fff'; x.fillRect(0, 0, cs * k + 1, cs * k + 1); x.restore();
    }
    // スタート位置の白線
    for (let i = 0; i < 8; i++) { const s = gridSpotRaw(T, i); x.save(); x.translate(s.x * k, s.y * k); x.rotate(s.a); x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = 2 * k; x.strokeRect(-4 * k, -7 * k, 10 * k, 14 * k); x.restore(); }
    return c;
  }
  function gridSpotRaw(T, i) { const idx = T.N - 6 - Math.floor(i / 2) * 7; return offsetAt(T, idx, i % 2 ? 20 : -20); }
  function paintMask(T) {
    const M = 400, c = document.createElement('canvas'); c.width = c.height = M;
    const x = c.getContext('2d'), k = M / WS;
    x.fillStyle = '#000'; x.fillRect(0, 0, M, M);
    x.fillStyle = 'rgb(60,60,60)'; x.beginPath(); x.ellipse(POND.x * k, POND.y * k, POND.rx * k, POND.ry * k, 0, 0, 7); x.fill();
    x.lineJoin = 'round'; x.lineCap = 'round';
    trackPath(x, T, k); x.strokeStyle = 'rgb(128,128,128)'; x.lineWidth = (TW + KERB * 2 + 4) * k; x.stroke();
    trackPath(x, T, k); x.strokeStyle = '#fff'; x.lineWidth = TW * k; x.stroke();
    const d = x.getImageData(0, 0, M, M).data, out = new Uint8Array(M * M);
    for (let i = 0; i < M * M; i++) out[i] = d[i * 4];
    return { M, k, d: out };
  }
  function surfAt(px, py) {
    const m = TR.mask, ix = Math.floor(px * m.k), iy = Math.floor(py * m.k);
    if (ix < 0 || iy < 0 || ix >= m.M || iy >= m.M) return 'grass';
    const v = m.d[iy * m.M + ix];
    return v > 200 ? 'road' : v > 100 ? 'kerb' : v > 40 ? 'water' : 'grass';
  }
  function makeDeco(T) {
    const R = rng('onsen-deco'), out = [];
    // ちょうちん（スタート前後の直線）
    for (let i = -70; i <= 80; i += 10) { const sgn = [-1, 1]; sgn.forEach(sg => { const s = offsetAt(T, i, sg * (TW / 2 + 16)); out.push({ t: 'lantern', x: s.x, y: s.y, h: 15 }); }); }
    // スタートゲート
    const g0 = offsetAt(T, 0, -(TW / 2 + 6)), g1 = offsetAt(T, 0, TW / 2 + 6);
    out.push({ t: 'gate', x: (g0.x + g1.x) / 2, y: (g0.y + g1.y) / 2, h: 26, w: TW + 12 });
    // 木（コースから離れた所だけ）
    let tries = 0;
    while (out.filter(o => o.t === 'tree').length < 110 && tries++ < 4000) {
      const xx = 30 + R() * (WS - 60), yy = 30 + R() * (WS - 60);
      if (surfAt2(T, xx, yy) !== 'grass') continue;
      if (Math.hypot((xx - POND.x) / (POND.rx + 40), (yy - POND.y) / (POND.ry + 40)) < 1) continue;
      let near = 1e9; for (let i = 0; i < T.N; i += 4) { const q = T.p[i]; near = Math.min(near, Math.hypot(q[0] - xx, q[1] - yy)); }
      if (near < TW / 2 + 34) continue;
      out.push({ t: 'tree', x: xx, y: yy, h: 22 + R() * 14, kind: R() < 0.25 ? 'sakura' : 'pine' });
    }
    // 湯気
    for (let i = 0; i < 6; i++) out.push({ t: 'steam', x: POND.x + (R() - 0.5) * POND.rx, y: POND.y + (R() - 0.5) * POND.ry, h: 30, ph: R() * 6 });
    return out;
  }
  function surfAt2(T, px, py) { const m = T.mask, ix = Math.floor(px * m.k), iy = Math.floor(py * m.k); if (ix < 0 || iy < 0 || ix >= m.M || iy >= m.M) return 'grass'; const v = m.d[iy * m.M + ix]; return v > 200 ? 'road' : v > 100 ? 'kerb' : v > 40 ? 'water' : 'grass'; }

  /* ===== WebGL：地面を斜めから見た絵にする ===== */
  function initGL(cv, texCanvas) {
    let gl = null;
    try { gl = cv.getContext('webgl', { antialias: false, alpha: false }) || cv.getContext('experimental-webgl'); } catch (e) {}
    if (!gl) return null;
    const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    const fs = `precision highp float;
uniform sampler2D tex; uniform vec2 res; uniform vec2 cam; uniform vec2 fw; uniform float hgt; uniform float hor; uniform float foc; uniform float wsz;
void main(){
  float fy = res.y - gl_FragCoord.y;
  if (fy <= hor) { float k = fy / hor; gl_FragColor = vec4(mix(vec3(0.36,0.62,0.93), vec3(0.86,0.94,0.99), k), 1.0); return; }
  float z = hgt * foc / (fy - hor);
  float lx = (gl_FragCoord.x - res.x * 0.5) * z / foc;
  vec2 rt = vec2(-fw.y, fw.x);
  vec2 w = cam + fw * z + rt * lx;
  vec2 uv = w / wsz;
  vec3 c;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) c = vec3(0.37,0.65,0.28) * (0.92 + 0.08 * sin(w.x * 0.07) * sin(w.y * 0.05));
  else c = texture2D(tex, uv).rgb;
  float f = smoothstep(700.0, 2000.0, z);
  gl_FragColor = vec4(mix(c, vec3(0.80,0.90,0.97), f), 1.0);
}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      const u = n => gl.getUniformLocation(pr, n);
      return { gl, U: { res: u('res'), cam: u('cam'), fw: u('fw'), hgt: u('hgt'), hor: u('hor'), foc: u('foc'), wsz: u('wsz'), tex: u('tex') } };
    } catch (e) { console.warn(e); return null; }
  }

  /* ===== 操作ボタン ===== */
  function buildControls(ctx) {
    const V = ctx.H.view; if (!V.racer) return;
    const btn = (label, css) => h('button', { type: 'button', style: 'position:absolute;pointer-events:auto;border-radius:50%;border:3px solid rgba(255,255,255,.85);background:rgba(13,20,48,.45);color:#fff;font-weight:700;font-size:15px;touch-action:none;-webkit-user-select:none;user-select:none;' + css }, label);
    const B = 'bottom:calc(env(safe-area-inset-bottom,0px) + 14px);';
    V.bDrift = btn('ドリフト', B + 'right:max(14px,env(safe-area-inset-right,0px));width:96px;height:96px');
    V.bItem = btn('アイテム', B + 'left:max(14px,env(safe-area-inset-left,0px));width:84px;height:84px;font-size:13px');
    V.ctl.append(V.bDrift, V.bItem);
    const hold = (el, on, off) => {
      ctx.listen(el, 'pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} on(); el.style.background = 'rgba(227,162,13,.8)'; });
      const up = () => { off(); el.style.background = 'rgba(13,20,48,.45)'; };
      ctx.listen(el, 'pointerup', up); ctx.listen(el, 'pointercancel', up);
    };
    hold(V.bDrift, () => { V.drift = true; }, () => { V.drift = false; });
    hold(V.bItem, () => useItem(ctx), () => {});
    // センサーがない人のためのハンドルボタン
    V.bL = btn('◀', B + 'left:max(110px,calc(env(safe-area-inset-left,0px) + 110px));width:72px;height:72px;font-size:22px');
    V.bR = btn('▶', B + 'right:max(122px,calc(env(safe-area-inset-right,0px) + 122px));width:72px;height:72px;font-size:22px');
    V.ctl.append(V.bL, V.bR);
    hold(V.bL, () => { V.steerBtn = -1; }, () => { if (V.steerBtn < 0) V.steerBtn = 0; });
    hold(V.bR, () => { V.steerBtn = 1; }, () => { if (V.steerBtn > 0) V.steerBtn = 0; });
  }
  function useItem(ctx) {
    const V = ctx.H.view, K = V.K; if (!K || !K.item || K.roll > 0 || K.done) return;
    const it = K.item; K.item = '';
    const fx = Math.cos(K.a), fy = Math.sin(K.a), id = randomId(6);
    if (it === 'peel') { ctx.broadcast({ k: 'it', id, t: 'peel', x: +(K.x - fx * 12).toFixed(1), y: +(K.y - fy * 12).toFixed(1) }, true); Sound.pop(); }
    else if (it === 'pillow') { ctx.broadcast({ k: 'it', id, t: 'pillow', x: +(K.x + fx * 10).toFixed(1), y: +(K.y + fy * 10).toFixed(1), a: +K.a.toFixed(3), t0: ctx.now() }, true); Sound.tone(300, 0.15, 'sawtooth', 0.1); }
    else if (it === 'steam') { ctx.broadcast({ k: 'fx', t: 'steam', p: Math.round(progress(K)) }, true); Sound.noise(0.5, 0.15, 500); flash(V, '湯けむりを出した！'); }
    else if (it === 'dash') { K.boost = 1.7; Sound.tone(700, 0.25, 'square', 0.1); }
  }
  function flash(V, text) { V.msg = text; V.msgAt = performance.now(); }

  /* ===== 1コマ ===== */
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  /* 点と線分のきょり（コマ数が少なくても、すり抜けないように） */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function progress(K) { return (K.lap - 1) * TR.L + K.idx * TR.seg + (K.done ? 1e6 : 0); }
  function trackIdx(K) {
    let best = K.idx, bd = 1e12;
    for (let o = -25; o <= 45; o++) { const i = (K.idx + o + TR.N) % TR.N, q = TR.p[i], d = (q[0] - K.x) ** 2 + (q[1] - K.y) ** 2; if (d < bd) { bd = d; best = i; } }
    if (bd > 160 * 160) { for (let i = 0; i < TR.N; i++) { const q = TR.p[i], d = (q[0] - K.x) ** 2 + (q[1] - K.y) ** 2; if (d < bd) { bd = d; best = i; } } }
    const prev = K.idx; K.idx = best;
    if (prev > TR.N * 0.8 && best < TR.N * 0.2) { if (K.passed.size >= 4) { K.lap++; K.passed = new Set([0]); return true; } }
    else if (prev < TR.N * 0.2 && best > TR.N * 0.8) { if (K.lap > 0) { K.lap--; K.passed = new Set([0, 1, 2, 3]); } }
    K.passed.add(Math.floor(best / (TR.N / 4)));
    return false;
  }
  function rollItem(ctx, K) {
    const ranks = rankList(ctx), me = ranks.findIndex(r => r.me), n = ranks.length;
    const pos = n <= 1 ? 0.5 : me / (n - 1);
    const pool = pos < 0.25 ? ['peel', 'peel', 'pillow', 'dash'] : pos > 0.7 ? ['dash', 'dash', 'steam', 'steam', 'pillow'] : ['pillow', 'pillow', 'peel', 'dash', 'steam'];
    K.item = pick(pool); K.roll = 0.9;
  }
  function frame(ctx, dt) {
    const V = ctx.H.view, g = ctx.g; if (!V || !g) return;
    const now = ctx.now(), started = now >= g.startAt, K = V.K, pnow = performance.now();
    // 自分のカート
    if (K) {
      V.steer = V.steerBtn || (Motion.ok ? V.steerTilt : 0);
      if (V.auto) { const t = TR.p[(K.idx + 14) % TR.N]; V.steer = clamp(angDiff(Math.atan2(t[1] - K.y, t[0] - K.x), K.a) * 2, -1, 1); }
      // 実際にたった時間ぶんを、細かく区切って進める（画面のコマ数が少ない端末でも同じ速さ）
      K.px = K.x; K.py = K.y;
      const tnow = performance.now(), real = V.lastT ? Math.min(0.25, (tnow - V.lastT) / 1000) : dt; V.lastT = tnow;
      let rem = real;
      while (rem > 1e-4) {
        const hstep = Math.min(1 / 60, rem); rem -= hstep;
        if (started) drive(ctx, V, K, hstep);
        const lapped = trackIdx(K);
        if (lapped && K.lap > 1 && K.lap <= g.laps) { flash(V, 'ラップ ' + K.lap + '/' + g.laps + (K.lap === g.laps ? '　ファイナルラップ！' : '')); Sound.ding(); }
      }
      if (!K.done && K.lap > g.laps) {
        K.done = true; K.ft = now - g.startAt; K.item = '';
        ctx.send({ k: 'fin', t: Math.round(K.ft) }, true);
        flash(V, 'ゴール！'); Sound.fanfare();
      }
      // 10回/秒で自分の位置を送る
      if (pnow - V.lastSend > 100) {
        V.lastSend = pnow;
        ctx.fast({ k: 'kt', x: +K.x.toFixed(1), y: +K.y.toFixed(1), a: +K.a.toFixed(3), v: +K.v.toFixed(1), p: Math.round(progress(K)), l: K.lap, s: K.spin > 0 ? 1 : 0, b: K.boost > 0 ? 1 : 0, d: V.drift && K.charge > 0 ? 1 : 0, dn: K.done ? 1 : 0, t: Math.round(now) });
      }
      if (ctx.isHost) ctx.H.myProg = progress(K);
    }
    // ほかの人のカート（先読み＋なめらか）
    Object.values(V.others).forEach(o => {
      const age = o.t ? clamp((now - o.t) / 1000, 0, 0.5) : 0;
      const px = o.x + Math.cos(o.a) * o.v * age, py = o.y + Math.sin(o.a) * o.v * age;
      const k = Math.min(1, dt * 10);
      if (Math.hypot(px - o.dx, py - o.dy) > 80) { o.dx = px; o.dy = py; }
      o.dx += (px - o.dx) * k; o.dy += (py - o.dy) * k; o.da += angDiff(o.a, o.da) * k;
      // ぶつかったら自分だけはじく
      if (K && started && !K.done && o.seen) {
        const dx = K.x - o.dx, dy = K.y - o.dy, d = Math.hypot(dx, dy);
        if (d < 8 && d > 0.01) { K.x += dx / d * (8 - d); K.y += dy / d * (8 - d); if (!o.bump || pnow - o.bump > 400) { o.bump = pnow; K.v *= 0.8; V.shake = pnow; Sound.tone(120, 0.08, 'square', 0.12); } }
      }
    });
    // アイテム
    V.items.forEach((it, id) => {
      if (it.t === 'pillow') {
        const t = (now - it.t0) / 1000;
        if (t > 2.6) { V.items.delete(id); return; }
        it.cx = it.x + Math.cos(it.a) * PILLOW_V * t; it.cy = it.y + Math.sin(it.a) * PILLOW_V * t;
      } else { it.cx = it.x; it.cy = it.y; }
      if (K && started && !K.done && K.spin <= 0 && (it.t !== 'pillow' || it.by !== ctx.me.id)) {
        if (segDist(it.cx, it.cy, K.px, K.py, K.x, K.y) < (it.t === 'pillow' ? 8 : 6.5)) {
          V.items.delete(id); ctx.broadcast({ k: 'rm', id }, true);
          K.spin = it.t === 'pillow' ? 1.3 : 1.1; K.boost = 0; K.charge = 0;
          flash(V, it.t === 'pillow' ? 'まくらが当たった！' : '枝豆の皮でスリップ！'); Sound.buzz();
        }
      }
    });
    // 福袋
    if (K && g.items && started && !K.done) {
      TR.bags.forEach((b, i) => {
        if ((V.bagGone[i] || 0) > pnow) return;
        if (segDist(b.x, b.y, K.px, K.py, K.x, K.y) < 10) { V.bagGone[i] = pnow + 3500; if (!K.item) { rollItem(ctx, K); Sound.pop(); } }
      });
    }
    if (K && K.roll > 0) { K.roll -= dt; if (K.roll <= 0) Sound.ding(); }
    render(ctx, dt);
  }
  function drive(ctx, V, K, dt) {
    let st = V.steer;
    if (K.spin > 0) { K.spin -= dt; K.v *= Math.pow(0.25, dt); st = 0; }
    const surf = surfAt(K.x, K.y);
    let vmax = surf === 'road' ? VMAX : surf === 'kerb' ? VKERB : surf === 'water' ? VWATER : VGRASS;
    if (K.boost > 0) { K.boost -= dt; vmax = Math.max(vmax, VBOOST); }
    if (K.done) vmax = Math.min(vmax, 60);
    K.v += (vmax - K.v) * (K.v < vmax ? ACC : 2.4) * dt;
    const grip = Math.min(1, K.v / 35);
    const drifting = V.drift && K.v > 55 && Math.abs(st) > 0.25 && K.spin <= 0;
    K.a += (drifting ? DRIFT_TURN : TURN) * st * grip * dt;
    if (drifting) { K.charge += dt; if (Math.random() < 0.6) V.sparks.push({ t: performance.now(), c: K.charge > 1.6 ? '#ff8a2a' : K.charge > 0.8 ? '#4cc3ff' : '#ffffff', side: Math.sign(st) }); }
    else if (K.charge > 0) { if (K.charge > 0.8) { K.boost = Math.min(1.3, 0.45 + K.charge * 0.35); Sound.tone(880, 0.12, 'square', 0.08); } K.charge = 0; }
    const va = drifting ? K.a - st * 0.28 : K.a;
    K.x = clamp(K.x + Math.cos(va) * K.v * dt, 10, WS - 10); K.y = clamp(K.y + Math.sin(va) * K.v * dt, 10, WS - 10);
  }

  /* ===== 順位 ===== */
  function rankList(ctx) {
    const V = ctx.H.view, g = ctx.g, list = [];
    if (V.K) list.push({ id: ctx.me.id, me: true, p: progress(V.K), ft: V.K.done ? V.K.ft : null, col: V.K.col });
    Object.entries(V.others).forEach(([id, o]) => list.push({ id, me: false, p: o.p + (o.done ? 1e6 : 0), ft: g.fin[id] != null ? g.fin[id] : null, col: o.col }));
    list.sort((a, b) => {
      if (a.ft != null && b.ft != null) return a.ft - b.ft;
      if (a.ft != null) return -1;
      if (b.ft != null) return 1;
      return b.p - a.p;
    });
    return list;
  }
  const fmtT = ms => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };

  /* ===== 描画 ===== */
  function render(ctx, dt) {
    const V = ctx.H.view, g = ctx.g, d = V.d, W = V.W, H = V.H, pnow = performance.now();
    // カメラ：自分（観戦は先頭）の斜め後ろ
    let F = V.K;
    if (!F) { const r = rankList(ctx)[0]; const o = r && V.others[r.id]; F = o ? { x: o.dx, y: o.dy, a: o.da, spin: o.s ? 1 : 0 } : { x: TR.p[0][0], y: TR.p[0][1], a: TR.dir[0] }; }
    V.camA = V.camA == null ? F.a : V.camA + angDiff(F.a, V.camA) * Math.min(1, dt * 6);
    const shake = pnow - V.shake < 250 ? (Math.random() - 0.5) * 3 : 0;
    const fx = Math.cos(V.camA), fy = Math.sin(V.camA);
    const hor = H * (V.portrait ? 0.4 : 0.36), foc = Math.min(W * 0.95, H * (V.portrait ? 1.0 : 1.25));
    const cam = { x: F.x - fx * CAM_D, y: F.y - fy * CAM_D, fx, fy, h: CAM_H, hor: hor + shake, foc, W, H };
    // 地面
    const G = V.gl;
    if (G) {
      const gl = G.gl;
      gl.viewport(0, 0, V.glc.width, V.glc.height);
      gl.uniform2f(G.U.res, V.glc.width, V.glc.height); gl.uniform2f(G.U.cam, cam.x, cam.y); gl.uniform2f(G.U.fw, fx, fy);
      gl.uniform1f(G.U.hgt, CAM_H); gl.uniform1f(G.U.hor, cam.hor * d); gl.uniform1f(G.U.foc, foc * d); gl.uniform1f(G.U.wsz, WS); gl.uniform1i(G.U.tex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    const x = V.ov.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, V.ov.width, V.ov.height); x.setTransform(d, 0, 0, d, 0, 0);
    if (!G) fallback2D(x, V, F, W, H);
    else drawMountains(x, cam);
    // 立っている物を遠い順に
    const sprites = [];
    const add = (o, kind, extra) => { const p = proj(cam, o.x, o.y); if (p && p.z < 1300 && p.sx > -200 && p.sx < W + 200) sprites.push(Object.assign({ p, kind, o }, extra)); };
    if (G) TR.deco.forEach(o => add(o, o.t));
    TR.bags.forEach((b, i) => { if (!(g.items) || (V.bagGone[i] || 0) > pnow) return; add(b, 'bag', { i }); });
    V.items.forEach(it => add({ x: it.cx, y: it.cy }, it.t));
    Object.entries(V.others).forEach(([id, o]) => add({ x: o.dx, y: o.dy }, 'kart', { col: o.col, a: o.da, name: o.name, spin: o.s, boost: o.b, dr: o.dr }));
    if (V.K) add(V.K, 'kart', { col: V.K.col, a: V.K.a, me: true, spin: V.K.spin > 0, boost: V.K.boost > 0, dr: V.drift && V.K.charge > 0 });
    sprites.sort((a, b) => b.p.z - a.p.z);
    sprites.forEach(s => drawSprite(x, s, cam, pnow));
    // ドリフトの火花
    if (V.K) {
      const p = proj(cam, V.K.x, V.K.y);
      V.sparks = V.sparks.filter(s => pnow - s.t < 250);
      if (p) V.sparks.forEach(s => { const k = (pnow - s.t) / 250; x.fillStyle = s.c; x.globalAlpha = 1 - k; x.beginPath(); x.arc(p.sx - s.side * 4.5 * p.s + (Math.random() - 0.5) * 8, p.sy - k * 14, 3 + Math.random() * 3, 0, 7); x.fill(); });
      x.globalAlpha = 1;
    }
    // 湯けむり
    if (V.fog > pnow) {
      const k = Math.min(1, (V.fog - pnow) / 800);
      for (let i = 0; i < 9; i++) { const cx = W * ((i * 0.37 + pnow / 9000) % 1), cy = H * (0.25 + 0.55 * ((i * 0.61) % 1)); const gr = x.createRadialGradient(cx, cy, 10, cx, cy, W * 0.35); gr.addColorStop(0, 'rgba(255,255,255,' + 0.85 * k + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, W, H); }
    }
    drawHud(ctx, x, W, H, pnow);
  }
  function proj(cam, wx, wy) {
    const rx = wx - cam.x, ry = wy - cam.y, z = rx * cam.fx + ry * cam.fy;
    if (z < 3) return null;
    const lx = -rx * cam.fy + ry * cam.fx, s = cam.foc / z;
    return { z, sx: cam.W / 2 + lx * s, sy: cam.hor + cam.h * s, s };
  }
  function drawMountains(x, cam) {
    const W = cam.W, hor = cam.hor, base = Math.atan2(cam.fy, cam.fx);
    x.fillStyle = '#7f9fc2';
    x.beginPath(); x.moveTo(0, hor);
    for (let sx = 0; sx <= W; sx += 6) { const b = base + Math.atan((sx - W / 2) / cam.foc); const hh = 22 + 16 * Math.sin(b * 3) + 10 * Math.sin(b * 7 + 1) + 6 * Math.sin(b * 13 + 2); x.lineTo(sx, hor - hh); }
    x.lineTo(W, hor); x.closePath(); x.fill();
    x.fillStyle = '#5f86a8';
    x.beginPath(); x.moveTo(0, hor);
    for (let sx = 0; sx <= W; sx += 6) { const b = base + Math.atan((sx - W / 2) / cam.foc); const hh = 10 + 8 * Math.sin(b * 5 + 3) + 5 * Math.sin(b * 11); x.lineTo(sx, hor - hh); }
    x.lineTo(W, hor); x.closePath(); x.fill();
  }
  function drawSprite(x, sp, cam, pnow) {
    const { p, kind } = sp, s = p.s, X = p.sx, Y = p.sy;
    if (kind === 'tree') {
      const hh = sp.o.h * s, w = hh * 0.55;
      x.fillStyle = '#6b4a2b'; x.fillRect(X - w * 0.08, Y - hh * 0.3, w * 0.16, hh * 0.3);
      if (sp.o.kind === 'sakura') { x.fillStyle = '#f7b6cf'; x.beginPath(); x.arc(X, Y - hh * 0.62, w * 0.5, 0, 7); x.fill(); x.fillStyle = '#f39bbd'; x.beginPath(); x.arc(X - w * 0.2, Y - hh * 0.55, w * 0.3, 0, 7); x.fill(); }
      else { x.fillStyle = '#2f7a3a'; x.beginPath(); x.moveTo(X, Y - hh); x.lineTo(X + w / 2, Y - hh * 0.25); x.lineTo(X - w / 2, Y - hh * 0.25); x.closePath(); x.fill(); x.fillStyle = '#3d9149'; x.beginPath(); x.moveTo(X, Y - hh); x.lineTo(X + w * 0.32, Y - hh * 0.5); x.lineTo(X - w * 0.32, Y - hh * 0.5); x.closePath(); x.fill(); }
    } else if (kind === 'lantern') {
      const hh = sp.o.h * s, w = Math.max(1, s * 1.2);
      x.fillStyle = '#4a3a2a'; x.fillRect(X - w / 2, Y - hh, w, hh);
      x.fillStyle = '#e0352b'; x.beginPath(); x.ellipse(X, Y - hh * 0.92, s * 3.2, s * 4.2, 0, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,220,120,.6)'; x.beginPath(); x.ellipse(X, Y - hh * 0.92, s * 1.6, s * 3.2, 0, 0, 7); x.fill();
      x.fillStyle = '#222'; x.fillRect(X - s * 2, Y - hh * 0.92 - s * 4.4, s * 4, s * 0.9); x.fillRect(X - s * 2, Y - hh * 0.92 + s * 3.6, s * 4, s * 0.9);
    } else if (kind === 'gate') {
      const hh = sp.o.h * s, w = sp.o.w * s;
      x.fillStyle = '#3a2a1a'; x.fillRect(X - w / 2 - s * 1.5, Y - hh, s * 3, hh); x.fillRect(X + w / 2 - s * 1.5, Y - hh, s * 3, hh);
      x.fillStyle = '#c3352b'; x.fillRect(X - w / 2 - s * 3, Y - hh - s * 6, w + s * 6, s * 7);
      x.fillStyle = '#fff'; x.font = '400 ' + Math.max(8, s * 5) + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--f-display'); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('旅宴グランプリ', X, Y - hh - s * 2.5);
    } else if (kind === 'steam') {
      const t = pnow / 1000 + sp.o.ph;
      for (let i = 0; i < 3; i++) { const k = ((t * 0.4 + i / 3) % 1); x.fillStyle = 'rgba(255,255,255,' + (0.55 * (1 - k)) + ')'; x.beginPath(); x.arc(X + Math.sin(t + i) * s * 4, Y - k * sp.o.h * s, s * (4 + k * 6), 0, 7); x.fill(); }
    } else if (kind === 'bag') {
      const bob = Math.sin(pnow / 300 + sp.i) * s * 1.2, w = s * 7, hh = s * 7, yy = Y - s * 4 + bob;
      x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.ellipse(X, Y, w * 0.45, s * 1.2, 0, 0, 7); x.fill();
      x.fillStyle = '#d6332a'; x.beginPath(); x.moveTo(X - w * 0.45, yy); x.quadraticCurveTo(X - w * 0.55, yy - hh * 0.9, X - w * 0.2, yy - hh); x.lineTo(X + w * 0.2, yy - hh); x.quadraticCurveTo(X + w * 0.55, yy - hh * 0.9, X + w * 0.45, yy); x.closePath(); x.fill();
      x.fillStyle = '#f4c542'; x.fillRect(X - w * 0.25, yy - hh * 1.02, w * 0.5, hh * 0.12);
      x.fillStyle = '#fff'; x.font = '700 ' + Math.max(7, s * 4) + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('福', X, yy - hh * 0.45);
    } else if (kind === 'peel') {
      x.fillStyle = '#5aa83c'; x.beginPath(); x.ellipse(X, Y - s, s * 3.5, s * 1.4, -0.3, 0, 7); x.fill();
      x.fillStyle = '#7fcf5a'; [-1.6, 0, 1.6].forEach(o => { x.beginPath(); x.arc(X + o * s, Y - s * 1.2, s * 0.9, 0, 7); x.fill(); });
    } else if (kind === 'pillow') {
      const yy = Y - s * 4, w = s * 7, hh = s * 4.5;
      x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.ellipse(X, Y, w * 0.4, s, 0, 0, 7); x.fill();
      x.fillStyle = '#fbfbf7'; x.strokeStyle = '#2563d9'; x.lineWidth = Math.max(1, s * 0.6);
      x.beginPath(); x.roundRect ? x.roundRect(X - w / 2, yy - hh / 2, w, hh, s * 1.5) : x.rect(X - w / 2, yy - hh / 2, w, hh); x.fill(); x.stroke();
    } else if (kind === 'kart') drawKartSprite(x, sp, cam, pnow);
  }
  function drawKartSprite(x, sp, cam, pnow) {
    const { p } = sp, s = p.s, X = p.sx, Y = p.sy;
    const rel = angDiff(sp.a, Math.atan2(cam.fy, cam.fx));
    const side = Math.sin(rel), w = s * (7 + Math.abs(side) * 4), hh = s * 4.2;
    x.save(); x.translate(X, Y);
    if (sp.spin) x.rotate(Math.sin(pnow / 40) * 0.6);
    else if (sp.dr) x.rotate(-side * 0.12);
    // 影
    x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(0, 0, w * 0.55, s * 1.4, 0, 0, 7); x.fill();
    // ブースト
    if (sp.boost) { x.fillStyle = '#ffb02e'; x.beginPath(); x.moveTo(-w * 0.2, -hh * 0.35); x.lineTo(0, -hh * 0.35 + s * (3 + Math.random() * 3)); x.lineTo(w * 0.2, -hh * 0.35); x.fill(); }
    // タイヤ
    x.fillStyle = '#18181b';
    x.fillRect(-w * 0.5, -hh * 0.55, w * 0.22, hh * 0.55); x.fillRect(w * 0.28, -hh * 0.55, w * 0.22, hh * 0.55);
    // 車体
    x.fillStyle = sp.col; x.beginPath(); x.roundRect ? x.roundRect(-w * 0.36, -hh * 0.95, w * 0.72, hh * 0.7, s * 1.2) : x.rect(-w * 0.36, -hh * 0.95, w * 0.72, hh * 0.7); x.fill();
    x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(-w * 0.3, -hh * 0.9, w * 0.6, hh * 0.12);
    // うしろの羽
    x.fillStyle = '#222'; x.fillRect(-w * 0.4, -hh * 1.05, w * 0.8, hh * 0.14);
    // ヘルメット
    x.fillStyle = '#fff'; x.beginPath(); x.arc(side * w * 0.12, -hh * 1.32, s * 1.9, 0, 7); x.fill();
    x.fillStyle = sp.col; x.fillRect(side * w * 0.12 - s * 1.9, -hh * 1.4, s * 3.8, s * 0.8);
    x.restore();
    if (!sp.me && sp.name && p.z < 500) {
      x.font = '700 ' + 12 + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'bottom';
      const tw = x.measureText(sp.name).width + 10;
      x.fillStyle = 'rgba(13,20,48,.7)'; x.fillRect(X - tw / 2, Y - hh * 1.6 - 20, tw, 18);
      x.fillStyle = '#fff'; x.fillText(sp.name, X, Y - hh * 1.6 - 3);
    }
  }
  function fallback2D(x, V, F, W, H) {
    // WebGL が使えない時：真上から見た地図を回して表示
    const k = TEX / WS, z = 2.2;
    x.fillStyle = '#5ea548'; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H * 0.7); x.rotate(-F.a - Math.PI / 2); x.scale(z / k, z / k); x.drawImage(TR.tex, -F.x * k, -F.y * k); x.restore();
  }
  function drawHud(ctx, x, W, H, pnow) {
    const V = ctx.H.view, g = ctx.g, K = V.K, now = ctx.now();
    const top = document.body.classList.contains('playing') ? $('#hud').getBoundingClientRect().bottom + 6 : 8;
    const ranks = rankList(ctx), myRank = ranks.findIndex(r => r.me) + 1;
    const disp = getComputedStyle(document.documentElement).getPropertyValue('--f-display');
    x.textBaseline = 'top'; x.textAlign = 'left';
    const shadowText = (t, xx, yy, font, col) => { x.font = font; x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.55)'; x.strokeText(t, xx, yy); x.fillStyle = col || '#fff'; x.fillText(t, xx, yy); };
    const L = 14;
    if (K) {
      shadowText(String(myRank), L, top, '400 46px ' + disp, myRank === 1 ? '#ffd23f' : '#fff');
      shadowText('位 / ' + ranks.length, L + (myRank > 9 ? 56 : 30), top + 20, '700 15px system-ui');
      shadowText('ラップ ' + clamp(K.lap, 1, g.laps) + '/' + g.laps, L, top + 52, '700 15px system-ui');
      shadowText(fmtT(K.done ? K.ft : now - g.startAt), L, top + 72, '700 15px system-ui');
      // アイテム枠
      const cx = W / 2, cy = top + 28, r = 26;
      x.fillStyle = 'rgba(13,20,48,.55)'; x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.stroke();
      const it = K.roll > 0 ? pick(Object.keys(ITEMS)) : K.item;
      if (it) { x.font = '700 12px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(ITEMS[it].short, cx, cy); }
      V.bItem && (V.bItem.textContent = K.item && K.roll <= 0 ? ITEMS[K.item].short : 'アイテム');
      V.bItem && (V.bItem.style.opacity = K.item && K.roll <= 0 ? '1' : '.5');
      const noSensor = !Motion.ok;
      V.bL && (V.bL.style.display = noSensor ? 'block' : 'none'); V.bR && (V.bR.style.display = noSensor ? 'block' : 'none');
      // 速さ
      x.textAlign = 'right'; x.textBaseline = 'bottom';
      shadowText(Math.round(K.v * 1.1) + ' km/h', W - 126, H - 20, '700 14px system-ui');
    } else {
      x.textAlign = 'left';
      shadowText('観戦中：先頭を追いかけてる', L, top, '700 15px system-ui');
      ranks.slice(0, 8).forEach((r, i) => { x.fillStyle = r.col; x.beginPath(); x.arc(L + 6, top + 33 + i * 22, 6, 0, 7); x.fill(); shadowText((i + 1) + '位 ' + ctx.nameOf(r.id), L + 18, top + 25 + i * 22, '700 14px system-ui'); });
    }
    // ミニマップ
    const mm = 110, mx = W - mm - 12, my = top;
    x.fillStyle = 'rgba(13,20,48,.35)'; x.fillRect(mx - 4, my - 4, mm + 8, mm + 8);
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3; x.beginPath();
    TR.p.forEach((q, i) => { const px = mx + q[0] / WS * mm, py = my + q[1] / WS * mm; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.stroke();
    const dot = (wx, wy, c, r) => { x.fillStyle = c; x.beginPath(); x.arc(mx + wx / WS * mm, my + wy / WS * mm, r, 0, 7); x.fill(); };
    Object.values(V.others).forEach(o => dot(o.dx, o.dy, o.col, 3.5));
    if (K) { dot(K.x, K.y, '#fff', 5.5); dot(K.x, K.y, K.col, 4); }
    // メッセージ
    if (V.msg && pnow - V.msgAt < 1800) {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      shadowText(V.msg, W / 2, H * 0.3, '400 26px ' + disp, '#ffd23f');
    }
    if (K && K.done) {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      shadowText('ゴール！ ' + myRank + '位　' + fmtT(K.ft), W / 2, H * 0.42, '400 30px ' + disp, '#fff');
      if (g.endBy) shadowText('みんなのゴールを待ってる…（あと' + Math.max(0, Math.ceil((g.endBy - now) / 1000)) + '秒）', W / 2, H * 0.42 + 36, '700 14px system-ui');
    } else if (K && g.endBy) {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      shadowText('あと ' + Math.max(0, Math.ceil((g.endBy - now) / 1000)) + '秒でリタイア！', W / 2, top + 70, '700 16px system-ui', '#ff7466');
    }
  }

  function endKart(ctx) {
    const g = ctx.g, V = ctx.H.view; g.phase = 'end';
    const prog = id => id === ctx.me.id ? (ctx.H.myProg || -1e9) : (V && V.others[id] ? V.others[id].p : -1e9);
    const lapOf = id => id === ctx.me.id ? (V && V.K ? V.K.lap : 0) : (V && V.others[id] ? V.others[id].l : 0);
    const rows = g.players.map(p => ({ id: p.id, ft: g.fin[p.id], pr: prog(p.id) }));
    rows.sort((a, b) => (a.ft != null && b.ft != null) ? a.ft - b.ft : a.ft != null ? -1 : b.ft != null ? 1 : b.pr - a.pr);
    rows.forEach((r, i) => { r.pos = i + 1; r.label = r.ft != null ? fmtT(r.ft) : 'リタイア（ラップ' + clamp(lapOf(r.id), 1, g.laps) + '）'; });
    ctx.finish({ title: ctx.nameOf(rows[0].id) + ' が優勝！', note: '温泉街サーキット ' + g.laps + '周', rows: rows.map(r => ({ id: r.id, pos: r.pos, label: r.label })) });
  }
})();
