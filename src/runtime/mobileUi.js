/*! Open Historia — phone layout helpers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the HUD, the menus and the panels share to fit a phone.
//
// The visible height. `100vh` is the LARGEST viewport a phone browser can
// show, the one with its address bar hidden. While the bar is showing, a panel
// sized or anchored with 100vh is taller than the screen, and its header, with
// the close button in it, ends up under the bar or off the top: the advisor
// drawer was exactly that, a screen-sized sheet whose only way out could not be
// reached. `--oh-app-height` is the height actually visible, kept current as
// the bar, the keyboard and the orientation change, and APP_HEIGHT reads it
// with 100vh as the fallback, so it goes wherever 100vh used to.
//
// The notch and the home indicator. index.html asks for the whole screen
// (viewport-fit=cover), so a sheet that reaches an edge pads itself by that
// edge's inset; the SAFE_* values are 0 wherever there is nothing to avoid.
//
// And the two questions about the device that inline styles cannot ask CSS:
// can it hover at all (a control that only appears on hover never appears on a
// touch screen), and is a finger its main pointer.
import { useEffect, useState } from "react";

export const APP_HEIGHT_VAR = "--oh-app-height";
export const APP_HEIGHT = `var(${APP_HEIGHT_VAR}, 100vh)`;

// The visible height with the keyboard left out. APP_HEIGHT follows the
// keyboard, which is right for a sheet with a composer at its bottom and wrong
// for a dialog with a search box at its top: the country picker, sized from
// APP_HEIGHT and centred, shrank and jumped when the keyboard rose (its top
// went above the screen for a moment) and its map was squeezed to 150 px.
// SCREEN_HEIGHT follows every change except a shrink while a text field has
// focus.
export const SCREEN_HEIGHT_VAR = "--oh-screen-height";
export const SCREEN_HEIGHT = `var(${SCREEN_HEIGHT_VAR}, 100vh)`;

export const SAFE_TOP = "env(safe-area-inset-top, 0px)";
export const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
export const SAFE_LEFT = "env(safe-area-inset-left, 0px)";
export const SAFE_RIGHT = "env(safe-area-inset-right, 0px)";

// A field that raises the on-screen keyboard while it has focus.
const NO_KEYBOARD_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
export const isTypingInto = (element) => {
    if (!element) return false;
    if (element.isContentEditable) return true;
    const tag = String(element.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return true;
    return tag === "INPUT" && !NO_KEYBOARD_INPUTS.has(String(element.type || "text").toLowerCase());
};

// Writes the visible height onto <html> and keeps it current. window.innerHeight
// follows a phone browser's address bar as it shows and hides; index.html's
// `interactive-widget=resizes-content` makes it follow the keyboard too, so a
// composer at the bottom of a sheet stays above the keys (the Android app's
// MainActivity makes room for the keyboard the same way). Safe to call twice.
export const installAppHeight = (win = typeof window === "undefined" ? null : window) => {
    if (!win || win.__ohAppHeightInstalled) return false;
    win.__ohAppHeightInstalled = true;
    const root = win.document?.documentElement;
    let screenHeight = 0;
    let screenWidth = 0;
    const apply = () => {
        const height = Math.round(Number(win.innerHeight) || 0);
        if (!root || height <= 0) return;
        root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
        // A shrink with a text field focused is the keyboard, which the screen
        // height leaves out. A turn changes the width, which the keyboard
        // never does, so a turn always counts.
        const width = Math.round(Number(win.innerWidth) || 0);
        const keyboard = height < screenHeight && width === screenWidth && isTypingInto(win.document?.activeElement);
        if (!keyboard) {
            screenHeight = height;
            screenWidth = width;
            root.style.setProperty(SCREEN_HEIGHT_VAR, `${height}px`);
        }
    };
    apply();
    win.addEventListener?.("resize", apply);
    win.addEventListener?.("orientationchange", apply);
    win.visualViewport?.addEventListener?.("resize", apply);
    return true;
};

const matches = (query) => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(query).matches;

const useMediaQuery = (query) => {
    const [value, setValue] = useState(() => matches(query));
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
        const mq = window.matchMedia(query);
        const onChange = () => setValue(mq.matches);
        onChange();
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else mq.addListener(onChange);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener("change", onChange);
            else mq.removeListener(onChange);
        };
    }, [query]);
    return value;
};

// The Android app is a phone app whatever its screen reports. A compile-time
// flag: unset in the website and desktop builds, and under node --test.
const nativeApp = () => {
    try {
        return Boolean(import.meta.env.VITE_OH_NATIVE);
    } catch {
        return false;
    }
};

// False on a phone or a tablet: nothing there can hover, so a control drawn
// only while the pointer is over its row has to be drawn all the time. Some
// Android phones answer `(hover: hover)` all the same (Chromium before 2026
// took a touchscreen that also claims to be a mouse at its word), so a touch
// screen never counts as one that hovers.
export const useCanHover = () => {
    const hover = useMediaQuery("(hover: hover)");
    const touch = useTouchPrimary();
    return hover && !touch;
};

// A map card (a region, a unit, a place) opened on a phone. The cards are
// sheets at the bottom of a phone's screen, where the chat, Actions, Projects
// and timeline panels are too, so the two take turns: the HUD shuts its panel
// when a card announces itself, and puts the cards away when a panel opens
// (GameUI/main.jsx).
export const MAP_CARD_OPENED = "oh:map-card-opened";

// A phone held sideways: a finger, and a screen too short (375-430 px) for a
// card anchored at the tap, which rose off the top with its ✕. The phone
// layout (useIsMobile, 700 px wide or less) does not cover it. Asked the way
// TOUCH_QUERY asks, for the reasons it gives.
export const SHORT_TOUCH_QUERY = "(any-pointer: coarse) and (max-height: 500px), (hover: none) and (max-height: 500px)";
export const useShortTouchScreen = () => useMediaQuery(SHORT_TOUCH_QUERY);

// True when a finger is the main pointer: a phone, a tablet, the Android app.
// `(pointer: coarse)` alone can miss a phone. Older Android WebViews and
// Chromes report a touchscreen that also takes a stylus as a FINE pointer and
// nothing else (Chromium's TouchDevice, until it began reporting every pointer
// a device has), and a device in desktop mode prefers its fine pointer too. Those phones got the desktop's behaviour: search boxes that
// focus themselves (the keyboard rose over the country picker as it opened),
// no Back-to-close, 26 px close buttons. A device that cannot hover at all is
// a touch device whatever its pointer says, a touchscreen on a phone-sized
// screen counts, and the Android app always does. styles.css asks the same.
export const TOUCH_QUERY = "(pointer: coarse), (hover: none), (any-pointer: coarse) and (max-width: 700px)";
export const isTouchPrimary = () => nativeApp() || matches(TOUCH_QUERY);
export const useTouchPrimary = () => {
    const touch = useMediaQuery(TOUCH_QUERY);
    return nativeApp() || touch;
};
