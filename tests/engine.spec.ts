import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import ts from "typescript";
import type { Object3D } from "three";
import { FUEL_PRICE, FUEL_STATIONS, HOMES, VEHICLES, WEAPONS, type GameController, type GameStats } from "../src/game/config";

declare global {
  interface Window {
    engine: {
      controller: GameController;
      stats: GameStats;
      car: Object3D;
      avatar: Object3D;
      advance: (seconds: number, frameMs?: number) => void;
    };
  }
}

// Only this intercepted page gets a controller/scene handle. Production modules are
// transpiled without instrumentation; no app debug API or general file server is needed.
const fixturePage = `<!doctype html><html><head>
  <link rel="icon" href="data:,">
  <script type="importmap">{"imports":{
    "three":"/three-fixture.js",
    "three/addons/geometries/RoundedBoxGeometry.js":"/RoundedBoxGeometry.js",
    "three/addons/environments/RoomEnvironment.js":"/RoomEnvironment.js"
  }}</script></head><body>
  <div id="game" style="position:relative;width:320px;height:200px"></div>
  <script type="module" src="/fixture.js"></script>
</body></html>`;

const rendererFixture = `
  export * from '/three.module.js';
  import { WebGLRenderer as RealRenderer } from '/three.module.js';
  export let renderer, scene;
  export class WebGLRenderer extends RealRenderer {
    constructor(options) {
      super(options);
      renderer = this;
      const render = this.render.bind(this);
      this.render = (world, camera) => {
        if (world.isScene && world.fog) scene = world;
        return render(world, camera);
      };
    }
  }
`;

const browserFixture = `
  import { createGame } from '/engine';
  import { renderer, scene } from '/three-fixture.js';
  let now = 0, nextId = 0, ready = false, stats;
  const frames = new Map();
  Object.defineProperty(performance, 'now', { value: () => now });
  window.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  // Repeatable spread, not zero spread: raycasting and pellet simulation remain real.
  let seed = 41723;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const controller = createGame(document.getElementById('game'), value => { stats = value; }, () => { ready = true; });
  function advance(seconds, frameMs = 25) {
    const count = Math.ceil(seconds * 1000 / frameMs);
    for (let i = 0; i < count; i++) {
      now += seconds * 1000 / count;
      const pending = [...frames.values()];
      frames.clear();
      if (pending.length !== 1) throw new Error('Expected one engine RAF callback');
      for (const callback of pending) callback(now);
    }
    // Camera is a non-simulation command that publishes a fresh stats snapshot.
    controller.command({ type: 'camera' });
  }
  advance(0.1);
  if (!ready || !scene || !renderer.getContext().getParameter(renderer.getContext().VERSION)) {
    throw new Error('Engine did not render its first real WebGL frame');
  }
  // WebGLRenderer defines render on the instance, not its prototype. Keep real
  // initialization/first render, then omit GPU draws during deterministic ticks.
  renderer.render = () => {};
  const car = scene.children.find(o => o.type === 'Group' && o.children.some(c => c.type === 'Group' && c.children.length > 50));
  const avatar = scene.children.find(o => o.type === 'Group' && o.children.length === 3);
  if (!car || !avatar) throw new Error('Could not identify engine actors for scenario placement');
  window.engine = { controller, get stats() { return stats; }, advance, car, avatar };
`;

