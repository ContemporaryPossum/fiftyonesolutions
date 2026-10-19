/* =========================================================
   FiftyOne Solutions: scroll and motion layer
   Lenis (smooth scroll) driven by GSAP's ticker, so the page,
   ScrollTrigger scenes, charts and the WebGL background all
   share one requestAnimationFrame loop.
   ========================================================= */

import { initCharts } from "./charts.js";

const { gsap, ScrollTrigger, SplitText, Lenis } = window;
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

let lenis = null;
let bg = null;
let menuOpen = false;
let introPlayed = false;
let closeMenu = () => {};

$$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

if (gsap && ScrollTrigger && Lenis) {
  boot();
} else {
  // A CDN failed: keep the page fully usable without motion.
  $(".loader")?.remove();
  initCharts({ reduced: true });
  initForm();
  initAccordion();
}

/* ---------------------------------------------------------
   Boot sequence
   --------------------------------------------------------- */
async function boot() {
  gsap.registerPlugin(ScrollTrigger, ...(SplitText ? [SplitText] : []));
  ScrollTrigger.config({ ignoreMobileResize: true });

  lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.scrollTo(0, 0);
  if (!reduced) lenis.stop();

  initNav();
  initMenu();
  initAnchors();
  initCursor();
  initForm();
  initAccordion();
  initCharts({ ticker: gsap.ticker, reduced });

  await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), wait(2500)]);

  const hero = buildHero();
  buildStatement();
  buildServices();
  buildInsight();
  buildProcess();
  buildExperience();
  buildPartners();
  buildContact();
  buildFooter();
  const anchors = buildFormationAnchors();

  const resort = () => { ScrollTrigger.sort(); ScrollTrigger.refresh(); };
  resort();
  requestAnimationFrame(resort);
  window.addEventListener("load", resort);

  bootBackground(anchors);

  await runLoader();
  hero.play();
  introPlayed = true;
  bg?.intro(gsap.ticker.time);
  lenis.start();
}

/* ---------------------------------------------------------
   Preloader: counts to 51, then the curtain lifts
   --------------------------------------------------------- */
function runLoader() {
  const loader = $(".loader");
  if (!loader) return Promise.resolve();
  if (reduced) { loader.remove(); return Promise.resolve(); }
  loader.style.animation = "none";
  const count = $("[data-count]", loader);
  const fill = $(".loader__fill", loader);
  const o = { v: 0 };
  return new Promise((resolve) => {
    gsap.timeline({ onComplete: () => loader.remove() })
      .to(o, {
        v: 51, duration: 1.5, ease: "power2.inOut",
        onUpdate: () => (count.textContent = String(Math.round(o.v)).padStart(2, "0")),
      })
      .to(fill, { scaleX: 1, duration: 1.5, ease: "power2.inOut" }, 0)
      .to(".loader__inner", { yPercent: -10, autoAlpha: 0, duration: 0.5, ease: "power3.in" }, "+=0.12")
      .to(loader, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.95, ease: "expo.inOut" }, "-=0.2")
      .add(resolve, "-=0.55");
  });
}

/* ---------------------------------------------------------
   Shared heading reveal (lines rise out of a mask)
   --------------------------------------------------------- */
function splitHeading(el, start = "top 82%") {
  if (!el || !SplitText || reduced) return;
  SplitText.create(el, {
    type: "lines",
    mask: "lines",
    autoSplit: true,
    onSplit(self) {
      gsap.set(self.masks, { paddingBottom: "0.08em", marginBottom: "-0.08em" });
      return gsap.from(self.lines, {
        yPercent: 108, duration: 1.15, ease: "expo.out", stagger: 0.09,
        scrollTrigger: { trigger: el, start },
      });
    },
  });
}

/* ---------------------------------------------------------
   Hero: character intro + layered scroll-out
   --------------------------------------------------------- */
