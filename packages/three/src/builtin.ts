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

/**
 * Turn a body that was modelled nose-first along −z to face +z.
 *
 * glTF puts a model's front on +z, and `yawOf` in the core is written to that
 * convention: a heading of zero turns the mesh's +z to north. Every body in
 * this file was drawn the other way round — nose at −z, which is what you get
 * if you sketch a side elevation with the nose on the left — so every one of
 * them flew, drove and sailed backwards. It was invisible on a circuit, where
 * a shape going round a ring reads as going round a ring whichever end leads,
 * and unmissable the moment an aeroplane was pointed at a runway.
 *
 * They are turned once, here, rather than by renumbering every coordinate.
 * Renumbering means negating a z on every part and then negating the rotations
 * that go with them — six models, forty parts, and one sign wrong is a wing
 * mounted backwards that nobody notices for a month. This is one rotation with
 * one test on it.
 *
 * The turn is a half turn about the vertical, which also negates x. Every body
 * here is symmetric about its own centreline, so that is free.
 */
function facingForward(built: Group): Group {
  const outer = new Group();
  built.rotation.y = Math.PI;
  outer.add(built);
  return outer;
}

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
/**
 * A narrowbody airliner, about the size of an A320.
 *
 * The first one was a tube with a plank through it, and it read as a tube with
 * a plank through it. What makes an aeroplane recognisable from above at map
 * zoom, in order: the sweep of the wing, the wing being further back than the
 * middle, the two engines slung under and ahead of it, and the fin. The
 * fuselage is the least of it — nobody identifies an aircraft by its tube.
 *
 * So the wings are swept, tapered and given winglets, the engines hang on
 * pylons ahead of the leading edge where they actually are, and the tailplane
 * is swept too. Thirty-seven metres long, thirty-five across, which is an A320
 * to within a metre.
 *
 * Everything is still primitives. A swept wing is a box turned about the
 * vertical and squeezed along its span; a taper is a second, smaller box
 * further out. At the size an aircraft is drawn on a map, an aerofoil section
 * is geometry spent on something no camera will ever resolve.
 */
function aircraft(): Group {
  const group = new Group();
  const skin = paint(WHITE, 0.35);
  const trim = paint(0x2f6fd0, 0.4);
  const metal = paint(GREY, 0.35);

  /* Fuselage: a tube, a rounded nose, and a tail that lifts as it tapers. */
  const fuselage = new Mesh(new CylinderGeometry(1.85, 1.85, 27, 22), skin);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.set(0, 3.9, -1.5);
  const nose = new Mesh(new SphereGeometry(1.85, 20, 14), skin);
  nose.scale.set(1, 0.95, 1.5);
  nose.position.set(0, 3.85, -15);
  const tailCone = new Mesh(new CylinderGeometry(0.45, 1.85, 8.5, 20), skin);
  tailCone.rotation.x = -Math.PI / 2 - 0.09;
  tailCone.position.set(0, 4.35, 16.2);
  group.add(fuselage, nose, tailCone);

  /*
   * Flight deck windows and a cabin band. Two thin dark boxes, and the only
   * reason they are here: without something breaking the white, a fuselage at
   * a distance is a chalk mark rather than an aircraft.
   */
  const windscreen = new Mesh(new BoxGeometry(2.1, 0.7, 1.5), paint(0x22262c, 0.15));
  windscreen.position.set(0, 4.55, -13.2);
  const band = new Mesh(new BoxGeometry(3.75, 0.42, 21), paint(0x39404a, 0.3));
  band.position.set(0, 4.5, -2);
  group.add(windscreen, band);

  /* Wings: swept back, tapered, with winglets. Root at the belly, aft of centre. */
  for (const side of [-1, 1]) {
    const inner = new Mesh(new BoxGeometry(9, 0.42, 6.2), skin);
    inner.position.set(side * 5.4, 2.9, 3.4);
    inner.rotation.y = side * -0.42;
    const outer = new Mesh(new BoxGeometry(8.6, 0.34, 3.4), skin);
    outer.position.set(side * 13.4, 3.15, 7.1);
    outer.rotation.y = side * -0.42;
    const winglet = new Mesh(new BoxGeometry(0.3, 2.4, 1.7), trim);
    winglet.position.set(side * 17.4, 4.2, 8.6);
    winglet.rotation.y = side * -0.42;
    group.add(inner, outer, winglet);

    /* Engine on a pylon, ahead of and below the leading edge, as it hangs. */
    const pylon = new Mesh(new BoxGeometry(0.5, 1.5, 2.6), skin);
    pylon.position.set(side * 6.2, 2.2, 1.1);
    const nacelle = new Mesh(new CylinderGeometry(1.35, 1.2, 4.6, 18), metal);
    nacelle.rotation.x = Math.PI / 2;
    // Clear of the ground by a few centimetres, which is about the clearance a
    // narrowbody actually has and is what keeps the size test honest.
    nacelle.position.set(side * 6.2, 1.42, 0.4);
    const intake = new Mesh(new CylinderGeometry(1.38, 1.38, 0.35, 18), paint(0x22262c, 0.2));
    intake.rotation.x = Math.PI / 2;
    intake.position.set(side * 6.2, 1.42, -1.85);
    group.add(pylon, nacelle, intake);

    /* Main gear, down. An aircraft on approach has its wheels out. */
    const leg = new Mesh(new CylinderGeometry(0.13, 0.13, 2.2, 8), metal);
    leg.position.set(side * 3.7, 1.1, 3);
    const wheel = new Mesh(new CylinderGeometry(0.55, 0.55, 0.35, 14), paint(0x1d2126));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 3.7, 0.55, 3);
    group.add(leg, wheel);

    /* Tailplane, swept like the wing and a good deal smaller. */
    const stabiliser = new Mesh(new BoxGeometry(6.2, 0.3, 2.5), skin);
    stabiliser.position.set(side * 3.4, 5.6, 16.6);
    stabiliser.rotation.y = side * -0.38;
    group.add(stabiliser);
  }

  /* Nose gear, and the fin. */
  const noseLeg = new Mesh(new CylinderGeometry(0.11, 0.11, 2.4, 8), metal);
  noseLeg.position.set(0, 1.2, -11.5);
  const noseWheel = new Mesh(new CylinderGeometry(0.42, 0.42, 0.3, 14), paint(0x1d2126));
  noseWheel.rotation.z = Math.PI / 2;
  noseWheel.position.set(0, 0.42, -11.5);
  const fin = new Mesh(new BoxGeometry(0.42, 6.4, 5.2), trim);
  fin.position.set(0, 8, 16.4);
  // Swept: the fin leans back from its root, which is most of its silhouette.
  fin.rotation.x = -0.34;
  group.add(noseLeg, noseWheel, fin);

  return facingForward(group);
}