const test = base.extend<{ enginePage: void }>({
  enginePage: [async ({ page }, runTest) => {
    const root = path.resolve(__dirname, "..");
    const files = new Map([
      ["/engine", "src/game/engine.ts"],
      ["/config", "src/game/config.ts"],
      ["/three.module.js", "node_modules/three/build/three.module.js"],
      ["/three.core.js", "node_modules/three/build/three.core.js"],
      ["/RoundedBoxGeometry.js", "node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js"],
      ["/RoomEnvironment.js", "node_modules/three/examples/jsm/environments/RoomEnvironment.js"],
    ]);
    const scripts = new Map([["/fixture.js", browserFixture], ["/three-fixture.js", rendererFixture]]);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://engine.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/") {
        await route.fulfill({ contentType: "text/html", body: fixturePage });
        return;
      }
      let body = scripts.get(pathname);
      const file = files.get(pathname);
      if (file) {
        body = await readFile(path.join(root, file), "utf8");
        if (file.endsWith(".ts")) body = ts.transpileModule(body, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
      }
      if (body === undefined) {
        errors.push(`Unexpected fixture request: ${pathname}`);
        await route.abort();
        return;
      }
      await route.fulfill({ contentType: "text/javascript", body });
    });
    await page.goto("http://engine.test/");
    await page.waitForFunction(() => Boolean(window.engine));
    try {
      await runTest();
    } finally {
      await page.evaluate(() => window.engine.controller.dispose());
      expect(errors, "browser errors and unapproved fixture requests").toEqual([]);
    }
  }, { auto: true }],
});

test("parked car collision, clear-path entry and stopped-only exit", async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = window.engine;
    const command = e.controller.command;
    command({ type: "toggle-drive" });
    const exit = { ...e.stats };
    command({ type: "input", key: "a", pressed: true });
    e.advance(Math.PI / 2 / 2.3);
    command({ type: "input", key: "a", pressed: false });
    command({ type: "input", key: "w", pressed: true });
    e.advance(2);
    command({ type: "input", key: "w", pressed: false });
    e.advance(0.5);
    const blocked = { ...e.stats };
    // Arrange adversarial geometry using scene actors only, never physics/economy state.
    e.avatar.position.set(30, 0, 0);
    command({ type: "toggle-drive" });
    const remote = { ...e.stats };
    command({ type: "reset" });
    command({ type: "toggle-drive" });
    const entered = { ...e.stats };
    command({ type: "input", key: "w", pressed: true });
    e.advance(1);
    command({ type: "toggle-drive" });
    const moving = { ...e.stats };
    command({ type: "reset" });
    command({ type: "toggle-drive" });
    command({ type: "travel", index: 7 });
    e.car.position.set(0, 0, 0);
    e.car.rotation.y = Math.PI / 2;
    e.avatar.position.set(0, 0, 3);
    command({ type: "input", key: "w", pressed: true });
    e.advance(2);
    command({ type: "input", key: "w", pressed: false });
    e.advance(0.5);
    return { exit, blocked, remote, entered, moving, rotated: e.stats };
  });
  expect(result.exit).toMatchObject({ driving: false, canEnterCar: true, health: 100 });
  expect(result.blocked.x).toBeGreaterThan(1.3);
  expect(result.blocked.x).toBeLessThan(result.exit.x);
  expect(result.blocked.speed).toBe(0);
  expect(result.remote).toMatchObject({ driving: false, canEnterCar: false, x: 30 });
  expect(result.entered.driving).toBe(true);
  expect(result.moving.driving).toBe(true);
  expect(result.moving.speed).toBeGreaterThan(7.2);
  expect(result.moving.message).toContain("Slow below 2 m/s");
  expect(result.rotated.z).toBeGreaterThan(1.3);
  expect(result.rotated.z).toBeLessThan(2);
  expect(result.rotated.speed).toBe(0);

  const walls = await page.evaluate(home => {
    const e = window.engine;
    e.car.position.set(home.x + 7.5, 0, home.z);
    e.car.rotation.y = 0;
    e.avatar.position.set(home.x + 5.5, 0, home.z);
    e.controller.command({ type: "toggle-drive" });
    const entry = { ...e.stats };
    e.controller.command({ type: "reset" });
    e.controller.command({ type: "toggle-drive" });
    e.car.position.set(home.x, 0, home.z);
    e.controller.command({ type: "toggle-drive" });
    return { entry, exit: e.stats };
  }, HOMES[7]);
  expect(walls.entry).toMatchObject({ driving: false, canEnterCar: false });
  expect(walls.exit.driving).toBe(true);
  expect(walls.exit.message).toContain("Both doors are blocked");
});

