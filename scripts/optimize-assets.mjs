/* Builds the optimised images in /public from the original sources.
   Sources live outside this repo (the GOBT project and the legacy site),
   so this only needs re-running when a screenshot or logo changes:

     GOBT_DIR=~/Downloads/GOBT npm run assets
*/
import sharp from 'sharp'
import { mkdir, copyFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const gobt = process.env.GOBT_DIR?.replace(/^~/, homedir()) ?? path.join(homedir(), 'Downloads/GOBT')
const legacy = path.join(root, 'legacy-site')
const extra = process.env.EXTRA_DIR ?? path.join(root, 'scripts/src') // extra captures (gobt.in homepage)
const out = (...p) => path.join(root, 'public', ...p)

const WORK = {
  gobt: path.join(extra, 'gobt-home.png'),
  picaku: path.join(extra, 'picaku.png'),
  lifeapp: path.join(extra, 'lifeapp.png'),
  pizzahap: path.join(gobt, 'public/img/pizzahap-website-and-branding.png'),
  gharkamali: path.join(gobt, 'public/img/gharkamali-mobile-app.png'),
  'gharkamali-alt': path.join(gobt, 'public/img/gharkamali-home-services-marketplace.png'),
  altaqwa: path.join(gobt, 'public/img/al-taqwa-luxury-ecommerce.png'),
  accurateastro: path.join(gobt, 'public/img/accurate-astro-booking-platform.png'),
  mastermind: path.join(gobt, 'public/img/mastermind-abacus-odisha-website.png'),
  gftd: path.join(gobt, 'public/img/gftd-ecommerce-gifting-platform.png'),
  agile: path.join(gobt, 'public/img/agile-engineering-corporate-website.png'),
  ideashapers: path.join(gobt, 'public/img/idea-shapers-website.png'),
}

const LOGOS = {
  gobt: path.join(gobt, 'public/logo.png'),
  pizzahap: path.join(gobt, 'public/pizzahap-logo.png'),
  gharkamali: path.join(gobt, 'public/gkm-logo.png'),
  altaqwa: path.join(gobt, 'public/aitqwa-logo.png'),
  accurateastro: path.join(gobt, 'public/accurateastro-logo.png'),
  gftd: path.join(gobt, 'public/gftd-logo.png'),
  agile: path.join(gobt, 'public/agile-logo.png'),
}

const exists = async (p) => access(p).then(() => true, () => false)

async function run() {
  await Promise.all(['img/work', 'img/tex', 'img/logos', 'img/people'].map((d) => mkdir(out(d), { recursive: true })))

  for (const [slug, src] of Object.entries(WORK)) {
    if (!(await exists(src))) { console.warn('missing', src); continue }
    const img = sharp(src).flatten({ background: '#111' })
    await img.clone().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toFile(out('img/work', `${slug}.webp`))
    await img.clone().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out('img/work', `${slug}-sm.webp`))
    // billboard textures are 2:1, cropped from the top so the hero of each site shows
    await img.clone().resize({ width: 1024, height: 512, fit: 'cover', position: 'top' }).webp({ quality: 80 }).toFile(out('img/tex', `${slug}.webp`))
    console.log('work', slug)
  }

  for (const [slug, src] of Object.entries(LOGOS)) {
    if (!(await exists(src))) { console.warn('missing', src); continue }
    await sharp(src).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(out('img/logos', `${slug}.webp`))
    console.log('logo', slug)
  }

  const people = [
    [path.join(gobt, 'public/team/akash.webp'), 'akash-cutout.webp', 640],
    [path.join(legacy, 'images/my image.jpg'), 'akash-photo.webp', 1200],
    [path.join(legacy, 'images/avatars/souvik.jpg'), 'souvik.webp', 240],
    [path.join(legacy, 'images/avatars/subhodeep.jpg'), 'subhodeep.webp', 240],
  ]
  for (const [src, name, w] of people) {
    if (!(await exists(src))) { console.warn('missing', src); continue }
    await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toFile(out('img/people', name))
    console.log('person', name)
  }

  const cv = path.join(legacy, 'akash ranjan mandal cv.pdf')
  if (await exists(cv)) await copyFile(cv, out('akash-ranjan-mandal-cv.pdf'))

  // app icons rendered from the SVG mark
  const mark = out('favicon.svg')
  if (await exists(mark)) {
    for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
      await sharp(mark, { density: 512 }).resize(size, size).png().toFile(out(name))
    }
    console.log('icons')
  }
}

run().catch((e) => { console.error(e); process.exit(1) })