function buildHero() {
  const tl = gsap.timeline({ paused: true, onComplete: initMagnetic });
  const title = $(".hero__title");
  if (reduced || !SplitText) { initMagnetic(); return tl; }

  // Word masks (not line masks) so the headline re-wraps naturally on resize / rotation
  const split = SplitText.create(title, { type: "words,chars", mask: "words" });
  gsap.set(split.masks, { paddingBottom: "0.1em", marginBottom: "-0.1em" });

  tl.from(split.chars, { yPercent: 118, rotate: 7, duration: 1.3, ease: "expo.out", stagger: 0.016 })
    .from(".hero__sub", { y: 24, autoAlpha: 0, filter: "blur(10px)", duration: 1.1, ease: "expo.out", clearProps: "filter" }, 0.35)
    .from(".hero__ctas .btn", { y: 18, autoAlpha: 0, scale: 0.95, duration: 0.9, ease: "expo.out", stagger: 0.08 }, 0.5)
    .from(".nav__inner > *", { yPercent: -80, autoAlpha: 0, duration: 0.9, ease: "expo.out", stagger: 0.06 }, 0.2)
    .from(".hero__cue", { autoAlpha: 0, duration: 0.8 }, 0.9);

  gsap.timeline({ scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } })
    .to(split.masks, { yPercent: (i) => -30 - i * 22, ease: "none" }, 0)
    .to(title, { autoAlpha: 0, ease: "power1.in" }, 0)
    .to(".hero__foot", { y: -90, autoAlpha: 0, ease: "none" }, 0);

  return tl;
}

/* ---------------------------------------------------------
   Statement: pinned, words light up as you scroll
   --------------------------------------------------------- */
function buildStatement() {
  const text = $(".statement__text");
  if (!text || !SplitText || reduced) return;
  const split = SplitText.create(text, { type: "words" });
  gsap.set(split.words, { opacity: 0.13 });
  gsap.timeline({
    // Pins refresh first so every trigger below includes their extra scroll length
    scrollTrigger: { trigger: ".statement", start: "top top", end: "+=130%", pin: true, scrub: 0.5, refreshPriority: 2 },
  })
    .to(split.words, { opacity: 1, stagger: 0.1, ease: "none", duration: 0.5 })
    .to({}, { duration: 0.8 });
}

/* ---------------------------------------------------------
   Services: horizontal pan on desktop, stacked on mobile
   --------------------------------------------------------- */
function buildServices() {
  const section = $(".services");
  const track = $(".services__track");
  const panels = $$(".svc", track);
  const counter = $("[data-svc-current]");
  const bar = $("[data-svc-bar]");
  splitHeading($("#services-title"), "top 75%");
  gsap.from(".services__intro .lead, .services__hint", {
    y: 24, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.1,
    scrollTrigger: { trigger: ".services__intro", start: "top 75%" },
  });

  panels.forEach((p) => p.addEventListener("pointerenter", () => bg?.pulse(0.5)));

  const mm = gsap.matchMedia();
  mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
    const pinEl = $(".services__pin");
    const dist = () => Math.max(0, track.scrollWidth - pinEl.clientWidth);
    const pan = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => `+=${dist()}`,
        pin: true,
        scrub: 0.8,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        refreshPriority: 1,
        onUpdate: (self) => gsap.set(bar, { scaleX: self.progress }),
      },
    });

    panels.forEach((p, i) => {
      gsap.fromTo($(".svc__ghost", p), { xPercent: 45 }, {
        xPercent: -45, ease: "none",
        scrollTrigger: { trigger: p, containerAnimation: pan, start: "left right", end: "right left", scrub: true },
      });
      gsap.fromTo(p, { rotate: 2.2, y: 26 }, {
        rotate: -2.2, y: -26, ease: "none",
        scrollTrigger: { trigger: p, containerAnimation: pan, start: "left right", end: "right left", scrub: true },
      });
      gsap.from($$(".svc__list li", p), {
        x: 36, autoAlpha: 0, duration: 0.7, ease: "expo.out", stagger: 0.05,
        scrollTrigger: { trigger: p, containerAnimation: pan, start: "left 82%", toggleActions: "play none none reverse" },
      });
      ScrollTrigger.create({
        trigger: p, containerAnimation: pan, start: "left 60%", end: "right 60%",
        onToggle: (self) => {
          if (!self.isActive) return;
          counter.textContent = String(i + 1).padStart(2, "0");
          bg?.pulse(0.35);
        },
      });
    });
  });

  mm.add("(max-width: 899px) and (prefers-reduced-motion: no-preference)", () => {
    panels.forEach((p) => {
      gsap.from(p, { y: 60, autoAlpha: 0, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: p, start: "top 90%" } });
    });
  });
}

