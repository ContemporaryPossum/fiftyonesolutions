/* =========================================================
   Scroll-reactive vector background
   A single WebGL canvas: a grid of points + wireframe lines that
   morphs between eight "formations" as the page scrolls
   (globe, vortex, terrain, tunnel, helix, torus, clusters, "51").
   Scroll position also scrubs each formation's own animation,
   so the scene plays like a vector video tied to the scrollbar.
   ========================================================= */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Rotate (Y then X) and offset a point into out[k..k+2] */
function put(out, k, x, y, z, cy, sy, cx, sx, o) {
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  out[k] = x1 + o[0];
  out[k + 1] = y * cx - z1 * sx + o[1];
  out[k + 2] = y * sx + z1 * cx + o[2];
}

/* Sample the "51" mark into lattice points (row-major order keeps neighbours close) */
function sampleMark(count) {
  const w = 640, h = 420;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '800 390px Geist, "Arial Black", Arial, sans-serif';
  ctx.fillText("51", w / 2, h / 2 + 18);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pts = [];
  const step = 3;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] > 140) pts.push((x - w / 2) * 0.025, -(y - h / 2) * 0.025);
    }
  }
  const m = pts.length / 2 || 1;
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const s = Math.floor((i * m) / count);
    out[i * 2] = pts[s * 2] || 0;
    out[i * 2 + 1] = pts[s * 2 + 1] || 0;
  }
  return out;
}

const NOISE_GLSL = /* glsl */ `
  uniform vec2 uMouse;
  uniform float uMouseStr;
  uniform float uAspect;
  vec4 displace(vec4 clip) {
    vec2 ndc = clip.xy / clip.w;
    vec2 d = ndc - uMouse;
    d.x *= uAspect;
    float dist = length(d);
    float f = smoothstep(0.42, 0.0, dist) * uMouseStr;
    vec2 dir = d / max(dist, 1e-4);
    dir.x /= uAspect;
    ndc += dir * f * 0.075;
    clip.xy = ndc * clip.w;
    return clip;
  }
`;

const POINT_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uSize;
  uniform float uPR;
  uniform float uTime;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vAccent;
  ${NOISE_GLSL}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = displace(projectionMatrix * mv);
    float depth = -mv.z;
    float size = uSize * uPR * (22.0 / max(depth, 0.1)) * (0.55 + aSeed * 0.9);
    gl_PointSize = min(size, 9.0 * uPR);
    vAlpha = smoothstep(70.0, 16.0, depth) * smoothstep(0.5, 6.0, depth) * uOpacity;
    float isAccent = step(0.93, aSeed);
    vAccent = isAccent * (0.55 + 0.45 * sin(uTime * 2.2 + aSeed * 90.0));
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uAccentMix;
  varying float vAlpha;
  varying float vAccent;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.12, d);
    vec3 col = mix(uColor, uAccent, clamp(vAccent * uAccentMix * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, a * vAlpha * (0.75 + vAccent * 0.6));
  }
