/*! Open Historia — the hub's music list, for a screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useEffect, useState } from "react";

import { fetchHubMusic, knownHubMusic } from "./hubMusic.js";

// The community hub's music list (hubMusic.js) for a screen that shows it: the
// scenario editor's Music tab, a scenario's credits before a game. What this
// device already knows at once, then what the hub answers. null until either
// is known; a list that could not be read has `listed: false`. Nothing is
// asked while `wanted` is false: a screen with no track to show asks nothing.
export const useHubMusic = (wanted = true) => {
  const [list, setList] = useState(() => (wanted ? knownHubMusic() : null));

  useEffect(() => {
    if (!wanted) return undefined;
    let shown = true;
    fetchHubMusic().then((next) => { if (shown) setList(next); });
    return () => { shown = false; };
  }, [wanted]);

  return list;
};