/* ---------------------------------------------------------
   Insight: bento cells rise in, charts reveal themselves
   --------------------------------------------------------- */
function buildInsight() {
  splitHeading($("#insight-title"));
  if (reduced) return;
  gsap.from(".insight__head .lead, .insight__head .chip", {
    y: 26, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.1,
    scrollTrigger: { trigger: ".insight__head", start: "top 80%" },
  });
  const cells = $$(".cell");
  gsap.set(cells, { y: 80, autoAlpha: 0, scale: 0.97, transformOrigin: "50% 100%" });
  ScrollTrigger.batch(cells, {
    start: "top 90%",
    once: true,
    onEnter: (els) => gsap.to(els, { y: 0, autoAlpha: 1, scale: 1, duration: 1.15, ease: "expo.out", stagger: 0.1 }),
  });
  // A gentle depth drift between the two bento rows
  gsap.to(".cell--radar, .cell--area", {
    y: -40, ease: "none",
    scrollTrigger: { trigger: ".bento", start: "top bottom", end: "bottom top", scrub: true },
  });
}

/* ---------------------------------------------------------
   Approach: sticky stack, earlier cards recede
   --------------------------------------------------------- */
function buildProcess() {
  splitHeading($("#approach-title"));
  if (reduced) return;
  const steps = $$(".step");
  const navH = 68;
  steps.forEach((step, i) => {
    const inner = $(".step__inner", step);
    gsap.from([$(".step__num", step), $(".step__title", step), $(".step__body p", step), $(".step__icon", step)], {
      y: 44, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.07,
      scrollTrigger: { trigger: step, start: "top 78%" },
    });
    if (i < steps.length - 1) {
      // Cards stay opaque (so lower cards never show through); a shade dims them instead
      const shade = document.createElement("span");
      shade.className = "step__shade";
      inner.appendChild(shade);
      gsap.timeline({
        scrollTrigger: {
          trigger: steps[i + 1],
          start: "top bottom",
          end: () => `top ${navH + 24 + (i + 1) * 18}px`,
          scrub: true,
          invalidateOnRefresh: true,
        },
      })
        .to(inner, { scale: 0.93, ease: "none" }, 0)
        .to(shade, { opacity: 0.62, ease: "none" }, 0);
    }
  });
}

/* ---------------------------------------------------------
   Experience: rules draw, rows rise, accordion pulses the scene
   --------------------------------------------------------- */
function buildExperience() {
  splitHeading($("#experience-title"));
  if (reduced) return;
  gsap.from(".experience__head .lead", {
    y: 24, autoAlpha: 0, duration: 1, ease: "expo.out",
    scrollTrigger: { trigger: ".experience__head", start: "top 80%" },
  });
  $$(".xp__row").forEach((row) => {
    gsap.timeline({ scrollTrigger: { trigger: row, start: "top 92%" } })
      .from($(".xp__rule", row), { scaleX: 0, duration: 1.3, ease: "expo.out" })
      .from($(".xp__btn", row), { y: 36, autoAlpha: 0, duration: 1, ease: "expo.out" }, 0.08);
    $(".xp__btn", row).addEventListener("pointerenter", () => bg?.pulse(0.6));
  });
}

function initAccordion() {
  $$(".xp__btn").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      bg?.pulse(1);
      if (!gsap || reduced) { panel.hidden = open; ScrollTrigger?.refresh(); return; }
      if (!open) {
        panel.hidden = false;
        gsap.fromTo(panel, { height: 0 }, { height: "auto", duration: 0.6, ease: "expo.out", onComplete: () => ScrollTrigger.refresh() });
        gsap.fromTo($("p", panel), { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: "expo.out", delay: 0.05 });
      } else {
        gsap.to(panel, {
          height: 0, duration: 0.45, ease: "expo.inOut",
          onComplete: () => { panel.hidden = true; gsap.set(panel, { clearProps: "height" }); ScrollTrigger.refresh(); },
        });
      }
    });
  });
}

