/* HEROES vs VILLAINS — two REAL stack towers (three.js), red vs blue.
   Same orthographic down-angle view + BoxGeometry cubes + black outlines as the
   original STACK, rendered twice into left/right scissor halves. Driven entirely
   by controls. 1 block per point; reach winScore -> bank a win + reset that side. */

/* ---------------- storage / util ---------------- */
const load = (k, d) => { try { const v = localStorage.getItem("vs_" + k); return v === null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem("vs_" + k, String(v)); } catch (e) {} };
const sfx = (n, a, b) => { try { if (window.SFX && SFX[n]) SFX[n](a, b); } catch (e) {} };
const el = (id) => document.getElementById(id);

/* ---------------- config ---------------- */
const TEAMS = { red: { name: "VILLAINS", other: "blue", accent: "#ff3b57" }, blue: { name: "HEROES", other: "red", accent: "#38b6ff" } };
const UP = ["up1", "up2"], DOWN = ["down1", "down2"];
const AMT_DEFAULT = { up1: 25, up2: 250, down1: 25, down2: 250, steal: 250 };
const BIND_DEFAULT = {
  red_up1: "q", red_up2: "w", red_addwin: "e", red_down1: "a", red_down2: "s", red_subwin: "d", red_reset: "z", red_steal: "x", red_stealwin: "v", red_save: "c",
  blue_up1: "i", blue_up2: "o", blue_addwin: "p", blue_down1: "k", blue_down2: "l", blue_subwin: "b", blue_reset: "n", blue_steal: "m", blue_stealwin: "j", blue_save: "h",
};
const MV_DEFAULT = {
  menu: { x: 13, y: 4, s: 100 },
  redHud: { x: 25, y: 12, s: 96 }, blueHud: { x: 75, y: 12, s: 96 },
  redWins: { x: 13, y: 45, s: 100 }, blueWins: { x: 87, y: 45, s: 100 },
  redTimer: { x: 25, y: 30, s: 100 }, blueTimer: { x: 75, y: 30, s: 100 },
};
const teamNames = { red: load("name_red", "VILLAINS"), blue: load("name_blue", "HEROES") };
function teamName(t) { return teamNames[t] || TEAMS[t].name; }
function applyNames() {
  el("redTitle").textContent = teamNames.red; el("blueTitle").textContent = teamNames.blue;
  el("redWinsLabel").textContent = teamNames.red + " WINS"; el("blueWinsLabel").textContent = teamNames.blue + " WINS";
}
// mixed shades so the tower looks varied — a fresh pink/red (or blue) per block/click
const RED_PALETTE = [0xff3d5a, 0xff5c8a, 0xff2d55, 0xff6b9d, 0xe8305a, 0xff4d7a, 0xff849e, 0xd6265a, 0xff3b73, 0xff738f];
const BLUE_PALETTE = [0x2f9dff, 0x38b6ff, 0x1e78ff, 0x4dc3ff, 0x2b6fff, 0x39d0ff, 0x5ab0ff, 0x1e90ff, 0x53d8ff, 0x2f7bff];
// stable pseudo-random shade per block index — adjacent blocks differ, each click reveals a new one
function colorFor(pal, idx) { let h = ((idx + 1) * 374761393) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return pal[h % pal.length]; }

/* stack look (matches the original game) */
const BOX_HEIGHT = 2.2, SIZE = 6.4, VIEW_H = 50, POOL = 30, STAGE_RATIO = 0.82;
/* click-to-stack tuning (ported from the stack game: slide, drop, slice, perfect, grow) */
const SPAWN_OFFSET = SIZE * 1.2; // fixed slide range each way (block goes fully off at the extremes)
const LAND_TOL = SIZE * 0.6;     // click with the block within this of centre = it lands; else it misses
const MISS_PENALTY = 10;         // mistimed click -> block falls off, tower drops this many
const tri = (p) => 4 * Math.abs((p % 1 + 1) % 1 - 0.5) - 1; // -1..1 triangle wave (constant speed)
let slideSpeed = Math.max(0.08, Math.min(0.6, parseFloat(load("slideSpeed", "0.2")) || 0.2)); // full slide cycles/sec-ish
let clickSide = load("clickSide", "blue"); // which side a click stacks: "both" | "red" | "blue"

let winScore = parseInt(load("winScore", 1000), 10) || 1000;
const amounts = {};
for (const t of ["red", "blue"]) for (const s of [...UP, ...DOWN, "steal"]) amounts[t + "_" + s] = parseInt(load("amt_" + t + "_" + s, AMT_DEFAULT[s]), 10) || AMT_DEFAULT[s];
let binds; try { binds = Object.assign({}, BIND_DEFAULT, JSON.parse(load("binds", "{}"))); } catch (e) { binds = { ...BIND_DEFAULT }; }
// drop any stale bindings pointing at actions that no longer exist (prevents NaN glitches)
(function () {
  const valid = new Set(); for (const t of ["red", "blue"]) for (const a of [...UP, ...DOWN, "addwin", "subwin", "reset", "steal", "stealwin", "save"]) valid.add(t + "_" + a);
  let changed = false; for (const k in binds) if (!valid.has(k)) { delete binds[k]; changed = true; }
  if (changed) save("binds", JSON.stringify(binds));
})();

const state = {
  red: { score: 0, disp: 0, wins: parseInt(load("wins_red", 0), 10) || 0, glow: 0, kick: 0, shake: 0, pop: 0, resetSecs: 0, winSecs: 0, streak: 0, moverOffset: 0, queue: 0, qStep: 0.4, lastTop: 0, blockPop: 0, climbRingT: 0 },
  blue: { score: 0, disp: 0, wins: parseInt(load("wins_blue", 0), 10) || 0, glow: 0, kick: 0, shake: 0, pop: 0, resetSecs: 0, winSecs: 0, streak: 0, moverOffset: 0, queue: 0, qStep: 0.4, lastTop: 0, blockPop: 0, climbRingT: 0 },
};

/* ---------------- three.js setup ---------------- */
const stageEl = el("stage");
let renderer, cam, unitGeo, unitEdges, lineGeo, edgeBlack, edgeWhite, FAT = false;
let towers = {};
let W = 0, H = 0, T = 0, DPR = Math.min(1.75, window.devicePixelRatio || 1);

// Rounded box (soft beveled edges) — unit cube, rounded, height along Y.
function roundedBox(w, h, d, r, seg) {
  const s = new THREE.Shape(), hw = w / 2, hd = d / 2, x = -hw, y = -hd;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: seg, steps: 1, curveSegments: seg });
  g.center(); g.rotateX(-Math.PI / 2); g.computeVertexNormals();
  return g;
}
function applyVertexShade(geo) {
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const vY = y + 0.5, vD = ((0.5 - x) + (0.5 - z)) / 2;
    let s = 0.62 + 0.34 * vY + 0.12 * vD; if (vY < 0.05) s *= 0.82; if (s > 1) s = 1;
    colors[i * 3] = s; colors[i * 3 + 1] = s; colors[i * 3 + 2] = s;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}
