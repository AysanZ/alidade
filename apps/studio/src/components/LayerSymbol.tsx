import type { LayerNode, TreeNode } from "@alidade/core";

/**
 * What the layer actually looks like, at 20 by 16.
 *
 * A flat colour chip is a lie about most layers. A choropleth is five colours, a
 * road network is a stroke of a particular width, an airport layer is a glyph,
 * and a boundary is an outline with nothing inside it — a single square of the
 * "representative colour" says the same thing about all four. Drawing the real
 * symbology means the table of contents can be read at a glance, which is the
 * only thing a table of contents is for.
 */

const W = 20;
const H = 16;

export function LayerSymbol({ node }: { node: TreeNode }) {
  if (node.type === "group") return <Folder />;

  return (
    <svg
      className="sym"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      // The layer's own transparency, so a 20% layer does not look solid here.
      style={{ opacity: Math.max(0.25, node.opacity) }}
    >
      <Body node={node} />
      {node.marker && <Glyph glyph={node.marker.glyph} />}
    </svg>
  );
}

function Body({ node }: { node: LayerNode }) {
  const s = node.symbology;
  const id = `sym_${node.id.replace(/[^a-z0-9]/gi, "")}`;

  if (node.geometry === "raster") {
    // Four tiles, because that is what a raster is and nothing else looks like it.
    return (
      <g>
        {[
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y], i) => (
          <rect
            key={i}
            x={(x as number) * (W / 2)}
            y={(y as number) * (H / 2)}
            width={W / 2}
            height={H / 2}
            fill={i % 2 === 0 ? "#3c4654" : "#2a323c"}
          />
        ))}
      </g>
    );
  }

  /* A classification is a run of colours, so it is drawn as one. */
  const ramp =
    s.kind === "graduated"
      ? s.colors
      : s.kind === "categorized"
        ? s.categories.slice(0, 6).map((c) => c.color)
        : null;

  const stroke = "stroke" in s ? s.stroke : undefined;
  const flat = "color" in s ? s.color : "#4c8dff";

  if (node.geometry === "point") {
    return (
      <g>
        {ramp ? (
          ramp.slice(0, 3).map((color, i) => (
            <circle key={i} cx={5 + i * 5} cy={H / 2} r={2.6} fill={color} />
          ))
        ) : (
          <circle
            cx={W / 2}
            cy={H / 2}
            r={4}
            fill={flat}
            stroke={stroke?.color}
            strokeWidth={stroke ? Math.min(1.5, stroke.width) : 0}
          />
        )}
      </g>
    );
  }

  if (node.geometry === "line") {
    // Drawn with a kink, so the width and the dash pattern are both legible.
    return (
      <g>
        {ramp && (
          <defs>
            <linearGradient id={id} x1="0" x2="1">
              {ramp.map((color, i) => (
                <stop key={i} offset={`${(i / Math.max(1, ramp.length - 1)) * 100}%`} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
        )}
        <path
          d={`M1 ${H - 3} L7 4 L13 ${H - 4} L19 3`}
          fill="none"
          stroke={ramp ? `url(#${id})` : flat}
          strokeWidth={Math.max(1.2, Math.min(3, stroke?.width ?? 1.8))}
          strokeDasharray={stroke?.dash?.join(" ")}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }

  /* An area: a filled box with its own outline. */
  return (
    <g>
      {ramp && (
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            {ramp.map((color, i) => (
              <stop
                key={i}
                // Hard stops, not a blend: a classification is bands, not a fade.
                offset={`${(i / ramp.length) * 100}%`}
                stopColor={color}
              />
            ))}
            {ramp.map((color, i) => (
              <stop key={`e${i}`} offset={`${((i + 1) / ramp.length) * 100}%`} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      )}
      <rect
        x={0.75}
        y={0.75}
        width={W - 1.5}
        height={H - 1.5}
        rx={2}
        fill={ramp ? `url(#${id})` : flat}
        stroke={stroke?.color ?? "rgba(255,255,255,0.12)"}
        strokeWidth={stroke ? Math.max(0.8, Math.min(2, stroke.width)) : 1}
      />
    </g>
  );
}

/** A marker sits over the symbology rather than replacing it, and shows that. */
function Glyph({ glyph }: { glyph: string }) {
  return (
    <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="11">
      {glyph}
    </text>
  );
}

function Folder() {
  return (
    <svg className="sym folder" viewBox="0 0 20 16" width={W} height={H} aria-hidden="true">
      <path
        d="M1.5 4.2h5.2l1.6 2h10.2v7.3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