/** A car, nose along -z. Four and a half metres, which is the width of a lane. */
function car(): Group {
  const group = new Group();
  const shell = paint(0xc2402f, 0.35);
  const body = new Mesh(new BoxGeometry(1.8, 0.75, 4.4), shell);
  body.position.y = 0.75;
  const cabin = new Mesh(new BoxGeometry(1.65, 0.6, 2.1), paint(0x2b3038, 0.2));
  // Behind the middle, which is where a cabin sits and which is what gives the
  // car a front at all. It was ahead of it, and a car with the cabin forward of
  // centre reads as a car going the other way.
  cabin.position.set(0, 1.4, -0.35);
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

/**
 * A delivery van. The shape most of a city fleet actually is.
 *
 * Five and a half metres, box body, flat front. Told apart from the car at a
 * hundred metres by height and by the fact that its roof runs the whole length,
 * which is the only distinction that survives at map zoom.
 */
function van(): Group {
  const group = new Group();
  const shell = paint(0xe8e6df, 0.45);
  const body = new Mesh(new BoxGeometry(2.1, 1.75, 4.2), shell);
  body.position.set(0, 1.5, 0.5);
  const bonnet = new Mesh(new BoxGeometry(2.05, 0.95, 1.4), shell);
  bonnet.position.set(0, 1.1, -2);
  const screen = new Mesh(new BoxGeometry(1.95, 0.85, 0.2), paint(0x2b3038, 0.2));
  screen.position.set(0, 1.85, -1.35);
  group.add(body, bonnet, screen);
  for (const [x, z] of [
    [1, -1.7],
    [-1, -1.7],
    [1, 1.7],
    [-1, 1.7],
  ]) {
    const wheel = new Mesh(new CylinderGeometry(0.38, 0.38, 0.24, 14), paint(0x1d2126));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x!, 0.38, z!);
    group.add(wheel);
  }
  return facingForward(group);
}

/**
 * An articulated lorry: a cab and a trailer, drawn as one rigid thing.
 *
 * The trailer does not hinge. A real one does, and following the hinge means
 * knowing where the cab was a moment ago as well as where it is — a second
 * history, for an articulation nobody can see from above at map zoom.
 */
function truck(): Group {
  const group = new Group();
  const cab = new Mesh(new BoxGeometry(2.5, 2.9, 5.5), paint(0x2f6fd0, 0.4));
  cab.position.set(0, 1.9, -5.5);
  const trailer = new Mesh(new BoxGeometry(2.55, 3.1, 13), paint(0xe8e6df, 0.55));
  trailer.position.set(0, 2.6, 3);
  group.add(cab, trailer);
  for (const [x, z] of [
    [1.2, -7.4],
    [-1.2, -7.4],
    [1.2, -3.9],
    [-1.2, -3.9],
    [1.2, 7],
    [-1.2, 7],
    [1.2, 5.4],
    [-1.2, 5.4],
  ]) {
    const wheel = new Mesh(new CylinderGeometry(0.52, 0.52, 0.36, 14), paint(0x1d2126));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x!, 0.52, z!);
    group.add(wheel);
  }
  return facingForward(group);
}