function buildScene(palette) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x223048, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.95); key.position.set(14, 20, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.25); fill.position.set(-12, 6, -9); scene.add(fill);
  const pool = [];
  for (let k = 0; k < POOL; k++) pool.push(addBlock(scene, false)); // placed blocks: black stroke
  pool.push(addBlock(scene, true));                                 // the moving block: white stroke
  return { scene, pool, mover: pool[POOL], palette };
}
// bold stroke on EVERY edge (fat lines from the same geo -> perfectly aligned). white = the moving block, black = placed.
function addEdges(group, white) { const m = white ? edgeWhite : edgeBlack; group.add(FAT ? new THREE.LineSegments2(lineGeo, m) : new THREE.LineSegments(unitEdges, m)); }
function addBlock(scene, white) {
  const group = new THREE.Group(); group.scale.set(SIZE, BOX_HEIGHT, SIZE);
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 46, specular: new THREE.Color(0x5a5a5a), emissive: new THREE.Color(0x000000) });
  group.add(new THREE.Mesh(unitGeo, mat));
  addEdges(group, white);
  scene.add(group);
  return { group, mat };
}
function setupThree() {
  const canvas = el("game");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  unitGeo = new THREE.BoxGeometry(1, 0.985, 1); applyVertexShade(unitGeo); // nearly full height so stacked blocks touch (no gap)
  unitEdges = new THREE.EdgesGeometry(unitGeo);                             // same geo -> stroke on every edge, aligned
  FAT = !!(THREE.LineSegmentsGeometry && THREE.LineMaterial && THREE.LineSegments2);
  if (FAT) { lineGeo = new THREE.LineSegmentsGeometry().fromEdgesGeometry(unitEdges); edgeBlack = new THREE.LineMaterial({ color: 0x0a0a12, linewidth: 4 }); edgeWhite = new THREE.LineMaterial({ color: 0xffffff, linewidth: 5 }); }
  else { edgeBlack = new THREE.LineBasicMaterial({ color: 0x0a0a12 }); edgeWhite = new THREE.LineBasicMaterial({ color: 0xffffff }); }
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  towers.red = buildScene(RED_PALETTE); towers.blue = buildScene(BLUE_PALETTE);
}
function towerFrozen(team) { const st = state[team]; return st.resetSecs > 0 || st.winSecs > 0; } // no motion / no clicking
function updateTower(team) {
  const t = towers[team], st = state[team], disp = st.disp, topIdx = Math.floor(disp);
  // each time a NEW block is revealed at the top (climbing up), pop it in from small so you SEE it land
  if (topIdx > st.lastTop) st.blockPop = 1;
  st.lastTop = topIdx;
  for (let k = 0; k < POOL; k++) {                    // every block is full size, stacked straight
    const idx = topIdx - k, b = t.pool[k];
    if (idx < 0) { b.group.visible = false; continue; }
    b.group.visible = true;
    // top block pops in (from ~60%) as it appears; a click adds an extra little squash
    const popS = k === 0 ? (1 - st.blockPop * 0.42) * (1 + st.pop * 0.16) : 1;
    b.group.position.set(0, BOX_HEIGHT * idx, 0);
    b.group.scale.set(SIZE * popS, BOX_HEIGHT * popS, SIZE * popS);
    b.mat.color.setHex(colorFor(t.palette, idx));
    const gl = st.glow * (k < 3 ? 0.4 : 0.18); b.mat.emissive.setRGB(gl, gl, gl);
  }
  // moving block: full-size, slides across a fixed range over the tower; blue mirrors red; frozen when paused
  st.moverOffset = towerFrozen(team) ? 0 : tri(T * slideSpeed) * SPAWN_OFFSET * (team === "red" ? 1 : -1);
  const mv = t.mover;
  mv.group.visible = true;
  const mpop = 1 + st.pop * 0.22;
  mv.group.scale.set(SIZE * mpop, BOX_HEIGHT * mpop, SIZE * mpop);
  mv.group.position.set(st.moverOffset, BOX_HEIGHT * (topIdx + 1), 0);
  mv.mat.color.setHex(colorFor(t.palette, topIdx + 1)); // next block's shade (kept when placed)
  mv.mat.emissive.setRGB(0.14 + st.glow * 0.3, 0.14 + st.glow * 0.3, 0.14 + st.glow * 0.3);
}
function setCam(team) {
  const st = state[team], camY = BOX_HEIGHT * st.disp;
  const sh = st.shake > 0.3 ? st.shake * 0.11 : 0;
  // clean isometric look-down (~34°): wide flat top, short chunky sides; tower sits lower
  cam.position.set(26 + (Math.random() * 2 - 1) * sh, 24 + camY - st.kick + (Math.random() * 2 - 1) * sh, 26);
  cam.lookAt(0, camY - 2, 0);
}
function renderThree() {
  renderer.clear();
  renderer.setScissorTest(true);
  const halfW = Math.floor(W / 2);
  renderer.setViewport(0, 0, halfW, H); renderer.setScissor(0, 0, halfW, H);
  setCam("red"); renderer.render(towers.red.scene, cam);
  renderer.setViewport(halfW, 0, W - halfW, H); renderer.setScissor(halfW, 0, W - halfW, H);
  setCam("blue"); renderer.render(towers.blue.scene, cam);
  renderer.setScissorTest(false);
}
// SHATTER: real 3D blocks break off the top and tumble away.
function spawnDebris(team, n) {
  const t = towers[team], topIdx = Math.floor(state[team].disp), y0 = BOX_HEIGHT * topIdx;
  n = Math.min(n, 40 - debris.length); if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group(), sz = SIZE * (0.42 + Math.random() * 0.34);
    g.scale.set(sz, BOX_HEIGHT * (0.7 + Math.random() * 0.5), sz);
    g.position.set((Math.random() * 2 - 1) * SIZE * 0.42, y0 - Math.random() * BOX_HEIGHT * 4, (Math.random() * 2 - 1) * SIZE * 0.42);
    addEdges(g);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: new THREE.Color(0x5a5a5a), color: new THREE.Color(colorFor(t.palette, topIdx - i)) });
    g.add(new THREE.Mesh(unitGeo, mat));
    t.scene.add(g);
    const dir = (Math.random() * 2 - 1);
    debris.push({ team, g, mat, vx: dir * (0.4 + Math.random() * 0.7), vy: 0.5 + Math.random() * 0.7, vz: (Math.random() * 2 - 1) * 0.6, rx: (Math.random() * 2 - 1) * 0.14, ry: (Math.random() * 2 - 1) * 0.14, rz: (Math.random() * 2 - 1) * 0.14, life: 1 });
  }
}
function updateDebris() {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.vy -= 0.032;
    d.g.position.x += d.vx; d.g.position.y += d.vy; d.g.position.z += d.vz;
    d.g.rotation.x += d.rx; d.g.rotation.y += d.ry; d.g.rotation.z += d.rz;
    d.life -= 0.014;
    if (d.life < 0.3) { const s = Math.max(0.01, d.life / 0.3); d.g.scale.multiplyScalar(0.94); }
    if (d.life <= 0) { towers[d.team].scene.remove(d.g); d.mat.dispose(); debris.splice(i, 1); }
  }
}

