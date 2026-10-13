"""
Validate exported files by importing them into Blender, and optionally render previews.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      --python scripts/blender_check.py -- [--render out/renders] out/*.glb out/*.fbx out/*.obj
"""
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
render_dir = None
if "--render" in argv:
    i = argv.index("--render")
    render_dir = argv[i + 1]
    del argv[i:i + 2]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def do_import(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".glb":
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise ValueError(path)


def stats():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    verts = sum(len(o.data.vertices) for o in meshes)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    mats = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return meshes, verts, tris, mats, lo, hi


def render(path, out_png):
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH"]
    _, _, _, _, lo, hi = stats()
    centre = (lo + hi) / 2
    size = max(hi - lo)
    for o in meshes:
        for p in o.data.polygons:
            p.use_smooth = True if not o.data.polygons or True else False
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = False
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.12
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {"front": (0, -1, 0), "side": (1, 0, 0), "three_quarter": (0.75, -1, 0.15)}
    from mathutils import Vector as V
    paths = []
    for label, d in shots.items():
        d = V(d).normalized()
        cam.location = centre + d * size * 3
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out_png}_{label}.png"
        bpy.ops.render.render(write_still=True)
        paths.append(scene.render.filepath)
    # Close-up of the head (top 18% of the model).
    head_c = V((centre.x, centre.y, hi.z - (hi.z - lo.z) * 0.09))
    cam_data.ortho_scale = (hi.z - lo.z) * 0.22
    for label, d in {"face": (0, -1, 0), "face34": (0.8, -1, 0.1)}.items():
        d = V(d).normalized()
        cam.location = head_c + d * size * 3
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out_png}_{label}.png"
        bpy.ops.render.render(write_still=True)
    return paths


ok = True
for path in argv:
    reset()
    try:
        do_import(path)
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"FAIL {path}: {e}")
        continue
    meshes, verts, tris, mats, lo, hi = stats()
    dims = hi - lo
    print(
        f"OK   {os.path.basename(path):28s} objects={len(meshes)} verts={verts} tris={tris} "
        f"mats={len(mats)} size=({dims.x:.2f}, {dims.y:.2f}, {dims.z:.2f}) m  minZ={lo.z:.3f}"
    )
    if render_dir and path.endswith(".glb"):
        os.makedirs(render_dir, exist_ok=True)
        render(path, os.path.join(render_dir, os.path.splitext(os.path.basename(path))[0]))

print("ALL OK" if ok else "SOME FAILED")
