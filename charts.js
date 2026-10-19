/* =========================================================
   Interactive charts, modelled on Bklit UI's chart language
   (https://ui.bklit.com): --chart-* theme tokens, monotone curves,
   dashed crosshair + dots + popover tooltip + date pill,
   ~1100ms reveal, streaming live line with pulse and value badge.
   Bklit itself is a React/shadcn registry that needs a build step;
   this is a dependency-free SVG port so the site stays static.
   All values here are SAMPLE data for illustration.
   ========================================================= */

const NS = "http://www.w3.org/2000/svg";

/* Typed access to the chart CSS variables (mirrors Bklit's chartCssVars) */
export const chartCssVars = {
  background: "var(--chart-background)",
  foreground: "var(--chart-foreground)",
  foregroundMuted: "var(--chart-foreground-muted)",
  label: "var(--chart-label)",
  linePrimary: "var(--chart-line-primary)",
  lineSecondary: "var(--chart-line-secondary)",
  crosshair: "var(--chart-crosshair)",
  grid: "var(--chart-grid)",
  indicatorColor: "var(--chart-indicator-color)",
};
const seriesVar = (n) => `var(--chart-${n})`;

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2); // ≈ cubic-bezier(0.85,0,0.15,1)
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
let uidCount = 0;
const uid = (p) => `${p}-${++uidCount}`;

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function html(tag, cls, parent) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

