# Akash Ranjan Mandal — The Ride

An interactive 3D portfolio. You board a Kolkata taxi and ride a loop around an island in the sea; every stop is a chapter of the story or one of the projects I built. Scroll to ride, or take the wheel and drive.

**Live:** https://akash-jsx.netlify.app

## What's in it

- **Story mode** — scrolling drives the taxi from stop to stop (GSAP + Lenis), with the camera, time of day (dawn to night) and ticket panels following along.
- **Drive mode** — a physics taxi (cannon-es `RaycastVehicle`) with keyboard controls or a touch joystick, 12 hidden bugs to fix, ramps, props to knock over and a minimap.
- **19 stops** — Egra, university, first jobs, Xeta Labs, Picaku, Life App, Howrah Bridge, GOBT HQ, PizzaHap, GharKaMali, Al-Taqwa, Accurate Astro, Mastermind Abacus, GFTD, AGILE Engineering, Idea Shapers, skills, and the last stop.
- **Resume view** — everything on one accessible, scrollable page, plus the CV as a PDF.
- Fully responsive, adaptive quality (pixel ratio and shadows scale with the device), reduced-motion support, no-WebGL fallback.

## Stack

Vite · TypeScript · three.js · cannon-es · GSAP (SplitText) · Lenis · WebAudio (all sound is synthesised, no audio files)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview
```

## Project layout

```
src/content.ts        all copy: stops, projects, skills, testimonials
src/App.ts            conductor: scroll → taxi → camera → panels; drive mode
src/gl/               world: island, sea, road, landmarks, taxi, physics, sky
src/ui/               story timeline, ticket panels, modals, resume, HUD
scripts/              asset pipeline (sharp) for screenshots and logos
public/               optimised images, CV, manifest, icons
legacy-site/          the previous static portfolio, kept for reference
```

Edit `src/content.ts` to change any text or add a project; add its screenshot to `scripts/optimize-assets.mjs` and run `npm run assets`.

## Deploy

Static output in `dist/`. `netlify.toml` and `vercel.json` are included.

## Credits

Built by Akash Ranjan Mandal. Project screenshots belong to their respective sites.
