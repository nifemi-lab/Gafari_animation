(() => {
'use strict';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2, LEG = 72;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const t0 = performance.now();
const tNow = () => (performance.now() - t0) / 1000;

/* ---------- colours from CSS tokens ---------- */
const C = { ink: '#23104A', purple: '#6D28D9', red: '#E0348A', line: '#D9CCF5', lightbox: '#EBE3FF', cyan: '#38D9F0' };
function readColors() {
  const s = getComputedStyle(document.documentElement);
  for (const k of Object.keys(C)) { const v = s.getPropertyValue('--' + k).trim(); if (v) C[k] = v; }
}
function onTheme() { readColors(); if (T3) applyTheme3(); repaintAll(); if (reduce && W) drawStage(S.t); }
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------- the stick figure rig ----------
   Every angle is measured from "straight down", positive toward the way he faces. */
function basePose() {
  return { x: 0, dir: 1, lean: 0, head: 0, rot: 0, lift: 0, g: 1,
    armB: [.15, .3], armF: [-.12, .2], legB: [.07, .07], legF: [-.07, -.07] };
}
const DEF = { armB: [.15, .3], armF: [-.12, .2], legB: [.07, .07], legF: [-.07, -.07] };

function solve(p, sc, groundY) {
  const T = 56 * sc, N = 6 * sc, HR = 15 * sc, UA = 30 * sc, FA = 30 * sc, TH = 36 * sc, SH = 36 * sc;
  const dir = p.dir, rot = p.rot;
  const at = (o, ang, len) => { const A = ang + rot; return { x: o.x + Math.sin(A) * len * dir, y: o.y + Math.cos(A) * len }; };
  const hip = { x: 0, y: 0 }, UP = Math.PI - p.lean;
  const neck = at(hip, UP, T);
  const head = at(neck, UP - p.head, N + HR);
  const sh = at(hip, UP, T - 5 * sc);
  const arm = a => { const e = at(sh, a[0], UA); return [sh, e, at(e, a[1], FA)]; };
  const leg = a => { const k = at(hip, a[0], TH); return [hip, k, at(k, a[1], SH)]; };
  const aB = arm(p.armB), aF = arm(p.armF), lB = leg(p.legB), lF = leg(p.legF);
  const maxFoot = Math.max(lB[2].y, lF[2].y);
  const autoY = groundY - p.lift - maxFoot;
  const freeY = groundY - (TH + SH) - p.lift;
  const dy = freeY + (autoY - freeY) * p.g;
  const M = pt => ({ x: pt.x + p.x, y: pt.y + dy });
  return { hip: M(hip), neck: M(neck), head: M(head), HR, dir, sc,
    aB: aB.map(M), aF: aF.map(M), lB: lB.map(M), lF: lF.map(M) };
}

function drawFig(ctx, J, color, lw, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const l of [J.lB, J.lF, J.aB, J.aF]) { ctx.moveTo(l[0].x, l[0].y); ctx.lineTo(l[1].x, l[1].y); ctx.lineTo(l[2].x, l[2].y); }
  ctx.moveTo(J.hip.x, J.hip.y); ctx.lineTo(J.neck.x, J.neck.y);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(J.head.x, J.head.y, J.HR, 0, TAU); ctx.stroke();
  const ux = J.head.x - J.neck.x, uy = J.head.y - J.neck.y, ul = Math.hypot(ux, uy) || 1;
  const nx = ux / ul, ny = uy / ul;
  const ex = J.head.x + (-ny) * J.dir * J.HR * .45 + nx * J.HR * .15;
  const ey = J.head.y + nx * J.dir * J.HR * .45 + ny * J.HR * .15;
  ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.6, lw * .42), 0, TAU); ctx.fill();
  ctx.restore();
}

/* ---------- poses ---------- */
function walkPose(ph, run) {
  const A = run ? .95 : .5, K = run ? 1.55 : .85, ar = run ? .95 : .5, bend = run ? 1.5 : .35;
  const s = Math.sin(ph), c = Math.cos(ph);
  const leg = (s, c) => { const th = s * A; return [th, th - K * Math.max(0, c)]; };
  const arm = s => { const u = -s * ar; return [u, u + bend]; };
  return { lean: run ? .28 : .04, legF: leg(s, c), legB: leg(-s, -c), armF: arm(s), armB: arm(-s),
    lift: run ? 9 * Math.abs(Math.sin(ph)) : 0 };
}
function idlePose(t) {
  const b = reduce ? 0 : Math.sin(t * 2.2) * .03;
  return { lean: 0, head: reduce ? 0 : Math.sin(t * 1.1) * .03,
    armF: [-.14 + b, .12 + b], armB: [.16 - b, .3 - b], legF: [-.08, -.08], legB: [.08, .08] };
}
const jumpFn = o => u => {
  const a0 = o.a0, a1 = o.a1;
  let c;
  if (u < a0) c = ease(u / a0);
  else if (u < a0 + .1) c = 1 - ease((u - a0) / .1);
  else if (u < a1) c = 0;
  else if (u < a1 + .08) c = .8 * ease((u - a1) / .08);
  else c = .8 * (1 - ease((u - a1 - .08) / (1 - a1 - .08)));
  const air = u >= a0 && u <= a1;
  const w = air ? (u - a0) / (a1 - a0) : 0;
  const lift = air ? o.h * 4 * w * (1 - w) : 0;
  const tk = air ? Math.sin(Math.PI * w) : 0;
  const up = air ? Math.sqrt(Math.sin(Math.PI * w)) : 0;
  const rot = o.flip && air ? TAU * ease(w) : 0;
  const dx = o.dx ? (air ? o.dx * ease(w) : (u > a1 ? o.dx : 0)) : 0;
  return {
    lean: .25 * c, lift, rot, dx, g: air ? 1 - Math.sin(Math.PI * w) : 1,
    legF: [-.07 + 1.0 * c + o.tF[0] * tk, -.07 - .45 * c + o.tF[1] * tk],
    legB: [.07 + .85 * c + o.tB[0] * tk, .07 - .6 * c + o.tB[1] * tk],
    armF: [lerp(-.12 - .8 * c, o.aF[0], up), lerp(.2 - .6 * c, o.aF[1], up)],
    armB: [lerp(.15 - .8 * c, o.aB[0], up), lerp(.3 - .6 * c, o.aB[1], up)]
  };
};
const punchFn = u => {
  let sv;
  if (u < .25) sv = -ease(u / .25);
  else if (u < .37) sv = -1 + 2 * ease((u - .25) / .12);
  else if (u < .6) sv = 1;
  else sv = 1 - ease((u - .6) / .4);
  const cock = Math.max(0, -sv), ext = Math.max(0, sv), G = [1.2, 2.1];
  return { lean: .05 + .22 * ext, dx: 22 * ext, g: 1,
    armF: [lerp(lerp(G[0], -.5, cock), 1.57, ext), lerp(lerp(G[1], .3, cock), 1.57, ext)],
    armB: [1.05, 1.95], legF: [.75, .05], legB: [-.6, -.2] };
};
const danceFn = (u, t) => {
  const s = Math.sin(t * 9), k = t * 4.5;
  return { lean: .08 * Math.sin(k), head: .2 * Math.sin(k + 1),
    legF: [.55 * Math.max(0, s), -.15], legB: [.55 * Math.max(0, -s), -.15],
    armF: [2.3 + .5 * Math.sin(t * 9 + 1), 2.7 + .6 * Math.sin(t * 9 + 2)],
    armB: [1.9 + .5 * Math.sin(t * 9 + 3), 2.4 + .6 * Math.sin(t * 9 + .5)] };
};
const ACTIONS = {
  wave: { dur: 1.9, fn: u => {
    const r = Math.min(ease(u / .15), ease((1 - u) / .15));
    const w = Math.sin(u * 46) * .55 * r;
    return { armF: [lerp(-.12, 2.75, r), lerp(.2, 2.75, r) + w], head: .12 * r };
  } },
  jump: { dur: 1.0, fn: jumpFn({ a0: .2, a1: .75, h: 95, tF: [.7, -.2], tB: [.45, -.35], aF: [2.6, 2.7], aB: [2.25, 2.35] }) },
  backflip: { dur: 1.5, fn: jumpFn({ a0: .24, a1: .8, h: 105, flip: true, dx: -70, tF: [1.75, .3], tB: [1.5, .15], aF: [1.2, 2.3], aB: [1.0, 2.1] }) },
  punch: { dur: .9, fn: punchFn },
  dance: { dur: 2.6, fn: danceFn }
};

/* ---------- hero stage ---------- */
const stage = document.getElementById('stage');
const playhead = document.getElementById('playhead');
const frameNo = document.getElementById('frameNo');
const GL = (() => {
  try {
    if (!window.THREE) return false;
    const t = document.createElement('canvas');
    return !!(t.getContext('webgl') || t.getContext('experimental-webgl'));
  } catch (e) { return false; }
})();
const sctx = GL ? null : stage.getContext('2d');
let W = 0, H = 0, sc = 1, groundY = 0, stageVisible = true, lastF = -1, first = true, T3 = null;
let mx = 0, my = 0;

const S = { x: 0, dir: 1, ph: 0, running: false, target: null, act: null, entering: !reduce,
  last: 0, t: 0, ghost: [], gAcc: 0,
  cur: { lean: 0, head: 0, armB: [.15, .3], armF: [-.12, .2], legB: [.07, .07], legF: [-.07, -.07] } };