test("distance-based per-car fuel, station restrictions, tank and affordability caps", async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = window.engine;
    const command = e.controller.command;
    e.advance(10);
    const idle = { ...e.stats };
    command({ type: "refuel" });
    const remote = { ...e.stats };
    command({ type: "input", key: "w", pressed: true });
    e.advance(2);
    const driven = { ...e.stats };
    command({ type: "reset" });
    command({ type: "station-travel", index: 7 });
    const towed = { ...e.stats };
    command({ type: "refuel" });
    const bought = { ...e.stats };
    command({ type: "input", key: "w", pressed: true });
    e.advance(0.25);
    const movingBefore = { ...e.stats };
    command({ type: "refuel" });
    const movingAfter = { ...e.stats };
    command({ type: "station-travel", index: 7 });
    command({ type: "toggle-drive" });
    const onFoot = { ...e.stats };
    e.avatar.position.x += 20;
    command({ type: "refuel" });
    const farFoot = { ...e.stats };
    command({ type: "vehicle", index: 1 });
    const otherCar = { ...e.stats };
    command({ type: "vehicle", index: 0 });
    const originalCar = { ...e.stats };
    command({ type: "station-travel", index: 7 });
    for (let i = 0; i < 10; i++) command({ type: "refuel" });
    const full = { ...e.stats };
    command({ type: "vehicle", index: 1 });
    for (let i = 0; i < 10; i++) command({ type: "refuel" });
    const affordable = { ...e.stats };
    command({ type: "refuel" });
    return { idle, remote, driven, towed, bought, movingBefore, movingAfter, onFoot, farFoot, otherCar, originalCar, full, affordable, broke: e.stats };
  });
  expect(result.idle).toMatchObject({ fuel: 65, credits: 100, speed: 0 });
  expect(result.remote).toMatchObject({ fuel: 65, credits: 100, nearbyStation: null });
  expect(result.driven.z).toBeLessThan(-20);
  expect(result.driven.fuel).toBeCloseTo(65 - Math.abs(result.driven.z) * 0.015, 8);
  expect(result.towed).toMatchObject({ nearbyStation: 7, fuel: result.driven.fuel, credits: 100 });
  expect(result.bought.fuel).toBeCloseTo(result.driven.fuel + 10, 8);
  expect(result.bought.credits).toBe(100 - 10 * FUEL_PRICE);
  expect(result.movingBefore.nearbyStation).toBe(7);
  expect(result.movingAfter).toMatchObject({ fuel: result.movingBefore.fuel, credits: result.bought.credits });
  expect(result.movingAfter.message).toContain("Stop before refuelling");
  expect(result.onFoot.nearbyStation).toBe(7);
  expect(result.farFoot).toMatchObject({ nearbyStation: null, fuel: result.onFoot.fuel, credits: result.onFoot.credits });
  expect(result.otherCar.fuel).toBe(65);
  expect(result.originalCar.fuel).toBe(result.onFoot.fuel);
  expect(result.full.fuel).toBe(100);
  expect(result.full.credits).toBeCloseTo(result.onFoot.credits - (100 - result.onFoot.fuel) * FUEL_PRICE, 8);
  expect(result.full.message).toContain("tank is full");
  expect(result.affordable.credits).toBe(0);
  expect(result.affordable.fuel).toBeCloseTo(65 + result.full.credits / FUEL_PRICE, 8);
  expect(result.broke).toMatchObject({ fuel: result.affordable.fuel, credits: 0 });
  expect(result.broke.message).toContain("Not enough credits");

  const stations = await page.evaluate(({ cars, stations }) => {
    const e = window.engine;
    const results = [];
    for (let index = 0; index < cars; index++) {
      e.controller.command({ type: "reset" });
      e.controller.command({ type: "vehicle", index });
      for (let station = 0; station < stations; station++) {
        e.controller.command({ type: "station-travel", index: station });
        results.push({ car: index, station, nearby: e.stats.nearbyStation, enter: e.stats.canEnterCar });
      }
    }
    return results;
  }, { cars: VEHICLES.length, stations: FUEL_STATIONS.length });
  for (const station of stations) {
    expect(station, `car ${station.car} fits station ${station.station} with a clear door path`).toMatchObject({ nearby: station.station, enter: true });
  }
});

