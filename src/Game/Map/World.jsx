import React, { useState, useEffect } from "react";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import Nations from "./Nations";
import Cities from "./Cities";

function App() {
  const [projection, setProjection] = useState(() => {
    const savedGlobe = localStorage.getItem("Globe");
    return savedGlobe === "true" ? "globe" : "mercator";
  });
  const [terrainEnabled, setTerrainEnabled] = useState(() => {
    const savedTerrain = localStorage.getItem("Terrain");
    return savedTerrain === "true";
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const savedGlobe = localStorage.getItem("Globe");
      setProjection(savedGlobe === "true" ? "globe" : "mercator");

      const savedTerrain = localStorage.getItem("Terrain");
      setTerrainEnabled(savedTerrain === "true");
    };

    window.addEventListener("storage", handleStorageChange);

    const interval = setInterval(handleStorageChange, 500);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw", backgroundColor: "#000" }}>
      <Map
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3.5,
        }}
        minZoom={2.25}
        maxZoom={16}
        doubleClickZoom={false}

        maxBounds={[
          [-Infinity, -80],
          [Infinity, 85],
        ]}

        cursor="default"
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        dragPan={true}

        reuseMaps
        fadeDuration={0}
        collectResourceTiming={false}

        projection={projection}
        terrain={
          terrainEnabled
          ? {
            source: "terrain-source",
            exaggeration: 30,
          }
          : null
        }

        mapStyle={{
          version: 8,
          sources: {
            satellite: {
              type: "raster",
              tiles: [
                "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              ],
              tileSize: 256,
            },
            "terrain-source": {
              type: "raster-dem",
              tiles: [
                "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
              ],
              encoding: "terrarium",
              tileSize: 256,
              maxzoom: 5,
            },
            "hillshade-source": {
              type: "raster-dem",
              tiles: [
                "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
              ],
              encoding: "terrarium",
              tileSize: 256,
              maxzoom: 5,
            },
          },

          layers: [
            {
              id: "satellite-layer",
              type: "raster",
              source: "satellite",
            },
            {
              id: "hills",
              type: "hillshade",
              source: "hillshade-source",
              paint: {
                "hillshade-shadow-color": "#000",
                "hillshade-exaggeration": 0.1,
              },
            },
          ],
        }}
      >
        <Nations />
        <Cities />

      </Map>
    </div>
  );
}

export default App;
