"""The application has to import and expose what the studio calls.

Importing app.main is what catches a module that only fails at start up, which is
exactly the kind of break that looks like a networking problem from the browser.
"""

from app.main import app


def flatten(routes) -> list:
    """
    Recent FastAPI wraps an included router in an object that keeps the real routes
    on `original_router`, so the route list is a tree rather than a flat list.
    """
    out = []
    for route in routes:
        included = getattr(route, "original_router", None)
        if included is not None:
            out.extend(flatten(included.routes))
        elif hasattr(route, "routes"):
            out.extend(flatten(route.routes))
        elif hasattr(route, "path"):
            out.append(route)
    return out


def routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in flatten(app.routes)
        for method in getattr(route, "methods", set())
    }


def test_the_endpoints_the_studio_calls_all_exist():
    expected = [
        ("/api/health", "GET"),
        ("/api/layers", "GET"),
        ("/api/layers/upload", "POST"),
        ("/api/layers/from-url", "POST"),
        ("/api/layers/{layer_id}", "GET"),
        ("/api/layers/{layer_id}/features", "GET"),
        ("/api/services/wms/capabilities", "GET"),
        ("/api/tiles/{layer_id}/{z}/{x}/{y}.mvt", "GET"),
        ("/api/models", "POST"),
        ("/api/models", "GET"),
        ("/api/models/{stored}", "GET"),
    ]
    missing = [pair for pair in expected if pair not in routes()]
    assert missing == []


def test_fixed_paths_are_declared_before_the_wildcard():
    paths = [r.path for r in flatten(app.routes) if r.path.startswith("/api/layers")]
    assert paths.index("/api/layers/from-url") < paths.index("/api/layers/{layer_id}")
    assert paths.index("/api/layers/upload") < paths.index("/api/layers/{layer_id}")
    # /{layer_id}/features is longer, but a bare /{layer_id} above it would still win.
    assert paths.index("/api/layers/{layer_id}/features") < paths.index("/api/layers/{layer_id}")
