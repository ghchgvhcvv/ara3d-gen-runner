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

## Clothing

Choose a full MakeHuman outfit, or **Separate pieces**:

- **Tops:** tank top, fatigue shirt, techwear jacket, tattered shirt, sleeveless tunic, woven tunic (buba), or none (shirtless/topless).
- **Bottoms:** briefs, cargo shorts, fatigue/techwear/tattered pants, loose trousers (sokoto), wrappers (knee or ankle length), Zulu hide aprons, a loincloth with front and back panels, or none.
- **Accessories:** belts, utility belt, waist sash, shuka shoulder drape, crossed straps, amulet bandolier, leather armor, tactical vest, beaded collar, bead and cowrie necklaces, protective charms, brass cuffs, beaded and cowrie arm bands, arm guards, fur bands, fur headband with feathers, beaded headband, fila cap, combat helmet, holo visor, neon accents, goggles, arm wraps, wrist watch.
- **Footwear:** MakeHuman shoes, sandals, combat boots, or barefoot.
- **Fabrics:** generated, tileable, with normal maps: kente, aso-oke, ankara, adire, shuka plaid, cowhide, leopard, camo, MOLLE, leather, techwear, tattered.

Garments are grown from the body surface or wrapped around it with convex-hull rings, so they fit every body shape.

**Adult-only options:** topless and bottomless (no underwear) are only possible for characters aged 18+. Under-18 female characters always get a top, and every under-18 character keeps underwear. Bodies are anatomically neutral (no genital geometry).

## Rigging

Characters are rigged automatically, with no markers to place. The skeleton is built on the generated body's joints, and MakeHuman's CC0 skin weights are mapped onto it. Every clothing, hair and accessory vertex then gets weights: proxies through their reference vertices, garments through the base mesh or the nearest body vertices. Weights follow through subdivision.

| Option | Choices |
| --- | --- |
| Skeleton | **Game rig** (65 bones, Mixamo names; retargets to Mixamo / Unity Humanoid / Unreal), **lite** (25 bones, no fingers), **full MakeHuman** (163 bones incl. face), none |
| Facial bones | jaw + eyes |
| Rest pose | A-pose (natural) or T-pose (re-posed with linear blend skinning) |

GLB exports a joint hierarchy, inverse bind matrices and JOINTS_0/WEIGHTS_0. FBX exports LimbNodes, Skin/Cluster deformers and a bind pose. The ZIP adds `<name>.rig.json`, the bind pose in an engine-neutral form. The viewer can test the rig with poses (arms up, wave, squat, fist) and motions (idle, walk). `scripts/blender_rig_check.py` imports the exports into Blender and checks that posing deforms the mesh correctly.

## Roadmap: animation

1. Keyframed clip format on top of `core/rig/poses.ts` (rotations in the rest frame, so one clip drives every skeleton type).
2. Clip library (idle, walk, run, jump, attack, emotes) with blending in the viewer.
3. Export clips as glTF `animations` and FBX `AnimationStack`s.
4. Optional root motion, and facial animation through the jaw and eye bones and MakeHuman's expression targets.
