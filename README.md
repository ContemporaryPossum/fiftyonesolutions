# FiftyOne Solutions website

Static, single-page marketing site for **FiftyOne Technology Sdn. Bhd.** (trading as FiftyOne Solutions).
There is no build step: every file sits in the repository root and Cloudflare serves it as-is.

## Files

| File | What it does |
| --- | --- |
| `index.html` | All page content and sections |
| `styles.css` | Design tokens (colours, type, spacing) and every component style |
| `main.js` | Lenis smooth scroll + GSAP ScrollTrigger choreography, nav, menu, cursor, form |
| `background.js` | The scroll-reactive WebGL vector background (three.js) |
| `charts.js` | Interactive Bklit-style charts (live line, ring, radar, area, heatmap) |
| `favicon.svg` | Browser tab icon (the "51" mark) |
| `404.html` | Branded "page not found" page (Cloudflare uses it automatically) |
| `_headers` | Security and caching headers for Cloudflare Pages |
| `robots.txt` | Allows search engines to index the site |

## Deploy

1. **GitHub:** create a new repository, click *Add file > Upload files*, drag in all the files above, and commit.
2. **Cloudflare:** go to *Workers & Pages > Create > Pages > Connect to Git*, pick the repository, then set:
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: **/**
3. Deploy. Every later commit to the repository redeploys automatically.
4. Optional: add the client's domain under the project's *Custom domains* tab.

## Before going live, replace

- **Email, phone and address** in the Contact section of `index.html` (search for `REPLACE`).
- **`data-email="hello@example.com"`** on the contact form: the inbox that should receive enquiries.
  The form opens the visitor's email app with the message filled in. For a true "send" form,
  connect a service such as Formspree or a Cloudflare Pages Function later.
- **Proof:** a styled testimonial block is ready (commented out) in the Experience section of `index.html`.
  Add real client quotes, logos or case studies when available.
- **Charts:** the Insight dashboard uses sample data and says so on the page. Swap values in `charts.js`
  if the client wants to show real (anonymised) figures.
- Optional: a 1200x630 social preview image (`og-image.png`) plus an `og:image` tag in `index.html`.

## Customising

- **Colours, fonts, spacing:** the `:root` block at the top of `styles.css`. The single accent colour is `--accent`.
- **Background shapes:** `background.js`. Each section's `data-formation` maps to a shape
  (globe, vortex, terrain, tunnel, helix, torus, clusters, the "51" mark), in page order.
- **Motion:** `main.js`, one `build...()` function per section.

## Notes

- Visitors with "reduce motion" switched on get a calm version: native scrolling, no pinned or scrubbed
  scenes, and a still background.
- If WebGL is unavailable the background falls back to a static gradient. If a CDN fails, the page still
  shows all content without animation.
- The charts follow Bklit UI's design language (its `--chart-*` tokens, crosshair, tooltip, date pill and
  reveal timing). Bklit itself is a React + shadcn registry that needs a build step, so these are
  dependency-free SVG versions that keep the site deployable as plain files.

## Third-party libraries (loaded from CDNs, pinned versions)

- GSAP 3.13 with ScrollTrigger and SplitText (free under GreenSock's standard licence)
- Lenis 1.3 (MIT)
- three.js 0.170 (MIT)
- Phosphor Icons 2.1 (MIT)
- Geist and Geist Mono fonts via Google Fonts (SIL Open Font Licence)