/* ---------------- background + fx (2D canvases) ---------------- */
const bg = el("bg"), bgx = bg.getContext("2d");
const fx = el("fx"), fxx = fx.getContext("2d");
let skyRed = [], skyBlue = [];
let particles = [], bombs = [], flyers = [], rings = [], debris = [], explosionText = [], shake = 0;
function makeSky(x0, x1) { const a = []; let x = x0, s = Math.floor(x0) + 13; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; while (x < x1) { const w = 14 + rnd() * 26, h = 24 + rnd() * 120; a.push({ x, w, h }); x += w + 3 + rnd() * 9; } return a; }
function towerTop(team) { return { x: team === "red" ? W * 0.25 : W * 0.75, y: H * 0.47 }; } // screen pos of the tower top
function drawBG() {
  bgx.setTransform(DPR, 0, 0, DPR, 0, 0); bgx.clearRect(0, 0, W, H);
  drawSide(0, W / 2, "red"); drawSide(W / 2, W, "blue");
  bgx.fillStyle = "rgba(0,0,0,0.5)"; bgx.fillRect(W / 2 - 2, 0, 4, H);
  bgx.fillStyle = "rgba(255,255,255,0.18)"; bgx.fillRect(W / 2 - 1, 0, 1, H);
}
function drawSide(x0, x1, team) {
  const w = x1 - x0, g = bgx.createLinearGradient(0, 0, 0, H);
  if (team === "red") { g.addColorStop(0, "#1a0308"); g.addColorStop(0.55, "#4a0a16"); g.addColorStop(1, "#7a1226"); }
  else { g.addColorStop(0, "#02122e"); g.addColorStop(0.55, "#0a3a72"); g.addColorStop(1, "#0f5aa8"); }
  bgx.fillStyle = g; bgx.fillRect(x0, 0, w, H);
  // retro sun
  const cx = x0 + w * (team === "red" ? 0.5 : 0.5), cy = H * 0.28, r = Math.min(w, H) * 0.12;
  bgx.save();
  const gg = bgx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.6);
  gg.addColorStop(0, team === "red" ? "rgba(255,90,60,0.45)" : "rgba(60,180,255,0.45)"); gg.addColorStop(1, "transparent");
  bgx.fillStyle = gg; bgx.fillRect(cx - r * 2.6, cy - r * 2.6, r * 5.2, r * 5.2);
  bgx.beginPath(); bgx.arc(cx, cy, r, 0, 7); bgx.clip();
  const sg = bgx.createLinearGradient(cx, cy - r, cx, cy + r);
  if (team === "red") { sg.addColorStop(0, "#ffd76b"); sg.addColorStop(0.5, "#ff7a3c"); sg.addColorStop(1, "#ff2d55"); }
  else { sg.addColorStop(0, "#d6f6ff"); sg.addColorStop(0.5, "#4dc3ff"); sg.addColorStop(1, "#1e6fff"); }
  bgx.fillStyle = sg; bgx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  bgx.fillStyle = team === "red" ? "#3a0912" : "#031126";
  for (let i = 0; i < 8; i++) { const yy = cy + i * i * 0.5 + r * 0.12; bgx.fillRect(cx - r, yy, 2 * r, 2 + i); }
  bgx.restore();
  // skyline
  const sky = team === "red" ? skyRed : skyBlue, horizon = H * 0.62;
  bgx.fillStyle = team === "red" ? "rgba(24,3,10,0.85)" : "rgba(2,10,26,0.85)";
  for (const b of sky) bgx.fillRect(b.x, horizon - b.h, b.w, b.h);
  // grid
  bgx.save(); bgx.beginPath(); bgx.rect(x0, horizon, w, H - horizon); bgx.clip();
  bgx.strokeStyle = team === "red" ? "rgba(255,60,120,0.28)" : "rgba(60,160,255,0.28)"; bgx.lineWidth = 1.3;
  const scroll = (T * 0.35) % 1, gcx = x0 + w / 2;
  for (let i = 0; i < 16; i++) { const tt = (i + scroll) / 16, y = horizon + tt * tt * (H - horizon); bgx.beginPath(); bgx.moveTo(x0, y); bgx.lineTo(x1, y); bgx.stroke(); }
  for (let i = -9; i <= 9; i++) { bgx.beginPath(); bgx.moveTo(gcx, horizon); bgx.lineTo(gcx + i * (w / 6), H); bgx.stroke(); }
  bgx.restore();
}
function drawFX() {
  fxx.setTransform(DPR, 0, 0, DPR, 0, 0); fxx.clearRect(0, 0, W, H);
  fxx.save();
  if (shake > 0.2) fxx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
  // bombs: fall -> land on the tower -> sizzle for ~2s -> explode
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i]; b.targetY = towerTop(b.team).y - 18; // rest the stick ON the top block
    if (!b.landed) {
      b.vy += 0.5; b.y += b.vy;
      if (b.y >= b.targetY) { b.landed = true; b.y = b.targetY; b.fuse = 0; sfx("tntland"); }
    } else {
      b.y = b.targetY; b.fuse++;
      if (b.fuse % 9 === 0) sfx("fuse", Math.min(1, b.fuse / 120));
      if (b.fuse >= 120) { explodeBomb(b); bombs.splice(i, 1); continue; }
    }
    const armT = b.landed ? b.fuse / 120 : 0;                  // 0..1 as it's about to blow
    const blink = b.landed && b.fuse > 84 && (b.fuse % 8 < 4);  // red blink near the end
    const dw = 10, dh = 32;
    fxx.save(); fxx.translate(b.x, b.y);
    const grd = fxx.createLinearGradient(-dw, 0, dw, 0);
    grd.addColorStop(0, "#7e1420"); grd.addColorStop(0.5, blink ? "#ff6a4c" : "#e23b2e"); grd.addColorStop(1, "#7e1420");
    fxx.fillStyle = grd; fxx.fillRect(-dw, -dh / 2, dw * 2, dh);
    fxx.strokeStyle = "#2a0509"; fxx.lineWidth = 2; fxx.strokeRect(-dw, -dh / 2, dw * 2, dh);
    fxx.fillStyle = "#f2c14e"; fxx.fillRect(-dw, -dh / 2 + 5, dw * 2, 3); fxx.fillRect(-dw, dh / 2 - 8, dw * 2, 3);
    fxx.strokeStyle = "#c8a56a"; fxx.lineWidth = 2.5; fxx.beginPath(); fxx.moveTo(0, -dh / 2); fxx.quadraticCurveTo(8, -dh / 2 - 9, 3, -dh / 2 - 16); fxx.stroke();
    const ss = 2.5 + Math.random() * (2 + armT * 5);           // fuse spark grows as it arms
    fxx.shadowColor = "rgba(255,120,40,0.95)"; fxx.shadowBlur = 6 + armT * 24;
    fxx.fillStyle = "#ffd24d"; fxx.beginPath(); fxx.arc(3, -dh / 2 - 16, ss, 0, 7); fxx.fill();
    fxx.fillStyle = "#fff2c0"; fxx.beginPath(); fxx.arc(3, -dh / 2 - 16, ss * 0.5, 0, 7); fxx.fill();
    fxx.restore();
  }
  // rings (soft smoke rings on build, sharp shock rings on blasts)
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.r += (r.grow || 6); r.life -= (r.fade || 0.05); if (r.ry) r.y += r.ry;
    if (r.life <= 0) { rings.splice(i, 1); continue; }
    fxx.save();
    fxx.globalAlpha = Math.max(0, r.life) * (r.smoke ? 0.6 : 1);
    fxx.strokeStyle = r.color; fxx.lineWidth = (r.smoke ? 7 : 3) * r.life + 1;
    if (r.smoke) { fxx.shadowColor = r.color; fxx.shadowBlur = 16; }
    fxx.beginPath(); fxx.ellipse(r.x, r.y, r.r, r.r * 0.55, 0, 0, 7); fxx.stroke();
    fxx.restore();
  }
  // particles (squares for debris/sparks; glowing 4-point stars for star bursts)
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    fxx.globalAlpha = Math.max(0, p.life); fxx.fillStyle = p.color;
    if (p.star) {
      fxx.save(); fxx.translate(p.x, p.y); fxx.shadowColor = p.color; fxx.shadowBlur = 10;
      const s = p.size * p.life; fxx.beginPath();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; fxx.lineTo(Math.cos(a) * s, Math.sin(a) * s); fxx.lineTo(Math.cos(a + Math.PI / 4) * s * 0.4, Math.sin(a + Math.PI / 4) * s * 0.4); }
      fxx.closePath(); fxx.fill(); fxx.restore();
    } else fxx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  fxx.globalAlpha = 1;
  // steal flyers
  for (let i = flyers.length - 1; i >= 0; i--) { const f = flyers[i]; f.t += 1 / 60; if (f.t < 0) continue; const p = Math.min(1, f.t / f.dur); const x = f.sx + (f.ex - f.sx) * p, y = f.sy + (f.ey - f.sy) * p - Math.sin(Math.PI * p) * 130; fxx.globalAlpha = 1 - Math.max(0, (p - 0.8) / 0.2); fxx.fillStyle = f.color; fxx.fillRect(x - 7, y - 7, 14, 14); fxx.strokeStyle = "#fff"; fxx.lineWidth = 1.5; fxx.strokeRect(x - 7, y - 7, 14, 14); if (p >= 1) flyers.splice(i, 1); }
  fxx.globalAlpha = 1;
  // "EXPLOSION" neon text on a blast
  for (let i = explosionText.length - 1; i >= 0; i--) {
    const e = explosionText[i]; e.life -= 0.014; if (e.life <= 0) { explosionText.splice(i, 1); continue; }
    const grow = 1 + (1 - e.life) * 0.4, col = e.team === "red" ? "#ff3b57" : "#38b6ff";
    fxx.save(); fxx.translate(e.x, e.y - 6); fxx.scale(grow, grow); fxx.globalAlpha = Math.min(1, e.life * 2);
    fxx.font = "900 40px 'Luckiest Guy', sans-serif"; fxx.textAlign = "center"; fxx.textBaseline = "middle";
    fxx.lineJoin = "round"; fxx.strokeStyle = "#0a0a12"; fxx.lineWidth = 7; fxx.strokeText("EXPLOSION", 0, 0);
    fxx.shadowColor = col; fxx.shadowBlur = 16; fxx.fillStyle = col; fxx.fillText("EXPLOSION", 0, 0);
    fxx.restore();
  }
  fxx.globalAlpha = 1;
  fxx.restore();
}

