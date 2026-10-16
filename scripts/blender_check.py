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
    # Blender's glTF importer adds an "Icosphere" bone-shape helper for rigged files: ignore it.
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
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
    _, _, _, _, lo, hi = stats()
    centre = (lo + hi) / 2
    size = max(hi - lo)
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.34, 0.38, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    for name, loc, energy in [("key", (2.5, -3, 3.5), 900), ("fill", (-3, -2, 2), 300), ("rim", (0, 3, 3), 500)]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = 2.5
        lo_ = bpy.data.objects.new(name, ld)
        lo_.location = loc
        lo_.rotation_euler = (centre - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(lo_)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.08
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def shoot(label, d, target, scale):
        d = Vector(d).normalized()
        cam_data.ortho_scale = scale
        cam.location = target + d * 6
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out_png}_{label}.png"
        bpy.ops.render.render(write_still=True)

    shoot("front", (0, -1, 0), centre, size * 1.08)
    shoot("three_quarter", (0.7, -1, 0.1), centre, size * 1.08)
    shoot("back", (0, 1, 0), centre, size * 1.08)
    h = hi.z - lo.z
    head = Vector((centre.x, centre.y, hi.z - h * 0.085))
    shoot("face", (0, -1, 0), head, h * 0.2)
    shoot("face34", (0.8, -1, 0.05), head, h * 0.2)


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
