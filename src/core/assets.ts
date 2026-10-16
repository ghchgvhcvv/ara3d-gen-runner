/**
 * Asset pack formats (produced by scripts/build-assets.ts from the CC0
 * MakeHuman data) and a loader that works in both the browser and Node.
 */
import { decodePack, type Pack } from './pack';

export interface AssetMaterial {
  name: string;
  color: string; // sRGB hex multiplier
  roughness: number;
  metalness: number;
  diffuse?: string; // texture file name in assets/textures
  normal?: string;
  alpha: 'opaque' | 'mask' | 'blend';
  doubleSided: boolean;
}

export interface BaseMeta {
  vertexCount: number;
  faceCount: number;
  /** Skeleton joint name -> base-mesh vertex indices (joint position = their mean). */
  joints: Record<string, number[]>;
  bones: { name: string; parent: string | null; head: string; tail: string }[];
}
// arrays: positions (Float32, decimetres), faceVerts (Uint32, quads), faceUVs (Uint32), uvs (Float32)

export interface TargetsMeta {
  /** name -> [entry offset, entry count, quantisation scale] */
  targets: Record<string, [number, number, number]>;
}
// arrays: idx (Uint16 index deltas), dx, dy, dz (Int16)

export type ProxyKind = 'body' | 'eyes' | 'eyebrows' | 'eyelashes' | 'hair' | 'outfit' | 'shoes' | 'hat' | 'teeth';

export interface ProxyMeta {
  id: string;
  kind: ProxyKind;
  zDepth: number;
  /** Per-axis scale reference: [vertA, vertB, referenceDistance] or null. */
  scale: ([number, number, number] | null)[];
  material?: AssetMaterial;
  vertexCount: number;
}
// arrays: refs (Uint32 N*3), weights (Float32 N*3), offsets (Float32 N*3),
//         faceSizes (Uint8), faceVerts (Uint32), faceUVs (Uint32), uvs (Float32), deleteVerts (Uint32)

export interface CatalogItem {
  id: string;
  name: string;
  tags: string[];
  thumb?: string;
  /** Proxy pack file (relative to assets/), for mesh assets. */
  file?: string;
  material?: AssetMaterial;
}

export interface Slider {
  id: string;
  label: string;
  /** Pairs of [min target, max target]; several pairs = symmetric left/right. null = no target on that side. */
  targets: [string | null, string | null][];
  /** Unipolar sliders run 0..1, bipolar -1..1. */
  bipolar: boolean;
}

export interface SliderGroup {
  category: string;
  group: string;
  sliders: Slider[];
}

export interface Catalog {
  skins: CatalogItem[];
  eyes: CatalogItem[];
  eyebrows: CatalogItem[];
  eyelashes: CatalogItem[];
  hair: CatalogItem[];
  outfits: CatalogItem[];
  shoes: CatalogItem[];
  hats: CatalogItem[];
  bodies: CatalogItem[];
  eyeMesh: string;
  sliders: SliderGroup[];
}

/** Where asset bytes come from: fetch() in the browser, the filesystem in Node. */
export interface AssetSource {
  read(path: string): Promise<Uint8Array>;
  /** URL usable by the viewer for textures (browser only). */
  url?(path: string): string;
}

export function fetchSource(base = './assets/'): AssetSource {
  return {
    async read(path) {
      const r = await fetch(base + path);
      if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    url: (path) => base + path,
  };
}

/** Loads and caches packs, catalog and textures. */
export class AssetLibrary {
  catalog!: Catalog;
  base!: Pack<BaseMeta>;
  targets!: Pack<TargetsMeta>;
  private proxies = new Map<string, Promise<Pack<ProxyMeta>>>();
  private textures = new Map<string, Promise<Uint8Array>>();
  /** Textures generated at runtime (procedural garments), by file name. */
  private generated = new Map<string, Uint8Array>();
  private blobUrls = new Map<string, string>();

  registerTexture(name: string, data: Uint8Array): void {
    this.generated.set(name, data);
  }

  hasTexture(name: string): boolean {
    return this.generated.has(name);
  }

  peekTexture(name: string): Uint8Array | undefined {
    return this.generated.get(name);
  }

  constructor(readonly source: AssetSource) {}

  async init(): Promise<this> {
    const [cat, base, targets] = await Promise.all([
      this.source.read('catalog.json'),
      this.source.read('base.pack'),
      this.source.read('targets.pack'),
    ]);
    this.catalog = JSON.parse(new TextDecoder().decode(cat));
    this.base = decodePack<BaseMeta>(base);
    this.targets = decodePack<TargetsMeta>(targets);
    return this;
  }

  proxy(file: string): Promise<Pack<ProxyMeta>> {
    let p = this.proxies.get(file);
    if (!p) this.proxies.set(file, (p = this.source.read(file).then((b) => decodePack<ProxyMeta>(b))));
    return p;
  }

  texture(name: string): Promise<Uint8Array> {
    const gen = this.generated.get(name);
    if (gen) return Promise.resolve(gen);
    let p = this.textures.get(name);
    if (!p) this.textures.set(name, (p = this.source.read(`textures/${name}`)));
    return p;
  }

  textureUrl(name: string): string {
    const gen = this.generated.get(name);
    if (gen) {
      let url = this.blobUrls.get(name);
      if (!url) {
        url = URL.createObjectURL(new Blob([gen as BlobPart], { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
        this.blobUrls.set(name, url);
      }
      return url;
    }
    return this.source.url ? this.source.url(`textures/${name}`) : name;
  }
}
