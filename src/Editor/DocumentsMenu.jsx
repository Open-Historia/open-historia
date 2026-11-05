/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Top-left document menu: new (blank / world), open a saved map, save now, and
// export the current map as JSON. Backed by /api/mapeditor/documents.

import { useState } from "react";
import Icon from "./Icon.jsx";
import { inputStyle, panelSurface, toolButton } from "./editorStyles.js";
import { listDocuments, deleteDocument } from "./documentIO.js";

const menuItem = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 10px",
  background: "transparent",
  border: "none",
  color: "white",
  cursor: "pointer",
  fontSize: 12.5,
  textAlign: "left",
  borderRadius: 8,
};

const DocumentsMenu = ({ currentId, author, onAuthorChange, onNew, onSave, onExport, onExportGame, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState([]);
  const [armed, setArmed] = useState(null);
  const [removeError, setRemoveError] = useState("");

  const refresh = async () => setDocs(await listDocuments());
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    setArmed(null);
    setRemoveError("");
    if (next) refresh();
  };
  const close = () => {
    setOpen(false);
    setArmed(null);
    setRemoveError("");
  };

  // A saved map is deleted for good (the desktop store removes its file), so
  // the trash icon asks first and says when the delete fails. The map that is
  // open cannot be deleted from here: the Workshop kept saving to the deleted
  // id, and every save after it failed.
  const remove = async (doc) => {
    if (armed !== doc.id) {
      setArmed(doc.id);
      setRemoveError("");
      return;
    }
    setArmed(null);
    try {
      await deleteDocument(doc.id);
    } catch (e) {
      setRemoveError(`Could not delete this map: ${e?.message || e}`);
    }
    refresh();
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={toggle}
        title="Documents"
        aria-label="Documents"
        aria-expanded={open}
        style={{ ...toolButton(open, false), height: 34, gap: 3, padding: "0 7px" }}
      >
        <Icon name="file" size={16} />
        <Icon name="chevronDown" size={12} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{ ...panelSurface, position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, width: 244, boxSizing: "border-box", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ padding: "4px 8px 6px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>
              Made by
            </div>
            <input
              value={author || ""}
              onChange={(e) => onAuthorChange(e.target.value)}
              placeholder="your name / username"
              style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
            />
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "2px 0 4px" }} />
          <button style={menuItem} onClick={() => { onNew("fault-lines"); close(); }}>
            <Icon name="layers" size={15} /> New — world map
          </button>
          <button style={menuItem} onClick={() => { onNew("modern-day"); close(); }}>
            <Icon name="layers" size={15} /> New — legacy world map
          </button>
          <button style={menuItem} onClick={() => { onNew("blank"); close(); }}>
            <Icon name="draw" size={15} /> New — blank map
          </button>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
          <button style={menuItem} onClick={() => { onSave(); close(); }}>
            <Icon name="save" size={15} /> Save now
          </button>
          <button style={menuItem} onClick={() => { onExport(); close(); }}>
            <Icon name="copy" size={15} /> Export JSON
          </button>
          <button style={menuItem} onClick={() => { onExportGame(); close(); }}>
            <Icon name="feature" size={15} /> Export for game
          </button>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
          <div style={{ padding: "2px 10px", fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Saved maps
          </div>
          {removeError && (
            <div style={{ margin: "2px 8px 4px", padding: "6px 8px", borderRadius: 8, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#fecaca", fontSize: 11.5 }}>
              {removeError}
            </div>
          )}
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {docs.length === 0 && (
              <div style={{ padding: "6px 10px", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>No saved maps yet</div>
            )}
            {docs.map((doc) => (
              <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px" }}>
                <button
                  style={{ ...menuItem, padding: "6px 8px", flex: 1, background: doc.id === currentId ? "rgba(255,255,255,0.08)" : "transparent" }}
                  onClick={() => { onOpen(doc.id); close(); }}
                >
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{doc.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{doc.regionCount} regions · {doc.featureCount} features</div>
                  </span>
                </button>
                <button
                  title={doc.id === currentId ? "This map is open. Open or start another map to delete it." : armed === doc.id ? `Delete “${doc.name || "Untitled Map"}” for good? This cannot be undone.` : "Delete"}
                  aria-label={doc.id === currentId ? "This map is open. Open or start another map to delete it." : armed === doc.id ? `Delete “${doc.name || "Untitled Map"}” for good? This cannot be undone.` : "Delete"}
                  disabled={doc.id === currentId}
                  onClick={() => { void remove(doc); }}
                  style={{
                    alignItems: "center",
                    background: armed === doc.id ? "rgba(185,28,28,0.72)" : "transparent",
                    border: armed === doc.id ? "1px solid rgba(248,113,113,0.4)" : "1px solid transparent",
                    borderRadius: 8,
                    color: armed === doc.id ? "#fff" : "#f87171",
                    cursor: doc.id === currentId ? "default" : "pointer",
                    display: "flex",
                    flexShrink: 0,
                    fontSize: 11.5,
                    fontWeight: 700,
                    gap: 4,
                    opacity: doc.id === currentId ? 0.3 : 1,
                    padding: armed === doc.id ? "3px 7px" : "3px 4px",
                  }}
                >
                  <Icon name="trash" size={13} />
                  {armed === doc.id && "Delete?"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsMenu;
