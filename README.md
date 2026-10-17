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
npm test               # builds 228 characters and validates every export format
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
  garments/    procedural clothing (shells, hull rings, generated fabrics)
  looks/       tattoos + stubble/shaved scalps (skin overlay), procedural hairstyles, beards, earrings
  props/       weapons (rifle, pistol, sword, knife)
  rig/         skeletons, auto-skinning, T-pose, WeaponR socket
  anim/        clips + the shared evaluator (FK, arm IK, grounding)
src/export/    glb.ts, fbx.ts (binary writer), obj.ts, index.ts (bundling)
src/app/       three.js viewer + catalog-driven UI
```

## Clothing

Choose a full MakeHuman outfit, or **Separate pieces**:

- **Tops:** tank top, fatigue shirt, uniform shirt (short or long sleeves, with epaulettes), techwear jacket, tattered shirt, sleeveless tunic, woven tunic (buba), or none (shirtless/topless).
- **Bottoms:** briefs, cargo shorts, fatigue/uniform/techwear/tattered pants, loose trousers (sokoto), wrappers (knee or ankle length), Zulu hide aprons, a loincloth with front and back panels, or none.
- **Accessories:** belts, utility belt, waist sash, shuka shoulder drape, crossed straps, amulet bandolier, leather armor, tactical vest, reflective hi-vis vest, beret, beaded collar, bead and cowrie necklaces, protective charms, brass cuffs, beaded and cowrie arm bands, arm guards, fur bands, fur headband with feathers, beaded headband, fila cap, combat helmet, holo visor, neon accents, goggles, arm wraps, wrist watch.
- **Footwear:** MakeHuman shoes, sandals, combat boots, or barefoot.
- **Fabrics:** generated, tileable, with normal maps: kente, aso-oke, ankara, adire, shuka plaid, cowhide, leopard, camo, MOLLE, leather, techwear, tattered.

Every piece has editable colours (Colour + Accent, e.g. epaulettes, badge, reflective tape) and, where it has several, a pattern choice. Presets include **Nigerian Police** (all-black uniform, short sleeves, beret, duty belt) and **FRSC** (beige short-sleeve shirt after the FRSC No. 5b dress, black trousers, maroon beret, service belt) officers. The uniform shirt comes in short and long sleeves, and a hi-vis reflective vest is available as an accessory.

Garments are grown from the body surface or wrapped around it with convex-hull rings, so they fit every body shape.

## Hair, beards, tattoos, earrings

- **Hairstyles:** MakeHuman hair, plus generated **buzz cut**, **punk mohawk** (liberty spikes, shaved sides), **cornrows** and **box braids**. These follow every head shape and take their own *Hair colour*.
- **Facial hair:** stubble, mustache, goatee, short beard or full beard, with a *Beard colour*. Beards are hair cards (alpha-masked strips, the usual game approach) over a stubble layer. With facial bones on, they follow the jaw.
- **Tattoos** (adults 18+ only): tribal armband, full sleeve, forearm bands, chest piece, back piece, and Yoruba-style cheek marks, with an ink colour.
- **Earrings:** studs, small hoops or big hoops, in gold or silver.

Tattoos, stubble and shaved scalps are painted into one RGBA "Skin details" texture in the body's UV space. It sits on a thin copy of the skin they cover, 0.4 mm above it. Designs are defined on the unmorphed base mesh, so they keep their shape on every body and the texture is cached while you move sliders.

**Adult-only options:** topless and bottomless (no underwear) are only possible for characters aged 18+. Under-18 female characters always get a top, and every under-18 character keeps underwear. Bodies are anatomically neutral (no genital geometry).

## Rigging

Characters are rigged automatically, with no markers to place. The skeleton is built on the generated body's joints, and MakeHuman's CC0 skin weights are mapped onto it. Every clothing, hair and accessory vertex then gets weights: proxies through their reference vertices, garments through the base mesh or the nearest body vertices. Weights follow through subdivision.

| Option | Choices |
| --- | --- |
| Skeleton | **Game rig** (65 bones, Mixamo names; retargets to Mixamo / Unity Humanoid / Unreal), **lite** (25 bones, no fingers), **full MakeHuman** (163 bones incl. face), none. Each also gets a `WeaponR` socket bone (below). |
| Facial bones | jaw + eyes |
| Rest pose | A-pose (natural) or T-pose (re-posed with linear blend skinning) |

**Weapon socket:** every rig has a `WeaponR` bone under the right hand, centred in the closed grip. Its +Y axis runs out of the top of the fist (the grip and blade axis) and +Z toward the knuckles. Parenting a prop to it is how games usually attach weapons, so you can swap weapons in the engine without re-exporting the character.

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
4. **Weapon** (when the character holds one): **In the hand**, one file with the weapon skinned to `WeaponR`; or **Separate prop file**, which exports the character without the weapon plus `<name>_<weapon>.glb/.fbx`. The prop's origin is at the grip, so it attaches to `WeaponR` with zero offset.
5. **Format:** GLB, FBX, OBJ (static only; disabled for rigged modes), or All formats (zip).
6. **You will download:** the exact file name and every file in it, each with a description: triangles, textures, bones and pose, which clips, and skeleton-only or not. Notes explain any adjustment, for example that OBJ can't hold a rig.

**Using the GLB in a game, without Blender:**
- **Web (three.js, Babylon.js, PlayCanvas) and Godot 4** load the rigged, animated GLB directly. `npm run test:gltf` proves this for three.js: it exports through the real pipeline, loads the file with the stock `GLTFLoader` + `AnimationMixer` in headless Chrome, and checks every bone of every clip against the generator. Results for all four rig variants: within 0.04°, with exact root positions, and the skinned mesh deforms.
- **Godot:** tick *Mark looping clips in their names* in the Export panel. Clips are then named `Walk-loop` and so on, which Godot imports as looping automatically.
- **Unity:** use **FBX**. It imports natively, the Mixamo bone names map to the Humanoid rig, and you tick *Loop Time* on looping clips. GLB in Unity needs the glTFast package.
- **Unreal 5:** use **FBX**. The skeleton has no separate root bone above Hips (like Mixamo), so Unreal's root-motion setup may need one added.
- **Every engine:** glTF has no loop flag, so set looping clips to loop. Loops play in place unless you export with Root motion.

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
| Shooter | Pistol idle (low ready), pistol aim, pistol fire; rifle idle (low ready), aim idle, fire single, fire full-auto, reload, aiming walk / walk back / strafe left / strafe right, rifle run, sprint, crouch aim, crouch walk; throw grenade, death (fall forward) |
| Melee | Sword idle (guard), sword slash, sword block (in Actions) |

**Weapons:** pick an assault rifle, pistol, sword or combat knife under *Weapon*. It is held in the right hand on the `WeaponR` socket, and the viewer switches to the matching idle. Firearms are fitted to the aiming pose: the barrel lines up with the chest's forward axis, and the rifle's handguard sits under the support hand. The shooter clips also work without a weapon, with your own prop parented to `WeaponR`. Both hands are placed with two-bone arm IK on a shared rifle line in chest space, so they hold the same (invisible) weapon on every body shape and skeleton. Fingers curl toward the palm, which is detected from each hand's joints, so fists and grips close correctly on A- and T-pose binds.

Feet are grounded automatically (crouch, landing, steps), and switching clips in the viewer crossfades over 0.25 s.

Clips are defined once (`src/core/anim/clips.ts`), in each bone's own frame (X = flex forward, Y = twist, Z = side), on an "animation rest" with relaxed arms and nearly straight elbows. One shared evaluator (`src/core/anim/evaluate.ts`) drives the viewer and both exporters, so one clip works on every skeleton type and on A- or T-pose binds, and the preview matches the export exactly.

Rig and animation options live in the export bar (the 🦴 button): skeleton type, rest pose, facial bones, and whether to include animations. With animations on:
- **GLB:** one glTF animation per clip (30 fps, rotation channels plus root translation).
- **FBX:** one AnimationStack (take) per clip.

`scripts/blender_anim_check.py` imports the files into Blender and renders key frames of every action.

### Next

- Facial animation through the jaw and eye bones and MakeHuman's expression targets.
- Two-bone IK foot locking for turns and strafes.
