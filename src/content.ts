/* ──────────────────────────────────────────────────────────────
   CONTENT
   Every word on the site comes from here: the story panels, the
   project case notes, the resume view and the 3D signage. Change
   copy here and the whole ride updates.
────────────────────────────────────────────────────────────── */

export const PROFILE = {
  name: 'Akash Ranjan Mandal',
  first: 'Akash',
  role: 'Full-stack Engineer & DevOps Lead',
  location: 'West Bengal, India',
  email: 'akashranjanmandal@gmail.com',
  phone: '+91 73192 92532',
  phoneHref: 'tel:+917319292532',
  whatsapp: 'https://wa.me/917319292532',
  cv: 'akash-ranjan-mandal-cv.pdf',
  photo: 'img/people/akash-photo.webp',
  cutout: 'img/people/akash-cutout.webp',
  socials: [
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/akash-ranjan-mandal-95abbb215/' },
    { label: 'GitHub', href: 'https://github.com/akashranjanmandal' },
    { label: 'Instagram', href: 'https://www.instagram.com/akaas.jpeg/' },
  ],
}

export type Project = {
  slug: string
  name: string
  tagline: string
  summary: string
  kind: string
  where: string
  features: string[]
  stats: { v: string; k: string }[]
  tech: string[]
  live: string
  image: string
  imageSm: string
  texture: string
  logo?: string
  accent: string
}

const work = (slug: string) => ({
  image: `img/work/${slug}.webp`,
  imageSm: `img/work/${slug}-sm.webp`,
  texture: `img/tex/${slug}.webp`,
})