/* ---------------------------------------------------------
   Partners: velocity-reactive marquee + drawn hub diagram
   --------------------------------------------------------- */
function buildPartners() {
  splitHeading($("#partners-title"));

  const track = $(".marquee__track");
  if (track && !reduced) {
    const loop = gsap.to(track, { xPercent: -50, ease: "none", duration: 36, repeat: -1 });
    loop.totalTime(loop.duration() * 200);
    const skew = gsap.quickTo(track, "skewX", { duration: 0.5, ease: "power3.out" });
    let dir = 1;
    lenis.on("scroll", ({ velocity, direction }) => {
      if (direction) dir = direction;
      const speed = 1 + Math.min(Math.abs(velocity) * 0.09, 7);
      gsap.to(loop, { timeScale: dir * speed, duration: 0.6, ease: "power2.out", overwrite: true });
      skew(clamp(-velocity * 0.18, -9, 9));
    });
  }

  if (reduced) return;
  gsap.from(".partners__copy .lead, .ticks li", {
    y: 24, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.08,
    scrollTrigger: { trigger: ".partners__copy", start: "top 78%" },
  });

  const paths = $$(".hub__path");
  const nodes = $$(".hub__node");
  const packetsG = $(".hub__packets");
  gsap.set(nodes, { xPercent: -50, yPercent: -50, x: 0, y: 0 });
  gsap.set(paths, { strokeDashoffset: 1 });
  gsap.timeline({ scrollTrigger: { trigger: ".hub", start: "top 82%", end: "center 52%", scrub: 0.6 } })
    .from(".hub__orbit", { scale: 0.6, autoAlpha: 0, svgOrigin: "300 230", duration: 0.6, stagger: 0.1 }, 0)
    .from(".hub__node--core", { scale: 0.5, autoAlpha: 0, duration: 0.3 }, 0)
    .to(paths, { strokeDashoffset: 0, duration: 0.6, stagger: 0.12, ease: "none" }, 0.15)
    .from(nodes.slice(1), { scale: 0.7, autoAlpha: 0, duration: 0.3, stagger: 0.12 }, 0.45)
    .from(packetsG, { autoAlpha: 0, duration: 0.2 }, 0.9);

  // Data packets travelling along each link
  const NSVG = "http://www.w3.org/2000/svg";
  const packets = [];
  paths.forEach((p, i) => {
    const L = p.getTotalLength();
    for (let k = 0; k < 2; k++) {
      const c = document.createElementNS(NSVG, "circle");
      c.setAttribute("r", k ? 2.5 : 3.5);
      packetsG.appendChild(c);
      packets.push({ p, L, c, off: k * 0.5 + i * 0.17, inbound: k === 1 });
    }
  });
  let visible = false;
  ScrollTrigger.create({ trigger: ".hub", start: "top bottom", end: "bottom top", onToggle: (s) => (visible = s.isActive) });
  gsap.ticker.add((time) => {
    if (!visible) return;
    packets.forEach((pk) => {
      let t = (time * 0.24 + pk.off) % 1;
      if (pk.inbound) t = 1 - t;
      const pt = pk.p.getPointAtLength(t * pk.L);
      pk.c.setAttribute("cx", pt.x);
      pk.c.setAttribute("cy", pt.y);
      pk.c.setAttribute("opacity", Math.sin(t * Math.PI).toFixed(3));
    });
  });
}

/* ---------------------------------------------------------
   Contact + footer
   --------------------------------------------------------- */
function buildContact() {
  const title = $(".contact__title");
  if (reduced) return;
  if (SplitText && title) {
    SplitText.create(title, {
      type: "lines,chars",
      mask: "lines",
      autoSplit: true,
      onSplit(self) {
        gsap.set(self.masks, { paddingBottom: "0.08em", marginBottom: "-0.08em" });
        return gsap.from(self.chars, {
          yPercent: 112, duration: 1.15, ease: "expo.out", stagger: 0.022,
          scrollTrigger: { trigger: title, start: "top 82%" },
        });
      },
    });
  }
  gsap.from(".contact__intro .lead, .contact__details li", {
    y: 28, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.08,
    scrollTrigger: { trigger: ".contact__grid", start: "top 80%" },
  });
  gsap.from(".form", {
    y: 70, autoAlpha: 0, duration: 1.2, ease: "expo.out",
    scrollTrigger: { trigger: ".contact__grid", start: "top 80%" },
  });
}

