# Solmere Free Roam

A playable 3D browser sandbox with solo free roam and private online battle-royale rooms built with Next.js, React, TypeScript, and Three.js. Nearly every model is generated in code at runtime; the Wastelands Edge district loads one pre-baked, original procedural glTF diorama from `/public/models`.

## Run

Requires Node.js 20.9+ and a browser with WebGL 2 and hardware acceleration.

```sh
npm install
npm run dev
```

Open http://localhost:3000 and select **Let's drive**.

## Included

- A compressed, wholly fictional coastal world with connected roads and all 18 province destinations. Fast travel through the Map panel.
- Coastline, animated ocean, palms, buildings, backwater scenery, and decorative hills.
- Wastelands Edge: a scorched frontier outpost past Sunhaven, with its own ruin, wrecked 4x4, and operator figure loaded from a pre-baked diorama.
- Five original procedural cars inspired by BMW, Audi, Jeep, Rolls-Royce, and Defender vehicle categories. Garage changes appearance and arcade handling.
- Driving, braking, boost, three camera views, walking, collisions, and nearest-road reset.
- Six selectable fictional weapons with different firing rates, spread, range, magazine sizes, reload times, recoil, and visible shot trails. Scattergun fires multiple pellets; shots originate at the held muzzle and respect cover.
- Improved procedural human proportions, facial features, articulated fingers, clothing seams, shoes, and distance-driven walking/aiming animation.
- Proximity/path-checked car entry, safe stopped-only exits, oriented car collisions, and bounded physics substeps.
- Health, impact damage, death/recovery, per-car fuel consumption, and eighteen petrol stations.
- Earn 10 credits per target hit plus 50 every five hits. Start with 100 credits; petrol costs 2 credits/L, purchased up to 10 L per transaction.
- Responsive map, garage, loadout, pause menu, and touch steering/pedals. Solo simulation pauses while panels are open. Online zones and damage continue while menus are open.
- Procedural Web Audio: engine hum tied to road speed, footsteps, gunfire, reloads, hit markers, collision impacts, and district-aware ambience. No audio files; mute from the pause menu.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Drive or walk; A/D turn |
| Space | Brake in car / jump on foot (solo) |
| Shift | Boost / run |
| E | Exit / return to car |
| F / click scene | Fire toward heading with light aim assistance |
| Drag scene on foot | Turn to aim |
| 1 through 6 | Switch weapon |
| R | Reload |
| C | Change camera |
| Escape | Pause / resume |
| Reset Ride button | Return to nearest clear road |

On touch devices, hold L/R to steer and GO/REV to move. Use the footer to exit or return to the car, FIRE to shoot, and the R button to reload. Open Loadout to switch weapons. Stop before exiting; walk within 3.8 m of the car with a clear path to enter. You cannot walk through the parked car.

Open **Petrol** to find a station or use free tow recovery. Stop near its pumps and select **Refuel**. Tow and Reset Ride do not heal you, refill fuel, or change your wallet. At zero health, **Recover at the road** restores health without changing money or fuel. Fuel is tracked separately for each car during the session.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright covers desktop/mobile launch accessibility, movement, reset, garage/loadout selection, travel, shooting, reload, pause, refueling and wallet deductions. Deterministic engine tests cover car collision and entry, fuel exhaustion, transaction validation, all weapons, rewards, damage and recovery. Tests use software WebGL in Chromium; actual performance depends on the device GPU.

## Scope and Limitations

Solmere is not a real place. It is a small procedural, compressed playground with fictional province labels, not surveyed boundaries, real road data, or recreated landmarks. Province placements and scenery are illustrative. Mountains are decorative, not drivable terrain.

Cars are original low-poly interpretations, not branded assets or licensed replicas. No affiliation with the referenced manufacturers is implied. Weapons are fictional gameplay abstractions, not realistic simulations.

No traffic, pedestrians, police, completed missions, multiplayer, sound, or persistence are included. Homes, aircraft, boats and mission definitions have partial scaffolding but are not playable systems yet. Refreshing starts a new session. Damage currently comes from vehicle impacts, not enemies. Physics and targeting remain simplified game systems; the camera can pass through scenery. The character is procedural, not a photorealistic scanned/rigged asset. A production statewide game would require geographic data, world streaming, authored assets, audio, a larger gameplay system, optimization, and licensing review.

## Layout

```text
src/app/                 App Router page, layout, global visual style
src/components/game/     Responsive game interface
src/game/config.ts       Vehicles, weapons, district destinations, engine contract
src/game/engine.ts       Rendering, world generation, and simulation
tests/                   Browser smoke tests
```

See CLAUDE.md for lightweight development rules and module ownership.


## Blender realism pass

The editable source `public/models/coastal-assets.blend` and generator `scripts/build-assets.py` create a sculpted head, fitted clothing, articulated limb surfaces, fabric/skin textures, treaded wheels, broad palm fronds, shutters, rocks, and shrubs. These replace parts of the runtime models. The garage renders the actual five vehicles instead of using illustrations. Copper Bay, Cedar Reach, and Lastlight extend the southern roads and destinations.

Driving uses braking before reversing, speed-dependent steering, a lateral grip limit, and visual suspension pitch/roll. Walking uses leg inverse kinematics and solo jumping uses gravity. The simulation remains lightweight and procedural, not a full rigid-body engine or fully photorealistic environment.

## Coastline Royale

Open **Online**, enter a player name, and create or join an eight-character invite room. Two to eight players can join; the host starts a four-minute, on-foot round. The blue safe zone shrinks after a 30-second grace period. Leaving the zone damages health. Last survivor wins. Disconnected players are eliminated after 15 seconds.

Start with a sidearm. Crates provide additional weapons, reserve ammunition, armor, and medkits. Move within three metres and select **Collect**. Weapons must be looted before use. Reloading consumes reserves. Armor absorbs part of incoming damage. A medkit takes three seconds, heals 45 health, and is interrupted by firing or taking bullet damage. The backpack holds three medkits. Refreshing loses the session. Menus do not stop an online match.

Mobile Play requests fullscreen and landscape when supported. A portrait rotation prompt provides a fallback where orientation locking is unavailable. Touch buttons support held fire, reload, movement, and solo jumping.

## Hosting online rooms

Run a **single persistent Node server** using `npm run build -- --webpack` followed by `npm run start -- --hostname 0.0.0.0`, behind an HTTPS reverse proxy. Both players must use the same hosted address. `Dockerfile` provides a deployable container (`docker build -t solmere .`, then `docker run -p 3000:3000 solmere`). The container definition is provided but has not been built in this workspace.

Room state is in memory and disappears on restart. Do not deploy this room implementation to stateless serverless functions or multiple replicas without adding shared state. Server checks cover room authorization, movement distance, fire rate, ammunition, loot, health, zone damage and winners. It still trusts client-supplied aim/cover distance and does not provide production anti-cheat, lag compensation, accounts, matchmaking, voice chat, or persistent rankings. It is a private-room prototype, not a PUBG/Call of Duty-scale service. No public server has been deployed by this change.