/* ---------------- actions ---------------- */
function updateHud(team) {
  const st = state[team];
  // a pending win is CANCELLED if the score falls back below the goal (you must be at goal+ to win)
  if (st.winSecs > 0 && Math.round(st.score) < winScore) { st.winSecs = 0; hideTimer(team); flash(teamName(team) + " DROPPED BELOW " + winScore + "!", "#ff5a52"); sfx("dive", 0.5); }
  el(team + "Score").textContent = Math.round(st.score); el(team + "Goal").textContent = winScore; el(team + "Wins").textContent = st.wins;
  el(team + "Fill").style.width = Math.max(0, Math.min(100, (st.score / winScore) * 100)) + "%";
}
function bumpWin(team) { const h = el(team + "WinsBox"); h.classList.remove("bump-win"); void h.offsetWidth; h.classList.add("bump-win"); }
// Hitting winScore no longer banks instantly — it starts a 30s PENDING WIN the
// other side can steal before it lands.
function checkWin(team) {
  const st = state[team];
  // reaching the goal starts a pending win; the score STAYS at the goal until it lands/steals
  if (Math.round(st.score) >= winScore && st.winSecs <= 0 && st.resetSecs <= 0) startWinCountdown(team);
}
// gifts don't snap the score — they QUEUE it so the tower visibly climbs / shrinks over ~2s
function queueScore(team, delta) {
  const st = state[team];
  st.queue += delta;
  st.qStep = Math.max(0.35, Math.abs(st.queue) / 150); // ~2.5s to drain the current queue
}
function addPoints(team, delta) {
  const st = state[team];
  if (delta > 0) {
    queueScore(team, delta);
    st.glow = 1; st.pop = 1; st.kick = Math.min(3.2, st.kick + (delta >= 250 ? 2.4 : 1.1));
    spawnRise(team, delta); ringPulse(team); addStars(team, 12);
    sfx(delta >= 250 ? "launch" : "arm", delta >= 250 ? Math.min(1, delta / 2500) : true);
  } else if (delta < 0) {
    dropBomb(team, -delta, false); // dynamite falls + fuses ~2s, then queues the drop (tower shrinks gradually)
  }
}
function addWin(team) { const st = state[team]; st.wins++; save("wins_" + team, st.wins); bumpWin(team); spawnConfetti(150, team); flash("+1 WIN — " + teamName(team), TEAMS[team].accent); sfx("boom", true); sfx("milestone"); updateHud(team); }
function subWin(team) { const st = state[team]; if (st.wins > 0) st.wins--; save("wins_" + team, st.wins); bumpWin(team); flash("-1 WIN — " + teamName(team), "#ff5a52"); sfx("dive", 0.6); updateHud(team); }
function resetTowerShape(team) { state[team].streak = 0; }