`;

const LINE_VERT = /* glsl */ `
  attribute float aAlpha;
  uniform float uOpacity;
  varying float vAlpha;
  ${NOISE_GLSL}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = displace(projectionMatrix * mv);
    float depth = -mv.z;
    vAlpha = aAlpha * smoothstep(64.0, 14.0, depth) * smoothstep(0.5, 6.0, depth) * uOpacity;
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }
`;

export const FORMATIONS = ["globe", "vortex", "terrain", "tunnel", "helix", "torus", "clusters", "mark"];

export function createBackground(canvas, { mobile = false, reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 0, 22);

  const U = mobile ? 72 : 112;
  const V = mobile ? 36 : 56;
  const N = U * V;
  const rnd = mulberry32(51);

  const seeds = new Float32Array(N);
  const delays = new Float32Array(N);
  const dirs = new Float32Array(N * 3);
  const scatter = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = (i % U) / U;
    seeds[i] = rnd();
    delays[i] = 0.62 * rnd() + 0.38 * u;
    const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
    dirs[i * 3] = Math.sin(ph) * Math.cos(th);
    dirs[i * 3 + 1] = Math.sin(ph) * Math.sin(th);
    dirs[i * 3 + 2] = Math.cos(ph);
    const r = 26 + rnd() * 30;
    scatter[i * 3] = dirs[i * 3] * r;
    scatter[i * 3 + 1] = dirs[i * 3 + 1] * r;
    scatter[i * 3 + 2] = dirs[i * 3 + 2] * r - 10;
  }

  /* ---------- Formations ---------- */
  const markPts = sampleMark(N);
  const F = [
    { // 0 globe
      offset: [5.6, 0.9, 0], mOffset: [0, 5.8, -12], line: 0.44, dim: 1, maxLen: 1.1,
      base(u, v) {
        const lon = u * TAU, lat = (v - 0.5) * Math.PI * 0.94, R = 5.8;
        return [R * Math.cos(lat) * Math.cos(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.sin(lon)];
      },
      frame(b, out, t, o) {
        const ry = t * 0.11, rx = 0.34;
        const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
        for (let i = 0, k = 0; i < N; i++, k += 3) put(out, k, b[k], b[k + 1], b[k + 2], cy, sy, cx, sx, o);
      },
    },
    { // 1 vortex
      offset: [1.5, -0.6, -4], mOffset: [0, 0.8, -9], line: 0.32, dim: 0.9, maxLen: 1.5,
      base(u, v) { return [1.1 + v * 12.5, u * TAU, rnd() - 0.5]; },
      frame(b, out, t, o) {
        const rx = 1.08, cx = Math.cos(rx), sx = Math.sin(rx);
        for (let i = 0, k = 0; i < N; i++, k += 3) {
          const r = b[k], a = b[k + 1] + r * 0.3 - t * 0.12;
          const y = Math.sin(b[k + 1] * 3 + r * 0.5 + t * 0.8) * 0.4 + b[k + 2] * 0.25;
          put(out, k, r * Math.cos(a), y, r * Math.sin(a), 1, 0, cx, sx, o);
        }
      },
    },
    { // 2 terrain
      offset: [0, 0, 0], mOffset: [0, 1, -4], line: 0.46, dim: 0.85, maxLen: 1.5,
      base(u, v) { return [(u - 0.5) * 46, 0, (v - 0.5) * 30]; },
      frame(b, out, t, o) {
        for (let i = 0, k = 0; i < N; i++, k += 3) {
          const x = b[k], z = b[k + 2];
          const y = -3.8
            + 1.15 * Math.sin(x * 0.27 + t * 0.7) * Math.cos(z * 0.33 + t * 0.45)
            + 0.55 * Math.sin((x - z) * 0.18 - t * 0.6)
            + 0.22 * Math.sin(x * 0.9 + z * 0.7 + t * 1.3);
          out[k] = x + o[0];
          out[k + 1] = y + o[1];
          out[k + 2] = z - 7 + o[2];
        }
      },
    },
    { // 3 tunnel
      offset: [0, 0, 0], mOffset: [0, 0, 0], line: 0.3, dim: 0.5, maxLen: 1.9,
      base(u, v) { return [u * TAU, v, 0]; },
      frame(b, out, t, o) {
        const L = 72;
        for (let i = 0, k = 0; i < N; i++, k += 3) {
          const a = b[k] + t * 0.06;
          const z = 16 - (((b[k + 1] + t * 0.035) % 1) + 1) % 1 * L;
          const r = 6.6 + 0.5 * Math.sin(b[k] * 5 + z * 0.22 + t * 1.4);
          out[k] = Math.cos(a) * r + o[0];
          out[k + 1] = Math.sin(a) * r + o[1];
          out[k + 2] = z + o[2];
        }
      },
    },
    { // 4 helix ribbon
      offset: [0, 0.4, 0], mOffset: [0, 2.6, -9], line: 0.42, dim: 0.8, maxLen: 1.3,
      base(u, v) { return [u, v - 0.5, 0]; },
      frame(b, out, t, o) {
        const rz = -0.2, cz = Math.cos(rz), sz = Math.sin(rz);
        for (let i = 0, k = 0; i < N; i++, k += 3) {
          const u = b[k], w = b[k + 1];
          const ang = u * TAU * 1.25 + t * 0.4;
          const width = 2.8 + 0.9 * Math.sin(u * TAU * 2 + t * 0.3);
          const x = (u - 0.5) * 38;
          const y = w * width * Math.cos(ang) + Math.sin(u * TAU + t * 0.5) * 1.3;
          const z = w * width * Math.sin(ang);
          out[k] = x * cz - y * sz + o[0];
          out[k + 1] = x * sz + y * cz + o[1];
          out[k + 2] = z + o[2];
        }
      },
    },
    { // 5 torus
      offset: [5.8, 0, -2], mOffset: [0, 3.2, -9], line: 0.42, dim: 0.72, maxLen: 1.25,
      base(u, v) {
        const th = u * TAU, ph = v * TAU, R = 5.1, r = 2.1;
        return [(R + r * Math.cos(ph)) * Math.cos(th), r * Math.sin(ph), (R + r * Math.cos(ph)) * Math.sin(th)];
      },
      frame(b, out, t, o) {
        const ry = t * 0.14, rx = 1.0 + Math.sin(t * 0.2) * 0.18;
        const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
        for (let i = 0, k = 0; i < N; i++, k += 3) put(out, k, b[k], b[k + 1], b[k + 2], cy, sy, cx, sx, o);
      },
    },
    { // 6 clusters (hub + four partners)
      offset: [2.5, 0.4, -7], mOffset: [0, 2.6, -11], line: 0.3, dim: 0.42, maxLen: 1.1,
      base(u, v) {
        let g, lu;
        if (u < 0.4) { g = 0; lu = u / 0.4; } else { g = 1 + Math.min(3, Math.floor((u - 0.4) / 0.15)); lu = (u - 0.4 - (g - 1) * 0.15) / 0.15; }
        const R = g === 0 ? 3.1 : 1.55;
        const lon = lu * TAU, lat = (v - 0.5) * Math.PI * 0.94;
        let cx = 0, cy = 0, cz = 0;
        if (g > 0) { const a = TAU * (g - 1) / 4 + Math.PI / 4; cx = Math.cos(a) * 7.6; cy = Math.sin(a) * 5.2; cz = g % 2 ? 1.6 : -1.6; }
        return [cx + R * Math.cos(lat) * Math.cos(lon), cy + R * Math.sin(lat), cz + R * Math.cos(lat) * Math.sin(lon)];
      },
      frame(b, out, t, o) {
        const ry = Math.sin(t * 0.18) * 0.5, rx = 0.25 + Math.sin(t * 0.13) * 0.1;
        const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
        for (let i = 0, k = 0; i < N; i++, k += 3) put(out, k, b[k], b[k + 1], b[k + 2], cy, sy, cx, sx, o);
      },
    },
    { // 7 the "51" mark
      offset: [6.2, 2.4, -1], mOffset: [0, 3.6, -8], line: 0.22, dim: 1, maxLen: 0.55,
      base(u, v, i) { return [markPts[i * 2], markPts[i * 2 + 1], (rnd() - 0.5) * 0.7]; },
      frame(b, out, t, o) {
        const ry = Math.sin(t * 0.35) * 0.24, cy = Math.cos(ry), sy = Math.sin(ry);
        for (let i = 0, k = 0; i < N; i++, k += 3) {
          const x = b[k], y = b[k + 1];
          const z = b[k + 2] + 0.35 * Math.sin(x * 0.45 + t * 1.2) + 0.2 * Math.cos(y * 0.6 + t * 0.9);
          put(out, k, x, y, z, cy, sy, 1, 0, o);
        }
      },
    },
  ];

  const bases = F.map((form) => {
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const p = form.base((i % U) / U, Math.floor(i / U) / (V - 1), i);
      arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
    }
    return arr;
  });

  /* ---------- Geometry ---------- */
  const positions = new Float32Array(N * 3);
  positions.set(scatter);
  const pGeo = new THREE.BufferGeometry();
  const pAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute("position", pAttr);
  pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

  const shared = {
    uMouse: { value: new THREE.Vector2(9, 9) },
    uMouseStr: { value: 0 },
    uAspect: { value: 1 },
    uOpacity: { value: 1 },
  };
  const pMat = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: {
      ...shared,
      uSize: { value: mobile ? 2.4 : 2.1 },
      uPR: { value: 1 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.74, 0.8, 0.9) },
      uAccent: { value: new THREE.Color(0.78, 0.95, 0.24) },
      uAccentMix: { value: 0.45 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  // Segments: u-neighbours and v-neighbours (with wrap; long jumps fade by length)
  const S = N * 2;
  const segA = new Uint32Array(S), segB = new Uint32Array(S);
  let s = 0;
  for (let v = 0; v < V; v++) {
    for (let u = 0; u < U; u++) {
      const i = v * U + u;
      segA[s] = i; segB[s] = v * U + ((u + 1) % U); s++;
      segA[s] = i; segB[s] = ((v + 1) % V) * U + u; s++;
    }
  }
  const lPos = new Float32Array(S * 6);
  const lAlpha = new Float32Array(S * 2);
  const lGeo = new THREE.BufferGeometry();
  const lPosAttr = new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage);
  const lAlphaAttr = new THREE.BufferAttribute(lAlpha, 1).setUsage(THREE.DynamicDrawUsage);
  lGeo.setAttribute("position", lPosAttr);
  lGeo.setAttribute("aAlpha", lAlphaAttr);
  const lMat = new THREE.ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: { ...shared, uColor: { value: new THREE.Color(0.42, 0.52, 0.68) } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  // Share the same uniform objects so mouse / opacity stay in sync
  lMat.uniforms.uMouse = pMat.uniforms.uMouse;
  lMat.uniforms.uMouseStr = pMat.uniforms.uMouseStr;
  lMat.uniforms.uAspect = pMat.uniforms.uAspect;
  lMat.uniforms.uOpacity = pMat.uniforms.uOpacity;
  const lines = new THREE.LineSegments(lGeo, lMat);
  lines.frustumCulled = false;
  scene.add(lines);

  /* ---------- State ---------- */
  const bufA = new Float32Array(N * 3);
  const bufB = new Float32Array(N * 3);
  const pointer = { x: 9, y: 9, tx: 9, ty: 9, active: 0, lastMove: -10 };
  let fSmooth = 0;
  let vel = 0;
  let boost = 0;
  let introStart = reduced ? -100 : null;
  let isMobileLayout = mobile;
  let lastTime = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pMat.uniforms.uPR.value = pr;
    pMat.uniforms.uAspect.value = w / h;
    isMobileLayout = w < 900;
  }
  resize();

  function offsetOf(k) { return isMobileLayout ? F[k].mOffset : F[k].offset; }

  function update({ time = 0, f = 0, scroll = 0, velocity = 0 } = {}) {
    const dt = Math.min(0.05, Math.max(0, time - lastTime));
    lastTime = time;

    fSmooth = reduced ? f : fSmooth + (f - fSmooth) * (1 - Math.pow(0.035, dt));
    const fi = clamp(fSmooth, 0, F.length - 1);
    const a = Math.floor(fi);
    const b = Math.min(a + 1, F.length - 1);
    const m = fi - a;
    const morphing = m > 0.0015 && b !== a;

    const t = reduced ? 0 : time + scroll * 0.0011;
    F[a].frame(bases[a], bufA, t, offsetOf(a));
    if (morphing) F[b].frame(bases[b], bufB, t, offsetOf(b));

    vel += (Math.abs(velocity) - vel) * 0.12;
    const vn = reduced ? 0 : clamp(vel / 70, 0, 1);

    let ip = 1;
    if (introStart === null) ip = 0;
    else if (time - introStart < 3.2) ip = clamp((time - introStart) / 2.6, 0, 1);

    for (let i = 0, k = 0; i < N; i++, k += 3) {
      let x = bufA[k], y = bufA[k + 1], z = bufA[k + 2];
      const sd = seeds[i];
      if (morphing) {
        const l = smooth(clamp((m - delays[i] * 0.45) / 0.55, 0, 1));
        const burst = Math.sin(l * Math.PI) * (1.2 + sd * 1.6);
        x = lerp(x, bufB[k], l) + dirs[k] * burst;
        y = lerp(y, bufB[k + 1], l) + dirs[k + 1] * burst;
        z = lerp(z, bufB[k + 2], l) + dirs[k + 2] * burst;
      }
      if (vn > 0.001) {
        const j = vn * (0.4 + sd * 1.4);
        x += dirs[k] * j * 0.6;
        y += dirs[k + 1] * j * 1.6;
        z += dirs[k + 2] * j * 0.6;
      }
      if (ip < 1) {
        const l = expoOut(clamp(ip * 1.5 - delays[i] * 0.5, 0, 1));
        x = lerp(scatter[k], x, l);
        y = lerp(scatter[k + 1], y, l);
        z = lerp(scatter[k + 2], z, l);
      }
      positions[k] = x; positions[k + 1] = y; positions[k + 2] = z;
    }
    pAttr.needsUpdate = true;

    // Blend per-formation look
    const lineA = lerp(F[a].line, F[b].line, m);
    const dim = lerp(F[a].dim, F[b].dim, m);
    const maxLen = lerp(F[a].maxLen, F[b].maxLen, m);
    const fadeStart = maxLen * 0.55;
    const lineStrength = lineA * (1 + vn * 0.6) * (ip < 1 ? ip * ip : 1);

    if (lineStrength > 0.005) {
      for (let q = 0; q < S; q++) {
        const ia = segA[q] * 3, ib = segB[q] * 3;
        const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
        const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let al = 0;
        if (len < maxLen) al = len <= fadeStart ? lineStrength : lineStrength * (1 - (len - fadeStart) / (maxLen - fadeStart));
        const o = q * 6;
        lPos[o] = ax; lPos[o + 1] = ay; lPos[o + 2] = az;
        lPos[o + 3] = bx; lPos[o + 4] = by; lPos[o + 5] = bz;
        lAlpha[q * 2] = al; lAlpha[q * 2 + 1] = al;
      }
      lPosAttr.needsUpdate = true;
      lAlphaAttr.needsUpdate = true;
      lines.visible = true;
    } else {
      lines.visible = false;
    }

    // Pointer + camera
    if (time - pointer.lastMove > 2.5) pointer.active = 0;
    pointer.x += (pointer.tx - pointer.x) * 0.12;
    pointer.y += (pointer.ty - pointer.y) * 0.12;
    pMat.uniforms.uMouse.value.set(pointer.x, pointer.y);
    pMat.uniforms.uMouseStr.value += ((reduced ? 0 : pointer.active) - pMat.uniforms.uMouseStr.value) * 0.06;

    const px = pointer.active ? pointer.x : 0, py = pointer.active ? pointer.y : 0;
    camera.position.x += (px * 0.9 - camera.position.x) * 0.03;
    camera.position.y += (py * 0.6 - camera.position.y) * 0.03;
    camera.position.z += (22 + vn * 2.5 - camera.position.z) * 0.08;
    camera.lookAt(0, 0, 0);

    boost *= 0.94;
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uAccentMix.value = 0.45 + boost * 0.55;
    pMat.uniforms.uOpacity.value = dim * (0.25 + 0.75 * ip);

    renderer.render(scene, camera);
  }

  return {
    update,
    resize,
    intro(time) { introStart = time; },
    setPointer(x, y, time) {
      pointer.tx = x; pointer.ty = y;
      pointer.active = 1;
      pointer.lastMove = time;
    },
    clearPointer() { pointer.active = 0; },
    pulse(amount = 1) { boost = Math.max(boost, amount); },
    destroy() {
      pGeo.dispose(); lGeo.dispose(); pMat.dispose(); lMat.dispose();
      renderer.dispose();
    },
  };
}
