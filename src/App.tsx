import Map from './Game/Map/World.tsx'
import UI from './Game/GameUI/main.tsx'


function App() {
  const ColorEffects = {
    filter: 'saturate(0.75) contrast(1.4) brightness(0.75) hue-rotate(20deg)',
    position: 'fixed',
    top: 0,
    left: 0
  };

  return (
    <>
    <div style={ColorEffects}>
    <Map />
    </div>
    <UI />
    </>
  )
}

export default App
