# 3D Gen: realistic game-character generator

Generate realistic, textured humans with sliders, presets and asset pickers, then
export them as **GLB, FBX, OBJ or a ZIP bundle**. Everything runs in the browser,
and the same generator also runs headless from Node.

```bash
npm install
npm run setup-assets   # one-time: downloads CC0 MakeHuman data (~420 MB) and builds public/assets (~85 MB)
npm run dev            # web app at http://localhost:5173  (add #face for a face close-up)
npm run export -- --preset "Athletic woman" --detail high --out out
npm run export -- --random 42 --formats glb,fbx
npm test               # builds 77 characters and validates every export format
```

## How it works

Realism comes from data, not hand-built shapes. The generator uses the MakeHuman
anatomy dataset, which is CC0 (public domain) since 2020:

- **Base mesh:** an artist-made, animation-ready human (13,378 quads).
- **Morph targets:** 935 targets. Macro controls (gender, age, muscle, weight, height,
  proportions, ethnicity, breast) blend across a lattice of targets, exactly like MakeHuman.
  219 detail sliders (head shape, nose, mouth, eyes, ears, chin, cheeks, torso, limbs…)
  add targets on top. Left/right pairs are merged into one symmetric slider.
- **Proxies:** eyes, eyebrows, eyelashes, 10 hairstyles, 12 outfits, 6 shoes and 2 hats.
  Each vertex is fitted to a triangle of body vertices (`.mhclo`), so clothing follows any
  body shape. Skin under clothing is removed to prevent poke-through.
- **Textures:** 20 photo-based skins (young / middle-aged / old × African / Asian / Caucasian ×
  male / female, picked automatically), plus diffuse and normal maps for clothes, alpha
  textures for hair and lashes, and 9 eye colours.

## Detail levels

| Level | Body | Typical triangles |
| --- | --- | --- |
| Low | MakeHuman game proxy (~1.6k quads) | ~5–10k |
| Medium | Full base mesh | ~30–40k |
| High (HD) | Catmull-Clark subdivided body + clothing | ~100–120k |

## Export formats

| Format | Units | Notes |
| --- | --- | --- |
| `.glb` | metres | glTF 2.0, PBR materials, textures embedded, alpha mask for hair and lashes |
| `.fbx` | centimetres | Binary FBX 7.4, quad topology, textures embedded (Unity, Unreal, Blender) |
| OBJ (`_obj.zip`) | metres | `.obj` + `.mtl` + `textures/`, quad topology |
| `.zip` | — | All of the above plus `params.json` (to regenerate), `preview.png`, README and LICENSE |

All formats use +Y up, with the character facing +Z and the feet at y = 0.
`scripts/blender_check.py` imports exports into Blender and renders previews.

## Architecture

```
scripts/build-assets.ts   MakeHuman data -> public/assets (packs, textures, thumbnails, catalog.json)
src/core/
  assets.ts    asset pack formats + AssetLibrary (fetch in browser, fs in Node)
  pack.ts      tiny gzip'd binary container (JSON header + typed arrays)
  params.ts    HumanParams, presets, seeded randomizer
  morph.ts     macro + detail-slider target weighting, target application
  human.ts     buildHuman(): morph, proxy fitting, subdivision, materials, skeleton
  geometry.ts  compaction, Catmull-Clark subdivision, normals
  mesh.ts      MeshData (multi-material, triangles + original polygons)
src/export/    glb.ts, fbx.ts (binary writer), obj.ts, index.ts (bundling)
src/app/       three.js viewer + catalog-driven UI
```

## Roadmap: rigging and animation

Most of the groundwork for rigging is already in place:

- MakeHuman's **163-bone skeleton** (with fingers, toes and facial bones) is computed for every
  character (`Character.bones`; tick **Skeleton** in the viewer to see it).
- The CC0 **skin weights** (`default_weights.mhw`) ship with the source data.

Next steps:
1. Pack the weights. Transfer them to proxies via their reference vertices, and to subdivided meshes by interpolation.
2. Offer a game-engine skeleton option (fewer bones, Mixamo / Unreal-style names).
3. Export glTF `skins` + `JOINTS_0/WEIGHTS_0`, and FBX `LimbNode` + `Skin`/`Cluster` + bind `Pose`.
4. Animation clips (idle, walk, run) and an expression/face-pose system (MakeHuman also has expression targets).

## License

Generator code: yours. Character assets: CC0 (see `public/assets/LICENSE.txt`). Exported
characters can be used commercially without attribution.
