# Contributing to 3D Gen

Thanks for helping! Bug reports, garments, hairstyles, animations, presets and
engine-integration notes are all welcome.

## Getting set up

```bash
git clone <your fork>
cd 3d-gen
npm install
npm run setup-assets   # one-time: CC0 MakeHuman data -> public/assets
npm run dev            # http://localhost:5173
```

Requirements: Node 20+ and git, on Windows, macOS or Linux. `npm run test:gltf` needs Chrome, Chromium or Edge (set `CHROME=/path/to/browser` if it isn't found). Blender is optional; it's only used by the `scripts/blender_*.py` render checks.

## Before you open a pull request

```bash
npm run typecheck
npm test            # builds ~240 characters and validates GLB, FBX, OBJ and every export mode
npm run test:gltf   # loads exported GLBs with three.js in headless Chrome (rig/animation changes)
```

For visual changes (garments, hair, tattoos, animation), please attach a screenshot or a short clip.

## Where things live

| Area | Files |
| --- | --- |
| Parameters, presets, randomizer | `src/core/params.ts` |
| Character assembly | `src/core/human.ts` |
| Procedural clothing | `src/core/garments/catalog.ts` (one entry per garment) |
| Hair, beards, tattoos, earrings | `src/core/looks/` |
| Weapons | `src/core/props/weapons.ts`, socket in `src/core/rig/socket.ts` |
| Skeletons and skinning | `src/core/rig/` |
| Animation clips / evaluator | `src/core/anim/clips.ts`, `src/core/anim/evaluate.ts` |
| Exporters | `src/export/` (`plan.ts` decides the files, `glb.ts`, `fbx.ts`, `obj.ts` write them) |
| Web app | `src/app/` (UI in `main.ts`, three.js viewer, generation worker) |

### Adding a garment

Add an entry to `GARMENTS` in `src/core/garments/catalog.ts`: an id, label, slot (`top`,
`bottom` or `acc`), the patterns it supports, default colours, and a `build` function.
Most garments are a body "shell" (a coverage predicate over body regions plus an offset),
optionally with extra parts (straps, badges, pockets) placed with the ring helpers. The
selftest automatically builds every garment on two bodies.

### Adding an animation

Add a `Clip` to `src/core/anim/clips.ts`. Channels are per bone, in degrees, in the bone's
own frame (X = flex forward, Y = twist, Z = side), and `side()` mirrors left/right. Hands
can be placed with IK targets in chest space. The same evaluator drives the viewer and
both exporters, so a clip works on every skeleton and bind pose automatically.

## Guidelines

- Keep everything procedural or CC0: no assets with restrictive licences.
- Cultural dress and uniforms: please cite your sources for colours and details.
- Adult-only options (topless, bottomless, tattoos) must stay restricted to characters aged 18+.
- Match the surrounding code style. Comments explain *why*, not *what*.

By contributing you agree that your contributions are licensed under the MIT licence.