function tween({ duration = 1100, delay = 0, ease = easeInOutQuint, update, done, reduced }) {
  if (reduced) { update(1); done && done(); return () => {}; }
  let raf;
  const start = performance.now() + delay;
  const step = (now) => {
    if (now < start) { raf = requestAnimationFrame(step); return; }
    const t = clamp((now - start) / duration, 0, 1);
    update(ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
    else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function onFirstView(el, cb, threshold = 0.3) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { io.disconnect(); cb(); } });
  }, { threshold });
  io.observe(el);
}

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
function ticks(min, max, count) {
  const step = niceStep(max - min, count);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/* Monotone cubic interpolation in x (same family as d3.curveMonotoneX) */
function monotonePath(p) {
  const n = p.length;
  if (!n) return "";
  if (n < 3) return "M" + p.map((q) => `${q[0]},${q[1]}`).join("L");
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0];
    m[i] = dx[i] ? (p[i + 1][1] - p[i][1]) / dx[i] : 0;
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) { t[i] = 0; continue; }
    const h0 = dx[i - 1], h1 = dx[i];
    const s = (m[i - 1] * h1 + m[i] * h0) / (h0 + h1);
    t[i] = (Math.sign(m[i - 1]) + Math.sign(m[i])) * Math.min(Math.abs(m[i - 1]), Math.abs(m[i]), 0.5 * Math.abs(s));
  }
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${p[i][0] + h},${p[i][1] + t[i] * h},${p[i + 1][0] - h},${p[i + 1][1] - t[i + 1] * h},${p[i + 1][0]},${p[i + 1][1]}`;
  }
  return d;
}

/* Popover tooltip shared by every chart */
function createTooltip(wrap) {
  const tip = html("div", "c-tip", wrap);
  tip.setAttribute("aria-hidden", "true");
  return {
    show(content, x, y) {
      tip.innerHTML = content;
      tip.classList.add("is-visible");
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const W = wrap.clientWidth, H = wrap.clientHeight;
      let left = x + 16;
      if (left + w > W) left = x - w - 16;
      left = clamp(left, -8, W - w + 8);
      const top = clamp(y - h / 2, -8, H - h + 8);
      tip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    },
    hide() { tip.classList.remove("is-visible"); },
  };
}
const tipRow = (color, label, value) =>
  `<div class="c-tip__row"><span class="c-tip__dot" style="background:${color}"></span><span>${label}</span><b>${value}</b></div>`;

/* Keyed labels that fade in/out as an axis domain moves (Bklit-style animated axes) */
function labelPool(group, cls) {
  const map = new Map();
  return {
    sync(items) {
      const keep = new Set();
      items.forEach(({ key, text, x, y, anchor }) => {
        keep.add(key);
        let el = map.get(key);
        if (!el) {
          el = svg("text", { class: cls }, group);
          el.textContent = text;
          if (anchor) el.setAttribute("text-anchor", anchor);
          el.style.opacity = "0";
          map.set(key, el);
          requestAnimationFrame(() => { el.style.opacity = ""; });
        }
        el.classList.remove("is-leaving");
        el.setAttribute("x", x);
        el.setAttribute("y", y);
      });
      map.forEach((el, key) => {
        if (!keep.has(key) && !el.classList.contains("is-leaving")) {
          el.classList.add("is-leaving");
          setTimeout(() => { if (el.classList.contains("is-leaving")) { el.remove(); map.delete(key); } }, 360);
        }
      });
    },
  };
}

/* =========================================================
   1. Live line chart (streaming throughput)
   ========================================================= */
function liveLineChart(wrap, { ticker, reduced }) {
  const margin = { top: 18, right: 92, bottom: 30, left: 44 };
  const windowSec = 30;
  const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour12: false });

  const root = svg("svg", { class: "c-svg", role: "img", "aria-label": "Sample live chart of network throughput on a head office uplink, in megabits per second, updating every second." }, wrap);
  const defs = svg("defs", {}, root);
  const gradId = uid("live-fill"), clipId = uid("live-clip");
  const grad = svg("linearGradient", { id: gradId, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  svg("stop", { offset: "0%", style: `stop-color:${seriesVar(1)};stop-opacity:0.3` }, grad);
  svg("stop", { offset: "100%", style: `stop-color:${seriesVar(1)};stop-opacity:0` }, grad);
  const clipRect = svg("rect", {}, svg("clipPath", { id: clipId }, defs));

  const gGrid = svg("g", { class: "c-grid" }, root);
  const gY = svg("g", {}, root);
  const gX = svg("g", {}, root);
  const plot = svg("g", { "clip-path": `url(#${clipId})` }, root);
  const area = svg("path", { class: "c-area", fill: `url(#${gradId})` }, plot);
  const line = svg("path", { class: "c-line c-line--1" }, plot);
  const cross = svg("line", { class: "c-crosshair" }, root);
  const hoverDot = svg("circle", { class: "c-dot c-dot--1 c-hover", r: 4.5 }, root);
  const pulse = svg("circle", { class: "c-pulse", r: 4 }, root);
  const dot = svg("circle", { class: "c-dot c-dot--1", r: 4.5 }, root);
  const badge = html("div", "c-badge", wrap);
  const pill = html("div", "c-pill", wrap);
  const tip = createTooltip(wrap);
  const yLabels = labelPool(gY, "c-label");
  const xLabels = labelPool(gX, "c-label");
  const gridLines = new Map();

  // Sample signal: a slow swell with noise and occasional bursts
  let phase = Math.random() * 10;
  const nextValue = (v) => {
    phase += 0.21;
    const base = 440 + Math.sin(phase) * 70 + Math.sin(phase * 0.37) * 95;
    const burst = Math.random() < 0.07 ? 140 + Math.random() * 160 : 0;
    return clamp(lerp(v, base + (Math.random() - 0.5) * 80 + burst, 0.6), 90, 980);
  };
  let now = Date.now() / 1000;
  let value = 430;
  const data = [];
  for (let i = windowSec + 3; i >= 1; i--) { value = nextValue(value); data.push({ time: now - i, value }); }
  let display = value;
  let yMin = 250, yMax = 700;
  let W = 0, H = 0, hoverX = null, visible = false, running = false;

  setInterval(() => {
    if (document.hidden) return;
    value = nextValue(value);
    data.push({ time: Date.now() / 1000, value });
    if (data.length > 90) data.shift();
  }, 1000);

  const measure = () => {
    W = wrap.clientWidth; H = wrap.clientHeight;
    root.setAttribute("viewBox", `0 0 ${W} ${H}`);
    clipRect.setAttribute("x", margin.left);
    clipRect.setAttribute("y", 0);
    clipRect.setAttribute("width", Math.max(0, W - margin.left - margin.right) + 1);
    clipRect.setAttribute("height", H);
  };
  new ResizeObserver(measure).observe(wrap);
  measure();

  function render() {
    if (!W) return;
    now = Date.now() / 1000;
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;
    display = lerp(display, value, 0.08);

    const t0 = now - windowSec;
    const vis = data.filter((p) => p.time >= t0 - 2);
    let lo = display, hi = display;
    vis.forEach((p) => { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); });
    const pad = Math.max(30, (hi - lo) * 0.28);
    const tMin = Math.max(0, lo - pad), tMax = hi + pad;
    yMin = lerp(yMin, tMin, 0.08);
    yMax = lerp(yMax, tMax, 0.08);

    const sx = (t) => margin.left + ((t - t0) / windowSec) * innerW;
    const sy = (v) => margin.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

    const pts = vis.map((p) => [sx(p.time), sy(p.value)]);
    const tipX = sx(now), tipY = sy(display);
    pts.push([tipX, tipY]);
    const d = monotonePath(pts);
    line.setAttribute("d", d);
    area.setAttribute("d", `${d}L${tipX},${margin.top + innerH}L${pts[0][0]},${margin.top + innerH}Z`);

    dot.setAttribute("cx", tipX); dot.setAttribute("cy", tipY);
    pulse.setAttribute("cx", tipX); pulse.setAttribute("cy", tipY);
    badge.textContent = `${Math.round(display)} Mbps`;
    badge.style.transform = `translate3d(${tipX + 12}px, ${tipY - 11}px, 0)`;

    // Y axis + grid
    const yt = ticks(tMin, tMax, 4);
    yLabels.sync(yt.map((v) => ({ key: v, text: String(Math.round(v)), x: margin.left - 10, y: sy(v) + 4, anchor: "end" })));
    const keep = new Set();
    yt.forEach((v) => {
      keep.add(v);
      let ln = gridLines.get(v);
      if (!ln) { ln = svg("line", {}, gGrid); gridLines.set(v, ln); }
      const y = sy(v);
      ln.setAttribute("x1", margin.left); ln.setAttribute("x2", margin.left + innerW);
      ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      ln.style.opacity = y < margin.top - 2 || y > margin.top + innerH + 2 ? 0 : 1;
    });
    gridLines.forEach((ln, v) => { if (!keep.has(v)) { ln.remove(); gridLines.delete(v); } });

    // X axis: time labels scrolling left (sparser on narrow screens)
    const xs = [];
    const every = innerW < 420 ? 15 : 10;
    for (let t = Math.ceil(t0 / every) * every; t <= now; t += every) {
      const x = sx(t);
      if (x > margin.left + 30 && x < margin.left + innerW - 10) xs.push({ key: t, text: fmtTime(t), x, y: H - 8, anchor: "middle" });
    }
    xLabels.sync(xs);

    // Crosshair
    if (hoverX !== null) {
      const tHover = t0 + ((hoverX - margin.left) / innerW) * windowSec;
      let best = vis[0], bd = Infinity;
      vis.forEach((p) => { const dd = Math.abs(p.time - tHover); if (dd < bd) { bd = dd; best = p; } });
      if (best) {
        const x = sx(best.time), y = sy(best.value);
        cross.setAttribute("x1", x); cross.setAttribute("x2", x);
        cross.setAttribute("y1", margin.top); cross.setAttribute("y2", margin.top + innerH);
        hoverDot.setAttribute("cx", x); hoverDot.setAttribute("cy", y);
        tip.show(`<div class="c-tip__head">${fmtTime(best.time)}</div>${tipRow(seriesVar(1), "Throughput", `${Math.round(best.value)} Mbps`)}`, x, y);
        pill.textContent = fmtTime(best.time);
        pill.style.transform = `translate3d(${x - pill.offsetWidth / 2}px, ${H - 22}px, 0)`;
      }
    }
  }

  const start = () => {
    if (running) return;
    running = true;
    if (ticker) ticker.add(render);
    else { const loop = () => { if (!running) return; render(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  };
  const stop = () => { running = false; if (ticker) ticker.remove(render); };

  new IntersectionObserver((entries) => {
    entries.forEach((e) => { visible = e.isIntersecting; visible ? start() : stop(); });
  }).observe(wrap);
  if (reduced) render();

  const move = (e) => {
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < margin.left || x > W - margin.right) { leave(); return; }
    hoverX = x;
    wrap.classList.add("is-hovering");
  };
  const leave = () => { hoverX = null; wrap.classList.remove("is-hovering"); tip.hide(); };
  wrap.addEventListener("pointermove", move);
  wrap.addEventListener("pointerleave", leave);
}

/* =========================================================
   2. Area chart (two series, crosshair, date pill, keyboard)
   ========================================================= */
function areaChart(wrap, { reduced }) {
  const margin = { top: 14, right: 14, bottom: 30, left: 36 };
  // 12 weeks ending this week (sample values)
  const opened = [42, 38, 45, 40, 36, 37, 33, 30, 31, 28, 26, 24];
  const resolved = [38, 40, 43, 41, 37, 35, 34, 31, 30, 29, 27, 25];
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const data = opened.map((o, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() - (opened.length - 1 - i) * 7);
    return { date: d, opened: o, resolved: resolved[i] };
  });
  const fmt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const series = [
    { key: "opened", label: "Opened", n: 2 },
    { key: "resolved", label: "Resolved", n: 1 },
  ];

  const root = svg("svg", { class: "c-svg", role: "img", "aria-label": "Sample area chart of support requests opened and resolved per week over twelve weeks. Both trend downward." }, wrap);
  const tip = createTooltip(wrap);
  const pill = html("div", "c-pill", wrap);
  let revealed = false, revealP = reduced ? 1 : 0, active = -1, geo = null;
  let clipRect;

  function build() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W) return;
    root.innerHTML = "";
    root.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;
    const max = Math.max(...opened, ...resolved) * 1.12;
    const yt = ticks(0, max, 4);
    const yTop = yt[yt.length - 1] < max ? yt[yt.length - 1] + niceStep(max, 4) : yt[yt.length - 1];
    const sx = (i) => margin.left + (i / (data.length - 1)) * innerW;
    const sy = (v) => margin.top + (1 - v / yTop) * innerH;

    const defs = svg("defs", {}, root);
    const clipId = uid("area-clip");
    clipRect = svg("rect", { x: 0, y: 0, height: H, width: margin.left + innerW * revealP + 2 }, svg("clipPath", { id: clipId }, defs));

    const gGrid = svg("g", { class: "c-grid" }, root);
    ticks(0, yTop, 4).forEach((v) => {
      svg("line", { x1: margin.left, x2: margin.left + innerW, y1: sy(v), y2: sy(v) }, gGrid);
      const t = svg("text", { class: "c-label", x: margin.left - 10, y: sy(v) + 4, "text-anchor": "end" }, root);
      t.textContent = v;
    });
    const every = innerW < 380 ? 3 : innerW < 640 ? 2 : 1;
    data.forEach((d, i) => {
      if ((data.length - 1 - i) % every) return;
      const t = svg("text", { class: "c-label", x: sx(i), y: H - 8, "text-anchor": "middle" }, root);
      t.textContent = fmt(d.date);
    });

    const plot = svg("g", { "clip-path": `url(#${clipId})` }, root);
    series.forEach((s) => {
      const gid = uid("area-fill");
      const g = svg("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      svg("stop", { offset: "0%", style: `stop-color:${seriesVar(s.n)};stop-opacity:${s.n === 1 ? 0.28 : 0.18}` }, g);
      svg("stop", { offset: "100%", style: `stop-color:${seriesVar(s.n)};stop-opacity:0` }, g);
      const pts = data.map((d, i) => [sx(i), sy(d[s.key])]);
      const dPath = monotonePath(pts);
      svg("path", { class: "c-area", fill: `url(#${gid})`, d: `${dPath}L${sx(data.length - 1)},${sy(0)}L${sx(0)},${sy(0)}Z` }, plot);
      svg("path", { class: `c-line c-line--${s.n}`, d: dPath }, plot);
    });

    const cross = svg("line", { class: "c-crosshair", y1: margin.top, y2: margin.top + innerH }, root);
    const dots = series.map((s) => svg("circle", { class: `c-dot c-dot--${s.n} c-hover`, r: 4.5 }, root));
    geo = { W, H, innerW, sx, sy, cross, dots };
    if (active >= 0) setActive(active);
  }

  function setActive(i) {
    if (!geo) return;
    active = i;
    const d = data[i];
    const x = geo.sx(i);
    geo.cross.setAttribute("x1", x); geo.cross.setAttribute("x2", x);
    series.forEach((s, k) => { geo.dots[k].setAttribute("cx", x); geo.dots[k].setAttribute("cy", geo.sy(d[s.key])); });
    wrap.classList.add("is-hovering");
    const rows = [...series].reverse().map((s) => tipRow(seriesVar(s.n), s.label, d[s.key])).join("");
    tip.show(`<div class="c-tip__head">Week of ${fmt(d.date)}</div>${rows}`, x, geo.sy(Math.max(d.opened, d.resolved)));
    pill.textContent = fmt(d.date);
    pill.style.transform = `translate3d(${clamp(x - pill.offsetWidth / 2, 0, geo.W - pill.offsetWidth)}px, ${geo.H - 22}px, 0)`;
  }
  function clear() { active = -1; wrap.classList.remove("is-hovering"); tip.hide(); }

  new ResizeObserver(build).observe(wrap);
  build();

  wrap.addEventListener("pointermove", (e) => {
    if (!geo || !revealed) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = clamp(Math.round(((x - margin.left) / geo.innerW) * (data.length - 1)), 0, data.length - 1);
    if (i !== active) setActive(i);
  });
  wrap.addEventListener("pointerleave", clear);
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = active < 0 ? data.length - 1 : clamp(active + (e.key === "ArrowRight" ? 1 : -1), 0, data.length - 1);
    setActive(next);
  });
  wrap.addEventListener("blur", clear);

  onFirstView(wrap, () => {
    tween({
      duration: 1100, delay: 200, reduced,
      update: (p) => { revealP = p; if (clipRect && geo) clipRect.setAttribute("width", margin.left + geo.innerW * p + 2); },
      done: () => { revealed = true; },
    });
  });
}

