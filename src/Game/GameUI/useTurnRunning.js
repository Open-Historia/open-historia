/*! Open Historia — whether a turn is running, for the controls it would overwrite © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { isSimulationBusy } from "../AI/simulationStatus.js";

// Whether a turn is running (or held, waiting for the player), for the controls
// a turn's own world write would overwrite: the standing goal, the unit card,
// the Forces panel, Historical tracking. The flag is a synchronous counter
// (simulationStatus.js), so it is polled while the control is on screen, as the
// HUD polls it.
const TURN_POLL_MS = 800;

export const useTurnRunning = (active = true) => {
    const [running, setRunning] = React.useState(() => isSimulationBusy());
    React.useEffect(() => {
        if (!active) return undefined;
        setRunning(isSimulationBusy());
        const timer = window.setInterval(() => setRunning(isSimulationBusy()), TURN_POLL_MS);
        return () => window.clearInterval(timer);
    }, [active]);
    return running;
};
