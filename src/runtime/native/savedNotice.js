/*! Open Historia — "saved to Downloads", inside the Android app © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A phone shows no download bar, and none of the exports say where their file
// went, so the app's own download (fileSave.js) says it: which folder, what the
// file is called, and a Share button for sending it on. Plain DOM rather than a
// React component, because a save can finish from anywhere — the library, the
// Workshop, the settings — and none of them has to mount anything for it. The
// interface translator picks the text up as it appears; the file name opts out.
const NOTICE_ID = "oh-saved-notice";
const VISIBLE_MS = 8000;

let hideTimer = 0;

const hide = () => {
  clearTimeout(hideTimer);
  document.getElementById(NOTICE_ID)?.remove();
};

const button = (label, onClick, extra = {}) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "oh-tap";
  element.textContent = label;
  Object.assign(element.style, {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "8px",
    color: "#f4f4f5",
    cursor: "pointer",
    flexShrink: "0",
    font: "inherit",
    fontSize: "0.8rem",
    fontWeight: "700",
    padding: "0.45rem 0.75rem",
    ...extra,
  });
  element.addEventListener("click", onClick);
  return element;
};

export const showSavedNotice = ({ fileName, onShare = null }) => {
  if (typeof document === "undefined" || !document.body) return;
  hide();
  const box = document.createElement("div");
  box.id = NOTICE_ID;
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  Object.assign(box.style, {
    alignItems: "center",
    background: "rgba(24,24,27,0.97)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "12px",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
    boxSizing: "border-box",
    color: "#f4f4f5",
    display: "flex",
    gap: "10px",
    left: "50%",
    maxWidth: "min(92vw, 26rem)",
    padding: "10px 12px",
    position: "fixed",
    transform: "translateX(-50%)",
    width: "max-content",
    zIndex: "2147483000",
  });

  const text = document.createElement("div");
  Object.assign(text.style, { display: "grid", gap: "2px", minWidth: "0" });
  const title = document.createElement("div");
  title.textContent = "Saved to your Downloads folder";
  Object.assign(title.style, { fontSize: "0.86rem", fontWeight: "700" });
  const place = document.createElement("div");
  place.setAttribute("data-no-translate", "");
  place.textContent = `Open Historia / ${fileName}`;
  Object.assign(place.style, { color: "rgba(255,255,255,0.62)", fontSize: "0.74rem", overflowWrap: "anywhere" });
  text.append(title, place);
  box.append(text);

  if (typeof onShare === "function") {
    box.append(button("Share", () => { hide(); onShare(); }));
  }
  const close = button("✕", hide, { background: "transparent", border: "none", padding: "0.45rem 0.55rem" });
  close.setAttribute("aria-label", "Close");
  close.title = "Close";
  box.append(close);

  document.body.append(box);
  hideTimer = setTimeout(hide, VISIBLE_MS);
};
