"""
Validate rigged exports in Blender: armature, vertex groups, and that posing a
bone actually deforms the mesh. Optionally renders the posed character.

  Blender -b --factory-startup --python scripts/blender_rig_check.py -- [--render DIR] files...
"""
import math
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

ok = True
for path in argv:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not arm or not meshes:
        print(f"FAIL {path}: armature={bool(arm)} meshes={len(meshes)}")
        ok = False
        continue
    mesh = meshes[0]
    bones = arm.data.bones
    groups = mesh.vertex_groups
    unweighted = sum(1 for v in mesh.data.vertices if not any(g.weight > 0 for g in v.groups))
    mod = any(m.type == "ARMATURE" and m.object == arm for m in mesh.modifiers) or mesh.parent == arm

    # Pose test: raise the left arm and check where the left/right hands go.
    arm_name = "LeftArm" if "LeftArm" in bones else "upperarm01.L"
    hand_l = "LeftHand" if "LeftHand" in bones else "wrist.L"
    hand_r = "RightHand" if "RightHand" in bones else "wrist.R"
    deps = bpy.context.evaluated_depsgraph_get()

    def hand_vertex_pos(bone_name):
        g = groups.get(bone_name)
        if g is None:
            return None
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        best, bw = None, 0
        for v in mesh.data.vertices:
            for gg in v.groups:
                if gg.group == g.index and gg.weight > bw:
                    best, bw = v.index, gg.weight
        p = mesh.matrix_world @ me.vertices[best].co
        ev.to_mesh_clear()
        return p

    before_l, before_r = hand_vertex_pos(hand_l), hand_vertex_pos(hand_r)
    pb = arm.pose.bones[arm_name]
    pb.rotation_mode = "XYZ"
    # Rotate about the armature's world forward axis (raises the arm sideways).
    world_axis = Vector((0, -1, 0)) if path.endswith(".glb") or path.endswith(".fbx") else Vector((0, 0, 1))
    m_world = arm.matrix_world @ pb.bone.matrix_local
    local_axis = (m_world.to_3x3().inverted() @ Vector((0, 1, 0))).normalized()  # Blender: Y forward after import is -Y; use bone-space
    pb.rotation_mode = "AXIS_ANGLE"
    fwd = (m_world.to_3x3().inverted() @ Vector((0, -1, 0))).normalized()
    pb.rotation_axis_angle = (math.radians(70), fwd.x, fwd.y, fwd.z)
    bpy.context.view_layer.update()
    after_l, after_r = hand_vertex_pos(hand_l), hand_vertex_pos(hand_r)
    moved_l = (after_l - before_l).length if before_l else 0
    moved_r = (after_r - before_r).length if before_r else 0
    good = len(bones) > 20 and unweighted == 0 and mod and moved_l > 0.2 and moved_r < 0.01
    ok &= good
    print(
        f"{'OK  ' if good else 'FAIL'} {os.path.basename(path):26s} bones={len(bones)} groups={len(groups)} "
        f"unweighted={unweighted} armatureMod={mod} leftHandMoved={moved_l:.2f}m rightHandMoved={moved_r:.3f}m "
        f"leftHandHeight {before_l.z:.2f}->{after_l.z:.2f}"
    )
    if render_dir:
        os.makedirs(render_dir, exist_ok=True)
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.display.shading.color_type = "TEXTURE"
        sc.render.resolution_x = sc.render.resolution_y = 700
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 2.3
        cam.location = (0.6, -6, 1.0)
        cam.rotation_euler = (Vector((0, 0, 1.0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(render_dir, os.path.basename(path) + ".png")
        bpy.ops.render.render(write_still=True)

print("ALL OK" if ok else "SOME FAILED")
