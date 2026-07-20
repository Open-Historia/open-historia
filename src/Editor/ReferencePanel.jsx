/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Reference image: a session-only tracing aid. Upload a source map, drag it
// into place over the world (move inside / resize by the corners while this
// panel is open), and trace borders through it at 50% opacity. It is never
// saved with the document and never exported to the game.

import Panel from "./Panel.jsx";
import { Row, Toggle, NumberField } from "./fields.jsx";
import { inputStyle } from "./editorStyles.js";

const readImageFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const image = new Image();
      image.onload = () =>
        resolve({ dataUrl, aspect: image.height > 0 ? image.width / image.height : 1.5 });
      image.onerror = () => reject(new Error("That file is not a readable image."));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

const ReferencePanel = ({ refImage, setRefImage, onRecenter, onClose }) => {
  const handleUpload = async (file) => {
    if (!file) return;
    try {
      const { dataUrl, aspect } = await readImageFile(file);
      setRefImage({ dataUrl, aspect, opacity: 0.5, visible: true });
    } catch (e) {
      window.alert(e?.message || "Could not read that image.");
    }
  };

  return (
    <Panel title="Reference image" icon="image" onClose={onClose} width={280}>
      <label
        style={{
          ...inputStyle,
          width: "auto",
          display: "block",
          textAlign: "center",
          cursor: "pointer",
          padding: "7px 10px",
          marginBottom: 10,
        }}
      >
        {refImage ? "⬆ Replace image" : "⬆ Upload reference image"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            handleUpload(f);
          }}
        />
      </label>

      {refImage ? (
        <>
          <Row label="Opacity">
            <NumberField
              value={refImage.opacity ?? 0.5}
              step={0.05}
              min={0}
              max={1}
              onChange={(v) => setRefImage({ ...refImage, opacity: Math.max(0, Math.min(1, v ?? 0.5)) })}
            />
          </Row>
          <Row label="Visible">
            <Toggle value={refImage.visible !== false} onChange={(v) => setRefImage({ ...refImage, visible: v })} />
          </Row>
          <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
            <button
              type="button"
              onClick={onRecenter}
              style={{ ...inputStyle, width: "auto", flex: 1, cursor: "pointer", padding: "6px 8px" }}
            >
              Center on view
            </button>
            <button
              type="button"
              onClick={() => setRefImage(null)}
              style={{ ...inputStyle, width: "auto", flex: 1, cursor: "pointer", padding: "6px 8px", color: "#fca5a5" }}
            >
              Remove
            </button>
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
            Drag inside the image to move it; drag a corner to resize (free
            stretch, so you can match the map projection). Close this panel to
            draw and edit through the image.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
          Upload a map or sketch to trace borders from. It shows at 50%
          opacity above the regions and is never saved with the map.
        </div>
      )}
    </Panel>
  );
};

export default ReferencePanel;
