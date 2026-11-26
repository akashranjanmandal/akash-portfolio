import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const screenshots = process.argv[2]
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
let browser
try {
  await server.listen()
  if (screenshots) await mkdir(screenshots, { recursive: true })
  browser = await chromium.launch({ channel: 'chrome', args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] })
  const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, reducedMotion: 'reduce' })
  const errors = []
  const record = message => { errors.push(message); console.error(message) }
  page.on('pageerror', e => record(e.message))
  page.on('console', m => { if (m.type() === 'error') record(m.text()) })
  page.on('response', r => { if (r.status() >= 400) record(r.status() + ' ' + r.url()) })
  page.setDefaultTimeout(120000)
  await page.goto(server.resolvedUrls.local[0] + '?debug&quality=mid')
  await page.waitForFunction(() => document.documentElement.classList.contains('no-gl') || document.querySelector('#start')?.disabled === false)
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('is-ready-to-start')), errors.join('\n') || 'Game failed to boot')
  await page.locator('#start:enabled').click()
  await page.waitForSelector('body.is-ready', { state: 'attached' })
  await page.keyboard.press('KeyM')
  await page.locator('#worldmap [data-id="park-street"]').click()
  assert.equal(await page.evaluate(() => __app.waypoint.id), 'park-street')
  console.log('Portfolio entry, map and metro waypoint passed.')
  const views = [
    ['metro-entry', 293, 0.18, -4, 0, 0.23], ['metro-platform', 293.6, 10.49, -38, -0.19, 0],
    ['sealdah', 135, 0.2, 408, Math.PI, 0.14], ['howrah', -214, 0.2, 18, 1.2, 0.13],
    ['ghat', -225, 0.14, 208, -0.48, 0.04], ['victoria', 1, 0.12, -249, 0, 0.25],
    ['eden', 215, 0.25, 327, 0.74, 0.14], ['flyover', -82, 9.1, -213, -1.65, -0.05],
  ]
  for (const [name, ...v] of views) {
    await page.evaluate(([x, y, z, yaw, pitch]) => {
      const g = __app.game
      g.engine.perfWarm = 1e9
      g.env.setTime('day')
      g.player.view = 'first'
      g.player.teleport(g.player.position.clone().set(x, y, z), yaw)
      g.player.pitch = pitch
    }, v)
    await page.waitForTimeout(500)
    if (screenshots) await page.locator('#gl').screenshot({ path: join(screenshots, name + '.png') })
  }
  for (const mode of ['day', 'night']) {
    await page.evaluate(mode => {
      const g = __app.game
      g.env.setTime(mode)
      g.player.teleport(g.player.position.clone().set(293.6, 10.5, -38), -0.19)
    }, mode)
    await page.waitForTimeout(1200)
    const fps = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now()
      let frames = 0
      function frame(now) {
        frames++
        if (now - start < 2000) requestAnimationFrame(frame)
        else resolve(Math.round(frames * 1000 / (now - start)))
      }
      requestAnimationFrame(frame)
    }))
    console.log('Metro platform, mid quality, ' + mode + ': ' + fps + ' fps')
    if (screenshots && mode === 'night') await page.locator('#gl').screenshot({ path: join(screenshots, 'metro-night.png') })
  }
  const transit = await page.evaluate(async () => {
    const g = __app.game
    g.engine.renderer.setAnimationLoop(null)
    const { METRO } = await import('/src/game/city/Plan.ts')
    const { trains } = g.world.transit
    const { RAPIER } = await import('/src/game/Physics.ts')
    const { inEden } = await import('/src/game/city/Plan.ts')
    const conflicts = []
    for (const [track, train] of [trains[0], trains[1], trains[2], trains[4]].entries()) {
      const line = train.loop
      for (let d = line.closed ? 0 : 5; d < line.length - (line.closed ? 0 : 5); d += 3) {
        const { p, dx, dz } = line.sample(d)
        const angle = Math.atan2(-dz, dx)
        const hit = g.physics.world.intersectionWithShape({ x: p.x, y: p.y + 2.55, z: p.z }, { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }, new RAPIER.Cuboid(1.5, 1.46, 1.6), RAPIER.QueryFilterFlags.ONLY_FIXED)
        if (hit && conflicts.length < 12) conflicts.push([track, p.x.toFixed(1), p.z.toFixed(1), hit.translation()])
      }
    }
    const trafficInStadium = g.world.traffic.drivers.some(driver => driver.path.some(p => inEden(p.x, p.z)))
    const visits = trains.map(() => new Set())
    let badStop = false, closed = false, reopened = false
    for (let n = 0; n < 4000; n++) {
      g.world.transit.update(0.12, 0)
      trains.forEach((t, i) => {
        if (t.wait > 2 && t.served >= 0) {
          visits[i].add(t.served)
          if (t.v > 0.001 || Math.abs(t.s - t.stops[t.served]) > 0.01) badStop = true
        }
      })
      if (g.world.transit.arms[0].angle < 0.02) closed = true
      if (closed && g.world.transit.arms[0].angle > 1.3) reopened = true
    }
    const people = g.world.pedestrians.crowds.flatMap(c => c.people)
    const clearance = [-100, 100, 300].map(z => trains[2].loop.sample(trains[2].loop.nearestS(418, z)).p.y)
    return { conflicts, trafficInStadium, visits: visits.map(s => s.size), badStop, closed, reopened, clearance, people: people.length, outfits: new Set(people.map(p => p.look)).size, stations: METRO.stations.length }
  })
  assert.deepEqual(transit.conflicts, [], 'A fixed object enters the train envelope: ' + JSON.stringify(transit.conflicts))
  assert.equal(transit.trafficInStadium, false)
  assert.deepEqual(transit.visits, [3, 3, 2, 2, 2, 2])
  assert.ok(!transit.badStop && transit.closed && transit.reopened && transit.clearance.every(h => h > 7))
  assert.ok(transit.people > 500 && transit.outfits === 6)
  console.log('All six trains served every scheduled stop. Crossing gates cycled. Population:', transit.people)
  const overlaps = await page.evaluate(() => {
    // solid buildings must never intersect each other (thin walls and towers sharing a base are allowed)
    const w = __app.game.physics.world, boxes = [], hits = []
    w.forEachCollider(c => { const h = c.halfExtents?.(); if (h && c.parent()?.isFixed() && h.y > 1.5 && h.x > 1.5 && h.z > 1.5) boxes.push(c) })
    for (const c of boxes) {
      const t = c.translation(), a = c.halfExtents()
      w.intersectionsWithShape(t, c.rotation(), c.shape, o => {
        if (o.handle <= c.handle || !boxes.includes(o)) return true
        const u = o.translation(), d = o.halfExtents()
        if (Math.abs(t.x - u.x) < 0.5 || Math.abs(t.z - u.z) < 0.5) return true
        if (Math.min(a.x + d.x - Math.abs(t.x - u.x), a.z + d.z - Math.abs(t.z - u.z)) > 0.6) hits.push([t.x, t.z, u.x, u.z].map(n => Math.round(n)))
        return true
      })
    }
    return hits
  })
  assert.deepEqual(overlaps, [], 'Buildings intersect: ' + JSON.stringify(overlaps))
  console.log('No buildings intersect each other.')
  const stairs = await page.evaluate(async () => {
    const g = __app.game, player = g.player
    const { METRO } = await import('/src/game/city/Plan.ts')
    const results = []
    const dt = 1 / 60
    const input = { move: { x: 0, y: 1 }, sprint: false, jump: false }
    for (const station of METRO.stations) for (const side of [-1, 1]) {
      const x = METRO.x + side * 6.65
      player.teleport(player.position.clone().set(x, 0.16, station.z + 42), 0)
      for (let i = 0; i < 730; i++) {
        player.stepPhysics(input, dt)
        g.physics.world.step()
        g.world.transit.update(dt, 0, player.curr)
      }
      const top = player.body.translation()
      player.yaw = Math.PI
      for (let i = 0; i < 730; i++) {
        player.stepPhysics(input, dt)
        g.physics.world.step()
      }
      const bottom = player.body.translation()
      results.push({ station: station.name, side, top: top.y, z: top.z - station.z, bottom: bottom.y })
    }
    return results
  })
  for (const s of stairs) assert.ok(s.top > 11 && s.z < 12 && s.bottom < 1.5, JSON.stringify(s))
  console.log('All six entrances walked up through fare control and back to the street.')
  const drove = await page.evaluate(async () => {
    const g = __app.game, v = g.vehicles[1], dt = 1 / 60
    const { rampUp, rampDown } = await import('/src/game/city/Flyover.ts')
    const route = rampUp().map(p => p.clone())
    // Merge onto the near lane while the auxiliary lane tapers.
    for (const p of route) if (p.x > -60) p.z += (p.x + 60) / 44 * 3.8
    for (let x = -12; x < 208; x += 4) route.push(route[0].clone().set(x, 9.2, -202.7))
    for (const p of rampDown()) {
      if (p.x < 256) p.z += (256 - p.x) / 48 * 3.8
      route.push(p)
    }
    // the render loop is stopped, so traffic stands still: park it out of the way
    for (const d of g.world.traffic.drivers) d.body.setTranslation({ x: 0, y: -200, z: 0 }, true)
    v.teleport(route[0], 0)
    g.player.mount(v)
    const input = { move: { x: 0, y: 0 }, sprint: false, brake: false }
    let idx = 0, elevated = false
    for (let i = 0; i < 10500 && idx < route.length - 1; i++) {
      const p = v.body.translation()
      while (idx < route.length - 1 && Math.hypot(p.x - route[idx].x, p.z - route[idx].z) < 4) idx++
      const goal = route[idx]
      const q = v.body.rotation()
      const f = v.root.position.clone().set(0, 0, -1).applyQuaternion(q)
      const desired = Math.atan2(goal.x - p.x, goal.z - p.z) - Math.atan2(f.x, f.z)
      const error = Math.atan2(Math.sin(desired), Math.cos(desired))
      input.move.x = Math.max(-1, Math.min(1, -error * 2.3))
      input.move.y = Math.abs(v.speed) < 7 ? 0.75 : 0
      v.stepPhysics(input, dt)
      g.physics.world.step()
      v.update(1, dt)
      if (p.x > 0 && p.y > 9 && p.x < 180) elevated = true
    }
    const p = v.body.translation()
    g.player.dismount()
    g.engine.start()
    return { elevated, index: idx, total: route.length, x: p.x, y: p.y, z: p.z }
  })
  assert.ok(drove.elevated && drove.index === drove.total - 1 && drove.y < 2, JSON.stringify(drove))
  console.log('Steered supercar climbed the entry ramp, merged, drove the north ring and took the exit.')
  for (const region of ['hills', 'city']) {
    await page.evaluate(region => __app.game.travel(region), region)
    assert.equal(await page.evaluate(() => __app.game.region), region)
  }
  console.log('City/hills return trip passed.')
  for (const tier of ['low', 'high']) {
    await page.goto(server.resolvedUrls.local[0] + '?debug&quality=' + tier)
    await page.locator('#start:enabled').click()
    await page.waitForSelector('body.is-ready', { state: 'attached' })
    assert.equal(await page.evaluate(() => __app.game.engine.quality.tier), tier)
    await page.evaluate(() => {
      const g = __app.game
      g.env.setTime('day')
      g.player.teleport(g.player.position.clone().set(200, 0.2, 218), Math.PI)
    })
    await page.waitForTimeout(450)
    if (screenshots) await page.locator('#gl').screenshot({ path: join(screenshots, 'eden-' + tier + '.png') })
    console.log('Portfolio and stadium rendered on ' + tier + '.')
  }
  assert.deepEqual(errors, [])
  console.log('No browser errors or failed HTTP responses.')
} finally {
  await browser?.close()
  await server.close()
}
