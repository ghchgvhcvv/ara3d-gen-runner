import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Character } from '../core/human';
import { boneFor, type Motion, type Pose } from '../core/rig/poses';
import { localTransform, quatOf } from '../core/rig/rig';

/** three.js viewport that displays a generated Character. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private helper: THREE.SkeletonHelper | null = null;
  private bones: THREE.Bone[] = [];
  private rest: THREE.Quaternion[] = [];
  private current: Character | null = null;
  private pose: Pose = {};
  private motion: Motion | null = null;
  private clock = new THREE.Clock();
  private loader = new THREE.TextureLoader();
  private texCache = new Map<string, THREE.Texture>();
  private framedHeight = 0;
  wireframe = false;
  showSkeleton = false;

  constructor(private canvas: HTMLCanvasElement, private textureUrl: (file: string) => string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE.Color('#2b2f38');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight('#fff4ea', 2.4);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.015;
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 12 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b8c8ff', 1.2);
    rim.position.set(-2.5, 3, -3);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#363b46', roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(8, 32, '#4c5262', '#3c414d');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = 0.001;
    this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.3;
    this.camera.position.set(1.4, 1.3, 4.2);
    this.controls.target.set(0, 0.9, 0);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      if (this.motion) this.applyPose(this.motion.sample(this.clock.getElapsedTime() % this.motion.duration));
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private texture(file: string, color: boolean): THREE.Texture {
    const key = file + color;
    let t = this.texCache.get(key);
    if (!t) {
      t = this.loader.load(this.textureUrl(file));
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; // procedural fabrics tile beyond 0..1
      this.texCache.set(key, t);
    }
    return t;
  }

  show(ch: Character) {
    const { mesh: m } = ch;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material[]).forEach((x) => x.dispose());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
    const total = m.groups.reduce((n, g) => n + g.indices.length, 0);
    const index = new Uint32Array(total);
    let o = 0;
    for (const g of m.groups) {
      index.set(g.indices, o);
      geo.addGroup(o, g.indices.length, g.material);
      o += g.indices.length;
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mats = m.materials.map((mt) => {
      const mat = new THREE.MeshStandardMaterial({
        name: mt.name,
        color: new THREE.Color(mt.color),
        roughness: mt.roughness,
        metalness: mt.metalness,
        map: mt.map ? this.texture(mt.map, true) : null,
        normalMap: mt.normalMap ? this.texture(mt.normalMap, false) : null,
        side: mt.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        emissive: mt.emissive ? new THREE.Color(mt.emissive) : new THREE.Color(0),
        emissiveIntensity: mt.emissive ? 1.6 : 0,
        wireframe: this.wireframe,
      });
      // Double-sided cloth would otherwise shadow itself (acne).
      if (mt.doubleSided) mat.shadowSide = THREE.FrontSide;
      if (mt.alpha === 'mask') {
        mat.alphaTest = 0.5;
        mat.alphaToCoverage = true;
      } else if (mt.alpha === 'blend') {
        mat.transparent = true;
        mat.opacity = mt.opacity ?? 1;
        mat.depthWrite = false;
      }
      return mat;
    });
    this.current = ch;
    if (ch.rig && m.joints && m.weights) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.joints, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(m.weights, 4));
      const sk = new THREE.SkinnedMesh(geo, mats);
      this.bones = ch.rig.bones.map((b, i) => {
        const bone = new THREE.Bone();
        bone.name = b.name;
        const { t, R } = localTransform(ch.rig!.bones, i);
        bone.position.set(...t);
        bone.quaternion.set(...quatOf(R));
        return bone;
      });
      ch.rig.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : sk).add(this.bones[i]));
      this.rest = this.bones.map((b) => b.quaternion.clone());
      sk.updateMatrixWorld(true);
      sk.bind(new THREE.Skeleton(this.bones));
      this.mesh = sk;
    } else {
      this.bones = [];
      this.rest = [];
      this.mesh = new THREE.Mesh(geo, mats);
    }
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.drawSkeleton();
    this.applyPose(this.pose);

    // Re-frame only when the height changes noticeably, so tweaking sliders doesn't jump the camera.
    if (Math.abs(ch.height - this.framedHeight) > 0.2) {
      this.framedHeight = ch.height;
      this.frame();
    }
  }

  private faceMode = false;

  private frame() {
    const h = this.framedHeight || 1.75;
    if (this.faceMode) {
      this.controls.target.set(0, h * 0.93, 0.02);
      this.camera.position.set(0.22, h * 0.95, 0.7);
    } else {
      const dist = h * 2.1 + 0.4;
      this.controls.target.set(0, h * 0.55, 0);
      this.camera.position.set(dist * 0.35, h * 0.7, dist);
    }
  }

  /** Close-up on the face (or back to full body). */
  focusFace(on: boolean) {
    this.faceMode = on;
    this.frame();
  }

  private drawSkeleton() {
    if (this.helper) {
      this.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = null;
    }
    if (!this.mesh || !this.bones.length) return;
    this.helper = new THREE.SkeletonHelper(this.mesh);
    (this.helper.material as THREE.LineBasicMaterial).depthTest = false;
    this.helper.renderOrder = 10;
    this.helper.visible = this.showSkeleton;
    this.scene.add(this.helper);
  }

  /** Apply a test pose (rotations about rest-frame axes at each bone's head). */
  private applyPose(pose: Pose) {
    if (!this.current?.rig || !this.bones.length) return;
    const rig = this.current.rig;
    const byName = new Map(this.bones.map((b, i) => [b.name, i]));
    this.bones.forEach((b, i) => b.quaternion.copy(this.rest[i]));
    for (const [name, rots] of Object.entries(pose)) {
      const target = boneFor(rig.type, name);
      const i = target ? byName.get(target) : undefined;
      if (i === undefined) continue;
      // Axis given in the character's rest frame -> bone-local axis via the bone's world rest rotation.
      const R = rig.bones[i].rot;
      const worldRest = new THREE.Matrix4().set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1);
      const inv = worldRest.clone().transpose();
      let delta = new THREE.Quaternion();
      for (const { axis, deg } of rots) {
        const a = new THREE.Vector3(...axis).applyMatrix4(inv).normalize();
        delta = delta.multiply(new THREE.Quaternion().setFromAxisAngle(a, (deg * Math.PI) / 180));
      }
      this.bones[i].quaternion.multiply(delta);
    }
  }

  setPose(pose: Pose) {
    this.motion = null;
    this.pose = pose;
    this.applyPose(pose);
  }

  playMotion(m: Motion | null) {
    this.motion = m;
    this.clock.start();
    if (!m) this.applyPose(this.pose);
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    if (this.mesh) for (const m of this.mesh.material as THREE.MeshStandardMaterial[]) m.wireframe = on;
  }

  setSkeleton(on: boolean) {
    this.showSkeleton = on;
    if (this.helper) this.helper.visible = on;
  }

  async snapshot(): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
  }
}
