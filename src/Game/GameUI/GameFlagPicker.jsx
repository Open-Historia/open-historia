import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getNationFlags } from "../../runtime/assets.js";
import { resolvePolityFlag, setPolityFlag } from "../../runtime/polityFlags.js";

const MAX_FLAG_WIDTH = 256;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

const str = (value) => String(value ?? "").trim();

const fileToScaledDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) { reject(new Error("Choose an image first.")); return; }
    if (!String(file.type || "").startsWith("image/")) {
        reject(new Error("Use a PNG, JPEG, WEBP, GIF, or SVG image."));
        return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
        const source = String(reader.result || "");
        const img = new Image();
        img.onerror = () => reject(new Error("Could not decode that image."));
        img.onload = () => {
            const width = Math.max(1, Number(img.naturalWidth || img.width || 1));
            const height = Math.max(1, Number(img.naturalHeight || img.height || 1));
            const scale = Math.min(1, MAX_FLAG_WIDTH / width);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("Canvas is unavailable.")); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/png"));
        };
        img.src = source;
    };
    reader.readAsDataURL(file);
});

const buttonStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 9,
    color: "white",
    cursor: "pointer",
    fontFamily: "sans-serif",
    fontSize: "0.8rem",
    fontWeight: 700,
    padding: "0.55rem 0.75rem",
};

