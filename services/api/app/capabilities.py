"""Parse a WMS GetCapabilities document into something a picker can show.

The point is that the user chooses a real layer, style, format and CRS that the
server actually advertises, rather than typing a name and hoping.
"""

from xml.etree import ElementTree

NS = {"wms": "http://www.opengis.net/wms"}


def _tag(element: ElementTree.Element) -> str:
    return element.tag.split("}")[-1]


def _find(parent: ElementTree.Element, name: str) -> ElementTree.Element | None:
    for child in parent:
        if _tag(child) == name:
            return child
    return None


def _text(parent: ElementTree.Element, name: str, default: str = "") -> str:
    found = _find(parent, name)
    return (found.text or default).strip() if found is not None else default


def _children(parent: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [c for c in parent if _tag(c) == name]


def parse(xml: str) -> dict:
    root = ElementTree.fromstring(xml)
    version = root.get("version", "1.3.0")

    service = _find(root, "Service")
    capability = _find(root, "Capability")
    title = _text(service, "Title") if service is not None else "WMS"

    formats: list[str] = []
    layers: list[dict] = []
    if capability is not None:
        request = _find(capability, "Request")
        get_map = _find(request, "GetMap") if request is not None else None
        if get_map is not None:
            formats = [(f.text or "").strip() for f in _children(get_map, "Format")]
        for root_layer in _children(capability, "Layer"):
            _collect(root_layer, layers, version, inherited_crs=[])

    return {"title": title, "version": version, "formats": formats, "layers": layers}


def _collect(
    element: ElementTree.Element, out: list[dict], version: str, inherited_crs: list[str]
) -> None:
    crs_tag = "CRS" if version == "1.3.0" else "SRS"
    crs = inherited_crs + [(c.text or "").strip() for c in _children(element, crs_tag)]

    name = _text(element, "Name")
    if name:
        out.append(
            {
                "name": name,
                "title": _text(element, "Title", name),
                "abstract": _text(element, "Abstract"),
                "queryable": element.get("queryable") == "1",
                "crs": list(dict.fromkeys(crs)),
                "styles": [_text(s, "Name") for s in _children(element, "Style")],
                "bbox": _bbox(element, version),
            }
        )

    # A WMS layer tree nests, and only the leaves carry a usable name.
    for child in _children(element, "Layer"):
        _collect(child, out, version, crs)


def _bbox(element: ElementTree.Element, version: str) -> list[float] | None:
    if version == "1.3.0":
        box = _find(element, "EX_GeographicBoundingBox")
        if box is None:
            return None
        try:
            return [
                float(_text(box, "westBoundLongitude")),
                float(_text(box, "southBoundLatitude")),
                float(_text(box, "eastBoundLongitude")),
                float(_text(box, "northBoundLatitude")),
            ]
        except ValueError:
            return None

    box = _find(element, "LatLonBoundingBox")
    if box is None:
        return None
    try:
        return [
            float(box.get("minx", "")),
            float(box.get("miny", "")),
            float(box.get("maxx", "")),
            float(box.get("maxy", "")),
        ]
    except ValueError:
        return None
