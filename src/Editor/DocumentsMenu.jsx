/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Top-left document menu: new (blank / world), open a saved map, save now, and
// export the current map as JSON. Backed by /api/mapeditor/documents.

import { useState } from "react";
import Icon from "./Icon.jsx";
import { panelSurface } from "./editorStyles.js";
import { listDocuments, deleteDocument } from "./documentIO.js";
import { useIsMobile } from "../runtime/useIsMobile.js";

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
  borderRadius: 6,
};

const DocumentsMenu = ({ docName, currentId, author, onAuthorChange, onNew, onSave, onExport, onExportGame, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState([]);
  // On a phone the three top bars (this one, the centred toolbar, the top-right
  // action buttons) fight for the same row. Collapse to just the icon so this one
  // stays narrow and clear of the toolbar.
  const isMobile = useIsMobile();

  const refresh = async () => setDocs(await listDocuments());
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  };
  const close = () => setOpen(false);

  return (
    <div style={{ position: "fixed", top: 12, left: 12, zIndex: 36 }}>
      <button
        onClick={toggle}
        title={isMobile ? (docName || "Untitled Map") : undefined}
        style={{
          ...panelSurface,
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 0 : 8,
          padding: isMobile ? "8px 10px" : "7px 12px",
          fontSize: isMobile ? 16 : 13,
          fontWeight: 700,
          cursor: "pointer",
          color: "white",
        }}
      >
        🗺️
        {!isMobile && (
          <>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{docName || "Untitled Map"}</span>
            <Icon name="plus" size={12} style={{ transform: "rotate(45deg)", opacity: 0.5 }} />
          </>
        )}
      </button>

      {open && (
        <div style={{ ...panelSurface, marginTop: 6, width: 260, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ padding: "4px 8px 6px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>
              Made by
            </div>
            <input
              value={author || ""}
              onChange={(e) => onAuthorChange(e.target.value)}
              placeholder="your name / username"
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.28)", color: "#fff", fontSize: 12.5, outline: "none" }}
            />
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "2px 0 4px" }} />
          <button style={menuItem} onClick={() => { onNew("import-world"); close(); }}>
            <Icon name="layers" size={15} /> New — world map
          </button>
          <button style={menuItem} onClick={() => { onNew("blank"); close(); }}>
            <Icon name="draw" size={15} /> New — blank map
          </button>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
          <button style={menuItem} onClick={() => { onSave(); close(); }}>
            <Icon name="pin" size={15} /> Save now
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
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {docs.length === 0 && (
              <div style={{ padding: "6px 10px", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>No saved maps yet</div>
            )}
            {docs.map((doc) => (
              <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px" }}>
                <button
                  style={{ ...menuItem, padding: "6px 8px", flex: 1, background: doc.id === currentId ? "rgba(59,130,246,0.2)" : "transparent" }}
                  onClick={() => { onOpen(doc.id); close(); }}
                >
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{doc.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{doc.regionCount} regions · {doc.featureCount} features</div>
                  </span>
                </button>
                <button
                  title="Delete"
                  onClick={async () => { await deleteDocument(doc.id); refresh(); }}
                  style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer" }}
                >
                  <Icon name="trash" size={13} />
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