function buildFooter() {
  $("[data-to-top]")?.addEventListener("click", () => {
    lenis.scrollTo(0, { duration: 2.2, easing: easeOutQuart });
    $("#main").focus({ preventScroll: true });
  });
  if (reduced) return;
  gsap.from(".footer__mark span", {
    yPercent: 100, ease: "none", stagger: 0.06,
    scrollTrigger: { trigger: ".footer", start: "top 85%", end: "bottom bottom", scrub: 0.6 },
  });
  gsap.from(".footer__cols > *", {
    y: 30, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.08,
    scrollTrigger: { trigger: ".footer", start: "top 85%" },
  });
}

/* ---------------------------------------------------------
   Background: each section's entry morphs to the next formation
   --------------------------------------------------------- */
function buildFormationAnchors() {
  return $$("[data-formation]").slice(1).map((sec) =>
    ScrollTrigger.create({ trigger: sec, start: "top 72%", end: "top 12%" })
  );
}
function formationAt(anchors) {
  let f = 0;
  for (const st of anchors) f += st.progress;
  return f;
}

async function bootBackground(anchors) {
  const canvas = $("#bg");
  try {
    const mod = await import("./background.js");
    bg = mod.createBackground(canvas, { mobile: window.innerWidth < 900, reduced });
  } catch (err) {
    root.classList.add("no-webgl");
    console.warn("Vector background disabled:", err);
    return;
  }

  if (reduced) {
    const still = () => bg.update({ time: 0, f: 0 });
    still();
    window.addEventListener("resize", debounce(() => { bg.resize(); still(); }, 150));
    return;
  }

  gsap.ticker.add((time) => {
    bg.update({ time, f: formationAt(anchors), scroll: lenis.scroll, velocity: lenis.velocity });
  });
  window.addEventListener("resize", debounce(() => bg.resize(), 150));
  if (introPlayed) bg.intro(gsap.ticker.time);
}

/* ---------------------------------------------------------
   Navigation, menu, anchors
   --------------------------------------------------------- */
function initNav() {
  const nav = $("[data-nav]");
  const bar = $("[data-progress]");
  lenis.on("scroll", ({ scroll, direction, progress }) => {
    nav.classList.toggle("is-scrolled", scroll > 40);
    if (!menuOpen) {
      if (scroll > 320 && direction > 0) nav.classList.add("is-hidden");
      else if (direction < 0 || scroll <= 320) nav.classList.remove("is-hidden");
    }
    bar.style.transform = `scaleX(${progress || 0})`;
  });
  nav.addEventListener("focusin", () => nav.classList.remove("is-hidden"));

  $$(".nav__links a").forEach((a) => {
    const sec = $(a.getAttribute("href"));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec, start: "top 50%", end: "bottom 50%",
      onToggle: (s) => a.classList.toggle("is-active", s.isActive),
    });
  });
}

function initMenu() {
  const btn = $("[data-menu-toggle]");
  const menu = $("#menu");
  if (!btn || !menu) return;
  const links = $$("a", menu);

  const open = () => {
    menuOpen = true;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Close menu");
    $("[data-nav]").classList.remove("is-hidden");
    lenis.stop();
    gsap.fromTo(menu, { clipPath: "inset(0% 0% 100% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.6, ease: "expo.out" });
    gsap.fromTo(links, { yPercent: 50, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.7, ease: "expo.out", stagger: 0.05, delay: 0.08 });
  };
  closeMenu = () => {
    if (!menuOpen) return;
    menuOpen = false;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open menu");
    lenis.start();
    gsap.to(menu, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.45, ease: "expo.in", onComplete: () => (menu.hidden = true) });
  };

  btn.addEventListener("click", () => (menuOpen ? closeMenu() : open()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuOpen) { closeMenu(); btn.focus(); }
  });
  window.addEventListener("resize", () => { if (menuOpen && window.innerWidth >= 900) closeMenu(); });
}

