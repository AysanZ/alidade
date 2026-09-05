/**
 * Models the application builds rather than downloads.
 *
 * The catalogue used to be somebody's renderer test assets: a fox, and a lorry
 * with the vendor's logo painted down the side. They load, which is all they
 * were ever meant to prove, and they are the wrong objects — placing forty of
 * them puts forty copies of another company's branding on your map, and none of
 * them is a thing anyone surveys.
 *
 * These are. Each one is built from primitives at its real size in metres, so
 * a turbine is eighty metres to the hub because that is what a turbine is, and
 * a scale of 1 is already right. Nothing is fetched, nothing can go stale, and
 * there is no texture to carry anyone's mark.
 *
 * They are deliberately plain. A model on a map is read at fifty metres on a
 * tilted view, where a silhouette and a size are everything and a bevel is
 * nothing. Bring a real file when you need a real building.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

/** Addressed as a URL so a built-in placement is an ordinary placement. */
export const BUILTIN_PREFIX = "builtin:";

export function isBuiltin(url: string): boolean {
  return url.startsWith(BUILTIN_PREFIX);
}

const paint = (color: number, rough = 0.75) =>
  new MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });

const WHITE = 0xe8eaed;
const GREY = 0x9aa0a8;
const DARK = 0x3b4048;
const RED = 0xd6402c;
const ORANGE = 0xf07a1f;
const GREEN = 0x4e7a44;

/**
 * A survey marker: a pole you can see from a distance with a head you can aim at.
 *
 * Three metres, because that is tall enough to stand above a parked car and
 * short enough not to lie about the scale of what it marks.
 */
function marker(): Group {
  const group = new Group();
  const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 3, 12), paint(WHITE));
  pole.position.y = 1.5;
  const head = new Mesh(new SphereGeometry(0.35, 20, 14), paint(RED, 0.4));
  head.position.y = 3.2;
  group.add(pole, head);
  return group;
}

/**
 * A wind turbine, at the size they are actually built.
 *
 * Eighty metres to the hub and a forty metre blade. This is the one that shows
 * what placing a model from a layer is for: a wind farm is a point layer with a
 * bearing column, and this is what that column means.
 */
function turbine(): Group {
  const group = new Group();
  const tower = new Mesh(new CylinderGeometry(1.6, 2.6, 80, 20), paint(WHITE));
  tower.position.y = 40;
  const nacelle = new Mesh(new BoxGeometry(3, 3, 9), paint(WHITE));
  nacelle.position.set(0, 80.5, 0);
  group.add(tower, nacelle);

  const hub = new Mesh(new SphereGeometry(1.6, 16, 12), paint(WHITE));
  hub.position.set(0, 80.5, -5);
  group.add(hub);

  // Three blades on the hub, in the plane facing the model's own -z, which is
  // the direction a heading of zero points the rotor.
  for (let i = 0; i < 3; i++) {
    const blade = new Mesh(new BoxGeometry(1.4, 40, 0.5), paint(WHITE));
    const angle = (i * 2 * Math.PI) / 3;
    blade.position.set(Math.sin(angle) * 20, 80.5 + Math.cos(angle) * 20, -5.5);
    blade.rotation.z = -angle;
    group.add(blade);
  }
  return group;
}

/** A lattice communications mast: forty metres, four legs, a bracing pattern. */
function mast(): Group {
  const group = new Group();
  const height = 40;
  const spread = 1.6;
  for (const [x, z] of [
    [spread, spread],
    [-spread, spread],
    [spread, -spread],
    [-spread, -spread],
  ]) {
    const leg = new Mesh(new CylinderGeometry(0.12, 0.18, height, 8), paint(GREY));
    leg.position.set(x! / 2, height / 2, z! / 2);
    // Legs lean in towards the top, which is what makes it read as a mast
    // rather than as four posts.
    leg.rotation.z = (-x! / height) * 0.6;
    leg.rotation.x = (z! / height) * 0.6;
    group.add(leg);
  }
  for (let y = 4; y < height; y += 4) {
    const band = new Mesh(new BoxGeometry(spread * 2 * (1 - y / height / 2), 0.15, 0.15), paint(GREY));
    band.position.y = y;
    group.add(band);
    const cross = band.clone();
    cross.rotation.y = Math.PI / 2;
    group.add(cross);
  }
  const dish = new Mesh(new CylinderGeometry(1.2, 1.2, 0.25, 20), paint(WHITE, 0.4));
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, height - 4, 1.4);
  group.add(dish);
  return group;
}

/** A traffic cone. Small, and the one that shows whether your scale is right. */
function cone(): Group {
  const group = new Group();
  const body = new Mesh(new CylinderGeometry(0.04, 0.22, 0.7, 16), paint(ORANGE, 0.6));
  body.position.y = 0.35;
  const base = new Mesh(new BoxGeometry(0.36, 0.04, 0.36), paint(DARK));
  base.position.y = 0.02;
  const band = new Mesh(new CylinderGeometry(0.13, 0.16, 0.12, 16), paint(WHITE, 0.5));
  band.position.y = 0.44;
  group.add(body, base, band);
  return group;
}