test("guns enforce cooldown, reload/pause, automatic fire, occlusion and target rewards", async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = window.engine;
    const command = e.controller.command;
    command({ type: "fire" });
    const drivingAmmo = e.stats.ammo;
    command({ type: "toggle-drive" });
    e.avatar.position.set(9, 0, -20);
    command({ type: "input", key: "f", pressed: true });
    e.advance(1);
    command({ type: "input", key: "f", pressed: false });
    const heldSemi = { ...e.stats };
    for (let i = 0; i < 4; i++) { e.advance(1.8); command({ type: "fire" }); }
    const rewarded = { ...e.stats };
    command({ type: "fire" });
    const cooldownAmmo = e.stats.ammo;
    command({ type: "reload" });
    e.advance(0.5);
    const reloading = { ...e.stats };
    command({ type: "fire" });
    command({ type: "pause", value: true });
    e.advance(3, 250);
    command({ type: "fire" });
    const paused = { ...e.stats };
    command({ type: "pause", value: false });
    e.advance(0.75, 250);
    const reloaded = { ...e.stats };
    command({ type: "weapon", index: 3 });
    command({ type: "input", key: "f", pressed: true });
    e.advance(0.5);
    command({ type: "input", key: "f", pressed: false });
    const automatic = { ...e.stats };
    return { drivingAmmo, heldSemi, rewarded, cooldownAmmo, reloading, paused, reloaded, automatic };
  });
  expect(result.drivingAmmo).toBe(12);
  expect(result.heldSemi).toMatchObject({ ammo: 11, hits: 1, credits: 110 });
  expect(result.rewarded).toMatchObject({ ammo: 7, hits: 5, credits: 200 });
  expect(result.rewarded.message).toContain("Five-hit bonus");
  expect(result.cooldownAmmo).toBe(7);
  expect(result.reloading).toMatchObject({ reloading: true, ammo: 7 });
  expect(result.paused).toMatchObject({ reloading: true, ammo: 7, hits: 5, credits: 200 });
  expect(result.reloaded).toMatchObject({ reloading: false, ammo: 12 });
  expect(result.automatic.ammo).toBeLessThan(30);

  for (const [index, weapon] of WEAPONS.entries()) {
    const fired = await page.evaluate(index => {
      const e = window.engine;
      e.controller.command({ type: "weapon", index });
      e.controller.command({ type: "reload" });
      e.advance(2.5);
      e.controller.command({ type: "fire" });
      const shot = { ...e.stats };
      e.controller.command({ type: "reload" });
      e.advance(2.5, 250);
      return { shot, loaded: e.stats };
    }, index);
    expect(fired.shot, weapon.name).toMatchObject({ weaponIndex: index, ammo: weapon.capacity - 1 });
    expect(fired.loaded, weapon.name).toMatchObject({ ammo: weapon.capacity, reloading: false });
  }

  const cover = await page.evaluate(home => {
    const e = window.engine;
    e.controller.command({ type: "weapon", index: 4 });
    e.car.position.set(9, 0, -30);
    e.avatar.position.set(9, 0, -20);
    e.avatar.rotation.y = 0;
    const before = { ...e.stats };
    e.controller.command({ type: "fire" });
    const occluded = { ...e.stats };
    e.advance(1);
    e.avatar.position.set(home.x, 0, home.z + 7.31);
    e.avatar.rotation.y = 0;
    e.controller.command({ type: "fire" });
    return { before, occluded, wall: e.stats };
  }, HOMES[7]);
  expect(cover.occluded).toMatchObject({ hits: cover.before.hits, credits: cover.before.credits, ammo: cover.before.ammo - 1 });
  expect(cover.wall.ammo).toBe(cover.occluded.ammo);
  expect(cover.wall.message).toContain("Barrel obstructed");
});

