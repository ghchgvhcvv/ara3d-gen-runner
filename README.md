# 3D Gen — parametric game-character generator

Generate stylised human characters from sliders and presets, then export them as
**GLB, FBX, OBJ or a ZIP bundle**. Everything runs in the browser, and the same
generator also runs headless from Node.

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm run export -- --preset Hero --out out          # headless export
npm run export -- --random 42 --formats glb,fbx
npm run export -- --params out/Hero/Hero.params.json --detail high
npm test             # fuzz-tests 159 characters + validates every export format
```

## Features

- **Body:** height, masculinity, muscle, body fat, head scale (realistic → chibi), shoulder/hip width, limb, neck, hand and foot size
- **Face:** head/jaw width, eye size/spacing, nose, round or pointed ears
- **Hair:** bald, buzz, short, spiky, long, ponytail, bun, mohawk, afro. **Facial hair:** mustache, goatee, beard
- **Outfit:** t-shirt / tank / long sleeve / none, pants / shorts / skirt, sneakers / boots, cap / beanie / helmet, belt, gloves, plus colors for everything
- **Output:** low / medium / high detail (~3.8k–20k tris), T- or A-pose, flat (low-poly) shading, fingers or mittens
- 7 presets, plus seeded randomization (the same seed gives the same character)

## Export formats

| Format | Units | Notes |
| --- | --- | --- |
| `.glb` | metres | glTF 2.0 binary, PBR materials (one primitive per material) |
| `.fbx` | centimetres | Binary FBX 7.4, per-polygon materials. Imports into Unity, Unreal and Blender |
| `.obj` + `.mtl` | metres | Includes PBR `Pr`/`Pm` extensions |
| `.zip` | — | All of the above plus `params.json` (to regenerate), `preview.png` and a README |

All formats use +Y up, with the character facing +Z and the feet at y = 0.
`scripts/blender_check.py` imports exported files into Blender as an end-to-end check.

## Architecture

```
src/core/      pure TypeScript, no three.js. Runs in browser and Node
  params.ts      parameter schema, presets, seeded randomizer
  skeleton.ts    proportions + Mixamo-named humanoid skeleton (25 joints)
  loft.ts        superellipse cross-sections swept along paths: the core primitive
  patch.ts       shells laid over a surface (hair, beards, hats)
  character.ts   body, head, face, limbs, clothing layers
  hair.ts        hair styles, facial hair, hats
  mesh.ts        MeshBuilder -> MeshData (format-neutral, multi-material)
src/export/    glb.ts, fbx.ts (binary writer), obj.ts, index.ts (zip bundling)
src/app/       three.js viewer + parameter panel
```

Clothing comes from material *layers* along each loft (`resolveLayers`). A sleeve,
for example, is just a slightly inflated span of the arm, with an automatic hem step.

## Roadmap: rigging and animation

The rig is already built into the design:

- every body part is placed from `Skeleton` joints (Mixamo naming: `Hips`, `Spine`, `LeftArm`, …)
- every vertex already stores its primary bone (`MeshData.bones`)

Next steps:
1. Smooth skin weights: blend the per-vertex bone with its neighbour near each joint
2. Export the skin: glTF `skins` + `JOINTS_0/WEIGHTS_0`, and FBX `LimbNode` + `Skin`/`Cluster` deformers + bind `Pose`
3. Procedural animation clips (idle, walk, run, jump) as glTF `animations` and FBX `AnimationStack`s
4. Viewer playback with a three.js `SkinnedMesh` + `AnimationMixer`