function initAnchors() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    const target = id === "#top" || id === "#" ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    closeMenu();
    lenis.scrollTo(target, {
      duration: 1.6,
      easing: easeOutQuart,
      onComplete: () => {
        if (target instanceof HTMLElement) {
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
        }
      },
    });
  });
}

/* ---------------------------------------------------------
   Cursor + magnetic buttons (fine pointers only)
   --------------------------------------------------------- */
function initCursor() {
  if (!finePointer || reduced) return;
  const cur = $(".cursor");
  const dot = $(".cursor__dot");
  const ring = $(".cursor__ring");
  cur.classList.add("is-idle");
  const dx = gsap.quickTo(dot, "x", { duration: 0.08, ease: "power3" });
  const dy = gsap.quickTo(dot, "y", { duration: 0.08, ease: "power3" });
  const rx = gsap.quickTo(ring, "x", { duration: 0.45, ease: "power3" });
  const ry = gsap.quickTo(ring, "y", { duration: 0.45, ease: "power3" });
  let shown = false;

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    if (!shown) { gsap.set([dot, ring], { x: e.clientX, y: e.clientY }); shown = true; }
    cur.classList.remove("is-idle");
    dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
    bg?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1, gsap.ticker.time);
  }, { passive: true });

  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-cursor], a, button, input, select, textarea, label");
    if (!el) { cur.dataset.state = ""; return; }
    cur.dataset.state = el.dataset.cursor || (el.matches("input, select, textarea") ? "hide" : "link");
  });
  document.documentElement.addEventListener("pointerleave", () => { cur.classList.add("is-idle"); bg?.clearPointer(); });
}

function initMagnetic() {
  if (!finePointer || reduced || !gsap) return;
  $$("[data-magnetic]").forEach((el) => {
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "power3.out" });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.28);
      yTo((e.clientY - r.top - r.height / 2) * 0.4);
    });
    el.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
  });
}

/* ---------------------------------------------------------
   Contact form: inline validation, then hands off to email
   (swap for Formspree / a Cloudflare Pages Function later)
   --------------------------------------------------------- */
function initForm() {
  const form = $("[data-contact-form]");
  if (!form) return;
  const status = $(".form__status", form);
  const fields = { name: form.elements.name, email: form.elements.email, message: form.elements.message };
  const rules = {
    name: (v) => (v.trim() ? "" : "Please enter your name."),
    email: (v) =>
      !v.trim()
        ? "Please enter your email address."
        : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
          ? ""
          : "That email address looks incomplete. Check it reads like name@company.com.",
    message: (v) => (v.trim().length >= 10 ? "" : "Tell us a little more (a sentence or two) so we can help."),
  };
  const setError = (input, msg) => {
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    const err = document.getElementById(`${input.id}-err`);
    if (err) err.textContent = msg;
  };

  Object.entries(fields).forEach(([key, input]) => {
    input.addEventListener("blur", () => { if (input.value) setError(input, rules[key](input.value)); });
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") setError(input, rules[key](input.value));
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let first = null;
    Object.entries(fields).forEach(([key, input]) => {
      const msg = rules[key](input.value);
      setError(input, msg);
      if (msg && !first) first = input;
    });
    if (first) {
      first.focus();
      status.classList.remove("is-success");
      status.textContent = "Please fix the highlighted fields and try again.";
      return;
    }
    const d = Object.fromEntries(new FormData(form));
    const to = form.dataset.email;
    const subject = `Website enquiry: ${d.interest} (${d.name}${d.company ? `, ${d.company}` : ""})`;
    const body = [
      `Name: ${d.name}`,
      `Company: ${d.company || "-"}`,
      `Email: ${d.email}`,
      `Phone: ${d.phone || "-"}`,
      `Interested in: ${d.interest}`,
      "",
      d.message,
    ].join("\n");
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.classList.add("is-success");
    status.textContent = `Your email app should open with the enquiry ready to send. If it doesn't, email ${to} directly.`;
  });
}