/* ---- CLICK-TO-STACK: a click places on BOTH towers (+1 each). Perfect keeps width,
   a miss slices the overhang off, every 5 perfects grows the block back. No streak UI. ---- */
// Pure timing: land the block if it's over the tower when you click, else it falls off and you drop 10.
function placeOne(team) {
  const st = state[team];
  if (towerFrozen(team)) return; // paused side (mid reset or mid win countdown) can't be clicked
  if (Math.abs(st.moverOffset) <= LAND_TOL) {
    // TIMED RIGHT -> block lands (full size, straight), +1
    st.score += 1; st.pop = 1; st.glow = 0.6;
    st.streak = (st.streak || 0) + 1;
    ringPulse(team); addStars(team, 8);        // circle + stars on every click
    sfx("place");                              // one satisfying, consistent placement sound
    checkWin(team); updateHud(team);
  } else {
    // MISTIMED -> the block slides right off the tower and you drop 10
    spawnMissBlock(team, Math.sign(st.moverOffset) || 1);
    st.score = Math.max(0, st.score - MISS_PENALTY); st.streak = 0; st.shake = Math.min(11, st.shake + 2.4);
    flash(teamName(team) + " MISS  −" + MISS_PENALTY, "#ff5a52"); sfx("miss"); updateHud(team);
  }
}
function stackClick() { ensureAudio(); if (clickSide === "both" || clickSide === "red") placeOne("red"); if (clickSide === "both" || clickSide === "blue") placeOne("blue"); }
function spawnMissBlock(team, dir) { // the full block that missed tumbles off into the void
  const t = towers[team], y0 = BOX_HEIGHT * (Math.floor(state[team].disp) + 1);
  const g = new THREE.Group(); g.scale.set(SIZE, BOX_HEIGHT, SIZE);
  g.position.set(state[team].moverOffset, y0, 0); addEdges(g);
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: new THREE.Color(0x5a5a5a), color: new THREE.Color(colorFor(t.palette, Math.floor(state[team].disp) + 1)) });
  g.add(new THREE.Mesh(unitGeo, mat)); t.scene.add(g);
  debris.push({ team, g, mat, vx: dir * (0.5 + Math.random() * 0.3), vy: 0.1, vz: 0, rx: dir * 0.05, ry: 0, rz: dir * 0.14, life: 1 });
}
// little star sparkles bursting out (used on grow + gift up + explosions)
function addStars(team, n, big) {
  const t = towerTop(team); n = n || 10; const col = team === "red" ? "#ffd76b" : "#9fe4ff";
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = (big ? 4 : 2.5) + Math.random() * 3; particles.push({ x: t.x, y: t.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.65 - 1, life: 1, decay: 0.014 + Math.random() * 0.012, color: Math.random() < 0.5 ? col : "#ffffff", size: 6 + Math.random() * 5, g: 0.05, star: true }); }
}
/* ---- per-side countdown timers (reset & pending-win) ---- */
const RESET_SECS = 30, WIN_SECS = 30;
function showTimer(team, label, secs, total, urgent, mode) {
  const t = el(team + "Timer"); t.classList.remove("hidden");
  t.classList.toggle("urgent", urgent);
  t.classList.toggle("reset-mode", mode === "reset"); // bounce animation only on the reset timer
  el(team + "TimerLabel").textContent = label;
  el(team + "TimerNum").textContent = secs;
  el(team + "TimerFill").style.width = (secs / total * 100) + "%";
  el(team + "TimerSub").textContent = mode === "win" ? "OTHER TEAM CAN STEAL THE WIN!" : "";
}
function hideTimer(team) { const t = el(team + "Timer"); t.classList.add("hidden"); t.classList.remove("reset-mode", "urgent"); }
function startResetCountdown(team) {
  const st = state[team]; if (st.resetSecs > 0) return;
  st.resetSecs = RESET_SECS; showTimer(team, "RESETTING", st.resetSecs, RESET_SECS, false, "reset");
  flash(teamName(team) + " RESETTING…", TEAMS[team].accent); sfx("dive", 0.4);
}
function saveTeam(team) {
  const st = state[team];
  if (st.resetSecs > 0) {
    st.resetSecs = 0; spawnConfetti(130, team); flash(teamName(team) + " SAVED!", "#6bff9a"); sfx("save"); sfx("boom", true);
    if (st.winSecs > 0) showTimer(team, "WIN IN", st.winSecs, WIN_SECS, st.winSecs <= 10, "win"); else hideTimer(team);
  } else { spawnConfetti(50, team); flash("SAVED!", "#6bff9a"); sfx("save"); }
}
function doReset(team) { // countdown hit zero -> collapse the tower immediately
  const st = state[team], tp = towerTop(team);
  spawnDebris(team, 16);
  rings.push({ x: tp.x, y: tp.y, r: 8, life: 1, color: team === "red" ? "#ff5a72" : "#ffb347", grow: 11 });
  st.score = 0; st.queue = 0; st.resetSecs = 0; hideTimer(team); resetTowerShape(team);
  st.shake = Math.min(24, st.shake + 9); shake = Math.min(20, shake + 3); updateHud(team);
  flash(teamName(team) + " RESET", TEAMS[team].accent); sfx("reset"); sfx("explode", 0.9);
}
function startWinCountdown(team) {
  const st = state[team]; st.queue = Math.min(0, st.queue); st.winSecs = WIN_SECS; showTimer(team, "WIN IN", st.winSecs, WIN_SECS, false, "win"); // stop the climb at the goal
  flash(teamName(team) + " WIN INCOMING!", TEAMS[team].accent); sfx("milestone");
  flash(teamName(team) + " WIN INCOMING!", TEAMS[team].accent); sfx("milestone");
}
function confirmWin(team) { // countdown landed -> award the win and NOW reset the tower to 0
  const st = state[team]; st.winSecs = 0; hideTimer(team);
  st.wins++; save("wins_" + team, st.wins); bumpWin(team); spawnConfetti(170, team);
  st.score = 0; st.queue = 0; resetTowerShape(team); updateHud(team);
  flash(teamName(team) + " WIN!", TEAMS[team].accent); sfx("boom", true); sfx("milestone");
}
function stealWin(byTeam, fromTeam) {
  // HOT POTATO: stealing doesn't win instantly — it hands the thief an instant goal-score
  // and a FRESH 30s countdown they now have to survive. The other side can steal it back,
  // and it keeps bouncing until one side's countdown runs out (then that side actually wins).
  state[fromTeam].winSecs = 0; hideTimer(fromTeam); state[fromTeam].score = 0; state[fromTeam].queue = 0; resetTowerShape(fromTeam); updateHud(fromTeam);
  const st = state[byTeam];
  st.score = winScore; st.queue = 0; st.glow = 1; st.pop = 1; // instant goal score on the thief's tower
  spawnFlyers(fromTeam, byTeam, 14); spawnConfetti(120, byTeam); addStars(byTeam, 14, true);
  updateHud(byTeam);
  startWinCountdown(byTeam);                                   // fresh 30s on their side
  flash(teamName(byTeam) + " STOLE THE WIN!", TEAMS[byTeam].accent); sfx("boom", true);
}
function stealWinAction(team) { // dedicated "steal their win" control
  const oid = TEAMS[team].other;
  if (state[oid].winSecs > 0) stealWin(team, oid);
  else { flash("NO WIN TO STEAL", "#fff"); sfx("miss"); }
}
function stealFrom(team) { // dedicated "steal points" control
  const oid = TEAMS[team].other, st = state[team], other = state[oid];
  const amt = Math.min(amounts[team + "_steal"], Math.round(other.score));
  if (amt <= 0) { flash("NOTHING TO STEAL", "#fff"); sfx("miss"); return; }
  other.score -= amt; st.score += amt; st.glow = 1;
  spawnFlyers(oid, team, Math.max(6, Math.min(20, Math.round(amt / 60))));
  checkWin(team); updateHud(team); updateHud(oid);
  flash(teamName(team) + " STOLE " + amt + "!", TEAMS[team].accent); sfx("dive", 0.7); sfx("save");
}
function tickTeam(team) {
  const st = state[team];
  if (st.winSecs > 0) { st.winSecs--; if (st.winSecs <= 0) { confirmWin(team); return; } }
  if (st.resetSecs > 0) { st.resetSecs--; if (st.resetSecs <= 0) { doReset(team); return; } }
  if (st.winSecs > 0) { showTimer(team, "WIN IN", st.winSecs, WIN_SECS, st.winSecs <= 10, "win"); if (st.winSecs <= 10) sfx("tick", true); }
  else if (st.resetSecs > 0) { showTimer(team, "RESETTING", st.resetSecs, RESET_SECS, st.resetSecs <= 10, "reset"); if (st.resetSecs <= 10) sfx("tick", true); }
}
function doAction(actId) {
  const i = actId.indexOf("_"), team = actId.slice(0, i), slot = actId.slice(i + 1);
  if (!state[team]) return; ensureAudio();
  if (slot === "reset") startResetCountdown(team);
  else if (slot === "save") saveTeam(team);
  else if (slot === "steal") stealFrom(team);
  else if (slot === "stealwin") stealWinAction(team);
  else if (slot === "addwin") addWin(team);
  else if (slot === "subwin") subWin(team);
  else if (slot[0] === "u") { const a = amounts[actId]; if (a > 0) addPoints(team, a); }
  else if (slot[0] === "d") { const a = amounts[actId]; if (a > 0) addPoints(team, -a); }
}
/* fx spawners */
function spawnConfetti(count, team) {
  const cont = el("confetti"); if (!cont) return;
  const reds = ["#ff3b57", "#ff6d84", "#ffd14d", "#ffffff", "#ff1e3c"], blues = ["#38b6ff", "#7fd0ff", "#4dffea", "#ffffff", "#1e90ff"];
  const colors = team === "red" ? reds : team === "blue" ? blues : reds.concat(blues), xmin = team === "red" ? 6 : team === "blue" ? 50 : 0, xspan = team ? 44 : 100;
  for (let i = 0; i < count; i++) { const p = document.createElement("div"); p.className = "confetti-piece"; p.style.left = (xmin + Math.random() * xspan).toFixed(1) + "%"; p.style.background = colors[(Math.random() * colors.length) | 0]; const sz = 6 + Math.random() * 9; p.style.width = sz.toFixed(0) + "px"; p.style.height = (sz * 0.5).toFixed(0) + "px"; const dur = 1.6 + Math.random() * 1.9; p.style.animationDuration = dur.toFixed(2) + "s"; p.style.animationDelay = (Math.random() * 0.3).toFixed(2) + "s"; p.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0) + "deg"); p.style.setProperty("--drift", (Math.random() * 220 - 110).toFixed(0) + "px"); cont.appendChild(p); setTimeout(() => p.remove(), (dur + 0.5) * 1000); }
}
function spawnRise(team, delta) {
  const t = towerTop(team), n = Math.min(28, 10 + Math.round(delta / 55));
  const acc = team === "red" ? ["#ff6d84", "#ffd76b", "#ffffff"] : ["#7fd0ff", "#4dffea", "#ffffff"];
  for (let i = 0; i < n; i++) particles.push({ x: t.x + (Math.random() * 2 - 1) * 52, y: t.y + Math.random() * 44, vx: (Math.random() * 2 - 1) * 0.6, vy: -(3 + Math.random() * 3.6), life: 1, decay: 0.02 + Math.random() * 0.02, color: acc[(Math.random() * acc.length) | 0], size: 3 + Math.random() * 4, g: -0.02 });
}
function ringPulse(team) { // big SMOKE ring on GIFT up: grows well past the blocks, lingers a few seconds, fades
  if (rings.length > 8) rings.shift();
  const t = towerTop(team);
  rings.push({ x: t.x, y: t.y, r: 16, life: 1, color: TEAMS[team].accent, grow: 1.7, fade: 0.006, smoke: true });
}
function dropBomb(team, amount, wipe) { const t = towerTop(team); bombs.push({ team, x: t.x, y: -34, vy: 2.6, targetY: t.y, amount: amount || 0, wipe: !!wipe, landed: false, fuse: 0 }); sfx("dive", 0.5); }
function explodeBomb(b) {
  const st = state[b.team];
  // queue the drop so the tower shrinks gradually after the blast (noticeable), not an instant snap
  if (b.wipe) queueScore(b.team, -(st.score + st.queue)); else queueScore(b.team, -b.amount);
  updateHud(b.team);
  const col = b.team === "red" ? "#ff5a72" : "#ffb347";
  for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 8; particles.push({ x: b.x, y: b.targetY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 1, decay: 0.018 + Math.random() * 0.02, color: Math.random() < 0.5 ? col : "#fff", size: 4 + Math.random() * 7, g: 0.22 }); }
  rings.push({ x: b.x, y: b.targetY, r: 8, life: 1, color: col, grow: 12 });
  addStars(b.team, 16, true);                       // comic star burst
  explosionText.push({ team: b.team, x: b.x, y: b.targetY, life: 1 });
  spawnDebris(b.team, Math.min(18, 6 + Math.round((b.amount || 400) / 150)));
  st.shake = Math.min(24, st.shake + 8); shake = Math.min(18, shake + 3);
  sfx("explode", Math.min(1, 0.5 + (b.amount || 400) / 2000)); sfx("boom", false);
}
function spawnFlyers(from, to, n) { const a = towerTop(from), b = towerTop(to), col = to === "red" ? "#ff5a72" : "#39d0ff"; for (let i = 0; i < n; i++) flyers.push({ sx: a.x, sy: a.y, ex: b.x + (Math.random() * 40 - 20), ey: b.y - Math.random() * 30, t: -i * 0.03, dur: 0.55 + Math.random() * 0.2, color: col }); }
let flashTimer = null;
function flash(text, color) { const f = el("flash"); f.textContent = text; f.style.color = color || "#fff"; f.classList.remove("show"); void f.offsetWidth; f.classList.add("show"); if (flashTimer) clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove("show"), 1100); }

