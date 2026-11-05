import { useEffect, useRef, useState } from "react";
import { getRuntimeSlice, subscribeRuntime } from "./runtimeStore.js";
import { useGameEntered } from "./gameEntry.js";

// Reads one slice of a runtime document. The selector lives in a ref so an
// inline arrow does not tear the subscription down every render. Pass a
// primitive `depsKey` when the selector closes over something that can change
// without the document changing.
//
// A runtime document is the open game's. Before the player has opened a game
// (gameEntry.js) the page shows the main menu and loads none, so the hook
// subscribes, which is what reads the document, only once one is opened; until
// then it holds the store's empty value. (Everything that uses it is the
// game's own UI, mounted with a game, but for the screen's shell in
// GameUI/main.jsx, which is there for the menu too.)
export const useRuntimeState = (key, select, depsKey) => {
  const entered = useGameEntered();
  const selectRef = useRef(select);
  selectRef.current = select;

  // What this hook last handed React, so the subscription below can tell whether
  // anything moved in between.
  const seedRef = useRef(null);
  const [value, setValue] = useState(() => {
    seedRef.current = getRuntimeSlice(key, select);
    return seedRef.current;
  });

  useEffect(() => {
    if (!entered) return undefined;
    const apply = (next) => {
      seedRef.current = next;
      setValue(next);
    };
    return subscribeRuntime(key, apply, {
      select: selectRef.current ? (doc) => selectRef.current(doc) : undefined,
      seed: seedRef.current,
    });
  }, [key, depsKey, entered]);

  return value;
};
