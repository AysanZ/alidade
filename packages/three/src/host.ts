import {
  Box3,
  BoxHelper,
  Camera,
  Color,
  DirectionalLight,
  HemisphereLight,
  Group,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  PMREMGenerator,
  Raycaster,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import type { Light, Model3D } from "@alidade/core";
import { anchorLift, frameOf } from "@alidade/core";
import type { ModelHost } from "@alidade/maplibre";

import { cameraMatrix, placementMatrix } from "./frame";

/** What is known about a file once it has arrived. In the file's own units. */
export interface LoadedInfo {
  /** Width, height and depth of the mesh: its extent along x, y and z. */
  size: [number, number, number];
  /** The bottom of the mesh, which is what `base` anchoring lifts it by. */
  low: number;
  triangles: number;
}

export interface HostEvents {
  onLoaded?(id: string, info: LoadedInfo): void;
  onFailed?(id: string, reason: string): void;
  /**
   * The scene is not being drawn because the map is a sphere. Called once each
   * time that changes, so the application can say so once rather than per frame.
   */
  onGlobe?(hidden: boolean): void;
}

/**
 * The slice of the map a custom layer is handed. Declared here rather than
 * imported, so that this package does not depend on MapLibre's types for the
 * four methods it uses, and a test can pass a plain object.
 */
export interface HostMap {
  getCanvas(): HTMLCanvasElement;
  getCenter(): { lng: number; lat: number };
  triggerRepaint(): void;
  queryTerrainElevation(position: [number, number]): number | null;
}

/** The part of the map's render arguments this layer reads. */
interface RenderArgs {
  /** View space to clip space. Older engines do not pass it. */
  projectionMatrix?: ArrayLike<number>;
  defaultProjectionData: {
    mainMatrix: ArrayLike<number>;
    fallbackMatrix: ArrayLike<number>;
    /** 0 is mercator, 1 is a globe. Anything above 0 is a globe being drawn. */
    projectionTransition: number;
  };
}

interface Loaded {
  template: Object3D;
  info: LoadedInfo;
}

interface Entry {
  model: Model3D;
  /** Carries the placement. Its matrix is written every frame, never composed. */
  group: Group;
  /** Carries the anchor lift, so the mesh can stand on its base. */
  pivot: Group;
  mesh: Object3D | null;
  info: LoadedInfo | null;
  /** True once this placement has its own materials and may change their opacity. */
  own: boolean;
  /** Terrain height under the model, and when it was last asked for. */
  ground: number;
  groundAt: number;
}

/** How long a terrain height is trusted for. Terrain tiles arrive over seconds, not frames. */
const GROUND_TTL_MS = 250;

/** Default sun, the map's own: from the south-west, thirty degrees off vertical. */
const DEFAULT_LIGHT: Light = { anchor: "map", color: "#ffffff", intensity: 0.85, position: [1.15, 210, 30] };

const SELECTION = 0x4c8dff;

/**
 * Draws glTF models into a MapLibre map with three.js.
 *
 * This is the one place that knows what a mesh is. It is given models as
 * placements — a position, a height, a bearing, a scale — and turns them into a
 * scene that the map draws as one of its own layers, sharing the map's camera
 * and depth buffer, so a model stands behind the building in front of it and
 * under the label above it.
 *
 * Files are loaded once per URL and cloned per placement, so a car park of
 * forty identical cars is one download. The scene is re-anchored at the map
 * centre every frame; see `frame.ts` for why.
 */
export class ThreeModelHost implements ModelHost {
  #scene = new Scene();
  #camera = new Camera();
  #renderer: WebGLRenderer | null = null;
  #gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  #map: HostMap | null = null;
  #loader: GLTFLoader;
  #files = new Map<string, Promise<Loaded>>();
  #entries = new Map<string, Entry>();
  #sky = new HemisphereLight(0xdfe8f5, 0x2a2a2e, 0.9);
  #sun = new DirectionalLight(0xffffff, 2.4);
  #events: HostEvents;
  #onGlobe: boolean | null = null;
  #selected: string | null = null;
  #outline: BoxHelper | null = null;
  #raycaster = new Raycaster();
  /** Metric scene to clip space, and back, as of the last frame. */
  #matrix = new Matrix4();
  #inverse = new Matrix4();
  #projection = new Matrix4();
  #view = new Matrix4();
  #environment: Texture | null = null;

  constructor(events: HostEvents = {}) {
    this.#events = events;
    /*
     * The camera is a pair of matrices and nothing else. Its transform is
     * written each frame from the map's, so three.js must not derive it from a
     * position and a rotation it was never given.
     */
    this.#camera.matrixAutoUpdate = false;
    this.#camera.matrixWorldAutoUpdate = false;
    /*
     * The Draco decoder ships with three.js and is bundled with the studio, so
     * a compressed file — which is what Blender and Sketchfab export by
     * default — decodes without a request to anyone else's server. It is only
     * fetched from the bundle when a file turns out to need it.
     */
    this.#loader = new GLTFLoader();
    this.#loader.setDRACOLoader(new DRACOLoader());
    this.#scene.add(this.#sky, this.#sun);
    this.light(null);
  }

  /* ---------------------------------------------------------- the layer */

  layer(id: string): Record<string, unknown> {
    return {
      id,
      type: "custom",
      renderingMode: "3d",
      onAdd: (map: HostMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => this.#attach(map, gl),
      onRemove: () => {
        // The layer is gone; the context is not. Everything loaded stays loaded
        // for the next `onAdd`, which a basemap swap produces a moment later.
        this.#map = null;
      },
      render: (_gl: unknown, args: RenderArgs) => this.#render(args),
    };
  }

  #attach(map: HostMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.#map = map;
    if (this.#renderer && this.#gl === gl) return;
    this.#renderer?.dispose();
    this.#environment = null;
    this.#scene.environment = null;
    this.#gl = gl;
    this.#renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    // The map has already drawn this frame; clearing would wipe it.
    this.#renderer.autoClear = false;
  }

  /**
   * Something for a metallic surface to reflect.
   *
   * A physically based material with nothing around it is a dull grey, however
   * good the file. A neutral room, filtered once and kept, gives chrome and
   * glass something to be chrome and glass with. It is made inside a frame,
   * not on attach, because it renders to textures of its own and the map only
   * expects its state to be disturbed inside a frame.
   */
  #surround(renderer: WebGLRenderer): void {
    if (this.#environment) return;
    try {
      const generator = new PMREMGenerator(renderer);
      this.#environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
      generator.dispose();
      this.#scene.environment = this.#environment;
      this.#scene.environmentIntensity = 0.45;
    } catch (error) {
      console.warn("[alidade] no environment map for models", error);
      this.#environment = new Texture();
    }
  }

  #render(args: RenderArgs): void {
    const map = this.#map;
    const renderer = this.#renderer;
    if (!map || !renderer) return;

    /*
     * Under globe projection the map's matrix projects a sphere, and a mesh
     * placed in mercator would be drawn floating beside the planet. Rather than
     * draw something wrong, draw nothing and say why, once.
     */
    const globe = args.defaultProjectionData.projectionTransition > 0;
    if (globe !== this.#onGlobe) {
      this.#onGlobe = globe;
      this.#events.onGlobe?.(globe);
    }
    if (globe) return;

    let drawn = 0;
    const centre = map.getCenter();
    const origin = { lon: centre.lng, lat: centre.lat };
    const now = performance.now();
    for (const entry of this.#entries.values()) {
      const { model } = entry;
      entry.group.visible = model.visible && entry.mesh !== null;
      if (!entry.group.visible) continue;
      if (model.clamp && now - entry.groundAt > GROUND_TTL_MS) {
        entry.ground = map.queryTerrainElevation(model.position) ?? 0;
        entry.groundAt = now;
      }
      placementMatrix(frameOf(model, origin, model.clamp ? entry.ground : 0), entry.group.matrix);
      drawn++;
    }
    if (drawn === 0) return;

    cameraMatrix(args.defaultProjectionData.mainMatrix, origin, this.#matrix);
    this.#inverse.copy(this.#matrix).invert();

    /*
     * The map's matrix is a projection and a view multiplied out, and the
     * geometry only needs the product. Lighting needs the two apart: a specular
     * highlight is drawn towards the eye, and with the product on the camera
     * and nothing else three.js takes the eye to be at the scene's origin,
     * which is on the ground at the map centre. The map passes the projection
     * on its own, so the view is recovered from it — the product is unchanged,
     * and the eye is where the camera is.
     */
    if (args.projectionMatrix) {
      this.#projection.fromArray(args.projectionMatrix);
      this.#view.copy(this.#projection).invert().multiply(this.#matrix);
      this.#camera.projectionMatrix.copy(this.#projection);
      this.#camera.projectionMatrixInverse.copy(this.#projection).invert();
      this.#camera.matrixWorldInverse.copy(this.#view);
      this.#camera.matrixWorld.copy(this.#view).invert();
    } else {
      this.#camera.projectionMatrix.copy(this.#matrix);
      this.#camera.projectionMatrixInverse.copy(this.#inverse);
      this.#camera.matrixWorldInverse.identity();
      this.#camera.matrixWorld.identity();
    }

    this.#scene.updateMatrixWorld(true);
    this.#outline?.update();

    const canvas = map.getCanvas();
    renderer.resetState();
    this.#surround(renderer);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.render(this.#scene, this.#camera);
  }

  /* ---------------------------------------------------------- models */

  add(model: Model3D): void {
    const existing = this.#entries.get(model.id);
    // Replaying against a scene that was not as empty as expected is what a
    // basemap swap does, and it must not download the file again.
    if (existing) return this.update(model);

    const group = new Group();
    group.matrixAutoUpdate = false;
    group.userData["modelId"] = model.id;
    const pivot = new Group();
    group.add(pivot);
    this.#scene.add(group);

    const entry: Entry = { model, group, pivot, mesh: null, info: null, own: false, ground: 0, groundAt: 0 };
    this.#entries.set(model.id, entry);
    this.#fetch(entry);
  }

  update(model: Model3D): void {
    const entry = this.#entries.get(model.id);
    if (!entry) return this.add(model);
    const was = entry.model;
    entry.model = model;
    if (was.url !== model.url) {
      this.#drop(entry);
      this.#fetch(entry);
      return;
    }
    if (was.anchor !== model.anchor) this.#anchor(entry);
    if (was.opacity !== model.opacity) this.#fade(entry);
    if (was.clamp !== model.clamp || was.position[0] !== model.position[0] || was.position[1] !== model.position[1]) {
      entry.groundAt = 0;
    }
    this.#map?.triggerRepaint();
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#drop(entry);
    this.#scene.remove(entry.group);
    this.#entries.delete(id);
    if (this.#selected === id) this.select(null);
    this.#map?.triggerRepaint();
  }

  #fetch(entry: Entry): void {
    const { url, id } = entry.model;
    this.#load(url).then(
      (loaded) => {
        // The placement may have gone, or moved to another file, while this was in flight.
        if (this.#entries.get(id) !== entry || entry.model.url !== url) return;
        entry.mesh = cloneSkinned(loaded.template);
        entry.info = loaded.info;
        entry.own = false;
        entry.pivot.add(entry.mesh);
        this.#anchor(entry);
        this.#fade(entry);
        this.#events.onLoaded?.(id, loaded.info);
        this.#map?.triggerRepaint();
      },
      (error: unknown) => {
        if (this.#entries.get(id) !== entry || entry.model.url !== url) return;
        this.#events.onFailed?.(id, reason(error));
      },
    );
  }

  /**
   * One download per URL, shared by every placement and kept for the session.
   *
   * A failed download is forgotten, so a file that was unreachable once is tried
   * again when the next placement asks for it.
   */
  #load(url: string): Promise<Loaded> {
    let pending = this.#files.get(url);
    if (!pending) {
      pending = this.#loader.loadAsync(url).then((gltf) => {
        const template = gltf.scene;
        template.updateMatrixWorld(true);
        const box = new Box3().setFromObject(template);
        const size = new Vector3();
        box.getSize(size);
        let triangles = 0;
        template.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const geometry = object.geometry;
          const count = geometry.index ? geometry.index.count : geometry.attributes["position"]?.count ?? 0;
          triangles += Math.floor(count / 3);
        });
        return {
          template,
          info: {
            size: [size.x, size.y, size.z],
            low: Number.isFinite(box.min.y) ? box.min.y : 0,
            triangles,
          },
        };
      });
      pending.catch(() => this.#files.delete(url));
      this.#files.set(url, pending);
    }
    return pending;
  }

  #drop(entry: Entry): void {
    if (!entry.mesh) return;
    // Materials this placement made for itself are its own to dispose. Geometry
    // and the file's materials are shared with the template and stay.
    if (entry.own) {
      entry.mesh.traverse((object) => {
        if (object instanceof Mesh) {
          for (const material of materialsOf(object)) material.dispose();
        }
      });
    }
    entry.pivot.remove(entry.mesh);
    entry.mesh = null;
    entry.info = null;
    entry.own = false;
  }

  #anchor(entry: Entry): void {
    entry.pivot.position.y = entry.info ? anchorLift(entry.model.anchor, entry.info.low) : 0;
  }

  #fade(entry: Entry): void {
    if (!entry.mesh) return;
    const opacity = Math.max(0, Math.min(1, entry.model.opacity));
    // A fully opaque placement can keep sharing the file's materials.
    if (opacity >= 1 && !entry.own) return;
    if (!entry.own) {
      entry.mesh.traverse((object) => {
        if (object instanceof Mesh) {
          object.material = Array.isArray(object.material)
            ? object.material.map((m: Material) => m.clone())
            : (object.material as Material).clone();
        }
      });
      entry.own = true;
    }
    entry.mesh.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of materialsOf(object)) {
        material.transparent = opacity < 1;
        material.opacity = opacity;
        material.needsUpdate = true;
      }
    });
  }

  /* ---------------------------------------------------------- light */

  /**
   * The map's light, on the scene.
   *
   * The map states a light as a colour, an intensity from 0 to 1, and where it
   * comes from as a bearing and an angle off the vertical. The sun here is set
   * the same way, and the sky light is dimmed with it, so Night in the scene
   * panel darkens the buildings and the models together.
   */
  light(light: Light | null): void {
    const chosen = light ?? DEFAULT_LIGHT;
    const [, azimuth = 210, polar = 30] = chosen.position ?? DEFAULT_LIGHT.position!;
    const a = (azimuth * Math.PI) / 180;
    const p = (polar * Math.PI) / 180;
    // Towards the light, in a frame with x east, y up and z south.
    this.#sun.position.set(Math.sin(a) * Math.sin(p), Math.cos(p), -Math.cos(a) * Math.sin(p)).multiplyScalar(1000);
    const intensity = Math.max(0, Math.min(1, chosen.intensity));
    const color = new Color(chosen.color);
    this.#sun.color.copy(color);
    this.#sun.intensity = 0.5 + 2.3 * intensity;
    this.#sky.color.copy(new Color(0xdfe8f5).lerp(color, 0.5));
    this.#sky.intensity = 0.3 + 0.7 * intensity;
    this.#map?.triggerRepaint();
  }

  /* ---------------------------------------------------------- picking */

  /**
   * Which model is under a point on the canvas, if any.
   *
   * `precise` tests the triangles, which is what a click deserves. Without it
   * only each model's box is tested, which is what a pointer passing over the
   * map can afford at sixty frames a second on a mesh of a million triangles.
   */
  pick(x: number, y: number, precise = false): string | null {
    const map = this.#map;
    if (!map || this.#onGlobe) return null;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return null;

    /*
     * A screen point is taken back into the scene through the inverse of the
     * whole scene-to-clip matrix, at the near plane and at the far plane, and
     * the ray runs between them. Nothing about a perspective camera's position
     * is assumed; only the matrix is.
     */
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1;
    const inverse = this.#inverse;
    const near = new Vector3(nx, ny, -1).applyMatrix4(inverse);
    const far = new Vector3(nx, ny, 1).applyMatrix4(inverse);
    this.#raycaster.set(near, far.sub(near).normalize());

    this.#scene.updateMatrixWorld(true);
    let best: { id: string; distance: number } | null = null;
    const box = new Box3();
    for (const entry of this.#entries.values()) {
      if (!entry.group.visible || !entry.mesh) continue;
      box.setFromObject(entry.group);
      const at = this.#raycaster.ray.intersectBox(box, new Vector3());
      if (!at) continue;
      let distance = at.distanceTo(near);
      if (precise) {
        const hit = this.#raycaster.intersectObject(entry.mesh, true)[0];
        if (!hit) continue;
        distance = hit.distance;
      }
      if (!best || distance < best.distance) best = { id: entry.model.id, distance };
    }
    return best?.id ?? null;
  }

  /** Draw a box round one model, or round none. */
  select(id: string | null): void {
    if (this.#outline) {
      this.#scene.remove(this.#outline);
      this.#outline.dispose();
      this.#outline = null;
    }
    this.#selected = id;
    const entry = id ? this.#entries.get(id) : undefined;
    if (entry) {
      this.#outline = new BoxHelper(entry.group, SELECTION);
      this.#scene.add(this.#outline);
    }
    this.#map?.triggerRepaint();
  }

  /** What is known about a placement's file, once it has arrived. */
  info(id: string): LoadedInfo | null {
    return this.#entries.get(id)?.info ?? null;
  }

  /** Let go of the GL resources. For when the map itself is going away. */
  dispose(): void {
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries.clear();
    this.#outline?.dispose();
    this.#environment?.dispose();
    this.#environment = null;
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#gl = null;
    this.#map = null;
  }
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** A download failure as a sentence, whichever shape the loader threw it in. */
function reason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; target?: { status?: number; statusText?: string } };
    if (typeof e.message === "string") return e.message;
    if (e.target?.status) return `The server answered ${e.target.status} ${e.target.statusText ?? ""}`.trim();
  }
  return "The file could not be loaded.";
}