/* ---------------- resize + loop ---------------- */
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  W = Math.min(vw, Math.round(vh * STAGE_RATIO)); H = vh;
  stageEl.style.setProperty("--stageW", W + "px");
  for (const c of [bg, fx]) { c.width = Math.floor(W * DPR); c.height = Math.floor(H * DPR); c.style.width = W + "px"; c.style.height = H + "px"; }
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  const halfAspect = (W / 2) / H, viewW = VIEW_H * halfAspect;
  cam.left = -viewW / 2; cam.right = viewW / 2; cam.top = VIEW_H / 2; cam.bottom = -VIEW_H / 2; cam.updateProjectionMatrix();
  if (FAT) { edgeBlack.resolution.set(W / 2, H); edgeWhite.resolution.set(W / 2, H); } // fat-line thickness in px
  skyRed = makeSky(0, W / 2); skyBlue = makeSky(W / 2, W);
}
function frame() {
  T += 1 / 60; shake *= 0.86;
  for (const t of ["red", "blue"]) {
    const st = state[t];
    // drain queued gift/bomb points gradually so the tower visibly climbs / shrinks
    if (Math.abs(st.queue) >= 0.001) {
      const dir = Math.sign(st.queue), step = Math.min(Math.abs(st.queue), st.qStep) * dir;
      st.score = Math.max(0, st.score + step); st.queue -= step;
      if (dir > 0) {
        st.glow = Math.max(st.glow, 0.5); checkWin(t);
        // rising energy ring that climbs the tower + sparkles, so the gift-up reads as blocks pushing up
        if (T - st.climbRingT > 0.11) {
          st.climbRingT = T; const tp = towerTop(t);
          rings.push({ x: tp.x, y: tp.y + 52, r: SIZE * 2.4, life: 1, color: TEAMS[t].accent, grow: 0.9, fade: 0.028, ry: -3.6, smoke: true });
          addStars(t, 3);
        }
      }
      updateHud(t);
    }
    st.disp += (st.score - st.disp) * (Math.abs(st.queue) > 0.001 ? 0.32 : 0.2); // snappier follow while a gift is climbing
    st.blockPop *= 0.5; st.glow *= 0.94; st.kick *= 0.8; st.shake *= 0.86; st.pop *= 0.88;
  }
  updateDebris();
  drawBG(); updateTower("red"); updateTower("blue"); renderThree(); drawFX();
  requestAnimationFrame(frame);
}

