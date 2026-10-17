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

## Exporting

The export bar always shows what you're about to get, for example `📦 FBX · Rigged + 3 anims`, with a Download button named after the exact file. Click the summary to open the **Export panel**:

1. **What to export**
   - **Static model:** mesh + textures.
   - **Rigged model:** + skeleton and skin weights.
   - **Rigged + animations:** + the clips you pick.
2. **Skeleton:** game rig (65 bones, Mixamo names), lite (25), or full MakeHuman (163); A- or T-pose bind; optional jaw and eye bones.
3. **Animations:** tick clips by category (▶ previews each one), then choose **One file, all clips inside** or **Zip: one file per clip**.
   - Per-clip files follow Unity's `model@clip.fbx` convention and are skeleton-only unless "Include the mesh" is on.
   - **Root motion** makes walk, run and strafe travel instead of playing in place.
4. **Format:** GLB, FBX, OBJ (static only; disabled for rigged modes), or All formats (zip).
5. **You will download:** the exact file name and every file in it, each with a description: triangles, textures, bones and pose, which clips, and skeleton-only or not. Notes explain any adjustment, for example that OBJ can't hold a rig.

The plan is computed by `planExport()` (`src/export/plan.ts`) and executed by `runExport()`, so the download always matches the list. Zips also contain `params.json` (to regenerate the character), `rig.json`, a README listing the files, the licence and a preview image.

## Animation

The character loads playing **Idle**, a rigged idle with relaxed arms. The animation bar at the top of the viewport plays the clips:

| Category | Clips |
| --- | --- |
| Idle & stance | Idle, Crouch idle (loops) |
| Locomotion | Walk, Run, Walk backwards, Strafe left/right (loops; in place, or with root motion) |
| Actions | Jump, Fall, Punch, Hit reaction (one-shots) |
| Emotes | Wave, Cheer (loops) |
| Turns | Left/right 45° and 90°, full 360° (one-shots: hip yaw with stepping feet) |

Feet are grounded automatically (crouch, landing, steps), and switching clips in the viewer crossfades over 0.25 s.

Clips are defined once (`src/core/anim/clips.ts`), in each bone's own frame (X = flex forward, Y = twist, Z = side), on an "animation rest" with relaxed arms and nearly straight elbows. One shared evaluator (`src/core/anim/evaluate.ts`) drives the viewer and both exporters, so one clip works on every skeleton type and on A- or T-pose binds, and the preview matches the export exactly.

Rig and animation options live in the export bar (the 🦴 button): skeleton type, rest pose, facial bones, and whether to include animations. With animations on:
- **GLB:** one glTF animation per clip (30 fps, rotation channels plus root translation).
- **FBX:** one AnimationStack (take) per clip.

`scripts/blender_anim_check.py` imports the files into Blender and renders key frames of every action.

### Next

- Facial animation through the jaw and eye bones and MakeHuman's expression targets.
- Two-bone IK foot locking for turns and strafes.
- Weapon-holding and combat sets, if wanted.