/* =========================================================
   3. Ring chart (multi-ring KPI)
   ========================================================= */
function ringChart(wrap, legend, { reduced }) {
  const items = [
    { label: "Patched", value: 96, n: 1 },
    { label: "Protected", value: 92, n: 2 },
    { label: "Backed up", value: 88, n: 3 },
  ];
  const fleet = 148;
  const radii = [84, 64, 44];
  const root = svg("svg", { class: "c-svg", viewBox: "0 0 200 200", role: "img", "aria-label": `Sample ring chart of endpoint readiness: ${items.map((i) => `${i.label} ${i.value}%`).join(", ")}.` }, wrap);
  const center = html("div", "c-ring-center", wrap);
  const setCenter = (big, small) => { center.innerHTML = `<strong>${big}</strong><span>${small}</span>`; };
  setCenter(fleet, "managed devices");

  const arcs = items.map((it, i) => {
    svg("circle", { class: "c-ring-track", cx: 100, cy: 100, r: radii[i], "stroke-width": 12 }, root);
    const arc = svg("circle", {
      class: `c-ring c-ring--${it.n}`, cx: 100, cy: 100, r: radii[i], "stroke-width": 12,
      pathLength: 100, "stroke-dasharray": "0 100", transform: "rotate(-90 100 100)", opacity: 0,
    }, root);
    return arc;
  });

  const lis = items.map((it, i) => {
    const li = html("li", "", legend);
    li.innerHTML = `<span style="background:${seriesVar(it.n)}"></span><span>${it.label}</span><b>${it.value}%</b>`;
    li.addEventListener("pointerenter", () => setActive(i));
    li.addEventListener("pointerleave", () => setActive(-1));
    return li;
  });
  arcs.forEach((a, i) => {
    a.addEventListener("pointerenter", () => setActive(i));
    a.addEventListener("pointerleave", () => setActive(-1));
  });

  function setActive(i) {
    wrap.classList.toggle("has-active", i >= 0);
    legend.classList.toggle("has-active", i >= 0);
    arcs.forEach((a, k) => a.classList.toggle("is-active", k === i));
    lis.forEach((l, k) => l.classList.toggle("is-active", k === i));
    if (i >= 0) setCenter(`${items[i].value}%`, items[i].label.toLowerCase());
    else setCenter(fleet, "managed devices");
  }

  onFirstView(wrap, () => {
    items.forEach((it, i) => {
      tween({
        duration: 1100, delay: 200 + i * 140, reduced,
        update: (p) => { arcs[i].setAttribute("opacity", 1); arcs[i].setAttribute("stroke-dasharray", `${(it.value * p).toFixed(2)} 100`); },
      });
    });
  });
}