/* ---------------- panel + movable + wiring (unchanged structure) ---------------- */
let listening = null;
function keyLabel(k) { return !k ? "—" : k === " " ? "Spc" : k.length === 1 ? k.toUpperCase() : k; }
function makeKbd(a) {
  const wrap = document.createElement("div"); wrap.className = "kbd-wrap";
  const k = document.createElement("div"); k.className = "kbd"; k.textContent = keyLabel(binds[a]); k.dataset.act = a;
  k.addEventListener("click", () => { document.querySelectorAll(".kbd.listening").forEach((e) => e.classList.remove("listening")); listening = a; k.classList.add("listening"); k.textContent = "…"; });
  const unb = document.createElement("button"); unb.className = "kbd-unbind"; unb.textContent = "×"; unb.title = "Unbind";
  unb.addEventListener("click", (e) => { e.stopPropagation(); binds[a] = ""; save("binds", JSON.stringify(binds)); listening = null; refreshKbdLabels(); });
  wrap.appendChild(k); wrap.appendChild(unb);
  return wrap;
}
function makeAmt(a) { const i = document.createElement("input"); i.type = "number"; i.min = "1"; i.className = "amt"; i.value = amounts[a]; i.addEventListener("input", () => { amounts[a] = Math.max(0, parseInt(i.value, 10) || 0); save("amt_" + a, amounts[a]); }); i.addEventListener("focus", () => i.select()); return i; }
function span(cls, txt) { const s = document.createElement("span"); s.className = cls; s.textContent = txt; return s; }
function row(cells) { const r = document.createElement("div"); r.className = "ctrl-row"; cells.forEach((c) => r.appendChild(c)); return r; }
function divider(t) { const d = document.createElement("div"); d.className = "ctrl-divider"; d.textContent = t; return d; }
function buildControls(team, c) {
  c.innerHTML = "";
  const nameRow = document.createElement("div"); nameRow.className = "pl-row";
  nameRow.appendChild(span("", "Team name"));
  const ni = document.createElement("input"); ni.type = "text"; ni.className = "pl-num name-input"; ni.value = teamNames[team]; ni.maxLength = 18;
  ni.addEventListener("input", () => { teamNames[team] = ni.value || TEAMS[team].name; save("name_" + team, teamNames[team]); applyNames(); });
  nameRow.appendChild(ni); c.appendChild(nameRow);
  c.appendChild(divider("Score up (rocket)"));
  UP.forEach((s) => { const a = team + "_" + s; c.appendChild(row([makeAmt(a), span("lab", "+ points"), makeKbd(a)])); });
  c.appendChild(row([span("", ""), span("lab win", "+1 WIN"), makeKbd(team + "_addwin")]));
  c.appendChild(divider("Score down (bomb)"));
  DOWN.forEach((s) => { const a = team + "_" + s; c.appendChild(row([makeAmt(a), span("lab", "− points"), makeKbd(a)])); });
  c.appendChild(row([span("", ""), span("lab win", "−1 WIN"), makeKbd(team + "_subwin")]));
  c.appendChild(divider("Actions"));
  c.appendChild(row([span("", ""), span("lab", "Reset (30s countdown)"), makeKbd(team + "_reset")]));
  c.appendChild(row([span("", ""), span("lab", "Save (stop the reset)"), makeKbd(team + "_save")]));
  c.appendChild(row([makeAmt(team + "_steal"), span("lab", "Steal points"), makeKbd(team + "_steal")]));
  c.appendChild(row([span("", ""), span("lab win", "Steal their WIN"), makeKbd(team + "_stealwin")]));
}
function refreshKbdLabels() { document.querySelectorAll(".kbd").forEach((k) => { k.classList.remove("listening"); k.textContent = keyLabel(binds[k.dataset.act]); }); }
function initMovable() {
  document.querySelectorAll(".movable").forEach((elm) => {
    const id = elm.dataset.mv, d = MV_DEFAULT[id] || { x: 50, y: 50, s: 100 };
    let x = parseFloat(load("mvx_" + id, d.x)), y = parseFloat(load("mvy_" + id, d.y)), s = parseFloat(load("mvs_" + id, d.s));
    const apply = () => { elm.style.left = x + "%"; elm.style.top = y + "%"; elm.style.transform = "translate(-50%,-50%) scale(" + s / 100 + ")"; }; apply();
    let dragging = false, ox = 0, oy = 0;
    elm.addEventListener("pointerdown", (e) => { if (!document.body.classList.contains("editing")) return; e.preventDefault(); dragging = true; elm.classList.add("grabbing"); try { elm.setPointerCapture(e.pointerId); } catch (x) {} const r = elm.getBoundingClientRect(); ox = e.clientX - (r.left + r.width / 2); oy = e.clientY - (r.top + r.height / 2); });
    elm.addEventListener("pointermove", (e) => { if (!dragging) return; e.preventDefault(); const sr = stageEl.getBoundingClientRect(); x = Math.max(0, Math.min(100, ((e.clientX - ox - sr.left) / Math.max(1, sr.width)) * 100)); y = Math.max(0, Math.min(100, ((e.clientY - oy - sr.top) / Math.max(1, sr.height)) * 100)); apply(); });
    const end = (e) => { if (!dragging) return; dragging = false; elm.classList.remove("grabbing"); try { elm.releasePointerCapture(e.pointerId); } catch (x) {} save("mvx_" + id, x); save("mvy_" + id, y); };
    elm.addEventListener("pointerup", end); elm.addEventListener("pointercancel", end);
    elm.addEventListener("wheel", (e) => { if (!document.body.classList.contains("editing")) return; e.preventDefault(); s = Math.max(40, Math.min(320, s + (e.deltaY < 0 ? 6 : -6))); apply(); save("mvs_" + id, s); }, { passive: false });
  });
}
function resetLayout() { for (const id in MV_DEFAULT) { save("mvx_" + id, MV_DEFAULT[id].x); save("mvy_" + id, MV_DEFAULT[id].y); save("mvs_" + id, MV_DEFAULT[id].s); } document.querySelectorAll(".movable").forEach((elm) => { const d = MV_DEFAULT[elm.dataset.mv]; if (!d) return; elm.style.left = d.x + "%"; elm.style.top = d.y + "%"; elm.style.transform = "translate(-50%,-50%) scale(" + d.s / 100 + ")"; }); }