/**
 * A massing block: ten by ten by twenty.
 *
 * For a proposal that has a footprint and a height and no design yet, which is
 * most of them. It is what a shadow study needs and what a render does not.
 */
function block(): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(10, 20, 10), paint(0xc8ccd2));
  body.position.y = 10;
  const roof = new Mesh(new BoxGeometry(10.4, 0.4, 10.4), paint(DARK));
  roof.position.y = 20.2;
  group.add(body, roof);
  return group;
}

/** A street tree, eight metres, for the shadow it throws. */
function tree(): Group {
  const group = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.18, 0.3, 3, 10), paint(0x6b5544));
  trunk.position.y = 1.5;
  const crown = new Mesh(new SphereGeometry(2.4, 16, 12), paint(GREEN, 0.9));
  crown.position.y = 5.4;
  crown.scale.set(1, 1.1, 1);
  group.add(trunk, crown);
  return group;
}

/**
 * An airliner, nose along the model's own -z.
 *
 * -z is north in the scene's frame, so a heading of zero points it up the map
 * and a track that turns it to face the way it is going turns it correctly.
 * A file that was authored facing some other way is what the heading offset on
 * a track is for; nothing built here needs one.
 *
 * Thirty-eight metres, which is a narrow-body. At cruise it is a speck, which
 * is what the on-screen size floor is for: a plane you have to zoom to street
 * level to see is not a plane on a map.
 */
function aircraft(): Group {
  const group = new Group();
  const skin = paint(WHITE, 0.35);

  const fuselage = new Mesh(new CylinderGeometry(1.9, 1.9, 34, 20), skin);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 4;
  const nose = new Mesh(new SphereGeometry(1.9, 18, 12), skin);
  nose.position.set(0, 4, -17);
  const tailCone = new Mesh(new CylinderGeometry(0.4, 1.9, 5, 16), skin);
  tailCone.rotation.x = -Math.PI / 2;
  tailCone.position.set(0, 4.6, 19);
  group.add(fuselage, nose, tailCone);

  const wing = new Mesh(new BoxGeometry(34, 0.55, 5.5), skin);
  wing.position.set(0, 3.2, 1);
  const stabiliser = new Mesh(new BoxGeometry(12, 0.4, 2.6), skin);
  stabiliser.position.set(0, 5.4, 18);
  const fin = new Mesh(new BoxGeometry(0.5, 5.5, 4), paint(0x2f6fd0, 0.4));
  fin.position.set(0, 8, 18.5);
  group.add(wing, stabiliser, fin);

  for (const x of [-7, 7]) {
    const engine = new Mesh(new CylinderGeometry(1.5, 1.4, 4.4, 16), paint(GREY, 0.4));
    engine.rotation.x = Math.PI / 2;
    engine.position.set(x, 2.2, 0);
    group.add(engine);
  }
  return group;
}

/** A car, nose along -z. Four and a half metres, which is the width of a lane. */
function car(): Group {
  const group = new Group();
  const shell = paint(0xc2402f, 0.35);
  const body = new Mesh(new BoxGeometry(1.8, 0.75, 4.4), shell);
  body.position.y = 0.75;
  const cabin = new Mesh(new BoxGeometry(1.65, 0.6, 2.1), paint(0x2b3038, 0.2));
  cabin.position.set(0, 1.4, 0.15);
  group.add(body, cabin);
  for (const [x, z] of [
    [0.9, -1.4],
    [-0.9, -1.4],
    [0.9, 1.4],
    [-0.9, 1.4],
  ]) {
    const wheel = new Mesh(new CylinderGeometry(0.34, 0.34, 0.22, 14), paint(0x1d2126));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x!, 0.34, z!);
    group.add(wheel);
  }
  return group;
}

const BUILT: Record<string, () => Group> = {
  aircraft,
  car,
  marker: marker,
  turbine: turbine,
  mast: mast,
  cone: cone,
  block: block,
  tree: tree,
};

/** What each built-in is, for the catalogue to describe without loading it. */
export const BUILTIN_HEIGHTS: Record<string, number> = {
  aircraft: 10.75,
  car: 1.7,
  marker: 3.55,
  turbine: 120.5,
  mast: 40,
  cone: 0.7,
  block: 20.4,
  tree: 8.04,
};

/**
 * Build one, or nothing if the name is not known.
 *
 * A fresh object each time rather than a shared one: the host clones a loaded
 * template per placement, and handing it the same instance twice would put one
 * mesh in two places, which three.js resolves by drawing it in the second.
 */
export function buildBuiltin(url: string): Group | null {
  const name = url.slice(BUILTIN_PREFIX.length);
  const make = BUILT[name];
  return make ? make() : null;
}
