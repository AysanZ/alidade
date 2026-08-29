"""Parsing a real-shaped capabilities document. No network, no database."""

from app.capabilities import parse

WMS_130 = """<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Alidade demo server</Title></Service>
  <Capability>
    <Request>
      <GetMap>
        <Format>image/png</Format>
        <Format>image/jpeg</Format>
      </GetMap>
    </Request>
    <Layer>
      <Title>Alidade</Title>
      <CRS>EPSG:4326</CRS>
      <CRS>EPSG:3857</CRS>
      <Layer queryable="1">
        <Name>alidade:landcover</Name>
        <Title>Land cover 2023</Title>
        <Abstract>Corine classes</Abstract>
        <CRS>EPSG:32639</CRS>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>51.2</westBoundLongitude>
          <eastBoundLongitude>51.6</eastBoundLongitude>
          <southBoundLatitude>35.6</southBoundLatitude>
          <northBoundLatitude>35.83</northBoundLatitude>
        </EX_GeographicBoundingBox>
        <Style><Name>default</Name></Style>
        <Style><Name>raster</Name></Style>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>
"""

WMS_111 = """<?xml version="1.0"?>
<WMT_MS_Capabilities version="1.1.1">
  <Service><Title>Old server</Title></Service>
  <Capability>
    <Request><GetMap><Format>image/png</Format></GetMap></Request>
    <Layer>
      <Title>Root</Title>
      <SRS>EPSG:4326</SRS>
      <Layer>
        <Name>rivers</Name>
        <Title>Rivers</Title>
        <LatLonBoundingBox minx="44" miny="25" maxx="64" maxy="40"/>
      </Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>
"""


def test_the_service_describes_itself():
    described = parse(WMS_130)
    assert described["title"] == "Alidade demo server"
    assert described["version"] == "1.3.0"
    assert described["formats"] == ["image/png", "image/jpeg"]


def test_only_named_layers_can_be_requested():
    # The outer grouping layer has a title but no name, so it is not offered.
    names = [layer["name"] for layer in parse(WMS_130)["layers"]]
    assert names == ["alidade:landcover"]


def test_a_child_inherits_the_projections_of_its_parent():
    layer = parse(WMS_130)["layers"][0]
    assert layer["crs"] == ["EPSG:4326", "EPSG:3857", "EPSG:32639"]


def test_styles_and_queryability_come_through():
    layer = parse(WMS_130)["layers"][0]
    assert layer["styles"] == ["default", "raster"]
    assert layer["queryable"] is True
    assert layer["bbox"] == [51.2, 35.6, 51.6, 35.83]


def test_the_older_version_spells_everything_differently():
    described = parse(WMS_111)
    assert described["version"] == "1.1.1"
    layer = described["layers"][0]
    assert layer["crs"] == ["EPSG:4326"]
    assert layer["bbox"] == [44.0, 25.0, 64.0, 40.0]
    assert layer["queryable"] is False