/* =========================================================
   4. Radar chart (before / after assessment)
   ========================================================= */
function radarChart(wrap, legend, { reduced }) {
  const axes = ["Network", "Cloud & M365", "Security", "Backup", "Devices", "Processes"];
  const series = [
    { label: "Current state", values: [2.2, 2.8, 1.7, 1.4, 2.5, 1.9], n: 2, on: true },
    { label: "With a roadmap", values: [4.5, 4.6, 4.2, 4.4, 4.3, 4.0], n: 1, on: true },
  ];
  const VW = 360, VH = 320, cx = 180, cy = 162, R = 108, MAX = 5;
  const angle = (i) => -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const root = svg("svg", { class: "c-svg", viewBox: `0 0 ${VW} ${VH}`, role: "img", "aria-label": "Sample radar chart comparing a current IT maturity score with a target after a roadmap, across network, cloud, security, backup, devices and processes." }, wrap);
  const tip = createTooltip(wrap);

  for (let l = 1; l <= MAX; l++) {
    const d = axes.map((_, i) => pt(i, (R * l) / MAX)).map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("") + "Z";
    svg("path", { class: "c-radar-grid", d }, root);
  }
  const axisLines = axes.map((_, i) => { const p = pt(i, R); return svg("line", { class: "c-radar-axis", x1: cx, y1: cy, x2: p[0], y2: p[1] }, root); });
  const labels = axes.map((name, i) => {
    const p = pt(i, R + 20);
    const a = Math.cos(angle(i));
    const t = svg("text", { class: "c-radar-label", x: p[0], y: p[1] + 4, "text-anchor": Math.abs(a) < 0.2 ? "middle" : a > 0 ? "start" : "end" }, root);
    t.textContent = name;
    return t;
  });
  const shapes = series.map((s) => ({
    path: svg("path", { class: `c-radar-shape c-radar-shape--${s.n}` }, root),
    dots: svg("g", { class: `c-radar-dots c-radar-dots--${s.n}` }, root),
  }));
  shapes.forEach((sh) => axes.forEach(() => svg("circle", { r: 3 }, sh.dots)));

  let k = reduced ? 1 : 0;
  function draw() {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => pt(i, (R * v * k) / MAX));
      shapes[si].path.setAttribute("d", pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("") + "Z");
      [...shapes[si].dots.children].forEach((c, i) => { c.setAttribute("cx", pts[i][0]); c.setAttribute("cy", pts[i][1]); });
    });
  }
  draw();

  series.forEach((s, si) => {
    const b = html("button", "", legend);
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.innerHTML = `<span style="background:${seriesVar(s.n)}"></span>${s.label}`;
    b.addEventListener("click", () => {
      s.on = !s.on;
      b.setAttribute("aria-pressed", String(s.on));
      shapes[si].path.classList.toggle("is-off", !s.on);
      shapes[si].dots.classList.toggle("is-off", !s.on);
    });
  });

  let activeAxis = -1;
  function setAxis(i) {
    if (i === activeAxis) return;
    activeAxis = i;
    axisLines.forEach((l, k2) => l.classList.toggle("is-active", k2 === i));
    labels.forEach((l, k2) => l.classList.toggle("is-active", k2 === i));
    shapes.forEach((sh) => [...sh.dots.children].forEach((c, k2) => c.setAttribute("r", k2 === i ? 5 : 3)));
    if (i < 0) { tip.hide(); return; }
    const rows = [...series].reverse().filter((s) => s.on).map((s) => tipRow(seriesVar(s.n), s.label, `${s.values[i].toFixed(1)} / 5`)).join("");
    const rect = root.getBoundingClientRect();
    const scale = Math.min(rect.width / VW, rect.height / VH);
    const offX = (rect.width - VW * scale) / 2, offY = (rect.height - VH * scale) / 2;
    const maxV = Math.max(...series.map((s) => s.values[i]));
    const p = pt(i, (R * maxV) / MAX);
    tip.show(`<div class="c-tip__head">${axes[i]}</div>${rows || '<div class="c-tip__row">No series shown</div>'}`, offX + p[0] * scale, offY + p[1] * scale);
  }

  wrap.addEventListener("pointermove", (e) => {
    const rect = root.getBoundingClientRect();
    const scale = Math.min(rect.width / VW, rect.height / VH);
    const offX = (rect.width - VW * scale) / 2, offY = (rect.height - VH * scale) / 2;
    const x = (e.clientX - rect.left - offX) / scale - cx;
    const y = (e.clientY - rect.top - offY) / scale - cy;
    if (Math.hypot(x, y) > R * 1.35 || Math.hypot(x, y) < 6) { setAxis(-1); return; }
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    setAxis(Math.round((a / (Math.PI * 2)) * axes.length) % axes.length);
  });
  wrap.addEventListener("pointerleave", () => setAxis(-1));

  onFirstView(wrap, () => {
    tween({ duration: 1100, delay: 200, ease: easeOutExpo, reduced, update: (p) => { k = p; draw(); } });
  });
}