/**
 * A small vessel. For a feed of harbour traffic or a river patrol.
 *
 * The hull is a box with a raked bow rather than a curve: at the zoom a vessel
 * is looked at on a map, the thing that reads is the long axis and the wake it
 * is pointing along, and a hull form costs geometry to say something nobody can
 * see.
 */
function boat(): Group {
  const group = new Group();
  const hull = new Mesh(new BoxGeometry(3.4, 1.5, 11), paint(WHITE, 0.4));
  hull.position.y = 0.75;
  const bow = new Mesh(new CylinderGeometry(0.1, 1.7, 3.4, 4), paint(WHITE, 0.4));
  /*
   * Laid along -Z and then squashed, so the taper is in plan and not in
   * section. A cone of radius 1.7 lying on its side is 3.4 metres tall, which
   * put the bow a metre under the waterline and the vessel's stated height a
   * metre out — the size test caught it before anything was ever drawn.
   */
  bow.rotation.x = -Math.PI / 2;
  bow.scale.set(1, 1, 0.42);
  bow.position.set(0, 0.75, -6.4);
  const house = new Mesh(new BoxGeometry(2.6, 1.9, 3.6), paint(0xdfe3e8, 0.5));
  house.position.set(0, 2.45, -1);
  const mast = new Mesh(new CylinderGeometry(0.07, 0.07, 2, 8), paint(GREY));
  mast.position.set(0, 4.4, -1);
  group.add(hull, bow, house, mast);
  return facingForward(group);
}

/**
 * A quadcopter, at the size a survey drone actually is.
 *
 * Under a metre across, which makes it the one built-in that is genuinely too
 * small to see at map zoom without `minPixels` doing its job — which is a
 * useful thing to have in the catalogue, because that is the setting people do
 * not believe they need until something is invisible.
 */
function drone(): Group {
  const group = new Group();
  const shell = paint(DARK, 0.4);
  const body = new Mesh(new BoxGeometry(0.28, 0.12, 0.4), shell);
  body.position.y = 0.12;
  group.add(body);
  for (const [x, z] of [
    [0.34, -0.34],
    [-0.34, -0.34],
    [0.34, 0.34],
    [-0.34, 0.34],
  ]) {
    const arm = new Mesh(new BoxGeometry(0.05, 0.04, 0.05), shell);
    arm.position.set(x! / 2, 0.12, z! / 2);
    arm.scale.set(Math.abs(x!) * 14, 1, Math.abs(z!) * 14);
    const rotor = new Mesh(new CylinderGeometry(0.16, 0.16, 0.012, 16), paint(GREY, 0.3));
    rotor.position.set(x!, 0.2, z!);
    group.add(arm, rotor);
  }
  // Clear of the ground: a camera pod hanging through the tarmac is what the
  // "stands on the ground rather than through it" test is there to catch.
  const camera = new Mesh(new SphereGeometry(0.06, 12, 8), paint(0x1d2126, 0.2));
  camera.position.set(0, 0.075, 0.1);
  group.add(camera);
  return group;
}

/**
 * A bird, wings out, for a tracked-animal feed.
 *
 * A metre and a half across, which is a large gull or a small raptor. The wings
 * are flat plates swept back rather than aerofoils: what a moving dot on a map
 * needs is a silhouette with an obvious front, and this is the smallest amount
 * of geometry that has one.
 */
function bird(): Group {
  const group = new Group();
  const feather = paint(0x6b7078, 0.85);
  const body = new Mesh(new SphereGeometry(0.11, 14, 10), feather);
  body.position.y = 0.2;
  body.scale.set(1, 0.9, 3.1);
  const head = new Mesh(new SphereGeometry(0.075, 12, 9), paint(0xe8e6df, 0.8));
  head.position.set(0, 0.24, -0.36);
  const beak = new Mesh(new CylinderGeometry(0.005, 0.03, 0.12, 6), paint(ORANGE, 0.5));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.23, -0.48);
  group.add(body, head, beak);
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(0.62, 0.02, 0.22), feather);
    wing.position.set(side * 0.36, 0.22, 0.02);
    // Swept back and lifted, which is what reads as a bird rather than a plank.
    wing.rotation.set(0, side * 0.28, side * -0.16);
    group.add(wing);
  }
  const tail = new Mesh(new BoxGeometry(0.16, 0.02, 0.26), feather);
  tail.position.set(0, 0.21, 0.4);
  group.add(tail);
  return facingForward(group);
}

const BUILT: Record<string, () => Group> = {
  aircraft,
  car,
  van,
  truck,
  boat,
  drone,
  bird,
  marker: marker,
  turbine: turbine,
  mast: mast,
  cone: cone,
  block: block,
  tree: tree,
};

/** What each built-in is, for the catalogue to describe without loading it. */
export const BUILTIN_HEIGHTS: Record<string, number> = {
  aircraft: 11.88,
  car: 1.7,
  van: 2.38,
  truck: 4.15,
  boat: 5.4,
  drone: 0.21,
  bird: 0.32,
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
