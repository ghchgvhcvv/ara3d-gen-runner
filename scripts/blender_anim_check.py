"""
Check exported animations in Blender: list actions and render key frames of each.

  Blender -b --factory-startup --python scripts/blender_anim_check.py -- OUT_DIR file.glb|file.fbx
"""
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir, path = argv[0], argv[1]
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
if path.endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=path)
else:
    bpy.ops.import_scene.gltf(filepath=path)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
for o in bpy.context.scene.objects:
    if o.name.startswith("Icosphere"):
        o.hide_render = True
actions = sorted(bpy.data.actions, key=lambda a: a.name)
print("ACTIONS", len(actions))
for a in actions:
    print(f"  {a.name:40s} frames {a.frame_range[0]:.0f}-{a.frame_range[1]:.0f}")

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x = 420
sc.render.resolution_y = 520
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.4
target = Vector((0, 0, 0.9))
cam.location = target + Vector((3.5, -4.5, 1.0)).normalized() * 8
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
floor = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))

if arm.animation_data is None:
    arm.animation_data_create()
for a in actions:
    arm.animation_data.action = a
    if hasattr(arm.animation_data, "action_slot") and a.slots:
        arm.animation_data.action_slot = a.slots[0]
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    for label, f in (("mid", (f0 + f1) // 2), ("end", f1)):
        sc.frame_set(f)
        hips = arm.pose.bones[0]
        head = arm.matrix_world @ hips.head
        safe = "".join(ch if ch.isalnum() else "_" for ch in a.name)[:40]
        sc.render.filepath = os.path.join(out_dir, f"{safe}_{label}.png")
        bpy.ops.render.render(write_still=True)
        if label == "end":
            loc, rot = cam.location.copy(), cam.rotation_euler.copy()
            cam.location = target + Vector((1, 0, 0.15)).normalized() * 8
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(out_dir, f"{safe}_side.png")
            bpy.ops.render.render(write_still=True)
            cam.location, cam.rotation_euler = loc, rot
        print(f"  {a.name[:30]:30s} {label}: hips at ({head.x:.2f}, {head.y:.2f}, {head.z:.2f})")