export const PROJECTS: Record<string, Project> = {
  picaku: {
    slug: 'picaku',
    name: 'Picaku',
    tagline: 'Record. Transcribe. Never forget.',
    summary:
      'An AI memory app built at Xeta Labs: it turns meetings, lectures and voice notes into accurate transcripts, smart summaries and a searchable knowledge base you can chat with.',
    kind: 'AI app · Xeta Labs',
    where: 'iOS · Android · Web',
    features: [
      'Live recording with noise suppression and speaker separation',
      'Real-time transcription with punctuation and speaker labels',
      'Save links — articles, videos and research papers — alongside recordings',
      'Chat with everything you have ever recorded',
      'Memory highlights and smart summaries with action items and decisions',
    ],
    stats: [
      { v: '99%', k: 'accuracy in a quiet room' },
      { v: '3', k: 'platforms' },
      { v: 'AI', k: 'chat over your memories' },
    ],
    tech: ['AI transcription', 'Summaries', 'Semantic search', 'iOS', 'Android', 'Web'],
    live: 'https://picaku.org',
    ...work('picaku'),
    accent: '#e2312b',
  },
  lifeapp: {
    slug: 'lifeapp',
    name: 'Life App',
    tagline: 'Play, learn and earn.',
    summary:
      'A gamified learning platform for children, teachers and mentors — STEM, social-emotional, digital, financial and AI skills taught through collaborative games and real-world projects. Built at Xeta Labs.',
    kind: 'EdTech platform · Xeta Labs',
    where: 'Android · Schools across India',
    features: [
      'Gamified challenges and DIY activities across STEM, SEL, digital, financial and AI skills',
      'Standards-aligned, project-based resources for teachers',
      'Career and social-emotional mentorship connections',
      'Coins, rankings and rewards that keep students coming back',
      'Usage data that feeds school ratings and donor engagement',
    ],
    stats: [
      { v: '100K+', k: 'downloads' },
      { v: '140K+', k: 'users' },
      { v: '4★', k: 'Play Store rating' },
    ],
    tech: ['Android app', 'Gamification', 'Teacher tools', 'Rewards engine'],
    live: 'https://life-app.ai/',
    ...work('lifeapp'),
    accent: '#1b8fe6',
  },
  gobt: {
    slug: 'gobt',
    name: 'gobt.in',
    tagline: 'We pioneer Deep-Tech AI that Automates.',
    summary:
      'The flagship site for GOBT — Group Of Blooming Technicians, a DPIIT-recognised deep-tech startup in Kolkata. Particle-built gears and team portraits, scroll choreography, a live project estimator and serious SEO plumbing.',
    kind: 'Company website',
    where: 'Kolkata',
    features: [
      'Three.js particle gears and particle portraits of the team',
      'GSAP + Lenis scroll choreography across every section',
      'Interactive estimator for timelines and team size',
      'Contact API with Nodemailer, security headers, canonical redirects',
      'Sitemap, Open Graph images, structured data and llms.txt',
    ],
    stats: [
      { v: 'DPIIT', k: 'recognised startup' },
      { v: '9+', k: 'active clients' },
      { v: '25+', k: 'products launched' },
    ],
    tech: ['Next.js 16', 'React 19', 'TypeScript', 'Three.js', 'GSAP', 'Lenis', 'Tailwind 4'],
    live: 'https://gobt.in',
    ...work('gobt'),
    logo: 'img/logos/gobt.webp',
    accent: '#e8b923',
  },
  pizzahap: {
    slug: 'pizzahap',
    name: 'PizzaHap',
    tagline: 'Crafted Fire. Real Flavor.',
    summary:
      'A fire-themed website for a pizza & burger brand with stores in Uttarakhand — built to take hungry people from “wow” to “order” in two taps.',
    kind: 'Brand website',
    where: 'Uttarakhand',
    features: [
      '“Born from fire” hero slider with a custom ember cursor',
      '50+ item menu with veg / non-veg tagging',
      'Order on WhatsApp or the app, plus a store finder',
      'Reviews and bulk-order enquiries',
    ],
    stats: [
      { v: '4.8★', k: 'average rating' },
      { v: '50+', k: 'menu items' },
      { v: '2', k: 'stores live' },
    ],
    tech: ['HTML', 'CSS', 'JavaScript'],
    live: 'https://pizzahap.com',
    ...work('pizzahap'),
    logo: 'img/logos/pizzahap.webp',
    accent: '#ff5a1f',
  },
  gharkamali: {
    slug: 'gharkamali',
    name: 'GharKaMali',
    tagline: 'Professional gardening, made simple.',
    summary:
      'An on-demand gardening marketplace for Delhi NCR. Book a certified gardener from ₹349, subscribe to a plan, shop for plants or ask the AI about a sick leaf — on the web and in a Flutter app.',
    kind: 'Marketplace · Web + App',
    where: 'Delhi NCR',
    features: [
      'Five-step booking: location → plan → add-ons → schedule → confirm',
      'Live gardener tracking with maps and sockets',
      'Plant store, subscriptions and an in-app wallet',
      'AI “Plantopedia” plant identification from a photo',
      'Razorpay & PayU payments with OTP login',
    ],
    stats: [
      { v: '1,200+', k: 'homes served' },
      { v: '4.9★', k: 'user rating' },
      { v: '3', k: 'platforms' },
    ],
    tech: ['Next.js 14', 'TypeScript', 'React Query', 'Zustand', 'GSAP', 'Leaflet', 'Socket.io', 'Flutter'],
    live: 'https://gharkamali.com',
    ...work('gharkamali'),
    logo: 'img/logos/gharkamali.webp',
    accent: '#2f7d45',
  },
  altaqwa: {
    slug: 'altaqwa',
    name: 'Al-Taqwa',
    tagline: 'Where luxury meets elegance.',
    summary:
      'A navy-and-gold storefront for a Kolkata attar house — eight handcrafted, alcohol-free fragrances presented like jewellery.',
    kind: 'Luxury storefront',
    where: 'Kolkata',
    features: [
      'Collection of eight signature attars with notes, longevity and pricing',
      'Luxury art direction: deep navy, gold foil, high-contrast serif type',
      'Testimonials and an enquiry form wired with EmailJS',
      'Free-shipping and delivery messaging for all of India',
    ],
    stats: [
      { v: '8', k: 'signature attars' },
      { v: '100%', k: 'alcohol-free' },
      { v: '₹449', k: 'starting price' },
    ],
    tech: ['HTML', 'CSS', 'JavaScript', 'EmailJS'],
    live: 'https://altaqwa.in',
    ...work('altaqwa'),
    logo: 'img/logos/altaqwa.webp',
    accent: '#d6a842',
  },
  accurateastro: {
    slug: 'accurateastro',
    name: 'Accurate Astro',
    tagline: 'A free consultation with an expert astrologer, today.',
    summary:
      'A consultation platform that connects people with expert astrologers — profiles, services, sign-ups and booking on the web, with a companion Android app.',
    kind: 'Booking platform',
    where: 'India',
    features: [
      'Astrologer profiles and a services catalogue',
      'Login / registration and consultation booking',
      'Companion Android app on Google Play',
      'Fast single-page app built with React and Vite',
    ],
    stats: [
      { v: 'Web', k: '+ Android app' },
      { v: 'SPA', k: 'React + Vite' },
      { v: 'Free', k: 'first consultation' },
    ],
    tech: ['React', 'Vite', 'JavaScript'],
    live: 'https://accurateastro.in',
    ...work('accurateastro'),
    logo: 'img/logos/accurateastro.webp',
    accent: '#58b8ef',
  },
  mastermind: {
    slug: 'mastermind',
    name: 'Mastermind Abacus Odisha',
    tagline: 'Faster math, stronger focus, confident learners.',
    summary:
      'Website and growth engine for an abacus academy with nine centres across Odisha — a 3D globe, a free-assessment funnel, and monthly SEO and Google Ads reporting.',
    kind: 'Education · Website + SEO',
    where: 'Odisha',
    features: [
      'Interactive 3D globe built with Three.js and globe.gl',
      'Programmes for ages 5–14 and a centre finder for Bhubaneswar, Cuttack and Khordha',
      'Free-assessment lead funnel with EmailJS',
      'Blog, gallery and FAQ structured for search',
      'GA4 analytics with monthly SEO and Google Ads reports',
    ],
    stats: [
      { v: '9', k: 'centres in Odisha' },
      { v: '5–14', k: 'age range' },
      { v: '12', k: 'kids per batch' },
    ],
    tech: ['HTML', 'CSS', 'JavaScript', 'Three.js', 'globe.gl', 'Lenis', 'GA4'],
    live: 'https://mastermindabacusodisha.com',
    ...work('mastermind'),
    accent: '#f26b3a',
  },
  gftd: {
    slug: 'gftd',
    name: 'GFTD',
    tagline: 'The Art of Gifting.',
    summary:
      'A full-stack gifting store: browse categories, pick a curated combo or build your own, pay with Razorpay and track the order to the doorstep.',
    kind: 'E-commerce · Full-stack',
    where: 'India',
    features: [
      'Categories, curated combos and a custom-combo builder',
      'Razorpay checkout with order tracking',
      'Admin tools with S3 media uploads and PDF exports',
      'Email notifications and a rate-limited Express API',
    ],
    stats: [
      { v: 'React', k: 'storefront' },
      { v: 'Postgres', k: 'orders & catalogue' },
      { v: 'Razorpay', k: 'payments' },
    ],
    tech: ['React', 'TypeScript', 'Vite', 'Tailwind', 'Express', 'PostgreSQL', 'Razorpay', 'AWS S3'],
    live: 'https://gftd.in',
    ...work('gftd'),
    logo: 'img/logos/gftd.webp',
    accent: '#e3b23c',
  },
  agile: {
    slug: 'agile',
    name: 'AGILE Engineering',
    tagline: 'Engineering excellence & innovative solutions.',
    summary:
      'The corporate site for a Kolkata engineering consultancy spanning civil, architecture, mechanical, electrical and instrumentation — built to turn searches into enquiries.',
    kind: 'Corporate website',
    where: 'Kolkata',
    features: [
      'Five disciplines, eight service lines and ten industries, clearly mapped',
      'Inquiry form and WhatsApp lead capture',
      'Four-step approach told as a story: assess, plan, build, monitor',
      'SEO-first structure on a fast, static build',
    ],
    stats: [
      { v: '5', k: 'disciplines' },
      { v: '8', k: 'service lines' },
      { v: '10', k: 'industries' },
    ],
    tech: ['HTML', 'CSS', 'JavaScript', 'EmailJS', 'SEO'],
    live: 'https://agileengcon.in',
    ...work('agile'),
    logo: 'img/logos/agile.webp',
    accent: '#3f9a4a',
  },
  ideashapers: {
    slug: 'ideashapers',
    name: 'Idea Shapers',
    tagline: 'Brands and digital experiences the world can’t ignore.',
    summary:
      'The website for a Kolkata branding & digital agency with a 2,000+ creator network — editorial type, quiet motion and a five-step story of how they work.',
    kind: 'Agency website',
    where: 'Kolkata',
    features: [
      'Editorial hero mixing serif and sans type',
      'Portfolio across categories and a creator-network showcase',
      'Five-step process: discovery → strategy → design → build → launch',
      'Project-enquiry flows and FAQ',
    ],
    stats: [
      { v: '20+', k: 'projects delivered' },
      { v: '2,000+', k: 'creators' },
      { v: '98%', k: 'client satisfaction' },
    ],
    tech: ['Next.js 16', 'React 19', 'Tailwind', 'GSAP'],
    live: 'https://ideashapers.org',
    ...work('ideashapers'),
    accent: '#3346a8',
  },
}

