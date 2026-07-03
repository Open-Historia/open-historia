/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Layer visibility toggles for the editor canvas.

import { useState } from "react";
import Panel from "./Panel.jsx";
import { Row, Toggle } from "./fields.jsx";

const LayersPanel = ({ api, onClose }) => {
  const [vis, setVis] = useState({ regions: true, labels: true });
  const set = (key, value) => {
    setVis((v) => ({ ...v, [key]: value }));
    api?.setLayerVisibility(key, value);
  };
  return (
    <Panel title="Layers" icon="layers" onClose={onClose} width={260}>
      <Row label="Regions">
        <Toggle value={vis.regions} onChange={(v) => set("regions", v)} />
      </Row>
      <Row label="Region labels">
        <Toggle value={vis.labels} onChange={(v) => set("labels", v)} />
      </Row>
    </Panel>
  );
};

export default LayersPanel;