function fitStage() {
  const r = stage.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  if (!W || !H) return;
  sc = Math.max(.6, Math.min(H * (GL ? .44 : .53) / 164, W / 380));
  groundY = H - (GL ? 78 : 26);
  if (GL) {
    if (!T3) {
      try { T3 = initThree(); applyTheme3(); } catch (err) { console.error(err); return; }
    }
    resize3(d);
  } else {
    stage.width = Math.max(1, Math.round(W * d)); stage.height = Math.max(1, Math.round(H * d));
    sctx.setTransform(d, 0, 0, d, 0, 0);
  }
  if (first) {
    first = false;
    S.x = reduce ? W * .5 : -90;
    S.target = reduce ? null : W * .5;
  } else if (S.entering) {
    S.target = W * .5;
  } else {
    S.x = clamp(S.x, 36, Math.max(36, W - 36));
  }
  if (reduce) drawStage(S.t);
}

function startAct(name) {
  const a = ACTIONS[name]; if (!a) return;
  S.act = { name, t: 0, dur: a.dur, fn: a.fn, x0: S.x };
  S.target = null; S.entering = false; S.running = false;
}

function blend(c, t, k) {
  c.lean = lerp(c.lean, t.lean || 0, k);
  c.head = lerp(c.head, t.head || 0, k);
  for (const key of ['armB', 'armF', 'legB', 'legF']) {
    const tt = t[key] || DEF[key];
    c[key][0] = lerp(c[key][0], tt[0], k);
    c[key][1] = lerp(c[key][1], tt[1], k);
  }
}

function stageTick(now) {
  requestAnimationFrame(stageTick);
  const dt = Math.min(.05, (now - (S.last || now)) / 1000);
  S.last = now; S.t += dt;
  if (!stageVisible || !W) return;

  let tgt, ghostOn = false;
  if (S.act) { S.act.t += dt; if (S.act.t / S.act.dur >= 1) S.act = null; }

  if (S.act) {
    const p = S.act.fn(S.act.t / S.act.dur, S.act.t);
    tgt = p;
    S.x = clamp(S.act.x0 + (p.dx || 0) * sc * S.dir, 36, Math.max(36, W - 36));
    ghostOn = S.act.name !== 'wave';
  } else if (S.target != null && Math.abs(S.target - S.x) > 3) {
    const d = S.target - S.x; S.dir = d > 0 ? 1 : -1;
    if (!S.running && Math.abs(d) > 300 * sc) S.running = true;
    if (S.running && Math.abs(d) < 90 * sc) S.running = false;
    const v = (S.running ? 350 : 136) * sc;
    const step = Math.min(Math.abs(d), v * dt);
    S.x += S.dir * step;
    S.ph += step / ((S.running ? 150 : 138) * sc) * TAU;
    tgt = walkPose(S.ph, S.running);
    ghostOn = S.running;
  } else {
    if (S.target != null) {
      S.target = null; S.running = false;
      if (S.entering) { S.entering = false; startAct('wave'); }
    }
    tgt = idlePose(S.t);
  }

  blend(S.cur, tgt, 1 - Math.exp(-dt * (S.act ? 26 : 14)));
  drawStage(S.t, tgt, ghostOn, dt);
}

function drawStage(t, tgt, ghostOn, dt) {
  if (!W) return;
  tgt = tgt || idlePose(t);
  const pose = Object.assign({}, S.cur, {
    x: S.x, dir: S.dir, lift: (tgt.lift || 0) * sc, g: tgt.g == null ? 1 : tgt.g, rot: tgt.rot || 0
  });
  const J = solve(pose, sc, GL ? groundY - 4 * sc : groundY);
  if (ghostOn) {
    S.gAcc += dt || 0;
    if (S.gAcc > .07) { S.gAcc = 0; S.ghost.push({ J, born: S.t }); if (S.ghost.length > 6) S.ghost.shift(); }
  }
  S.ghost = S.ghost.filter(g => S.t - g.born < .4);

  if (GL) {
    if (T3) render3D(J, t);
  } else {
    const c = sctx;
    c.clearRect(0, 0, W, H);
    c.save();
    c.strokeStyle = C.ink; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath();
    for (let x = 0; x <= W; x += 20) {
      const y = groundY + Math.sin(x * .045) * 1.4 + Math.sin(x * .013 + 1) * 1.8;
      if (x) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
    c.globalAlpha = .3; c.lineWidth = 2; c.beginPath();
    for (let x = 30; x < W; x += 58) { const o = (x * 7) % 13; c.moveTo(x, groundY + 10 + o % 5); c.lineTo(x - 8, groundY + 18 + o % 5); }
    c.stroke();
    c.restore();
    const sh = Math.max(.35, 1 - pose.lift / (120 * sc));
    c.save(); c.globalAlpha = .14; c.fillStyle = C.ink;
    c.beginPath(); c.ellipse(S.x, groundY + 5, 38 * sc * sh, 6 * sc * sh, 0, 0, TAU); c.fill(); c.restore();
    for (const g of S.ghost) {
      const age = S.t - g.born;
      drawFig(c, g.J, C.purple, Math.max(3, 4.5 * sc), .3 * (1 - age / .4));
    }
    drawFig(c, J, C.ink, Math.max(3.5, 5.2 * sc));
  }

  const f = Math.round(clamp(S.x / W, 0, 1) * 4800);
  if (f !== lastF) { lastF = f; frameNo.textContent = 'frame ' + String(f).padStart(4, '0'); }
  playhead.style.left = (S.x / W * 100) + '%';
}

/* ---------- 3D stage (three.js) ---------- */
const CYL = window.THREE ? new THREE.CylinderGeometry(1, 1, 1, 14, 1) : null;
const SPH = window.THREE ? new THREE.SphereGeometry(1, 20, 14) : null;
const UPV = window.THREE ? new THREE.Vector3(0, 1, 0) : null;
const _d = window.THREE ? new THREE.Vector3() : null;

function canvasTex(w, h, fn) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  fn(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
}

function makeFigure(mat, shadow, eyeMat) {
  const g = new THREE.Group(), F = { g, segs: [], jts: [], eyes: [] };
  const add = (geo, arr) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; g.add(m); if (arr) arr.push(m); return m; };
  for (let i = 0; i < 10; i++) add(CYL, F.segs);
  for (let i = 0; i < 10; i++) add(SPH, F.jts);
  F.head = add(SPH, null);
  if (eyeMat) for (let i = 0; i < 2; i++) { const e = new THREE.Mesh(SPH, eyeMat); g.add(e); F.eyes.push(e); }
  return F;
}

function setSeg(m, p1, p2, r) {
  _d.subVectors(p2, p1);
  const len = _d.length() || 1e-3;
  m.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
  m.quaternion.setFromUnitVectors(UPV, _d.divideScalar(len));
  m.scale.set(r, len, r);
}

function poseFig(F, J, r) {
  const z = r * 2.6;
  const P = (p, zz) => new THREE.Vector3(p.x - W / 2, H / 2 - p.y, zz || 0);
  const hip = P(J.hip), neck = P(J.neck), head = P(J.head), sh = P(J.aB[0]);
  const kB = P(J.lB[1], -z * .7), fB = P(J.lB[2], -z * .7), kF = P(J.lF[1], z * .7), fF = P(J.lF[2], z * .7);
  const eB = P(J.aB[1], -z), hB = P(J.aB[2], -z), eF = P(J.aF[1], z), hF = P(J.aF[2], z);
  const s = F.segs;
  setSeg(s[0], hip, neck, r); setSeg(s[1], neck, head, r);
  setSeg(s[2], hip, kB, r); setSeg(s[3], kB, fB, r);
  setSeg(s[4], hip, kF, r); setSeg(s[5], kF, fF, r);
  setSeg(s[6], sh, eB, r); setSeg(s[7], eB, hB, r);
  setSeg(s[8], sh, eF, r); setSeg(s[9], eF, hF, r);
  const pts = [hip, sh, kB, kF, fB, fF, eB, eF, hB, hF];
  const rs = [1.05, 1.05, 1, 1, 1.25, 1.25, 1, 1, 1.2, 1.2];
  for (let i = 0; i < pts.length; i++) { F.jts[i].position.copy(pts[i]); F.jts[i].scale.setScalar(r * rs[i]); }
  F.head.position.copy(head); F.head.scale.setScalar(J.HR);
  if (F.eyes.length) {
    const ux = J.head.x - J.neck.x, uy = J.head.y - J.neck.y, ul = Math.hypot(ux, uy) || 1;
    const nx = ux / ul, ny = uy / ul, fx = -ny * J.dir, fy = nx * J.dir;
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1;
      F.eyes[i].position.set(head.x + (fx * .84 + nx * .17) * J.HR, head.y + (-fy * .84 - ny * .17) * J.HR, sg * J.HR * .5);
      F.eyes[i].scale.setScalar(J.HR * .17);
    }
  }
}

