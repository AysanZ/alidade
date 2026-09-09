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
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
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

import { buildBuiltin, isBuiltin } from "./builtin";
import { cameraMatrix, placementMatrix, visibilityBoost } from "./frame";

/** A built-in, as a promise, so it joins the same pipeline a download does. */
function builtinScene(url: string): Promise<Object3D> {
  const built = buildBuiltin(url);
  return built
    ? Promise.resolve(built)
    : Promise.reject(new Error(`There is no built-in model called "${url}".`));
}

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

/** The slice of the map a custom layer is handed. Declared, not imported, so this
 * package needs no MapLibre types and a test can pass a plain object. */
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

/**
 * How many overlapping models a hover tests the triangles of. Nearest box first,
 * so this caps effort rather than correctness: it only bites where boxes overlap.
 */
const HOVER_TESTS = 3;

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
 * Given placements, it makes a scene the map draws as one of its own layers,
 * sharing the map's camera and depth buffer. One download per URL, cloned per
 * placement; re-anchored at the map centre every frame, for the reason in `frame.ts`.
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
  /**
   * Something for a shadow to land on: the ground belongs to the map, so there
   * is no geometry there to darken. `ShadowMaterial` draws only where it is
   * shadowed. Flat at the anchor height — following terrain costs a sample
   * across the plane every frame to fix something nobody sees.
   */
  #ground = new Mesh(new PlaneGeometry(4000, 4000), new ShadowMaterial({ opacity: 0.32 }));
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
    // The camera is matrices only, written each frame from the map's, so
    // three.js must not derive them from a position it was never given.
    this.#camera.matrixAutoUpdate = false;
    this.#camera.matrixWorldAutoUpdate = false;
    // Draco ships with three.js and is bundled, so a compressed file — what
    // Blender exports by default — decodes without anyone else's server.
    this.#loader = new GLTFLoader();
    this.#loader.setDRACOLoader(new DRACOLoader());
    // Orthographic, so it must be told how much world to cover: too small
    // clips shadows square, too large spreads the depth texture thin.
    this.#sun.castShadow = true;
    this.#sun.shadow.mapSize.set(2048, 2048);
    const frustum = this.#sun.shadow.camera;
    frustum.left = -200;
    frustum.right = 200;
    frustum.top = 200;
    frustum.bottom = -200;
    frustum.near = 1;
    frustum.far = 4000;
    // Without a bias a surface shadows itself, in stripes, which is the classic
    // look of shadow mapping done once and never looked at again.
    this.#sun.shadow.bias = -0.0008;
    this.#sun.shadow.normalBias = 0.02;

    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.receiveShadow = true;
    // The ground is a shadow catcher, not an object: it must not block a pick,
    // and it must not be lifted into the outline of a selected model.
    this.#ground.raycast = () => {};
    this.#ground.userData["ground"] = true;

    this.#scene.add(this.#sky, this.#sun, this.#sun.target, this.#ground);
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
    // Soft shadows. The pass renders to its own target before the scene, so it
    // does not disturb what MapLibre has already drawn.
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFSoftShadowMap;
  }

  /**
   * Something for a metallic surface to reflect: a PBR material with nothing
   * around it is dull grey. Built inside a frame, because it renders to
   * textures of its own and that is when the map expects its state disturbed.
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

    // Under a globe, a mesh placed in mercator floats beside the planet. Draw
    // nothing, and say why once.
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

    // Before the placements: the size floor needs what a metre is worth in
    // pixels this frame, and that is this matrix's answer.
    cameraMatrix(args.defaultProjectionData.mainMatrix, origin, this.#matrix);
    this.#inverse.copy(this.#matrix).invert();
    const pixelsPerMetre = this.#pixelsPerMetre(map);

    for (const entry of this.#entries.values()) {
      const { model } = entry;
      entry.group.visible = model.visible && entry.mesh !== null;
      if (!entry.group.visible) continue;
      if (model.clamp && now - entry.groundAt > GROUND_TTL_MS) {
        entry.ground = map.queryTerrainElevation(model.position) ?? 0;
        entry.groundAt = now;
      }
      const frame = frameOf(model, origin, model.clamp ? entry.ground : 0);
      frame.scale *= this.#visibilityBoost(entry, pixelsPerMetre);
      placementMatrix(frame, entry.group.matrix);
      drawn++;
    }
    if (drawn === 0) return;

    // Geometry needs only the product; lighting needs projection and view
    // apart, or three.js puts the eye on the ground at the map centre and every
    // highlight points at the wrong place. The view is recovered from the two.
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

  /** One download per URL, kept for the session. A failure is forgotten and retried. */
  #load(url: string): Promise<Loaded> {
    let pending = this.#files.get(url);
    if (!pending) {
      // Measured by the same code that measures a downloaded file: two sources
      // of truth for a height means one of them is eventually wrong.
      const arriving = isBuiltin(url)
        ? builtinScene(url)
        : this.#loader.loadAsync(url).then((gltf) => gltf.scene);

      pending = arriving.then((scene) => {
        const template = scene;
        template.updateMatrixWorld(true);
        const box = new Box3().setFromObject(template);
        const size = new Vector3();
        box.getSize(size);
        let triangles = 0;
        template.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          // Every mesh in a placed file both throws a shadow and takes one, so
          // a lorry's cab shades its own trailer rather than only the ground.
          object.castShadow = true;
          object.receiveShadow = true;
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

  /**
   * How much bigger than life a placement is drawn to stay findable: one, unless
   * the alternative is drawing nothing anyone can see. Height rather than the
   * longest side, because height is what a tilted view reads.
   */
  /**
   * Pixels per metre at the scene origin this frame. Measured through the matrix
   * rather than from the zoom, so pitch and terrain need no special case, and
   * divided by `w`, because a perspective matrix without its divide is not a screen position.
   */
  #pixelsPerMetre(map: HostMap): number {
    const canvas = map.getCanvas();
    const height = canvas.clientHeight || canvas.height;
    if (!height) return 0;
    // `applyMatrix4` performs the perspective divide, so these are already
    // normalised device coordinates, which run -1 to 1 over the whole canvas.
    const ground = new Vector3(0, 0, 0).applyMatrix4(this.#matrix);
    const up = new Vector3(0, 1, 0).applyMatrix4(this.#matrix);
    const ndc = Math.abs(up.y - ground.y);
    return Number.isFinite(ndc) ? (ndc / 2) * height : 0;
  }

  #visibilityBoost(entry: Entry, pixelsPerMetre: number): number {
    if (!entry.info) return 1;
    return visibilityBoost(
      entry.info.size[1] * entry.model.scale,
      pixelsPerMetre,
      entry.model.minPixels ?? 0,
    );
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
   * The map's light, on the scene: same colour, intensity and bearing, with the
   * sky light dimmed alongside, so Night darkens buildings and models together.
   */
  light(light: Light | null): void {
    const chosen = light ?? DEFAULT_LIGHT;
    const [, azimuth = 210, polar = 30] = chosen.position ?? DEFAULT_LIGHT.position!;
    const a = (azimuth * Math.PI) / 180;
    const p = (polar * Math.PI) / 180;
    // Towards the light, in a frame with x east, y up and z south.
    this.#sun.position.set(Math.sin(a) * Math.sin(p), Math.cos(p), -Math.cos(a) * Math.sin(p)).multiplyScalar(1000);
    // Stated rather than left at the default: the shadow camera is built around
    // this axis, and a target never added to the scene casts from a stale matrix.
    this.#sun.target.position.set(0, 0, 0);
    this.#sun.target.updateMatrixWorld();
    // A sun below the horizon casts no shadow; leaving it on would throw one
    // upwards through the models from underneath.
    this.#sun.castShadow = this.#sun.position.y > 0;
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
   * Which model is under a point. Boxes reject cheaply, triangles decide;
   * `precise` tests every candidate rather than the nearest few, which is what a
   * click deserves and a pointer at frame rate does not. Boxes alone are not an
   * answer: a `Box3` is axis aligned, so a rotated model's box is half again too
   * big on the diagonal, and hovering named an airliner nowhere near the pointer.
   */
  pick(x: number, y: number, precise = false): string | null {
    const map = this.#map;
    if (!map || this.#onGlobe) return null;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return null;

    // Back through the inverse of the whole matrix, at the near and far planes.
    // Nothing about a camera position is assumed; only the matrix is.
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1;
    const inverse = this.#inverse;
    const near = new Vector3(nx, ny, -1).applyMatrix4(inverse);
    const far = new Vector3(nx, ny, 1).applyMatrix4(inverse);
    this.#raycaster.set(near, far.sub(near).normalize());

    this.#scene.updateMatrixWorld(true);

    /* Everything whose box the ray crosses, nearest first. */
    const candidates: { entry: Entry; distance: number }[] = [];
    const box = new Box3();
    for (const entry of this.#entries.values()) {
      if (!entry.group.visible || !entry.mesh) continue;
      box.setFromObject(entry.group);
      const at = this.#raycaster.ray.intersectBox(box, new Vector3());
      if (!at) continue;
      candidates.push({ entry, distance: at.distanceTo(near) });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distance - b.distance);

    // Triangles, nearest box first, stopping at the first hit: a further box
    // cannot hold a nearer surface, which is what makes the cap safe.
    const limit = precise ? candidates.length : Math.min(candidates.length, HOVER_TESTS);
    for (let i = 0; i < limit; i++) {
      const entry = candidates[i]!.entry;
      if (this.#raycaster.intersectObject(entry.mesh!, true).length > 0) return entry.model.id;
    }
    return null;
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
