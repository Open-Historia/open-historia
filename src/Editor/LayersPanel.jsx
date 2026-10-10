/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Layer visibility toggles for the editor canvas. The state lives on the map
// layers themselves (api.getLayerVisibility), so a layer hidden before the
// panel was closed still shows as off when it reopens.

import { useState } from "react";
import Panel from "./Panel.jsx";
import { Row, Toggle } from "./fields.jsx";

const LAYERS = [
  { key: "regions", label: "Regions" },
  { key: "labels", label: "Region labels" },
  { key: "groups", label: "Group outlines" },
  { key: "features", label: "Cities and map features" },
  { key: "units", label: "Starting units" },
];

const LayersPanel = ({ api, onClose }) => {
  const [vis, setVis] = useState(() =>
    Object.fromEntries(LAYERS.map(({ key }) => [key, api?.getLayerVisibility?.(key) ?? true])),
  );
  const set = (key, value) => {
    setVis((v) => ({ ...v, [key]: value }));
    api?.setLayerVisibility(key, value);
  };
  return (
    <Panel title="Layers" icon="layers" onClose={onClose} width={260}>
      {LAYERS.map(({ key, label }) => (
        <Row key={key} label={label}>
          <Toggle value={vis[key]} onChange={(v) => set(key, v)} />
        </Row>
      ))}
    </Panel>
  );
};

export default LayersPanel;