export type StopKind = 'intro' | 'chapter' | 'project' | 'skills' | 'contact'

export type Stop = {
  id: string
  kind: StopKind
  /** short name for the progress rail and the stops menu */
  label: string
  /** text painted on the roadside milestone */
  sign: string
  eyebrow: string
  title: string
  body?: string
  meta?: { k: string; v: string }[]
  list?: { title: string; text: string; href?: string }[]
  links?: { label: string; href: string }[]
  quote?: string
  stats?: { v: string; k: string }[]
  project?: string
  /** time of day for this stop: 0 = dawn … 1 = deep night */
  time: number
}

export const STOPS: Stop[] = [
  {
    id: 'boarding',
    kind: 'intro',
    label: 'Boarding',
    sign: 'AKASH',
    eyebrow: 'Boarding',
    title: 'Akash Ranjan Mandal',
    body: 'Full-stack engineer & DevOps lead from Bengal. I build web products that make people look up.',
    meta: [
      { k: 'Now', v: 'DevOps Lead · GOBT' },
      { k: 'Also', v: 'Full-stack · Xeta Labs' },
    ],
    time: 0,
  },
  {
    id: 'egra',
    kind: 'chapter',
    label: 'Egra',
    sign: 'EGRA',
    eyebrow: 'Egra, Purba Medinipur',
    title: 'Every road starts somewhere. <em>Mine starts in Egra.</em>',
    body: 'A small town in Purba Medinipur, West Bengal. At Egra Jhatulal High School I picked up the habit that still runs everything I do: finish what you start — and finish it well.',
    meta: [
      { k: '2018', v: 'Secondary · 82%' },
      { k: '2020', v: 'Higher Secondary · 88%' },
    ],
    time: 0.07,
  },
  {
    id: 'neotia',
    kind: 'chapter',
    label: 'University',
    sign: 'NEOTIA UNIV.',
    eyebrow: 'The Neotia University',
    title: 'Four years of B.Tech. <em>One question: does it solve a real problem?</em>',
    body: 'Computer Science & Engineering, 2020 – 2024, graduating with a CGPA of 8.59. Most of it went into building things people could actually use:',
    list: [
      { title: 'Aquafaze', text: 'Snap a selfie, get your hydration level — a full-stack ML app with 93% accuracy.' },
      { title: 'Dharitrika', text: 'Upload a leaf, catch the plant disease early. My ML-powered major project.' },
      { title: 'CMMS', text: 'Ticket management for the university with three role-based panels, built under the Pro-Chancellor’s guidance.' },
    ],
    meta: [
      { k: 'CGPA', v: '8.59 / 10' },
      { k: 'Clubs', v: 'Techniche · Turning Lens' },
    ],
    time: 0.15,
  },
  {
    id: 'first-jobs',
    kind: 'chapter',
    label: 'First jobs',
    sign: 'AILABS · XETA',
    eyebrow: 'First jobs',
    title: 'Trained in Kolkata. <em>Shipped from Assam.</em>',
    body: 'Engineering Trainee at AILABS, Kolkata, then a frontend internship at Xeta Labs, Assam — my first taste of real deadlines and real users.',
    list: [
      { title: 'Life Lab', text: 'Website for an NGO working with children, built at Xeta Labs.' },
      { title: 'MSTCE', text: 'Online board-examination system demo for Meghalaya’s state board.' },
      { title: 'Deaf & Dumb Institution', text: 'Site with sign-ups, newsletter and student registration for Basudevpur.', href: 'https://deafndumb.netlify.app/' },
    ],
    links: [
      { label: 'Bharat Steel Tech', href: 'https://bharatsteeltech.com/' },
      { label: 'Association of Engineers, India', href: 'https://aeindia.org.in/' },
      { label: 'Lapcom Xpert', href: 'https://lapcomxpert.in/' },
    ],
    meta: [
      { k: 'Jul–Aug 2023', v: 'AILABS · Engineering Trainee' },
      { k: 'Jan 2024', v: 'Joined Xeta Labs' },
    ],
    time: 0.24,
  },
  {
    id: 'xeta',
    kind: 'chapter',
    label: 'Xeta Labs',
    sign: 'XETA LABS',
    eyebrow: 'Xeta Labs, Assam',
    title: 'Intern in 2024. <em>Full-stack engineer since 2025.</em>',
    body: 'Xeta Labs is where I grew up as an engineer — from shipping frontends as an intern to owning features end to end. Real products, real users: an AI memory app, a learning platform with 140K+ users, and more.',
    meta: [
      { k: 'Jan–Aug 2024', v: 'Frontend Engineer' },
      { k: 'Feb 2025 — now', v: 'Full-stack Engineer' },
    ],
    time: 0.28,
  },
  { id: 'picaku', kind: 'project', label: 'Picaku', sign: 'PICAKU', eyebrow: 'Picaku', title: '', project: 'picaku', time: 0.31 },
  { id: 'lifeapp', kind: 'project', label: 'Life App', sign: 'LIFE APP', eyebrow: 'Life App', title: '', project: 'lifeapp', time: 0.34 },
  {
    id: 'howrah',
    kind: 'chapter',
    label: 'Howrah Bridge',
    sign: 'HOWRAH BRIDGE',
    eyebrow: 'Howrah Bridge',
    title: 'Then I crossed the river <em>into the city.</em>',
    body: 'Kolkata. Clients with real businesses, launch dates that don’t move, and users who never read the manual. The meter started running — it hasn’t stopped since.',
    stats: [
      { v: '11', k: 'live products on this island' },
      { v: '10', k: 'industries, from pizza to astrology' },
      { v: '3', k: 'platforms: web, Android, iOS' },
    ],
    time: 0.38,
  },
  {
    id: 'gobt',
    kind: 'project',
    label: 'GOBT HQ',
    sign: 'GOBT HQ',
    eyebrow: 'GOBT HQ, Kolkata',
    title: 'Today I keep the lights on — <em>and the deploys green.</em>',
    body: 'DevOps Lead at GOBT, a DPIIT-recognised deep-tech startup in Kolkata, and Full-stack Engineer at Xeta Labs since Feb 2025. I design, build, ship — and stay on call for — everything you’ll pass next. Starting with gobt.in itself.',
    quote: 'Deployment is just the beginning. True reliability is built through discipline, not luck.',
    project: 'gobt',
    time: 0.44,
  },
  { id: 'pizzahap', kind: 'project', label: 'PizzaHap', sign: 'PIZZAHAP', eyebrow: 'PizzaHap', title: '', project: 'pizzahap', time: 0.5 },
  { id: 'gharkamali', kind: 'project', label: 'GharKaMali', sign: 'GHAR KA MALI', eyebrow: 'GharKaMali', title: '', project: 'gharkamali', time: 0.56 },
  { id: 'altaqwa', kind: 'project', label: 'Al-Taqwa', sign: 'AL-TAQWA', eyebrow: 'Al-Taqwa', title: '', project: 'altaqwa', time: 0.62 },
  { id: 'accurateastro', kind: 'project', label: 'Accurate Astro', sign: 'ACCURATE ASTRO', eyebrow: 'Accurate Astro', title: '', project: 'accurateastro', time: 0.68 },
  { id: 'mastermind', kind: 'project', label: 'Mastermind Abacus', sign: 'MASTERMIND', eyebrow: 'Mastermind Abacus', title: '', project: 'mastermind', time: 0.73 },
  { id: 'gftd', kind: 'project', label: 'GFTD', sign: 'GFTD', eyebrow: 'GFTD', title: '', project: 'gftd', time: 0.78 },
  { id: 'agile', kind: 'project', label: 'AGILE', sign: 'AGILE ENGG.', eyebrow: 'AGILE Engineering', title: '', project: 'agile', time: 0.83 },
  { id: 'ideashapers', kind: 'project', label: 'Idea Shapers', sign: 'IDEA SHAPERS', eyebrow: 'Idea Shapers', title: '', project: 'ideashapers', time: 0.88 },
  {
    id: 'fuel',
    kind: 'skills',
    label: 'Fuel station',
    sign: 'FUEL',
    eyebrow: 'Fuel station',
    title: 'What’s in the tank.',
    body: 'The tools I reach for, roughly in order of how often they save the day.',
    time: 0.94,
  },
  {
    id: 'last-stop',
    kind: 'contact',
    label: 'Last stop',
    sign: 'LAST STOP',
    eyebrow: 'Last stop · Yours?',
    title: 'The meter’s still running. <em>Let’s build something.</em>',
    body: 'Have a product to build, a site to rescue or a role to fill? Tell me about it.',
    time: 1,
  },
]