test("collision damage, death lockout, respawn and empty-tank propulsion", async ({ page }) => {
  const damage = await page.evaluate(() => {
    const e = window.engine;
    // A short run into the north world boundary causes nonlethal damage.
    e.car.position.set(0, 0, -970);
    e.controller.command({ type: "input", key: "w", pressed: true });
    e.advance(2, 250);
    e.controller.command({ type: "input", key: "w", pressed: false });
    const collided = { ...e.stats };
    e.controller.command({ type: "reset" });
    return { collided, reset: e.stats };
  });
  expect(damage.collided.health).toBeGreaterThan(0);
  expect(damage.collided.health).toBeLessThan(100);
  expect(damage.collided.z).toBeGreaterThan(-983);
  expect(damage.collided.speed).toBe(0);
  expect(damage.reset).toMatchObject({ health: damage.collided.health, fuel: damage.collided.fuel, credits: damage.collided.credits });

  const death = await page.evaluate(() => {
    const e = window.engine;
    for (let i = 0; i < 3 && e.stats.health > 0; i++) {
      e.controller.command({ type: "travel", index: 7 });
      e.car.position.set(0, 0, -750);
      e.controller.command({ type: "input", key: "w", pressed: true });
      e.controller.command({ type: "input", key: "shift", pressed: true });
      e.advance(10, 250);
    }
    const dead = { ...e.stats };
    e.controller.command({ type: "input", key: "w", pressed: true });
    e.controller.command({ type: "reset" });
    e.controller.command({ type: "station-travel", index: 7 });
    e.controller.command({ type: "toggle-drive" });
    e.controller.command({ type: "fire" });
    e.advance(2);
    const locked = { ...e.stats };
    e.controller.command({ type: "respawn" });
    e.advance(1);
    return { dead, locked, respawned: e.stats };
  });
  expect(death.dead).toMatchObject({ health: 0, speed: 0 });
  expect(death.dead.z).toBeGreaterThan(-983);
  expect(death.dead.fuel).toBeLessThan(damage.reset.fuel);
  expect(death.locked).toMatchObject({ health: 0, speed: 0, x: death.dead.x, z: death.dead.z, fuel: death.dead.fuel, credits: death.dead.credits, ammo: death.dead.ammo, driving: true });
  expect(death.respawned).toMatchObject({ health: 100, speed: 0, fuel: death.dead.fuel, credits: death.dead.credits });

  const empty = await page.evaluate(() => {
    const e = window.engine;
    // Repeated straight road runs consume real fuel, without changing its state.
    // Bounded repetitions fail rather than hanging if fuel consumption regresses.
    for (let i = 0; i < 12 && e.stats.fuel > 0; i++) {
      e.controller.command({ type: "travel", index: 7 });
      e.car.position.set(0, 0, 650);
      e.controller.command({ type: "input", key: "w", pressed: true });
      e.advance(20, 250);
      e.controller.command({ type: "input", key: "w", pressed: false });
    }
    e.controller.command({ type: "reset" });
    const drained = { ...e.stats };
    const attempts = [];
    for (const key of ["w", "s"]) {
      e.controller.command({ type: "input", key, pressed: true });
      e.advance(2);
      e.controller.command({ type: "input", key, pressed: false });
      attempts.push({ ...e.stats });
    }
    e.controller.command({ type: "station-travel", index: 7 });
    const towed = { ...e.stats };
    e.controller.command({ type: "refuel" });
    e.controller.command({ type: "input", key: "w", pressed: true });
    e.advance(0.5);
    return { drained, attempts, towed, restarted: e.stats };
  });
  expect(empty.drained).toMatchObject({ health: 100, fuel: 0, speed: 0 });
  for (const attempt of empty.attempts) {
    expect(attempt).toMatchObject({ fuel: 0, speed: 0, x: empty.drained.x, z: empty.drained.z });
  }
  expect(empty.towed).toMatchObject({ fuel: 0, credits: empty.drained.credits, nearbyStation: 7 });
  expect(empty.restarted.credits).toBe(empty.drained.credits - 10 * FUEL_PRICE);
  expect(empty.restarted.fuel).toBeGreaterThan(0);
  expect(empty.restarted.fuel).toBeLessThan(10);
  expect(empty.restarted.speed).toBeGreaterThan(0);
});
