import { useRef } from "react";
import Map from "./Game/Map/World.jsx";
import UI from "./Game/GameUI/main.jsx";

const ColorEffects = {
  filter: "saturate(0.75) contrast(1.4) brightness(0.75) hue-rotate(20deg)",
  backgroundColor: "#000",
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  touchAction: "none",
};

const Vignette = {
  position: "fixed",
  inset: 0,
  background: "radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.25) 100%)",
  pointerEvents: "none",
  zIndex: 10,
};

function App() {
  const mapRef = useRef(null);

  return (
    <>
    <div style={ColorEffects}>
    <Map mapRef={mapRef} />
    <div style={Vignette} />
    </div>
    <UI mapRef={mapRef} />
    </>
  );
}

export default App;
