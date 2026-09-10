import React, { createContext, useContext, useEffect, useRef, useState } from "react";

// A surface that is conditionally rendered vanishes the instant its flag turns
// false, which is the one thing CSS alone cannot animate. Presence keeps the
// children mounted for one short exit animation after `open` turns false, and
// marks that phase on a boxless wrapper so styles.css can play the exit on the
// surface itself:
//
//   [data-oh-presence="leaving"] > * { animation: oh-surface-out ... }
//
// Two ways to give it children:
//   <Presence open={flag}>{...jsx...}</Presence>
//     for a surface whose content does not depend on a value that is null
//     while it is closed (the JSX is built by the parent on every render);
//   <Presence open={Boolean(item)} value={item}>{(item) => ...jsx...}</Presence>
//     for one that does: the function runs only while mounted, and during
//     the exit it is handed the last value the surface was open with.
//
// Portalled surfaces are not DOM children of the wrapper; they read
// usePresenceLeaving() and apply the exit class themselves.
//
// Entrances need no help: every positioned surface fades in through the
// attribute rules in styles.css, and the bigger ones add .oh-surface-in.
export const PRESENCE_LEAVE_MS = 150;

const PresenceContext = createContext(false);

export const usePresenceLeaving = () => useContext(PresenceContext);

export const Presence = ({ open, value, children }) => {
  const [leaving, setLeaving] = useState(false);
  // Derived from the flag during render (React's own pattern for state that
  // follows a prop), so the exit starts on the very render that closed it.
  const wasOpen = useRef(open);
  if (wasOpen.current !== open) {
    wasOpen.current = open;
    if (!open) setLeaving(true);
  }
  const lastValue = useRef(value);
  if (open) lastValue.current = value;

  useEffect(() => {
    if (!leaving || open) return undefined;
    const timer = setTimeout(() => setLeaving(false), PRESENCE_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, open]);

  if (!open && !leaving) return null;
  const phase = open ? "in" : "leaving";
  const content = typeof children === "function" ? children(open ? value : lastValue.current) : children;
  return (
    <PresenceContext.Provider value={!open}>
      <div data-oh-presence={phase} style={{ display: "contents" }}>{content}</div>
    </PresenceContext.Provider>
  );
};

export default Presence;
