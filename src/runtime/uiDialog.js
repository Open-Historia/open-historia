/*! Open Historia - shared non-blocking native modal dialogs. AGPL-3.0-or-later (see LICENSE). */
// Replaces blocking browser window.alert / window.confirm calls with a themed,
// keyboard-accessible top-layer <dialog> that never freezes React or OpenLayers.

const DIALOG_STYLE_ID = "oh-ui-dialog-style";

const ensureDialogStyles = () => {
  if (typeof document === "undefined" || document.getElementById(DIALOG_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = DIALOG_STYLE_ID;
  style.textContent = [
    "dialog.oh-ui-dialog::backdrop { background: rgba(0, 0, 0, 0.62); }",
    "dialog.oh-ui-dialog { box-sizing: border-box; border: 1px solid var(--oh-ui-line, rgba(255,255,255,0.18));",
    "  border-radius: 14px; background: var(--oh-ui-panel, #14202d); color: var(--oh-ui-text, #f1f5f9);",
    "  padding: 1.1rem 1.2rem; width: min(30rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem);",
    "  box-shadow: 0 24px 64px rgba(0,0,0,0.52); font-family: inherit; }",
    "dialog.oh-ui-dialog .oh-ui-dialog-title { font-size: 0.96rem; font-weight: 800; margin: 0 0 0.55rem; }",
    "dialog.oh-ui-dialog .oh-ui-dialog-body { font-size: 0.84rem; line-height: 1.55; white-space: pre-wrap;",
    "  overflow-wrap: anywhere; margin: 0 0 1rem; color: var(--oh-ui-text, #f1f5f9); }",
    "dialog.oh-ui-dialog .oh-ui-dialog-actions { display: flex; justify-content: flex-end; gap: 0.55rem; flex-wrap: wrap; }",
    "dialog.oh-ui-dialog button { border: 1px solid var(--oh-ui-line, rgba(255,255,255,0.2));",
    "  background: var(--oh-ui-raised, rgba(255,255,255,0.08)); color: inherit; border-radius: 8px;",
    "  padding: 0.45rem 0.9rem; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }",
    "dialog.oh-ui-dialog button[data-primary='true'] { background: var(--oh-ui-accent, #2bc1f3);",
    "  border-color: var(--oh-ui-accent, #2bc1f3); color: var(--oh-ui-bg, #0d131a); }",
    "dialog.oh-ui-dialog button[data-danger='true'] { border-color: rgba(239,68,68,0.6);",
    "  background: rgba(239,68,68,0.18); color: inherit; }",
  ].join("\n");
  document.head?.appendChild(style);
};

let overrideHandler = null;
export const setUiDialogHandler = (handler) => {
  overrideHandler = typeof handler === "function" ? handler : null;
};

export const hasOpenUiDialog = () => (
  typeof document !== "undefined"
  && Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))
);

let dialogQueue = Promise.resolve();

const renderModalDialog = ({ kind, text, title, confirmLabel, cancelLabel, okLabel, danger }) => {
  ensureDialogStyles();
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "oh-ui-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", title || (kind === "confirm" ? "Confirmation" : "Notice"));

    if (title) {
      const heading = document.createElement("div");
      heading.className = "oh-ui-dialog-title";
      heading.textContent = title;
      dialog.appendChild(heading);
    }

    const body = document.createElement("p");
    body.className = "oh-ui-dialog-body";
    body.textContent = text;
    dialog.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "oh-ui-dialog-actions";

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };

    let focusTarget = null;
    if (kind === "confirm") {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = cancelLabel;
      cancelButton.addEventListener("click", () => finish(false));
      actions.appendChild(cancelButton);

      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.textContent = confirmLabel;
      confirmButton.dataset[danger ? "danger" : "primary"] = "true";
      confirmButton.addEventListener("click", () => finish(true));
      actions.appendChild(confirmButton);
      focusTarget = danger ? cancelButton : confirmButton;
    } else {
      const okButton = document.createElement("button");
      okButton.type = "button";
      okButton.textContent = okLabel;
      okButton.dataset.primary = "true";
      okButton.addEventListener("click", () => finish(undefined));
      actions.appendChild(okButton);
      focusTarget = okButton;
    }

    dialog.appendChild(actions);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(kind === "confirm" ? false : undefined);
    });
    dialog.addEventListener("close", () => {
      finish(kind === "confirm" ? false : undefined);
    });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    if (typeof focusTarget?.focus === "function") focusTarget.focus();
  });
};

const showModalDialog = ({ kind, message, title = "", confirmLabel = "Confirm", cancelLabel = "Cancel", okLabel = "OK", danger = false }) => {
  const text = String(message ?? "");
  if (overrideHandler) {
    return Promise.resolve().then(() => overrideHandler({ kind, message: text, title, confirmLabel, cancelLabel, okLabel, danger }));
  }
  if (typeof document === "undefined" || !document.body) {
    return Promise.resolve(kind === "confirm" ? false : undefined);
  }
  const next = dialogQueue.then(
    () => renderModalDialog({ kind, text, title, confirmLabel, cancelLabel, okLabel, danger }),
    () => renderModalDialog({ kind, text, title, confirmLabel, cancelLabel, okLabel, danger }),
  );
  dialogQueue = next.then(() => undefined, () => undefined);
  return next;
};

export const confirmDialog = (message, options = {}) => showModalDialog({ kind: "confirm", message, ...options });
export const alertDialog = (message, options = {}) => showModalDialog({ kind: "alert", message, ...options });