function buildProps(scene) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1035, roughness: .5, metalness: .2 });

  // clapperboard with a moving clapper arm
  const clap = new THREE.Group();
  const faceTex = canvasTex(512, 320, (c, w, h) => {
    c.fillStyle = '#1b1035'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f4efff'; c.font = '800 46px system-ui, Arial, sans-serif'; c.fillText('GAFARI', 28, 72);
    c.fillStyle = '#b9a9e0'; c.font = '600 30px system-ui, Arial, sans-serif'; c.fillText('ANIMATION', 28, 112);
    c.strokeStyle = '#38d9f0'; c.lineWidth = 4; c.beginPath(); c.moveTo(28, 138); c.lineTo(w - 28, 138); c.stroke();
    c.fillStyle = '#f4efff'; c.font = '600 28px system-ui, Arial, sans-serif';
    c.fillText('SCENE  01', 28, 196); c.fillText('TAKE  07', 28, 244); c.fillText('STICKMAN', 28, 292);
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(110, 70, 8),
    [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: faceTex, roughness: .6 }), dark]);
  body.position.set(0, -6, 0);
  const stripeTex = canvasTex(512, 80, (c, w, h) => {
    c.fillStyle = '#f4efff'; c.fillRect(0, 0, w, h); c.fillStyle = '#23104a';
    for (let x = -h; x < w + h; x += 64) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h * .6, 0); c.lineTo(x + h * .6, 0); c.closePath(); c.fill(); }
  });
  const pivot = new THREE.Group(); pivot.position.set(-55, 31, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(110, 14, 8.4),
    [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: stripeTex, roughness: .5 }), dark]);
  arm.position.set(55, 7, 0); pivot.add(arm);
  clap.add(body); clap.add(pivot);

  // film reel
  const reel = new THREE.Group(), spin = new THREE.Group(); reel.add(spin);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: .3, metalness: .55 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(46, 46, 9, 48), discMat); disc.rotation.x = Math.PI / 2; spin.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(46, 3.2, 12, 64), new THREE.MeshStandardMaterial({ color: 0xe9dfff, roughness: .25, metalness: .6 })); spin.add(rim);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 9.6, 24), dark);
    hole.rotation.x = Math.PI / 2; hole.position.set(Math.cos(a) * 27, Math.sin(a) * 27, 0); spin.add(hole);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 13, 24), new THREE.MeshStandardMaterial({ color: 0x38d9f0, roughness: .3, metalness: .3, emissive: 0x0b4a55 }));
  hub.rotation.x = Math.PI / 2; spin.add(hub);

  // pencil
  const pencil = new THREE.Group();
  const pm = (c, m, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? .45 : r, metalness: m || 0 });
  const pBody = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 80, 6), pm(0xe0348a)); pencil.add(pBody);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 8, 6), pm(0xd8d4e6, .8, .25)); ferrule.position.y = 44; pencil.add(ferrule);
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 10, 12), pm(0xff9ccc)); eraser.position.y = 53; pencil.add(eraser);
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 5, 14, 6), pm(0xf1c9a0)); wood.position.y = -47; pencil.add(wood);
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(.1, 1.4, 4, 6), pm(0x23104a)); lead.position.y = -56; pencil.add(lead);

  scene.add(clap); scene.add(reel); scene.add(pencil);
  const items = [
    { o: clap, fx: -.8, fy: .4, z: -150 },
    { o: reel, fx: .84, fy: .3, z: -190 },
    { o: pencil, fx: .6, fy: .66, z: -90 }
  ];
  function layout() {
    const dist = T3.dist, on = W >= 700, k = H / 380;
    for (const it of items) {
      const f = (dist - it.z) / dist;
      it.o.visible = on;
      it.o.position.set(it.fx * (W / 2) * f, it.fy * (H / 2) * f, it.z);
      it.o.scale.setScalar(k * f);
      it.o.userData.by = it.o.position.y; it.o.userData.k = k;
    }
  }
  function animate(t) {
    const T = 3.4, ph = t % T;
    let a;
    if (ph < 2.7) a = .62; else if (ph < 2.85) a = lerp(.62, 0, (ph - 2.7) / .15); else a = lerp(0, .62, ease((ph - 2.85) / .55));
    pivot.rotation.z = a;
    clap.rotation.set(Math.sin(t * .5) * .08, -.3 + Math.sin(t * .7) * .3, .06);
    clap.position.y = (clap.userData.by || 0) + Math.sin(t * 1.1) * 6 * (clap.userData.k || 1);
    reel.rotation.set(.3, -.5 + Math.sin(t * .4) * .2, 0);
    spin.rotation.z = -t * .9;
    reel.position.y = (reel.userData.by || 0) + Math.sin(t * .9 + 2) * 5 * (reel.userData.k || 1);
    pencil.rotation.set(0, t * .6, .9 + Math.sin(t * .6) * .1);
    pencil.position.y = (pencil.userData.by || 0) + Math.sin(t * 1.3 + 1) * 7 * (pencil.userData.k || 1);
  }
  return { layout, animate };
}

function initThree() {
  const renderer = new THREE.WebGLRenderer({ canvas: stage, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 4000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d6be8, .55));
  const key = new THREE.DirectionalLight(0xffffff, .95);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.radius = 4;
  scene.add(key); scene.add(key.target);
  const rim = new THREE.PointLight(0x38d9f0, .7, 0); scene.add(rim);
  const fill = new THREE.PointLight(0xe0348a, .35, 0); scene.add(fill);

  const matFig = new THREE.MeshPhysicalMaterial({ color: 0x23104a, roughness: .32, metalness: .1, clearcoat: .8, clearcoatRoughness: .25 });
  const matEye = new THREE.MeshBasicMaterial({ color: 0x38d9f0 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xebe3ff, roughness: .35, metalness: .05 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x38d9f0 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), slabMat); slab.receiveShadow = true; scene.add(slab);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), edgeMat); scene.add(edge);

  const main = makeFigure(matFig, true, matEye); scene.add(main.g);
  const ghosts = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x6d28d9, transparent: true, opacity: 0, depthWrite: false });
    const f = makeFigure(m, false, null); f.mat = m; f.g.visible = false; scene.add(f.g); ghosts.push(f);
  }
  const props = buildProps(scene);
  return { renderer, scene, camera, key, rim, fill, matFig, matEye, slabMat, edgeMat, slab, edge, main, ghosts, props, dist: 1000, cx: 0, cy: 0, gy: 0 };
}

function applyTheme3() {
  const T = T3; if (!T) return;
  T.matFig.color.set(C.ink);
  T.matEye.color.set(C.cyan);
  T.edgeMat.color.set(C.cyan);
  T.slabMat.color.set(C.lightbox).multiplyScalar(.8);
  for (const g of T.ghosts) g.mat.color.set(C.purple);
}

function resize3(d) {
  const T = T3;
  T.renderer.setPixelRatio(d);
  T.renderer.setSize(W, H, false);
  T.dist = (H / 2) / Math.tan(15 * Math.PI / 180);
  T.camera.aspect = W / H; T.camera.far = T.dist * 4; T.camera.updateProjectionMatrix();
  const gy = H / 2 - groundY; T.gy = gy;
  T.slab.scale.set(W * 1.3, 18, 300); T.slab.position.set(0, gy - 9, -40);
  T.edge.scale.set(W * 1.3, 3, 3); T.edge.position.set(0, gy - 4, 110.5);
  T.key.position.set(-W * .25, H * 1.1, 320); T.key.target.position.set(0, gy + 40, 0);
  const sh = T.key.shadow.camera;
  sh.left = -W * .65; sh.right = W * .65; sh.top = H * 1.2; sh.bottom = -H * .6; sh.near = 50; sh.far = H * 3;
  sh.updateProjectionMatrix();
  T.rim.position.set(W * .4, H * .5, -200); T.fill.position.set(-W * .4, H * .2, 250);
  T.props.layout();
}

function render3D(J, t) {
  const T = T3, r = Math.max(2.4, 3.1 * sc);
  poseFig(T.main, J, r);
  for (let i = 0; i < T.ghosts.length; i++) {
    const gh = S.ghost[i], G = T.ghosts[i];
    if (gh) { G.g.visible = true; poseFig(G, gh.J, r * .9); G.mat.opacity = Math.max(0, .3 * (1 - (S.t - gh.born) / .4)); }
    else G.g.visible = false;
  }
  T.props.animate(reduce ? 0 : t);
  T.cx = lerp(T.cx, reduce ? 0 : mx * H * .3, .06);
  T.cy = lerp(T.cy, reduce ? 0 : -my * H * .1, .06);
  T.camera.position.set(T.cx, H * .1 + T.cy, T.dist);
  T.camera.lookAt(0, -H * .03, 0);
  T.renderer.render(T.scene, T.camera);
}

if (!reduce) window.addEventListener('pointermove', e => { mx = e.clientX / window.innerWidth - .5; my = e.clientY / window.innerHeight - .5; }, { passive: true });

stage.addEventListener('pointerdown', e => {
  const r = stage.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (!S.act && Math.abs(x - S.x) < 45 * sc && y > groundY - 170 * sc && y < groundY + 10) { startAct('wave'); return; }
  S.entering = false;
  S.target = clamp(x, 36, Math.max(36, W - 36));
});
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => startAct(b.dataset.act)));
new ResizeObserver(fitStage).observe(stage);
new IntersectionObserver(es => { stageVisible = es[0].isIntersecting; }).observe(stage);
requestAnimationFrame(stageTick);

