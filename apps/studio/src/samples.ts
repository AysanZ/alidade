export interface Sample {
  name: string;
  group: string;
  url: string;
  about: string;
}

const NE = "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0";

/**
 * Open datasets, importable with one click.
 *
 * The catalogue lists what is already in your database, which on a fresh install
 * is one demo layer. This is the other half of that question: something to look
 * at while you work out what the tool does. Everything here is public domain or
 * open licensed and needs no key, which is the same rule the basemaps follow — a
 * sample list that stops working when a trial ends is worse than no sample list.
 *
 * They are imported through the ordinary from-url route, so they land in PostGIS
 * and come back as vector tiles like anything else. Nothing here is special-cased.
 */
export const SAMPLES: Sample[] = [
  {
    name: "Countries",
    group: "Boundaries",
    url: `${NE}/ne_50m_admin_0_countries.geojson`,
    about: "Every sovereign state, with population and economy fields",
  },
  {
    name: "Countries, coarse",
    group: "Boundaries",
    url: `${NE}/ne_110m_admin_0_countries.geojson`,
    about: "The same at 1:110m, quick to load and fine above zoom 4",
  },
  {
    name: "States and provinces",
    group: "Boundaries",
    url: `${NE}/ne_50m_admin_1_states_provinces.geojson`,
    about: "First-order divisions worldwide",
  },
  {
    name: "Disputed areas",
    group: "Boundaries",
    url: `${NE}/ne_50m_admin_0_disputed_areas.geojson`,
    about: "Where the boundaries are not agreed",
  },

  {
    name: "Populated places",
    group: "Places",
    url: `${NE}/ne_50m_populated_places_simple.geojson`,
    about: "Cities and towns with population figures — good for markers",
  },
  {
    name: "Airports",
    group: "Places",
    url: `${NE}/ne_10m_airports.geojson`,
    about: "Major airports worldwide",
  },
  {
    name: "Ports",
    group: "Places",
    url: `${NE}/ne_10m_ports.geojson`,
    about: "Harbours and shipping ports",
  },

  {
    name: "Rivers and lakes",
    group: "Physical",
    url: `${NE}/ne_50m_rivers_lake_centerlines.geojson`,
    about: "Major river centrelines",
  },
  {
    name: "Lakes",
    group: "Physical",
    url: `${NE}/ne_50m_lakes.geojson`,
    about: "Lakes and reservoirs",
  },
  {
    name: "Coastline",
    group: "Physical",
    url: `${NE}/ne_50m_coastline.geojson`,
    about: "The line where land meets sea",
  },
  {
    name: "Land",
    group: "Physical",
    url: `${NE}/ne_50m_land.geojson`,
    about: "Land polygons, useful as a backdrop under your own data",
  },
  {
    name: "Glaciated areas",
    group: "Physical",
    url: `${NE}/ne_50m_glaciated_areas.geojson`,
    about: "Permanent ice",
  },

  {
    name: "Roads",
    group: "Transport",
    url: `${NE}/ne_10m_roads.geojson`,
    about: "Major roads, mostly North America and Europe",
  },
  {
    name: "Railroads",
    group: "Transport",
    url: `${NE}/ne_10m_railroads.geojson`,
    about: "Main rail lines",
  },

  {
    name: "Time zones",
    group: "Reference",
    url: `${NE}/ne_10m_time_zones.geojson`,
    about: "Zone polygons with UTC offsets — good for a categorized map",
  },
  {
    name: "Graticules, 10°",
    group: "Reference",
    url: `${NE}/ne_50m_graticules_10.geojson`,
    about: "Meridians and parallels as real features you can style",
  },
];

export const SAMPLE_GROUPS = [...new Set(SAMPLES.map((s) => s.group))];
