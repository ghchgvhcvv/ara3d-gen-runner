import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Character } from '../core/character';

/** three.js viewport that displays a generated Character. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private bones: THREE.Group | null = null;
  private framedHeight = 0;
  wireframe = false;
  showSkeleton = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color('#2a2e37');

    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3330', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 0.1, far: 12 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fb6ff', 1.0);
    rim.position.set(-3, 3, -3);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#30343e', roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(8, 32, '#4a5060', '#3a3f4b');
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.001;
    this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.camera.position.set(1.6, 1.4, 3.6);
    this.controls.target.set(0, 0.9, 0);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
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
    const mats = m.materials.map(
      (mt) =>
        new THREE.MeshStandardMaterial({
          name: mt.name,
          color: new THREE.Color(mt.color),
          roughness: mt.roughness,
          metalness: mt.metalness,
          flatShading: ch.params.flatShading,
          wireframe: this.wireframe,
        }),
    );
    this.mesh = new THREE.Mesh(geo, mats);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this.drawSkeleton(ch);

    // Re-frame only when the height changes noticeably, so tweaking sliders doesn't jump the camera.
    const h = ch.proportions.H;
    if (Math.abs(h - this.framedHeight) > 0.25) {
      this.framedHeight = h;
      this.controls.target.set(0, h * 0.52, 0);
      const dist = h * 1.9 + 0.6;
      this.camera.position.set(dist * 0.42, h * 0.75, dist);
    }
  }

  private drawSkeleton(ch: Character) {
    if (this.bones) this.scene.remove(this.bones);
    this.bones = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: '#ffcc33', depthTest: false });
    const pts: number[] = [];
    for (const j of ch.skeleton.joints) {
      if (j.parent < 0) continue;
      pts.push(...ch.skeleton.joints[j.parent].position, ...j.position);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, mat);
    lines.renderOrder = 10;
    this.bones.add(lines);
    const dot = new THREE.SphereGeometry(0.012, 8, 6);
    const dm = new THREE.MeshBasicMaterial({ color: '#ffcc33', depthTest: false });
    for (const j of ch.skeleton.joints) {
      const s = new THREE.Mesh(dot, dm);
      s.position.set(...j.position);
      s.renderOrder = 10;
      this.bones.add(s);
    }
    this.bones.visible = this.showSkeleton;
    this.scene.add(this.bones);
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    if (this.mesh) for (const m of this.mesh.material as THREE.MeshStandardMaterial[]) m.wireframe = on;
  }

  setSkeleton(on: boolean) {
    this.showSkeleton = on;
    if (this.bones) this.bones.visible = on;
  }

  /** PNG snapshot of the current view. */
  async snapshot(): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
  }
}