/* ---------- canvas helper for the small scenes ---------- */
const all = [];
const io = new IntersectionObserver(es => { for (const e of es) { const o = all.find(a => a.cv === e.target); if (o) o.vis = e.isIntersecting; } });
function bind(cv, draw, animated) {
  const o = { cv, draw, animated, c: cv.getContext('2d'), w: 0, h: 0, vis: false };
  o.paint = (t) => {
    if (!o.w) return;
    o.c.clearRect(0, 0, o.w, o.h);
    o.draw(o.c, o.w, o.h, t == null ? (reduce ? 1.3 : tNow()) : t);
  };
  const size = () => {
    const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    o.w = r.width; o.h = r.height;
    cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
    o.c.setTransform(d, 0, 0, d, 0, 0);
    o.paint();
  };
  all.push(o);
  new ResizeObserver(size).observe(cv);
  if (animated && !reduce) io.observe(cv);
  return o;
}
function repaintAll() { for (const o of all) o.paint(); }
function hline(c, y, w, alpha) {
  c.save(); c.strokeStyle = C.ink; c.globalAlpha = alpha == null ? 1 : alpha; c.lineWidth = 3; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.restore();
}
function figure(c, pose, s, groundY, color, lwScale) {
  pose.lift = (pose.lift || 0) * s;
  drawFig(c, solve(pose, s, groundY), color, Math.max(3, 5.2 * s * (lwScale || 1)));
}

/* ---------- work scenes ---------- */
const SCENES = {
  chase(c, w, h, t) {
    const gy = h * .82, s = h * .52 / 164;
    // skyline
    const bw = [70, 50, 90, 60, 80, 55], bh = [90, 140, 110, 170, 100, 130];
    const span = bw.reduce((a, b) => a + b + 30, 0);
    c.save(); c.strokeStyle = C.ink; c.globalAlpha = .2; c.lineWidth = 2;
    const off = -((t * 60) % span);
    for (let rep = 0; rep < 3; rep++) {
      let x = off + rep * span;
      for (let i = 0; i < bw.length; i++) { c.strokeRect(x, gy - bh[i] * (h / 300), bw[i], bh[i] * (h / 300)); x += bw[i] + 30; }
    }
    c.restore();
    hline(c, gy, w);
    c.save(); c.strokeStyle = C.ink; c.globalAlpha = .3; c.lineWidth = 2; c.lineCap = 'round'; c.beginPath();
    for (let x = -((t * 300) % 60); x < w; x += 60) { c.moveTo(x, gy + 14); c.lineTo(x + 26, gy + 14); }
    c.stroke(); c.restore();
    const chaser = Object.assign(basePose(), walkPose(t * 13 + 1.7, true), { x: w * .27 + Math.sin(t * 1.6) * 16 });
    figure(c, chaser, s, gy, C.red);
    const runner = Object.assign(basePose(), walkPose(t * 13, true), { x: w * .62 });
    figure(c, runner, s, gy, C.ink);
  },
  fall(c, w, h, t) {
    const s = h * .46 / 164;
    c.save(); c.strokeStyle = C.purple; c.globalAlpha = .4; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i < 16; i++) {
      const x = ((i * 137) % 100) / 100 * w, y = h - ((t * 420 + i * 61) % (h + 80)) + 20;
      c.moveTo(x, y); c.lineTo(x, y + 26 + (i % 3) * 8);
    }
    c.stroke(); c.restore();
    const hipY = h * .5 + Math.sin(t * 2.2) * 10;
    const p = Object.assign(basePose(), {
      x: w * .5, rot: 2.6 + Math.sin(t * 1.4) * .9, lean: .1, g: 0, lift: 0,
      armF: [2.4 + Math.sin(t * 9) * .6, 2.8 + Math.sin(t * 11) * .7],
      armB: [2.0 + Math.sin(t * 10 + 1) * .6, 2.5 + Math.sin(t * 8) * .7],
      legF: [.5 + Math.sin(t * 8) * .5, .3 + Math.sin(t * 7) * .4],
      legB: [-.4 + Math.sin(t * 7 + 2) * .5, -.2 + Math.sin(t * 9) * .4]
    });
    drawFig(c, solve(p, s, hipY + LEG * s), C.ink, Math.max(3, 5.2 * s));
  },
  duel(c, w, h, t) {
    const gy = h * .82, s = h * .5 / 164, T = 3.2, u = (t % T) / T;
    hline(c, gy, w);
    const guard = () => ({ lean: .06, g: 1, armF: [1.2, 2.1], armB: [1.05, 1.95], legF: [.75, .05], legB: [-.6, -.2] });
    const recoil = uu => {
      const r = uu > .3 && uu < .85 ? Math.sin(Math.PI * (uu - .3) / .55) : 0;
      return Object.assign(guard(), { lean: -.35 * r + .06 * (1 - r), head: -.3 * r, dx: -20 * r,
        armF: [lerp(1.2, .2, r), lerp(2.1, .5, r)], armB: [lerp(1.05, .4, r), lerp(1.95, .6, r)] });
    };
    const aAttacks = u < .5, uu = aAttacks ? u / .5 : (u - .5) / .5;
    const poseA = Object.assign(basePose(), aAttacks ? punchFn(uu) : recoil(uu));
    const poseB = Object.assign(basePose(), aAttacks ? recoil(uu) : punchFn(uu));
    poseA.dir = 1; poseB.dir = -1;
    poseA.x = w * .5 - 50 * s - 50 * s + (poseA.dx || 0) * s;
    poseB.x = w * .5 + 50 * s + 50 * s - (poseB.dx || 0) * s;
    // mug between them
    c.save(); c.strokeStyle = C.ink; c.lineWidth = 3; c.lineJoin = 'round';
    c.strokeRect(w * .5 - 11, gy - 26, 22, 24);
    c.beginPath(); c.arc(w * .5 + 11, gy - 14, 7, -Math.PI / 2, Math.PI / 2); c.stroke(); c.restore();
    const JA = solve(poseA, s, gy), JB = solve(poseB, s, gy);
    drawFig(c, JA, C.ink, Math.max(3, 5.2 * s));
    drawFig(c, JB, C.red, Math.max(3, 5.2 * s));
    if (uu > .36 && uu < .52) {
      const hand = (aAttacks ? JA : JB).aF[2], a = 1 - (uu - .36) / .16, dirn = aAttacks ? 1 : -1;
      c.save(); c.strokeStyle = C.red; c.globalAlpha = a; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = -Math.PI / 2 + i * (Math.PI / 5) - (dirn < 0 ? Math.PI : 0) * 0;
        const ax = Math.cos(ang) * dirn, ay = Math.sin(ang);
        c.moveTo(hand.x + dirn * 10 * s + ax * 10, hand.y + ay * 10);
        c.lineTo(hand.x + dirn * 10 * s + ax * 24, hand.y + ay * 24);
      }
      c.stroke(); c.restore();
    }
  },
  dance(c, w, h, t) {
    const gy = h * .82, s = h * .55 / 164;
    hline(c, gy, w);
    const bounce = Math.abs(Math.sin(t * 9)) * 5;
    for (let i = 0; i < 4; i++) {
      const ph = ((t * .55 + i * .25) % 1);
      const nx = w * (.22 + (i % 2) * .56) + Math.sin(ph * 6 + i) * 14;
      const ny = gy - 40 - ph * h * .5;
      const al = Math.sin(Math.PI * ph);
      const sz = Math.max(9, h * .05);
      c.save(); c.globalAlpha = al * .8; c.strokeStyle = C.purple; c.fillStyle = C.purple; c.lineWidth = 2.4; c.lineCap = 'round';
      c.beginPath(); c.ellipse(nx, ny, sz * .55, sz * .4, -.4, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(nx + sz * .5, ny - sz * .1); c.lineTo(nx + sz * .5, ny - sz * 1.6);
      c.quadraticCurveTo(nx + sz * 1.2, ny - sz * 1.3, nx + sz * .9, ny - sz * .6); c.stroke(); c.restore();
    }
    const p = Object.assign(basePose(), danceFn(0, t), { x: w * .5, lift: bounce / s * .3 });
    figure(c, p, s, gy, C.ink);
  }
};
document.querySelectorAll('canvas[data-scene]').forEach(cv => bind(cv, SCENES[cv.dataset.scene], true));

if (!reduce) {
  (function loop() {
    requestAnimationFrame(loop);
    const t = tNow();
    for (const o of all) if (o.animated && o.vis) o.paint(t);
  })();
}

/* ---------- process filmstrip ---------- */
const STEPS = [
  () => Object.assign(basePose(), { armF: [2.5, 3.7], armB: [.3, .5], head: .18, lean: .03 }),
  () => Object.assign(basePose(), { lean: .1, armF: [1.57, 1.6], armB: [-.4, -.1] }),
  () => Object.assign(basePose(), walkPose(1.05, false)),
  () => Object.assign(basePose(), walkPose(.95, true)),
  () => Object.assign(basePose(), { rot: 2.2, g: 0, lift: 34, legF: [1.6, .3], legB: [1.4, .1], armF: [1.2, 2.3], armB: [1, 2.1] }),
  () => Object.assign(basePose(), { lift: 14, armF: [2.7, 2.8], armB: [2.4, 2.5], legF: [.25, -.1], legB: [-.25, -.35] })
];
document.querySelectorAll('canvas[data-step]').forEach(cv => {
  const i = +cv.dataset.step;
  bind(cv, (c, w, h) => {
    const s = Math.min(h * .58 / 164, w / 200), gy = h - 24;
    hline(c, gy, w, .45);
    const p = STEPS[i](); p.x = w / 2;
    if (p.g === 0) {
      c.save(); c.globalAlpha = .12; c.fillStyle = C.ink;
      c.beginPath(); c.ellipse(w / 2, gy + 4, 26 * s, 4 * s, 0, 0, TAU); c.fill(); c.restore();
    }
    figure(c, p, s, gy, C.ink);
  }, false);
});

