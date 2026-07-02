/*! Open Historia — mobile HUD breakpoint hook © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect, useState } from "react";

// Small-screen detection for the HUD. Components use this to swap desktop
// offsets/widths for phone-friendly ones (full-width panels, compact bars).
// Pure-CSS min()/max() clamps are preferred where they suffice; this hook is
// for layout decisions CSS can't express in inline styles.
const MOBILE_QUERY = "(max-width: 700px)";

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return isMobile;
};