/* =========================================================
   5. Heatmap (daily availability, contribution-calendar style)
   ========================================================= */
function heatmapChart(wrap, avgEl, { reduced }) {
  const weeksEl = document.querySelector("[data-heat-weeks]");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Deterministic sample value per calendar day, so it is stable across reloads and resizes
  const uptimeFor = (date) => {
    let s = Math.floor(date.getTime() / 864e5) * 2654435761;
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    const r = ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    return r < 0.82 ? 100 : r < 0.92 ? 99.98 : r < 0.97 ? 99.93 : r < 0.99 ? 99.6 : 98.9;
  };
  const level = (u) => (u === null ? 0 : u >= 100 ? 5 : u >= 99.95 ? 4 : u >= 99.9 ? 3 : u >= 99.5 ? 2 : 1);
  const fmt = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const root = svg("svg", { class: "c-svg", role: "img", preserveAspectRatio: "xMinYMid meet", "aria-label": "Sample calendar heatmap of daily core network availability." }, wrap);
  const tip = createTooltip(wrap);
  let built = false;
  let days = [];

  function build() {
    const W = wrap.clientWidth;
    if (!W) return;
    root.innerHTML = "";
    const labelW = 34, top = 20, gap = 4;
    // Wider screens show more history (12 to 52 weeks), like a contribution calendar
    const WEEKS = clamp(Math.floor((W - labelW + gap) / (16 + gap)), 12, 52);
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7);
    days = [];
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        days.push({ w, d, date, up: date <= today ? uptimeFor(date) : null });
      }
    }
    const valid = days.filter((x) => x.up !== null);
    if (avgEl) avgEl.textContent = `${(valid.reduce((a, b) => a + b.up, 0) / valid.length).toFixed(2)}%`;
    if (weeksEl) weeksEl.textContent = WEEKS;

    const cell = clamp(Math.floor((W - labelW - gap * (WEEKS - 1)) / WEEKS), 8, 22);
    const gridW = WEEKS * cell + (WEEKS - 1) * gap;
    const H = top + 7 * cell + 6 * gap + 2;
    root.setAttribute("viewBox", `0 0 ${labelW + gridW} ${H}`);
    root.style.height = `${H * Math.min(1, W / (labelW + gridW))}px`;

    ["Mon", "Wed", "Fri"].forEach((name, i) => {
      const t = svg("text", { class: "c-label", x: 0, y: top + (i * 2) * (cell + gap) + cell * 0.72 }, root);
      t.textContent = name;
    });
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const dt = days[w * 7].date;
      if (dt.getMonth() !== lastMonth && w < WEEKS - 1) {
        lastMonth = dt.getMonth();
        const t = svg("text", { class: "c-label", x: labelW + w * (cell + gap), y: 11 }, root);
        t.textContent = dt.toLocaleDateString("en-GB", { month: "short" });
      }
    }
    const g = svg("g", {}, root);
    days.forEach((x, i) => {
      const r = svg("rect", {
        class: `c-heat-cell lvl-${level(x.up)}`,
        x: labelW + x.w * (cell + gap), y: top + x.d * (cell + gap),
        width: cell, height: cell, rx: Math.max(2, cell * 0.18),
        "data-i": i,
      }, g);
      r.style.transitionDelay = reduced ? "0ms" : `${x.w * 22 + x.d * 8}ms`;
    });
    built = true;
  }

  new ResizeObserver(build).observe(wrap);
  build();

  wrap.addEventListener("pointerover", (e) => {
    const r = e.target.closest && e.target.closest(".c-heat-cell");
    if (!r) return;
    const x = days[+r.dataset.i];
    const wr = wrap.getBoundingClientRect(), cr = r.getBoundingClientRect();
    const text = x.up === null ? "No data yet" : `${x.up.toFixed(2)}% uptime`;
    tip.show(`<div class="c-tip__head">${fmt(x.date)}</div>${tipRow(x.up === null ? "var(--border)" : `var(--chart-scale-0${level(x.up)})`, "Core network", text)}`, cr.left - wr.left + cr.width / 2, cr.top - wr.top + cr.height / 2);
  });
  wrap.addEventListener("pointerleave", () => tip.hide());

  onFirstView(wrap, () => { if (built) requestAnimationFrame(() => wrap.classList.add("is-revealed")); });
}

/* =========================================================
   Boot
   ========================================================= */
export function initCharts({ ticker = null, reduced = false } = {}) {
  const opts = { ticker, reduced };
  document.querySelectorAll("[data-chart]").forEach((el) => {
    try {
      switch (el.dataset.chart) {
        case "live": liveLineChart(el, opts); break;
        case "area": areaChart(el, opts); break;
        case "ring": ringChart(el, el.parentElement.querySelector("[data-ring-legend]"), opts); break;
        case "radar": radarChart(el, el.closest(".cell").querySelector("[data-radar-legend]"), opts); break;
        case "heatmap": heatmapChart(el, document.querySelector("[data-heat-avg]"), opts); break;
      }
    } catch (err) {
      console.warn("Chart failed to initialise:", el.dataset.chart, err);
    }
  });
}
