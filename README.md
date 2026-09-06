# Kerala Free Roam

A playable, single-player 3D browser sandbox built with Next.js, React, TypeScript, and Three.js. All models are generated in code; no external asset or map downloads are required at runtime.

## Run

Requires Node.js 20.9+ and a browser with WebGL 2 and hardware acceleration.

```sh
npm install
npm run dev
```

Open http://localhost:3000 and select **Let's drive**.

## Included

- A compressed Kerala-inspired world with connected roads and all 14 district destinations. Fast travel through the Map panel.
- Coastline, animated ocean, palms, buildings, backwater scenery, and decorative hills.
- Five original procedural cars inspired by BMW, Audi, Jeep, Rolls-Royce, and Defender vehicle categories. Garage changes appearance and arcade handling.
- Driving, braking, boost, three camera views, walking, collisions, and nearest-road reset.
- Three fictional weapons, limited magazines, reloads, visible shot trails, and non-graphic target scoring.
- Responsive map, garage, loadout, pause menu, and touch steering/pedals. Simulation pauses while panels are open.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Drive or walk; A/D turn |
| Space | Brake |
| Shift | Boost / run |
| E | Exit / return to car |
| F / click scene | Fire toward heading with light aim assistance |
| Drag scene on foot | Turn to aim |
| 1 / 2 / 3 | Switch weapon |
| R | Reload |
| C | Change camera |
| Escape | Pause / resume |
| Reset Ride button | Return to nearest clear road |

On touch devices, hold L/R to steer and GO/REV to move. Use the footer to exit or return to the car, FIRE to shoot, and the R button to reload. Open Loadout to switch weapons. Return to car is intentionally allowed from anywhere for this prototype.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright covers desktop and mobile layouts, starting, movement, reset, garage selection, district travel, walking, shooting, reload, and pause. Tests use software WebGL in Chromium; actual performance depends on the device GPU.

## Scope and Limitations

This is not the full real-world Kerala map. It is a small procedural, compressed playground with district labels, not surveyed boundaries, real road data, or recreated landmarks. District placements and scenery are illustrative. Mountains are decorative, not drivable terrain.

Cars are original low-poly interpretations, not branded assets or licensed replicas. No affiliation with the referenced manufacturers is implied. Weapons are fictional gameplay abstractions, not realistic simulations.

No traffic, pedestrians, police, GTA missions, multiplayer, sound, interiors, damage system, or persistence are included. Refreshing starts a new session. Physics and targeting are arcade-style; the camera can pass through scenery. A production statewide game would require geographic data, world streaming, authored assets, audio, a larger gameplay system, optimization, and licensing review.

## Layout

```text
src/app/                 App Router page, layout, global visual style
src/components/game/     Responsive game interface
src/game/config.ts       Vehicles, weapons, district destinations, engine contract
src/game/engine.ts       Rendering, world generation, and simulation
tests/                   Browser smoke tests
```

See CLAUDE.md for lightweight development rules and module ownership.