let audioReady = false;
function ensureAudio() { if (!audioReady) { audioReady = true; try { SFX && SFX.resume && SFX.resume(); } catch (e) {} } }
function init() {
  setupThree(); resize(); window.addEventListener("resize", resize);
  applyNames();
  updateHud("red"); updateHud("blue");
  buildControls("red", el("redControls")); buildControls("blue", el("blueControls"));
  initMovable();
  const vol = el("volRange"); let v = parseInt(load("vol", 60), 10); vol.value = v; if (window.SFX) SFX.setVolume(v / 100);
  vol.addEventListener("input", () => { v = +vol.value; save("vol", v); if (window.SFX) SFX.setVolume(v / 100); });
  const spd = el("speedRange"); spd.value = Math.round(slideSpeed * 100);
  spd.addEventListener("input", () => { slideSpeed = +spd.value / 100; save("slideSpeed", slideSpeed); });
  const css = el("clickSideSel"); css.value = clickSide;
  css.addEventListener("change", () => { clickSide = css.value; save("clickSide", clickSide); });
  const wsi = el("winScoreInput"); wsi.value = winScore;
  wsi.addEventListener("change", () => { winScore = Math.max(10, parseInt(wsi.value, 10) || 1000); wsi.value = winScore; save("winScore", winScore); updateHud("red"); updateHud("blue"); });
  const panel = el("panel"); const toggle = () => { ensureAudio(); panel.classList.toggle("open"); };
  el("menuBtn").addEventListener("click", () => { if (!document.body.classList.contains("editing")) toggle(); });
  el("panelClose").addEventListener("click", () => panel.classList.remove("open"));
  el("editLayout").addEventListener("change", (e) => document.body.classList.toggle("editing", e.target.checked));
  el("resetLayout").addEventListener("click", resetLayout);
  el("resetBinds").addEventListener("click", () => { binds = { ...BIND_DEFAULT }; save("binds", JSON.stringify(binds)); refreshKbdLabels(); });
  document.querySelectorAll(".sc-btn").forEach((b) => b.addEventListener("click", () => { if (!document.body.classList.contains("editing")) doAction(b.dataset.act); }));
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === "m") { e.preventDefault(); toggle(); return; }
    if (listening) { e.preventDefault(); for (const a in binds) if (binds[a] === k && a !== listening) binds[a] = ""; binds[listening] = k; save("binds", JSON.stringify(binds)); listening = null; refreshKbdLabels(); return; }
    const tag = e.target && e.target.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    for (const a in binds) { if (binds[a] === k) { e.preventDefault(); doAction(a); break; } }
  });
  // click / tap on the play field DROPS the moving block on both towers (real stack: perfect / slice / whiff)
  stageEl.addEventListener("pointerdown", (e) => {
    if (document.body.classList.contains("editing")) return;
    if (e.target.closest && e.target.closest("#panel, #menuBtn, .movable, button, input")) return;
    stackClick();
  });
  setInterval(() => { tickTeam("red"); tickTeam("blue"); }, 1000); // per-side countdowns
  requestAnimationFrame(frame);
}
init();