const FlagCard = ({ imageUrl, label, meta, onClick, selected = false }) => (
    <button
        type="button"
        onClick={onClick}
        style={{
            background: selected ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.04)",
            border: selected ? "1px solid rgba(167,139,250,0.7)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            color: "white",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            minWidth: 0,
            overflow: "hidden",
            padding: "0.5rem",
            textAlign: "left",
        }}
    >
        <div style={{ width: "100%", aspectRatio: "3 / 2", borderRadius: 7, overflow: "hidden", background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {imageUrl ? <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.72rem" }}>No preview</span>}
        </div>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        {meta && <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.66rem", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>}
    </button>
);

const PackCard = ({ post, onClick }) => {
    const count = Number(post?.flagCount || 0);
    const author = str(post?.author);
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                color: "white",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "0.45rem",
                minWidth: 0,
                overflow: "hidden",
                padding: "0.5rem",
                textAlign: "left",
            }}
        >
            <div style={{ position: "relative", width: "100%", aspectRatio: "3 / 2", borderRadius: 7, overflow: "hidden", background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(38,38,42,0.9))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {post?.imageUrl ? (
                    <img src={post.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.78 }} />
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem", color: "rgba(255,255,255,0.68)" }}>
                        <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>▦</span>
                        <span style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em" }}>FLAG PACK</span>
                    </div>
                )}
                <span style={{ position: "absolute", top: 7, right: 7, padding: "0.2rem 0.38rem", borderRadius: 999, background: "rgba(20,20,23,0.9)", border: "1px solid rgba(196,181,253,0.45)", color: "#ddd6fe", fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.06em" }}>PACK</span>
            </div>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{post?.title || "Scenario flag pack"}</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.66rem", overflow: "hidden", textOverflow: "ellipsis" }}>
                {count > 0 ? `${count} flag${count === 1 ? "" : "s"}` : "Scenario flag pack"}{author ? ` · by ${author}` : ""}
            </div>
        </button>
    );
};

const communityPackKey = (post) => str(post?.id || post?.packUrl || post?.url || post?.title);

const GameFlagPicker = ({ isOpen, polity, world, onClose, onApplied }) => {
    const [tab, setTab] = useState("game");
    const [flags, setFlags] = useState({});
    const [community, setCommunity] = useState([]);
    const [communityState, setCommunityState] = useState("idle");
    const [communityPack, setCommunityPack] = useState(null);
    const [communityPackFlags, setCommunityPackFlags] = useState([]);
    const [communityPackState, setCommunityPackState] = useState("idle");
    const [communityPackError, setCommunityPackError] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef(null);
    const packCacheRef = useRef(new Map());
    const packRequestRef = useRef(0);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        getNationFlags({ force: true })
            .then((value) => { if (!cancelled) setFlags(value || {}); })
            .catch(() => { if (!cancelled) setFlags({}); });
        setError("");
        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) return;
        packRequestRef.current += 1;
        setCommunityPack(null);
        setCommunityPackFlags([]);
        setCommunityPackState("idle");
        setCommunityPackError("");
        setTab("game");
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || tab !== "community") return;
        let cancelled = false;
        setCommunityState("loading");
        setError("");
        import("../../runtime/communityFlags.js")
            .then(async (mod) => {
                const posts = typeof mod.fetchCommunityFlags === "function"
                    ? await mod.fetchCommunityFlags({ force: false })
                    : [];
                if (cancelled) return;
                // Dedicated flag posts and scenario-derived packs share one root view.
                // Packs stay cheap here: their actual flag payload is fetched lazily
                // only after the player opens that pack.
                setCommunity(Array.isArray(posts) ? posts : []);
                setCommunityState("ready");
            })
            .catch((err) => {
                if (cancelled) return;
                setCommunityState("error");
                setError(err?.message || "Could not load community flags.");
            });
        return () => { cancelled = true; };
    }, [isOpen, tab]);

    const closeCommunityPack = () => {
        packRequestRef.current += 1;
        setCommunityPack(null);
        setCommunityPackFlags([]);
        setCommunityPackState("idle");
        setCommunityPackError("");
    };

    const openCommunityPack = async (post) => {
        const key = communityPackKey(post);
        if (!key) return;

        const requestId = packRequestRef.current + 1;
        packRequestRef.current = requestId;
        setCommunityPack(post);
        setCommunityPackError("");

        if (packCacheRef.current.has(key)) {
            setCommunityPackFlags(packCacheRef.current.get(key));
            setCommunityPackState("ready");
            return;
        }

        setCommunityPackFlags([]);
        setCommunityPackState("loading");
        try {
            const mod = await import("../../runtime/communityFlags.js");
            if (typeof mod.loadCommunityFlagPack !== "function") {
                throw new Error("Community scenario flag packs are unavailable in this build.");
            }
            const raw = await mod.loadCommunityFlagPack(post);
            const list = (Array.isArray(raw) ? raw : [])
                .map((flag, index) => ({
                    code: str(flag?.code) || `Flag ${index + 1}`,
                    dataUrl: str(flag?.dataUrl),
                }))
                .filter((flag) => flag.dataUrl);

            if (packRequestRef.current !== requestId) return;
            packCacheRef.current.set(key, list);
            setCommunityPackFlags(list);
            setCommunityPackState("ready");
        } catch (err) {
            if (packRequestRef.current !== requestId) return;
            setCommunityPackState("error");
            setCommunityPackError(err?.message || "Could not load that scenario flag pack.");
        }
    };

    const current = useMemo(
        () => resolvePolityFlag({ polity, world, flags }),
        [polity?.polityKey, polity?.name, polity?.code, world, flags],
    );

    const existing = useMemo(() => {
        const seen = new Set();
        return Object.entries(flags || {})
            .filter(([, value]) => str(value))
            .filter(([, value]) => {
                if (seen.has(value)) return false;
                seen.add(value);
                return true;
            })
            .slice(0, 120);
    }, [flags]);

    const apply = async (dataUrl) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const next = await setPolityFlag({ polity, world, dataUrl });
            setFlags(next || {});
            onApplied?.(next || {});
        } catch (err) {
            setError(err?.message || "Could not change the flag.");
        } finally {
            setBusy(false);
        }
    };

    const upload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setBusy(true);
        setError("");
        try {
            const dataUrl = await fileToScaledDataUrl(file);
            const next = await setPolityFlag({ polity, world, dataUrl });
            setFlags(next || {});
            onApplied?.(next || {});
        } catch (err) {
            setError(err?.message || "Could not use that flag image.");
        } finally {
            setBusy(false);
        }
    };

    const applyCommunity = async (post) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const mod = await import("../../runtime/communityFlags.js");
            if (typeof mod.loadCommunityFlagDataUrl !== "function") {
                throw new Error("Community flag installation is unavailable in this build.");
            }
            const dataUrl = await mod.loadCommunityFlagDataUrl(post);
            const next = await setPolityFlag({ polity, world, dataUrl });
            setFlags(next || {});
            onApplied?.(next || {});
        } catch (err) {
            setError(err?.message || "Could not install that community flag.");
        } finally {
            setBusy(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 12050, background: "rgba(8,8,10,0.78)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ width: "min(56rem, 96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "rgba(18,18,20,0.99)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.6)", overflow: "hidden", color: "white", fontFamily: "sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "1rem 1.1rem", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {current.imageUrl ? <img src={current.imageUrl} alt="" style={{ width: 46, height: 29, objectFit: "cover", borderRadius: 4, boxShadow: "0 0 0 1px rgba(255,255,255,0.18)" }} /> : <div style={{ width: 46, height: 29, borderRadius: 4, border: "1px solid rgba(255,255,255,0.18)" }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "1rem" }}>Change flag</div>
                        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{polity?.name || polity?.polityKey || polity?.code}</div>
                    </div>
                    <button type="button" onClick={onClose} style={{ ...buttonStyle, padding: "0.35rem 0.55rem", fontSize: "1rem", background: "transparent" }}>✕</button>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {[{ id: "game", label: "In this game" }, { id: "community", label: "Community" }].map((entry) => (
                        <button key={entry.id} type="button" onClick={() => setTab(entry.id)} style={{ ...buttonStyle, background: tab === entry.id ? "rgba(124,58,237,0.28)" : buttonStyle.background, borderColor: tab === entry.id ? "rgba(167,139,250,0.62)" : buttonStyle.border.split(" ").at(-1) }}>
                            {entry.label}
                        </button>
                    ))}
                    <div style={{ flex: 1 }} />
                    <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}>Upload image</button>
                    <input ref={inputRef} type="file" accept={ACCEPT} onChange={upload} style={{ display: "none" }} />
                    <button type="button" disabled={busy} onClick={() => apply(null)} title="Remove the custom flag and use the polity's safe stock/map fallback when one exists" style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}>Use standard</button>
                </div>

                {error && <div style={{ margin: "0.75rem 1rem 0", padding: "0.6rem 0.75rem", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5", fontSize: "0.76rem" }}>{error}</div>}

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "1rem", scrollbarWidth: "thin" }}>
                    {tab === "game" ? (
                        <>
                            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", marginBottom: "0.75rem" }}>
                                Reuse any flag already stored in this campaign. Choosing one copies the image to this polity's stable lineage; renaming the polity later will not detach it.
                            </div>
                            {existing.length === 0 ? (
                                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.8rem" }}>No custom flags are stored in this campaign yet.</div>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.75rem" }}>
                                    {existing.map(([name, imageUrl]) => (
                                        <FlagCard key={name} imageUrl={imageUrl} label={name} selected={current.imageUrl === imageUrl} onClick={() => apply(imageUrl)} />
                                    ))}
                                </div>
                            )}
                        </>
                    ) : communityPack ? (
                        <>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.9rem" }}>
                                <button type="button" onClick={closeCommunityPack} style={{ ...buttonStyle, padding: "0.45rem 0.65rem" }}>← Community</button>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 800, fontSize: "0.92rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{communityPack.title || "Scenario flag pack"}</div>
                                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", marginTop: "0.15rem" }}>
                                        {communityPackState === "ready"
                                            ? `${communityPackFlags.length} custom flag${communityPackFlags.length === 1 ? "" : "s"}`
                                            : Number(communityPack.flagCount || 0) > 0
                                                ? `${communityPack.flagCount} flag${Number(communityPack.flagCount) === 1 ? "" : "s"} advertised`
                                                : "Scenario flag pack"}
                                        {communityPack.author ? ` · by ${communityPack.author}` : ""}
                                    </div>
                                </div>
                            </div>

                            {communityPackState === "loading" ? (
                                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.8rem" }}>Loading this scenario's flags…</div>
                            ) : communityPackState === "error" ? (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.7rem 0.8rem", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: "0.78rem" }}>
                                    <span style={{ flex: 1 }}>{communityPackError || "This flag pack could not be loaded."}</span>
                                    <button type="button" onClick={() => openCommunityPack(communityPack)} style={{ ...buttonStyle, padding: "0.38rem 0.6rem" }}>Retry</button>
                                </div>
                            ) : communityPackFlags.length === 0 ? (
                                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>This scenario pack does not contain any custom flag images that can be selected individually.</div>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: "0.75rem" }}>
                                    {communityPackFlags.map((flag, index) => (
                                        <FlagCard
                                            key={`${flag.code}:${index}`}
                                            imageUrl={flag.dataUrl}
                                            label={flag.code}
                                            meta={communityPack.title || "Scenario flag pack"}
                                            selected={current.imageUrl === flag.dataUrl}
                                            onClick={() => apply(flag.dataUrl)}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    ) : communityState === "loading" ? (
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.8rem" }}>Loading community flags…</div>
                    ) : communityState === "error" ? (
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.8rem" }}>Community flags could not be loaded.</div>
                    ) : community.length === 0 ? (
                        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>No community flags or scenario flag packs are available right now.</div>
                    ) : (
                        <>
                            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", marginBottom: "0.75rem" }}>
                                Choose a shared flag directly, or open a scenario flag pack to pick one of its flags without importing the scenario.
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: "0.75rem" }}>
                                {community.map((post) => post?.fromScenario ? (
                                    <PackCard
                                        key={post.id || post.packUrl || post.url || post.title}
                                        post={post}
                                        onClick={() => openCommunityPack(post)}
                                    />
                                ) : (
                                    <FlagCard
                                        key={post.id || post.url || post.title}
                                        imageUrl={post.imageUrl}
                                        label={post.title || "Community flag"}
                                        meta={post.author ? `by ${post.author}` : "Community"}
                                        onClick={() => applyCommunity(post)}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default GameFlagPicker;
