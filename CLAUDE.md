@AGENTS.md

# Kerala Free Roam

Browser driving and action sandbox for players exploring a Kerala-inspired world.
Stack: Next.js App Router, React, TypeScript, Three.js, npm. See package.json for versions.
This is a lightweight prototype, not a geographically accurate statewide simulation.

## Coding Rules

- Server Components by default; client boundaries for the game and interactive UI.
- Keep per-frame simulation state in the engine, not React state.
- Dispose GPU resources and remove event listeners on unmount.
- Use original procedural assets. Do not imply car-brand licensing or affiliation.
- React Query is for remote server state, Zustand for shared client UI state if needed.
- Use Zod and react-hook-form if adding forms. No backend is currently required.

## Module Ownership

| Module | Files |
| --- | --- |
| M0: foundation | src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, src/game/config.ts, root config and docs |
| M1: simulation | src/game/engine.ts |
| M2: interface | src/components/game/** |
| M3: verification | tests/**, playwright.config.ts |
