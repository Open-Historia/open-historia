import Map from "./Game/Map/World.jsx";
import UI from "./Game/GameUI/main.jsx";

function App() {
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

  return (
    <>
      <div style={ColorEffects}>
        <Map />
      </div>
      <UI />
    </>
  );
}

export default App;
