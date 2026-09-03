import { useEffect, useState } from "react";

// React bridge for the deliberately coarse map-motion signal emitted by World.jsx.
// It changes only on motion start/end, never on each mousemove frame.
export const useMapMotionState = () => {
  const [moving, setMoving] = useState(
    () => typeof window !== "undefined" && Boolean(window.__OH_MAP_MOVING__),
  );

  useEffect(() => {
    const onMotion = (event) => setMoving(Boolean(event?.detail?.active));
    window.addEventListener("oh:map-motion", onMotion);
    return () => window.removeEventListener("oh:map-motion", onMotion);
  }, []);

  return moving;
};

export default useMapMotionState;