export const SKILLS: { group: string; items: string[] }[] = [
  { group: 'Frontend', items: ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Next.js', 'Tailwind CSS', 'GSAP', 'Three.js'] },
  { group: 'Backend & data', items: ['Node.js', 'Express', 'Python', 'REST APIs', 'Socket.io', 'PostgreSQL', 'MongoDB', 'SQL'] },
  { group: 'Mobile', items: ['Flutter', 'Dart'] },
  { group: 'Ship it', items: ['Git', 'Linux', 'PM2', 'Netlify', 'Vercel', 'SEO', 'GA4'] },
]

export const TESTIMONIALS = [
  {
    name: 'Souvik Ghosh',
    role: 'Software Developer I, Magicworks.ai',
    photo: 'img/people/souvik.webp',
    text: 'I am incredibly grateful to have had the opportunity to work with Akash for the past two years on over 10 projects. Akash has an uncanny ability to tackle complex challenges with innovative solutions, and his contributions were pivotal in our major projects.',
  },
  {
    name: 'Subhodeep Ghosh',
    role: 'AI Engineer, Aorvis',
    photo: 'img/people/subhodeep.webp',
    text: 'Akash is a talented full-stack developer who excels in time management, adaptability, and loyalty, consistently delivering high-quality results. I wholeheartedly endorse him for any project.',
  },
  {
    name: 'Parimal Mandal',
    role: 'CEO, Basudevpur Deaf & Dumb Institution',
    photo: '',
    text: 'Your dedication, skill, and creativity have resulted in a platform that truly represents our institution and its values. The website is not only visually appealing but also user-friendly and accessible, which is crucial for our community.',
  },
]

export const EXPERIENCE = [
  { when: 'Feb 2025 — now', what: 'Full-stack Engineer', where: 'Xeta Labs' },
  { when: 'Now', what: 'DevOps Lead', where: 'GOBT · Group Of Blooming Technicians, Kolkata' },
  { when: 'Jan — Aug 2024', what: 'Frontend Engineer', where: 'Xeta Labs, Assam' },
  { when: 'Jul — Aug 2023', what: 'Engineering Trainee', where: 'AILABS, Kolkata' },
]

export const EDUCATION = [
  { when: '2020 — 2024', what: 'B.Tech, Computer Science & Engineering · CGPA 8.59', where: 'The Neotia University' },
  { when: '2020', what: 'Higher Secondary · 88%', where: 'Egra Jhatulal High School' },
  { when: '2018', what: 'Secondary · 82%', where: 'Egra Jhatulal High School' },
]