/* ---------- 3D tilt on the work cards ---------- */
if (!reduce && matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.transition = 'transform .08s';
      card.style.transform = 'perspective(900px) rotateY(' + (x * 9) + 'deg) rotateX(' + (-y * 9) + 'deg) translateZ(6px)';
    });
    card.addEventListener('pointerleave', () => { card.style.transition = 'transform .35s ease'; card.style.transform = ''; });
  });
}

/* ---------- nav and form ---------- */
const menuBtn = document.querySelector('.menu-btn'), menu = document.getElementById('menu');
menuBtn.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
menu.addEventListener('click', e => {
  if (e.target.closest('a')) { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
});

const form = document.getElementById('brief'), note = document.getElementById('formNote');
const MAIL = 'ogiehenifemi@gmail.com';
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const d = new FormData(form);
  const subject = encodeURIComponent('New animation project: ' + d.get('type'));
  const body = encodeURIComponent('Name: ' + d.get('name') + '\nEmail: ' + d.get('email') + '\nProject: ' + d.get('type') + '\n\n' + d.get('message'));
  const a = document.createElement('a');
  a.href = 'mailto:' + MAIL + '?subject=' + subject + '&body=' + body;
  a.click();
  note.innerHTML = 'Your email app should open with the brief filled in. If it does not, write to <a href="mailto:' + MAIL + '">' + MAIL + '</a>.';
});
/* ---------- 10-second anime fight ---------- */
(function () {
  const cv = document.getElementById('fight');
  if (!cv) return;
  const c = cv.getContext('2d');
  const btn = document.getElementById('fightPlay');
  const scrub = document.getElementById('fightScrub');
  const timeEl = document.getElementById('fightTime');
  const DUR = 10, SP = -6.283, CYN = '#5CE8FF', PNK = '#FF5FA8';
  let fw = 0, fh = 0, fs = 1, fg = 0, dpr = 1;
  const hsh = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const EASE = { lin: p => p, io: p => p * p * (3 - 2 * p), out: p => 1 - Math.pow(1 - p, 3), in: p => p * p * p, snap: p => 1 - Math.pow(1 - p, 6) };
  const smooth = (t, a, b) => ease(clamp((t - a) / (b - a), 0, 1));

  /* poses: angles from straight down, positive toward the way he faces */
  const P = {
    guard:   { lean: .06, head: 0,  armF: [1.2, 2.1],  armB: [1.05, 1.95], legF: [.75, .05],  legB: [-.6, -.2] },
    crouch:  { lean: .32, head: .1, armF: [-.9, -.5],  armB: [-.7, -.4],   legF: [1.0, -.5],  legB: [.85, -.6] },
    dash:    { lean: .55, head: .1, armF: [-1.0, -.6], armB: [-.8, -.5],   legF: [1.05, .25], legB: [-1.0, -1.35] },
    punch:   { lean: .3,  head: 0,  armF: [1.57, 1.57], armB: [-.6, -.2],  legF: [.95, .1],   legB: [-.75, -.35] },
    block:   { lean: -.1, head: .05, armF: [1.7, 2.6], armB: [1.5, 2.7],   legF: [.5, .2],    legB: [-.7, -.4] },
    hit:     { lean: -.45, head: -.35, armF: [.9, .5], armB: [-.7, -.4],   legF: [.25, .5],   legB: [-.4, -.1] },
    kick:    { lean: -.3, head: -.05, armF: [-.7, .1], armB: [1.0, 1.6],   legF: [1.65, 1.6], legB: [-.15, -.15] },
    air:     { lean: .1,  head: 0,  armF: [1.4, 1.9],  armB: [.9, 1.6],    legF: [.8, .1],    legB: [.3, -.6] },
    airpunch:{ lean: .25, head: 0,  armF: [1.57, 1.57], armB: [.6, 1.5],   legF: [.9, .2],    legB: [.2, -.7] },
    airkick: { lean: -.2, head: 0,  armF: [.4, 1.4],   armB: [-.6, .2],    legF: [1.6, 1.55], legB: [.3, -.6] },
    fall:    { lean: -.3, head: -.4, armF: [2.3, 2.7], armB: [2.0, 2.4],   legF: [.8, .4],    legB: [.5, .1] },
    power:   { lean: .05, head: .1, armF: [.5, .5],    armB: [-.4, -.4],   legF: [.8, .05],   legB: [-.75, -.15] },
    lie:     { lean: 0,   head: 0,  armF: [.3, .3],    armB: [-.3, -.3],   legF: [.1, .1],    legB: [-.1, -.1] },
    victory: { lean: -.05, head: .1, armF: [2.6, 2.7], armB: [.5, .6],     legF: [.12, .12],  legB: [-.12, -.12] },
    stand:   { lean: 0,   head: 0,  armF: [-.12, .2],  armB: [.15, .3],    legF: [-.07, -.07], legB: [.07, .07] },
    taunt:   { lean: -.05, head: .15, armF: [1.65, 1.3], armB: [.3, .4],   legF: [.5, .05],   legB: [-.4, -.15] }
  };
  const K = (t, pose, off, o) => {
    o = o || {};
    return { t, p: P[pose], off, lift: o.lift || 0, g: o.g == null ? 1 : o.g, rot: o.rot || 0, dir: o.dir, ease: o.ease || 'io' };
  };
  const build = (d, list) => list.map(k => { if (k.dir == null) k.dir = d; else d = k.dir; return k; });

  /* hero fighter (left, cyan) */
  const TA = build(1, [
    K(0, 'guard', -250), K(1.3, 'guard', -250),
    K(1.55, 'crouch', -252), K(1.75, 'crouch', -252),
    K(1.82, 'dash', -238, { ease: 'out' }),
    K(2.08, 'punch', -75, { ease: 'in' }), K(2.28, 'punch', -75),
    K(2.60, 'hit', -140, { ease: 'out' }), K(2.80, 'guard', -150),
    K(2.90, 'dash', -135, { ease: 'out' }),
    K(3.02, 'punch', -10, { ease: 'in' }), K(3.16, 'punch', -10),
    K(3.28, 'guard', -30),
    K(3.36, 'air', -30, { lift: 70, g: 0, ease: 'out' }),
    K(3.54, 'airkick', 15, { lift: 55, g: 0, ease: 'in' }), K(3.66, 'airkick', 15, { lift: 55, g: 0 }),
    K(3.80, 'crouch', 20), K(3.95, 'guard', 0),
    K(4.10, 'air', -25, { lift: 120, g: 0, ease: 'out' }),
    K(4.28, 'airpunch', 0, { lift: 120, g: 0, ease: 'in' }),
    K(4.40, 'air', -30, { lift: 120, g: 0, ease: 'out' }),
    K(4.52, 'airkick', 5, { lift: 120, g: 0, ease: 'in' }),
    K(4.62, 'air', -35, { lift: 120, g: 0, ease: 'out' }),
    K(4.75, 'airpunch', 15, { lift: 126, g: 0, ease: 'in' }),
    K(4.82, 'hit', -10, { lift: 120, g: 0, rot: .2, ease: 'snap' }),
    K(5.03, 'fall', -175, { lift: 20, g: 0, rot: 1.3, ease: 'in' }),
    K(5.09, 'lie', -180, { lift: 3, g: 1, rot: 1.57, ease: 'out' }),
    K(5.55, 'lie', -180, { lift: 3, rot: 1.57 }),
    K(5.80, 'crouch', -178, { ease: 'out' }),
    K(6.05, 'power', -175, { ease: 'out' }), K(6.40, 'power', -175),
    K(6.55, 'crouch', -175), K(6.62, 'crouch', -175),
    K(6.68, 'dash', -170, { ease: 'out' }),
    K(6.80, 'dash', 105, { ease: 'lin' }),
    K(6.92, 'stand', 110, { ease: 'out' }), K(7.20, 'stand', 110),
    K(7.22, 'crouch', 110, { dir: -1 }),
    K(7.42, 'air', 70, { lift: 120, g: 0, ease: 'out' }),
    K(7.76, 'airkick', 48, { lift: 200, g: 0, ease: 'in' }), K(7.90, 'airkick', 48, { lift: 200, g: 0 }),
    K(8.20, 'fall', 30, { lift: 30, g: 0, ease: 'in' }),
    K(8.34, 'crouch', 60, { ease: 'out' }), K(8.75, 'guard', 60), K(9.10, 'victory', 60), K(10, 'victory', 60)
  ]);

  /* rival (right, pink). SP keeps his one spin continuous instead of unwinding */
  const TB = build(-1, [
    K(0, 'guard', 250), K(1.3, 'guard', 250),
    K(1.55, 'crouch', 252), K(1.75, 'crouch', 252),
    K(1.82, 'dash', 238, { ease: 'out' }),
    K(2.08, 'punch', 75, { ease: 'in' }), K(2.28, 'punch', 75),
    K(2.60, 'hit', 140, { ease: 'out' }), K(2.80, 'guard', 150),
    K(3.00, 'block', 110, { ease: 'out' }), K(3.12, 'block', 100),
    K(3.28, 'block', 155, { ease: 'out' }),
    K(3.40, 'kick', 70, { ease: 'out' }), K(3.54, 'kick', 65),
    K(3.58, 'hit', 75, { ease: 'snap' }), K(3.85, 'hit', 140, { ease: 'out' }),
    K(3.95, 'guard', 140),
    K(4.10, 'air', 70, { lift: 120, g: 0, ease: 'out' }),
    K(4.28, 'block', 62, { lift: 120, g: 0 }),
    K(4.40, 'block', 85, { lift: 120, g: 0, ease: 'out' }),
    K(4.52, 'hit', 92, { lift: 120, g: 0, ease: 'snap' }),
    K(4.62, 'air', 55, { lift: 120, g: 0, ease: 'out' }),
    K(4.85, 'airkick', 10, { lift: 124, g: 0, rot: SP, ease: 'io' }),
    K(5.02, 'airkick', 10, { lift: 124, g: 0, rot: SP }),
    K(5.18, 'crouch', 25, { rot: SP, ease: 'in' }),
    K(5.40, 'taunt', 25, { rot: SP }), K(6.05, 'taunt', 25, { rot: SP }),
    K(6.20, 'block', 40, { rot: SP, ease: 'out' }),
    K(6.50, 'guard', 55, { rot: SP }), K(7.10, 'guard', 55, { rot: SP }),
    K(7.16, 'hit', 60, { rot: SP, ease: 'snap' }), K(7.24, 'hit', 62, { rot: SP }),
    K(7.55, 'fall', 38, { lift: 200, g: 0, rot: SP - 1.3, ease: 'out' }),
    K(7.90, 'hit', 36, { lift: 200, g: 0, rot: SP - 1.3 }),
    K(8.05, 'fall', 20, { lift: 80, g: 0, rot: SP + .4, ease: 'in' }),
    K(8.16, 'lie', 0, { lift: 3, g: 1, rot: SP + 1.57, ease: 'out' }),
    K(10, 'lie', 0, { lift: 3, rot: SP + 1.57 })
  ]);

  function sample(track, t) {
    let i = 0;
    while (i < track.length - 1 && track[i + 1].t <= t) i++;
    const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
    let p = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    p = EASE[b.ease](p);
    const L = (x, y) => lerp(x, y, p), A2 = (u, v) => [L(u[0], v[0]), L(u[1], v[1])];
    return {
      off: L(a.off, b.off), lift: L(a.lift, b.lift), g: L(a.g, b.g), rot: L(a.rot, b.rot), dir: a.dir,
      lean: L(a.p.lean, b.p.lean), head: L(a.p.head, b.p.head),
      armF: A2(a.p.armF, b.p.armF), armB: A2(a.p.armB, b.p.armB), legF: A2(a.p.legF, b.p.legF), legB: A2(a.p.legB, b.p.legB)
    };
  }
  function fig(track, t, seed) {
    t = clamp(t, 0, DUR);
    const s = sample(track, t);
    return solve({
      x: fw / 2 + s.off * fs, dir: s.dir, lean: s.lean + Math.sin(t * 3.2 + seed) * .018, head: s.head, rot: s.rot,
      lift: s.lift * fs, g: s.g, armB: s.armB, armF: s.armF, legB: s.legB, legF: s.legF
    }, fs, fg);
  }
  const FA = t => fig(TA, t, 0), FB = t => fig(TB, t, 1.7);

  /* moments that get effects: t, kind, x (units from centre), y (units above ground), shake, zoom punch, inverted frame window */
  const EVT = [
    { t: 2.08, k: 'impact', x: 0,    y: 105, sh: 16, zm: .14, inv: [2.13, 2.2] },
    { t: 3.02, k: 'hit',    x: 58,   y: 100, sh: 5,  zm: .04 },
    { t: 3.58, k: 'hit',    x: 55,   y: 135, sh: 7,  zm: .05 },
    { t: 4.28, k: 'hit',    x: 32,   y: 232, sh: 4,  zm: .03 },
    { t: 4.52, k: 'hit',    x: 40,   y: 232, sh: 4,  zm: .03 },
    { t: 4.82, k: 'impact', x: -5,   y: 225, sh: 10, zm: .08, inv: [4.83, 4.88] },
    { t: 5.05, k: 'slam',   x: -178, y: 0,   sh: 14, zm: .06 },
    { t: 7.16, k: 'slash',  x: 60,   y: 110, sh: 8,  zm: .08, inv: [7.17, 7.24] },
    { t: 7.76, k: 'impact', x: 44,   y: 300, sh: 10, zm: .08, inv: [7.77, 7.82] },
    { t: 8.16, k: 'slam',   x: 0,    y: 0,   sh: 24, zm: .16, big: 1, inv: [8.17, 8.26] }
  ];

  function camRaw(t) {
    const a = FA(t).hip, b = FB(t).hip;
    let x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const sep = Math.abs(a.x - b.x);
    let z = clamp(fw * .55 / (sep + 200 * fs), .9, 1.5);
    const pu = smooth(t, 5.85, 6.1) * (1 - smooth(t, 6.5, 6.75));
    x = lerp(x, a.x, pu * .75); y = lerp(y, a.y, pu * .6); z += .28 * pu;
    return { x, y, z };
  }
  function cam(t) {
    let x = 0, y = 0, z = 0; const n = 5;
    for (let i = 0; i < n; i++) { const r = camRaw(Math.max(0, t - i * .05)); x += r.x; y += r.y; z += r.z; }
    return { x: x / n, y: y / n, z: z / n };
  }

  /* ---------- drawing helpers ---------- */
  const BLD = []; let TW = 0;
  for (let i = 0; i < 30; i++) { const w = 36 + hsh(i + 70) * 54, h = .07 + hsh(i + 90) * .2; BLD.push({ x: TW, w, h }); TW += w + 4 + hsh(i + 110) * 10; }

  function sky(cm, zz, cyy, shx, shy) {
    const g = c.createLinearGradient(0, 0, 0, fh);
    g.addColorStop(0, '#10052a'); g.addColorStop(.62, '#34176f'); g.addColorStop(1, '#6b3bb8');
    c.fillStyle = g; c.fillRect(0, 0, fw, fh);
    c.fillStyle = '#fff';
    for (let i = 0; i < 46; i++) { c.globalAlpha = .25 + .5 * hsh(i + 50); c.fillRect(hsh(i) * fw, hsh(i + 11) * fh * .55, 1.6, 1.6); }
    c.globalAlpha = 1;
    const mxp = fw * .78 - (cm.x - fw / 2) * .05, myp = fh * .24, mr = fh * .11;
    const mg = c.createRadialGradient(mxp, myp, mr * .6, mxp, myp, mr * 2.6);
    mg.addColorStop(0, 'rgba(241,232,255,.35)'); mg.addColorStop(1, 'rgba(241,232,255,0)');
    c.fillStyle = mg; c.fillRect(mxp - mr * 3, myp - mr * 3, mr * 6, mr * 6);
    c.fillStyle = '#f1e8ff'; c.beginPath(); c.arc(mxp, myp, mr, 0, TAU); c.fill();
    const gy = fh * .56 + shy + (fg - cyy) * zz;
    const off = -(cm.x - fw / 2) * .3 + shx;
    const base = ((off % TW) + TW) % TW - TW;
    c.fillStyle = '#1c0b45';
    for (let rep = 0; rep < 4; rep++) for (const b of BLD) {
      const x = base + rep * TW + b.x;
      if (x > fw || x + b.w < 0) continue;
      c.fillRect(x, gy - b.h * fh, b.w, b.h * fh + 2);
    }
  }

  function focusLines(cx, cy, r0, r1, n, col, al, seed) {
    c.save(); c.fillStyle = col; c.globalAlpha = al;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + (hsh(i * 3.1 + seed) - .5) * .12;
      const rr0 = r0 * (.8 + hsh(i * 7.7 + seed) * .6), wd = .012 + hsh(i * 1.7 + seed) * .02;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * rr0, cy + Math.sin(a) * rr0);
      c.lineTo(cx + Math.cos(a - wd) * r1, cy + Math.sin(a - wd) * r1);
      c.lineTo(cx + Math.cos(a + wd) * r1, cy + Math.sin(a + wd) * r1);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  function aura(J, rgb, inten, t) {
    if (inten <= 0.01) return;
    const cx = J.hip.x, cy = (J.hip.y + J.head.y) / 2, rx = 46 * fs, ry = Math.abs(J.hip.y - J.head.y) * .75 + 10 * fs;
    c.save(); c.translate(cx, cy); c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, rx * .1, 0, 0, rx * 1.4);
    g.addColorStop(0, 'rgba(' + rgb + ',' + (.5 * inten) + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.fillRect(-rx * 1.5, -rx * 1.5, rx * 3, rx * 3); c.restore();
    c.save(); c.lineCap = 'round'; c.lineWidth = 2.5 * Math.max(.6, fs);
    for (let i = 0; i < 14; i++) {
      const x = J.hip.x + (hsh(i + 30) - .5) * 80 * fs, ph = (t * (1.4 + hsh(i) * .8) + hsh(i + 7)) % 1;
      const y = fg - ph * 190 * fs, len = (24 + hsh(i + 11) * 36) * fs;
      c.strokeStyle = 'rgba(' + rgb + ',' + ((1 - ph) * inten * .8) + ')';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + len); c.stroke();
    }
    c.restore();
  }

  function spikes(J, col, t) {
    const ux = J.head.x - J.neck.x, uy = J.head.y - J.neck.y, ul = Math.hypot(ux, uy) || 1;
    const nx = ux / ul, ny = uy / ul, px = -ny, py = nx, R = J.HR, fr = Math.floor(t * 20);
    c.save(); c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 14;
    for (let i = -2; i <= 2; i++) {
      const bx = J.head.x + nx * R * .75 + px * i * R * .32, by = J.head.y + ny * R * .75 + py * i * R * .32;
      const len = R * (1.1 + hsh(i + fr * 3) * .5) * (i === 0 ? 1.4 : 1 - Math.abs(i) * .15);
      c.beginPath();
      c.moveTo(bx - px * R * .16, by - py * R * .16);
      c.lineTo(bx + nx * len + px * i * R * .35, by + ny * len + py * i * R * .35);
      c.lineTo(bx + px * R * .16, by + py * R * .16);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  function fighter(J, col, lw, al) {
    c.save(); c.shadowColor = col; c.shadowBlur = 18 * Math.max(.6, fs);
    drawFig(c, J, col, lw, al); c.restore();
  }

  function afterimages(fn, col, lw, t) {
    const now = fn(t).hip, prev = fn(t - .04).hip;
    const sp = Math.hypot(now.x - prev.x, now.y - prev.y) / .04, thr = 330 * fs;
    if (sp < thr) return;
    const al = clamp((sp - thr) / (1500 * fs), 0, 1) * .55;
    for (let k = 3; k >= 1; k--) drawFig(c, fn(t - k * .035), col, lw, al * (1 - k * .25));
  }

  function trail(fn, pick, col, lw, t) {
    const pts = [];
    for (let i = 0; i < 9; i++) pts.push(pick(fn(t - i * .014)));
    const d = Math.hypot(pts[0].x - pts[8].x, pts[0].y - pts[8].y);
    if (d < 70 * fs) return;
    const vis = Math.min(1, d / (200 * fs));
    c.save(); c.lineCap = 'round'; c.strokeStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 14;
    for (let i = 0; i < 8; i++) {
      c.globalAlpha = (1 - i / 8) * vis; c.lineWidth = Math.max(1, lw * (1 - i / 8) * 1.7);
      c.beginPath(); c.moveTo(pts[i].x, pts[i].y); c.lineTo(pts[i + 1].x, pts[i + 1].y); c.stroke();
    }
    c.restore();
  }

  function popText(str, t0, dur, x, y, size, rot, fill, shadow, t) {
    const a = t - t0; if (a < 0 || a > dur) return;
    const s0 = 1 + .9 * Math.pow(Math.max(0, 1 - a / .14), 2), al = a > dur - .15 ? (dur - a) / .15 : 1;
    c.save(); c.globalAlpha = al; c.translate(x, y); c.rotate(rot); c.scale(s0, s0);
    c.font = "900 " + size + "px 'Bricolage Grotesque', Impact, system-ui, sans-serif";
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.lineWidth = size * .16; c.strokeStyle = '#12082b';
    c.strokeText(str, size * .05, size * .05); c.fillStyle = shadow; c.fillText(str, size * .05, size * .05);
    c.strokeText(str, 0, 0); c.fillStyle = fill; c.fillText(str, 0, 0);
    c.restore();
  }

  function bars(t) {
    const bh = fh * .075 * Math.min(1, t / .5);
    c.fillStyle = '#000'; c.fillRect(0, 0, fw, bh); c.fillRect(0, fh - bh, fw, bh);
  }

  /* ---------- one frame ---------- */
  function draw(t) {
    if (!fw) return;
    t = clamp(t, 0, DUR);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, fw, fh);
    const cm = cam(t);
    let shake = 0, zoomP = 0;
    for (const e of EVT) {
      const a = t - e.t;
      if (a >= 0 && a < .5) { shake += e.sh * Math.pow(1 - a / .5, 2); zoomP += e.zm * Math.pow(Math.max(0, 1 - a / .3), 2); }
    }
    if (t > 5.95 && t < 6.65) shake += 2.5;
    const zz = cm.z + zoomP;
    const cyy = Math.max(cm.y, fg - .34 * fh / zz);
    const fr = Math.floor(t * 30), kk = fw / 1000;
    const shx = (hsh(fr * 1.3) - .5) * 2 * shake * kk, shy = (hsh(fr * 2.7 + 5) - .5) * 2 * shake * kk;
    const W2S = (X, Y) => ({ x: fw / 2 + shx + (X - cm.x) * zz, y: fh * .56 + shy + (Y - cyy) * zz });
    const U2W = (xu, yu) => ({ x: fw / 2 + xu * fs, y: fg - yu * fs });
    const toWorld = () => { c.translate(fw / 2 + shx, fh * .56 + shy); c.scale(zz, zz); c.translate(-cm.x, -cyy); };
    const A = FA(t), B = FB(t), lw = Math.max(3.5, 5.4 * fs);
    const inv = EVT.find(e => e.inv && t >= e.inv[0] && t < e.inv[1]);

    if (inv) {
      c.fillStyle = '#fff'; c.fillRect(0, 0, fw, fh);
      c.save(); toWorld();
      const p = U2W(inv.x, inv.y);
      focusLines(p.x, p.y, 60 * fs, 2400, 70, '#000', 1, Math.floor(t * 24));
      c.strokeStyle = '#000'; c.lineWidth = 4; c.beginPath(); c.moveTo(cm.x - 2500, fg); c.lineTo(cm.x + 2500, fg); c.stroke();
      drawFig(c, A, '#000', lw * 1.5, 1); drawFig(c, B, '#000', lw * 1.5, 1);
      c.restore(); bars(t);
      return;
    }

    sky(cm, zz, cyy, shx, shy);
    c.save(); toWorld();

    // ground
    c.fillStyle = '#140a2e'; c.fillRect(cm.x - 2500, fg, 5000, 2500);
    c.save(); c.strokeStyle = '#9b6cff'; c.shadowColor = '#9b6cff'; c.shadowBlur = 14; c.lineWidth = 3;
    c.beginPath(); c.moveTo(cm.x - 2500, fg); c.lineTo(cm.x + 2500, fg); c.stroke(); c.restore();

    // cracks, dust and ground shockwaves
    for (const e of EVT) {
      if (e.k !== 'slam' || t < e.t) continue;
      const a = t - e.t, X = U2W(e.x, 0).x, gr = Math.min(1, a / .15), n = e.big ? 9 : 6, mul = e.big ? 1.4 : 1;
      c.save(); c.strokeStyle = '#9b6cff'; c.globalAlpha = .7; c.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const sgn = i % 2 ? 1 : -1; let x = X, y = fg + 2;
        c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 5; j++) { x += sgn * (14 + hsh(i * 5 + j) * 26) * fs * mul * gr; y += (6 + hsh(i * 3 + j + 1) * 18) * fs * .55 * gr; c.lineTo(x, y); }
        c.stroke();
      }
      c.restore();
      if (a < 1.6) {
        const p = a / 1.6;
        c.save(); c.fillStyle = '#c9b8ff';
        for (let i = 0; i < 12; i++) {
          c.globalAlpha = (1 - p) * .35;
          const x = X + (hsh(i) - .5) * 260 * fs * Math.sqrt(p) * mul, y = fg - 8 * fs - p * (30 + hsh(i + 4) * 70) * fs;
          c.beginPath(); c.arc(x, y, (10 + p * 45 + hsh(i + 9) * 14) * fs * mul, 0, TAU); c.fill();
        }
        c.restore();
      }
      if (a < .6) {
        const p = a / .6, rx = (30 + p * (e.big ? 700 : 420)) * fs;
        c.save(); c.strokeStyle = '#fff'; c.globalAlpha = 1 - p; c.lineWidth = 6 * (1 - p) + 1;
        c.beginPath(); c.ellipse(X, fg, rx, rx * .14, 0, 0, TAU); c.stroke(); c.restore();
      }
    }

    // power-up rocks
    if (t > 5.9 && t < 6.9) {
      c.save();
      for (let i = 0; i < 7; i++) {
        const x = A.hip.x + (hsh(i + 20) - .5) * 260 * fs, y = fg - (8 + hsh(i + 3) * 30 + (t - 5.9) * (60 + hsh(i) * 80)) * fs, s = (5 + hsh(i + 8) * 7) * fs;
        c.globalAlpha = Math.min(1, (t - 5.9) / .3) * (1 - smooth(t, 6.55, 6.9));
        c.fillStyle = '#2b1560'; c.strokeStyle = '#9b6cff'; c.lineWidth = 1.5;
        c.beginPath(); c.rect(x - s / 2, y - s / 2, s, s); c.fill(); c.stroke();
      }
      c.restore();
    }

    // auras
    const pre = smooth(t, 1.5, 1.6) * (1 - smooth(t, 1.78, 1.85)) * .55;
    const power = smooth(t, 5.95, 6.1) * (1 - smooth(t, 6.5, 6.75));
    aura(A, '92,232,255', Math.max(pre, power), t);
    aura(B, '255,95,168', pre, t);

    // fighters, afterimages and smear trails
    afterimages(FA, CYN, lw, t); afterimages(FB, PNK, lw, t);
    trail(FA, J => J.aF[2], CYN, lw, t); trail(FA, J => J.lF[2], CYN, lw, t);
    trail(FB, J => J.aF[2], PNK, lw, t); trail(FB, J => J.lF[2], PNK, lw, t);
    fighter(B, PNK, lw, 1); fighter(A, CYN, lw, 1);
    if (t >= 6.05) spikes(A, '#bff6ff', t);

    // event effects
    for (const e of EVT) {
      const a = t - e.t; if (a < 0) continue;
      const P0 = U2W(e.x, e.y);
      if ((e.k === 'impact' || e.k === 'hit') && a < .5) {
        const life = e.k === 'impact' ? .45 : .3, p = a / life;
        if (p < 1) {
          c.save(); c.strokeStyle = '#fff'; c.globalAlpha = 1 - p; c.lineWidth = 6 * (1 - p) + 1;
          c.beginPath(); c.arc(P0.x, P0.y, (20 + p * (e.k === 'impact' ? 260 : 110)) * fs, 0, TAU); c.stroke(); c.restore();
        }
        const n = e.k === 'impact' ? 16 : 9, sp = Math.min(1, a / .3);
        if (sp < 1) {
          c.save(); c.lineCap = 'round'; c.lineWidth = 3;
          for (let i = 0; i < n; i++) {
            const ang = hsh(i + e.t * 7) * TAU, len = (30 + hsh(i + 3) * 60) * fs, r0 = (10 + sp * 120) * fs;
            c.strokeStyle = i % 3 ? '#fff' : CYN; c.globalAlpha = 1 - sp;
            c.beginPath(); c.moveTo(P0.x + Math.cos(ang) * r0, P0.y + Math.sin(ang) * r0);
            c.lineTo(P0.x + Math.cos(ang) * (r0 + len * (1 - sp)), P0.y + Math.sin(ang) * (r0 + len * (1 - sp))); c.stroke();
          }
          c.restore();
        }
      }
      if (e.k === 'slash' && a < .4) {
        const gp = Math.min(1, a / .05);
        c.save(); c.lineCap = 'round'; c.strokeStyle = '#fff'; c.shadowColor = CYN; c.shadowBlur = 20; c.globalAlpha = 1 - a / .4;
        for (let i = 0; i < 3; i++) {
          const ang = -.85 + i * .28, L = (140 + i * 40) * fs, dx = Math.cos(ang), dy = Math.sin(ang);
          c.lineWidth = (10 - 6 * a / .4) * Math.max(.6, fs);
          c.beginPath(); c.moveTo(P0.x - dx * L / 2, P0.y - dy * L / 2); c.lineTo(P0.x - dx * L / 2 + dx * L * gp, P0.y - dy * L / 2 + dy * L * gp); c.stroke();
        }
        c.restore();
      }
      if (e.k === 'slam' && a < 1.4) {
        c.save(); c.fillStyle = '#2b1560'; c.strokeStyle = '#9b6cff'; c.lineWidth = 1.5; c.globalAlpha = 1 - a / 1.4;
        for (let i = 0; i < 8; i++) {
          const vx = (hsh(i) - .5) * 420 * fs, vy0 = -(180 + hsh(i + 2) * 300) * fs, y = fg + vy0 * a + .5 * 900 * fs * a * a;
          if (y > fg) continue;
          const s = (5 + hsh(i + 5) * 9) * fs;
          c.beginPath(); c.rect(P0.x + vx * a - s / 2, y - s / 2, s, s); c.fill(); c.stroke();
        }
        c.restore();
      }
    }
    c.restore();

    /* ---- screen-space layers ---- */
    // dash streaks
    const vA = (FA(t).hip.x - FA(t - .04).hip.x) / .04, vB = (FB(t).hip.x - FB(t - .04).hip.x) / .04;
    const vx = Math.abs(vA) > Math.abs(vB) ? vA : vB, thr = 500 * fs;
    if (Math.abs(vx) > thr) {
      const it = clamp((Math.abs(vx) - thr) / (2500 * fs), 0, 1), seed = Math.floor(t * 24), sg = Math.sign(vx) || 1;
      c.save(); c.strokeStyle = '#fff'; c.lineCap = 'round';
      for (let i = 0; i < 22; i++) {
        const y = hsh(i + seed * 1.7) * fh, len = (120 + hsh(i * 2.1 + seed) * 300) * (fw / 1000);
        const x0 = ((hsh(i * 3.3) * 1.4 - .2) * fw + sg * t * 2500) % (fw + len) - len / 2;
        c.globalAlpha = it * (.25 + hsh(i + 9) * .4); c.lineWidth = 1 + hsh(i + 5) * 2.5;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + len, y); c.stroke();
      }
      c.restore();
    }
    // standoff wind
    if (t < 1.6) {
      c.save(); c.strokeStyle = '#fff'; c.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const y = fh * (.25 + hsh(i + 60) * .5), len = fw * (.06 + hsh(i + 61) * .08);
        const x0 = ((t * (260 + hsh(i) * 220) + hsh(i + 62) * fw) % (fw + len)) - len;
        c.globalAlpha = .13 * (1 - smooth(t, 1.2, 1.6)); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + len, y); c.stroke();
      }
      c.restore();
    }
    // anime focus lines on the big hits
    for (const e of EVT) {
      const a = t - e.t;
      if (a < 0 || a > .28 || e.k === 'hit') continue;
      const s = W2S(U2W(e.x, e.y).x, U2W(e.x, e.y).y);
      focusLines(s.x, s.y, fh * .12, fw * .9, 64, '#fff', .55 * (1 - a / .28), Math.floor(t * 24));
    }
    // vignette
    const vg = c.createRadialGradient(fw / 2, fh / 2, fh * .3, fw / 2, fh / 2, fw * .62);
    vg.addColorStop(0, 'rgba(8,2,24,0)'); vg.addColorStop(1, 'rgba(8,2,24,' + (.45 + .3 * Math.max(pre, power)) + ')');
    c.fillStyle = vg; c.fillRect(0, 0, fw, fh);
    // white flash
    let fl = 0;
    for (const e of EVT) { const a = t - e.t; if (a >= 0 && a < .07 && e.k !== 'hit') fl = Math.max(fl, (1 - a / .07) * .85); }
    if (fl > 0) { c.fillStyle = 'rgba(255,255,255,' + fl + ')'; c.fillRect(0, 0, fw, fh); }
    // onomatopoeia
    const b0 = W2S(U2W(-178, 120).x, U2W(-178, 120).y);
    popText('CLASH!', 2.10, .55, fw / 2, fh * .27, fh * .15, -.1, '#fff', PNK, t);
    popText('BAM!', 5.06, .55, clamp(b0.x, fw * .15, fw * .85), Math.min(b0.y, fh * .5), fh * .13, .08, '#fff', CYN, t);
    popText('K.O.', 8.3, 1.0, fw / 2, fh * .36, fh * .3, -.06, '#fff', CYN, t);
    bars(t);
    // end card
    if (t > 9.4) {
      const a = clamp((t - 9.4) / .5, 0, 1);
      c.fillStyle = 'rgba(10,3,30,' + (.6 * a) + ')'; c.fillRect(0, 0, fw, fh);
      c.save(); c.globalAlpha = a; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#fff'; c.font = "800 " + (fh * .09) + "px 'Bricolage Grotesque', system-ui, sans-serif";
      c.fillText('GAFARI ANIMATION', fw / 2, fh * .46);
      c.fillStyle = '#b9a9e0'; c.font = "500 " + (fh * .04) + "px 'Bricolage Grotesque', system-ui, sans-serif";
      c.fillText('Stick figures. Serious fights.', fw / 2, fh * .56);
      c.restore();
    }
  }
  cv._draw = draw;

  /* ---------- player controls ---------- */
  let pt = reduce ? 4.29 : 0, playing = false, started = false, visible = false, last = 0;
  function label() { btn.textContent = playing ? 'Pause' : (pt >= DUR - .01 ? 'Replay' : 'Play'); }
  function clock() { const s = Math.min(DUR, Math.floor(pt)); timeEl.textContent = '0:' + String(s).padStart(2, '0') + ' / 0:10'; }
  function ui() { scrub.value = String(Math.round(pt / DUR * 1000)); clock(); }
  btn.addEventListener('click', () => {
    if (pt >= DUR - .01) { pt = 0; playing = true; } else playing = !playing;
    label();
  });
  scrub.addEventListener('input', () => { pt = scrub.value / 1000 * DUR; playing = false; label(); clock(); draw(pt); });
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!playing || !visible) return;
    pt += dt;
    if (pt >= DUR) { pt = DUR; playing = false; label(); }
    draw(pt); ui();
  }
  requestAnimationFrame(loop);
  new IntersectionObserver(es => {
    const e = es[es.length - 1];
    visible = e.isIntersecting;
    if (visible && !started && !reduce && e.intersectionRatio >= .5) { started = true; pt = 0; playing = true; label(); }
  }, { threshold: [0, .5] }).observe(cv);
  new ResizeObserver(() => {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    fw = r.width; fh = r.height;
    if (!fw || !fh) return;
    cv.width = Math.round(fw * dpr); cv.height = Math.round(fh * dpr);
    fs = Math.max(.35, Math.min(fh * .38 / 164, fw / 720));
    fg = fh * .8;
    draw(pt);
  }).observe(cv);
  label(); ui();
})();

})();
