# Blender game assets

`build-assets.py` creates original geometry and embedded fabric textures using Blender 5.2.1. No third-party models or textures are used in this asset library.

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-assets.py
```

Outputs: `public/models/coastal-assets.blend` (editable source) and `public/models/coastal-assets.glb` (runtime asset library). Named parts attach to the existing character joints and wheel pivots. Keep the root object names intact when editing in Blender. Assets use meters; glTF export converts Blender Z-up to the game's Y-up coordinates.

Includes tailored shirt, canvas legs, treaded alloy wheels, three rocks, and coastal shrubs. The game retains built-in meshes if loading fails. Static parts are joined to reduce draw calls. Walking uses two-bone leg IK; car handling uses a grip-limited bicycle model with visual load transfer. These are lightweight approximations, not full rigid-body or soft-body simulation. The scene remains procedural and is not fully photorealistic.
