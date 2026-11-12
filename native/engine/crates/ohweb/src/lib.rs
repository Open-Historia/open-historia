use std::cell::RefCell;
use std::collections::VecDeque;
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::rc::Rc;

#[cfg(target_os = "windows")]
mod environment;
#[cfg(target_os = "windows")]
mod loader;

use wry::dpi::{PhysicalPosition, PhysicalSize};
use wry::raw_window_handle::{HandleError, HasWindowHandle, RawWindowHandle, WindowHandle};
use wry::{BackgroundThrottlingPolicy, NewWindowResponse, PageLoadEvent, Rect, WebContext, WebView, WebViewBuilder};

pub const ABI_VERSION: u32 = 2;

pub const KIND_WIN32: u32 = 1;
pub const KIND_APPKIT: u32 = 2;
pub const KIND_XLIB: u32 = 3;

pub const BROWSER_ARGUMENTS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

#[repr(C)]
pub struct OhwebConfig {
    pub kind: u32,
    pub window: u64,
    pub display: u64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub url: *const c_char,
    pub html: *const c_char,
    pub data_dir: *const c_char,
    pub allowed: *const c_char,
    pub visible: u8,
    pub focused: u8,
    pub devtools: u8,
    pub background: u32,
}

struct Request {
    kind: u32,
    window: u64,
    bounds: (f64, f64, f64, f64),
    url: Option<String>,
    html: Option<String>,
    data_dir: Option<PathBuf>,
    allowed: Vec<String>,
    visible: bool,
    focused: bool,
    devtools: bool,
    background: u32,
    scripts: Vec<String>,
}

struct Live {
    view: WebView,
    _context: WebContext,
}

enum State {
    Waiting(Box<Request>),
    Live(Live),
    Failed,
}

pub struct Panel {
    state: RefCell<State>,
    events: Rc<RefCell<VecDeque<String>>>,
}

const KEY_SCRIPT: &str = r#"(function(){
if (window.__ohKeys) return; window.__ohKeys = true;
var keys = {"Escape":1};
function up(k){ try { if (window.top === window) { if (window.ipc) window.ipc.postMessage("\u001fk" + k); } else { window.top.postMessage({__ohKey: k}, "*"); } } catch (e) {} }
window.addEventListener("keydown", function(e){ if (keys[e.key]) up(e.key); }, true);
if (window.top === window) {
  window.addEventListener("message", function(e){ if (e && e.data && typeof e.data.__ohKey === "string" && keys[e.data.__ohKey]) up(e.data.__ohKey); });
  window.oh = { send: function(text){ if (window.ipc) window.ipc.postMessage(String(text)); } };
}
})();"#;

struct Parent(RawWindowHandle);

impl HasWindowHandle for Parent {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        Ok(unsafe { WindowHandle::borrow_raw(self.0) })
    }
}

fn text(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
    if value.is_empty() { None } else { Some(value) }
}

fn out(value: String) -> *mut c_char {
    CString::new(value.replace('\0', " ")).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

fn set_error(error: *mut *mut c_char, value: String) {
    if !error.is_null() {
        unsafe { *error = out(value) };
    }
}

fn panic_text(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return format!("the web view panicked: {text}");
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return format!("the web view panicked: {text}");
    }
    "the web view panicked".to_string()
}

fn bounds((x, y, width, height): (f64, f64, f64, f64)) -> Rect {
    Rect {
        position: PhysicalPosition::new(x.round() as i32, y.round() as i32).into(),
        size: PhysicalSize::new(width.round().max(1.0) as u32, height.round().max(1.0) as u32).into(),
    }
}

fn parent_handle(kind: u32, window: u64) -> Result<RawWindowHandle, String> {
    match kind {
        #[cfg(target_os = "windows")]
        KIND_WIN32 => {
            let hwnd = std::num::NonZeroIsize::new(window as isize).ok_or("the window has no handle")?;
            Ok(RawWindowHandle::Win32(wry::raw_window_handle::Win32WindowHandle::new(hwnd)))
        }
        #[cfg(target_os = "macos")]
        KIND_APPKIT => {
            let view = std::ptr::NonNull::new(window as usize as *mut std::ffi::c_void).ok_or("the window has no view")?;
            Ok(RawWindowHandle::AppKit(wry::raw_window_handle::AppKitWindowHandle::new(view)))
        }
        #[cfg(target_os = "linux")]
        KIND_XLIB => {
            if window == 0 {
                return Err("the window has no X11 handle".into());
            }
            Ok(RawWindowHandle::Xlib(wry::raw_window_handle::XlibWindowHandle::new(window as _)))
        }
        _ => Err("this window system cannot hold a web view".into()),
    }
}

#[cfg(target_os = "linux")]
fn prepare() -> Result<(), String> {
    use std::sync::OnceLock;
    static READY: OnceLock<Result<(), String>> = OnceLock::new();
    if std::env::var_os("DISPLAY").is_none() {
        return Err("web views need an X11 display".into());
    }
    READY
        .get_or_init(|| {
            gtk::disable_setlocale();
            gtk::init().map_err(|error| format!("GTK could not start: {error}"))
        })
        .clone()
}

#[cfg(target_os = "windows")]
fn prepare() -> Result<(), String> {
    if loader::present() { Ok(()) } else { Err("WebView2Loader.dll is missing next to the game".into()) }
}

#[cfg(target_os = "macos")]
fn prepare() -> Result<(), String> {
    Ok(())
}

fn probe() -> Result<String, String> {
    prepare()?;
    wry::webview_version().map_err(|error| format!("no web view runtime: {error}"))
}

fn allowed_url(prefixes: &[String], url: &str) -> bool {
    prefixes.is_empty() || url.starts_with("about:") || url.starts_with("data:") || prefixes.iter().any(|prefix| url.starts_with(prefix.as_str()))
}

fn build(request: &Request, events: &Rc<RefCell<VecDeque<String>>>) -> Result<Live, String> {
    let parent = Parent(parent_handle(request.kind, request.window)?);
    if let Some(dir) = &request.data_dir {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut context = WebContext::new(request.data_dir.clone());
    let ipc_events = events.clone();
    let load_events = events.clone();
    let window_events = events.clone();
    let nav_events = events.clone();
    let nav_prefixes = request.allowed.clone();
    let color = request.background;
    let mut builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(bounds(request.bounds))
        .with_visible(request.visible)
        .with_focused(request.focused)
        .with_autoplay(true)
        .with_devtools(request.devtools)
        .with_hotkeys_zoom(false)
        .with_clipboard(true)
        .with_background_color(((color >> 24) as u8, (color >> 16) as u8, (color >> 8) as u8, color as u8))
        .with_background_throttling(BackgroundThrottlingPolicy::Disabled)
        .with_initialization_script_for_main_only(KEY_SCRIPT, false)
        .with_ipc_handler(move |request| {
            let body = request.body();
            let entry = match body.strip_prefix('\u{1f}') {
                Some(rest) => rest.to_string(),
                None => format!("m{body}"),
            };
            ipc_events.borrow_mut().push_back(entry);
        })
        .with_on_page_load_handler(move |event, url| {
            let tag = match event {
                PageLoadEvent::Started => 's',
                PageLoadEvent::Finished => 'l',
            };
            load_events.borrow_mut().push_back(format!("{tag}{url}"));
        })
        .with_new_window_req_handler(move |url, _features| {
            window_events.borrow_mut().push_back(format!("o{url}"));
            NewWindowResponse::Deny
        })
        .with_navigation_handler(move |url| {
            if allowed_url(&nav_prefixes, &url) {
                return true;
            }
            nav_events.borrow_mut().push_back(format!("o{url}"));
            false
        });
    #[cfg(target_os = "windows")]
    {
        use wry::WebViewBuilderExtWindows;
        let env = environment::ready(request.data_dir.as_deref())?;
        builder = builder.with_environment(env).with_browser_accelerator_keys(false).with_default_context_menus(false).with_additional_browser_args(BROWSER_ARGUMENTS);
    }
    if let Some(url) = &request.url {
        builder = builder.with_url(url.as_str());
    } else if let Some(html) = &request.html {
        builder = builder.with_html(html.as_str());
    }
    let view = builder.build_as_child(&parent).map_err(|error| format!("the web view could not be made: {error}"))?;
    for script in &request.scripts {
        let _ = view.evaluate_script(script);
    }
    Ok(Live { view, _context: context })
}

#[cfg(target_os = "windows")]
fn waiting_on(request: &Request) -> Result<bool, String> {
    environment::poll(request.data_dir.as_deref(), request.window as isize).map(|ready| !ready)
}

#[cfg(not(target_os = "windows"))]
fn waiting_on(_request: &Request) -> Result<bool, String> {
    Ok(false)
}

impl Panel {
    fn advance(&self) -> i32 {
        let mut state = self.state.borrow_mut();
        let request = match &*state {
            State::Live(_) => return 1,
            State::Failed => return -1,
            State::Waiting(request) => request,
        };
        let outcome = match waiting_on(request) {
            Ok(true) => return 0,
            Ok(false) => build(request, &self.events),
            Err(error) => Err(error),
        };
        match outcome {
            Ok(live) => {
                *state = State::Live(live);
                self.events.borrow_mut().push_back("r".into());
                1
            }
            Err(error) => {
                *state = State::Failed;
                self.events.borrow_mut().push_back(format!("e{error}"));
                -1
            }
        }
    }
}

fn request_from(config: &OhwebConfig) -> Request {
    Request {
        kind: config.kind,
        window: config.window,
        bounds: (config.x, config.y, config.width, config.height),
        url: text(config.url),
        html: text(config.html),
        data_dir: text(config.data_dir).map(PathBuf::from),
        allowed: text(config.allowed).map(|list| list.lines().map(str::trim).filter(|line| !line.is_empty()).map(String::from).collect()).unwrap_or_default(),
        visible: config.visible != 0,
        focused: config.focused != 0,
        devtools: config.devtools != 0,
        background: config.background,
        scripts: Vec::new(),
    }
}

fn start(config: &OhwebConfig) -> Result<Panel, String> {
    prepare()?;
    let request = request_from(config);
    parent_handle(request.kind, request.window)?;
    #[cfg(target_os = "windows")]
    {
        wry::webview_version().map_err(|error| format!("WebView2 is not installed: {error}"))?;
        environment::begin(request.data_dir.as_deref())?;
    }
    let panel = Panel { state: RefCell::new(State::Waiting(Box::new(request))), events: Rc::new(RefCell::new(VecDeque::new())) };
    Ok(panel)
}

#[no_mangle]
pub extern "C" fn ohweb_abi() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_probe(detail: *mut *mut c_char) -> i32 {
    let result = catch_unwind(probe).unwrap_or_else(|payload| Err(panic_text(payload)));
    match result {
        Ok(version) => {
            set_error(detail, version);
            1
        }
        Err(error) => {
            set_error(detail, error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_create(config: *const OhwebConfig, error: *mut *mut c_char) -> *mut Panel {
    if config.is_null() {
        set_error(error, "no configuration".into());
        return std::ptr::null_mut();
    }
    let config = unsafe { &*config };
    let result = catch_unwind(AssertUnwindSafe(|| start(config))).unwrap_or_else(|payload| Err(panic_text(payload)));
    match result {
        Ok(panel) => Box::into_raw(Box::new(panel)),
        Err(message) => {
            set_error(error, message);
            std::ptr::null_mut()
        }
    }
}

fn with_panel<T>(panel: *mut Panel, fallback: T, action: impl FnOnce(&Panel) -> T) -> T {
    if panel.is_null() {
        return fallback;
    }
    let panel = unsafe { &*panel };
    match catch_unwind(AssertUnwindSafe(|| action(panel))) {
        Ok(value) => value,
        Err(_) => fallback,
    }
}

fn with_state<T>(panel: *mut Panel, fallback: T, live: impl FnOnce(&WebView) -> T, waiting: impl FnOnce(&mut Request) -> T) -> T {
    with_panel(panel, None, |panel| {
        let mut state = panel.state.try_borrow_mut().ok()?;
        Some(match &mut *state {
            State::Live(current) => live(&current.view),
            State::Waiting(request) => waiting(request),
            State::Failed => return None,
        })
    })
    .unwrap_or(fallback)
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_poll(panel: *mut Panel) -> i32 {
    with_panel(panel, -1, |panel| panel.advance())
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_set_bounds(panel: *mut Panel, x: f64, y: f64, width: f64, height: f64) -> i32 {
    with_state(panel, 0, |view| view.set_bounds(bounds((x, y, width, height))).is_ok() as i32, |request| {
        request.bounds = (x, y, width, height);
        1
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_set_visible(panel: *mut Panel, visible: u8) -> i32 {
    with_state(panel, 0, |view| view.set_visible(visible != 0).is_ok() as i32, |request| {
        request.visible = visible != 0;
        1
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_load_url(panel: *mut Panel, url: *const c_char) -> i32 {
    let Some(url) = text(url) else { return 0 };
    let copy = url.clone();
    with_state(panel, 0, |view| view.load_url(&url).is_ok() as i32, |request| {
        request.url = Some(copy);
        request.html = None;
        1
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_load_html(panel: *mut Panel, html: *const c_char) -> i32 {
    let html = text(html).unwrap_or_default();
    let copy = html.clone();
    with_state(panel, 0, |view| view.load_html(&html).is_ok() as i32, |request| {
        request.url = None;
        request.html = Some(copy);
        1
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_eval(panel: *mut Panel, script: *const c_char) -> i32 {
    let Some(script) = text(script) else { return 0 };
    let copy = script.clone();
    with_state(panel, 0, |view| view.evaluate_script(&script).is_ok() as i32, |request| {
        request.scripts.push(copy);
        1
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_focus(panel: *mut Panel, web: u8) -> i32 {
    with_state(
        panel,
        0,
        |view| if web != 0 { view.focus().is_ok() as i32 } else { view.focus_parent().is_ok() as i32 },
        |request| {
            request.focused = web != 0;
            1
        },
    )
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_url(panel: *mut Panel) -> *mut c_char {
    with_state(panel, std::ptr::null_mut(), |view| view.url().map(out).unwrap_or(std::ptr::null_mut()), |_| std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_next_event(panel: *mut Panel) -> *mut c_char {
    with_panel(panel, std::ptr::null_mut(), |panel| {
        let next = panel.events.try_borrow_mut().ok().and_then(|mut queue| queue.pop_front());
        next.map(out).unwrap_or(std::ptr::null_mut())
    })
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_destroy(panel: *mut Panel) {
    if panel.is_null() {
        return;
    }
    let boxed = unsafe { Box::from_raw(panel) };
    let _ = catch_unwind(AssertUnwindSafe(move || {
        if let Ok(state) = boxed.state.try_borrow() {
            if let State::Live(live) = &*state {
                let _ = live.view.set_visible(false);
            }
        }
        drop(boxed);
    }));
}

#[no_mangle]
pub unsafe extern "C" fn ohweb_free(value: *mut c_char) {
    if !value.is_null() {
        drop(unsafe { CString::from_raw(value) });
    }
}

#[no_mangle]
pub extern "C" fn ohweb_pump() {
    #[cfg(target_os = "linux")]
    let _ = catch_unwind(|| {
        if gtk::is_initialized_main_thread() {
            let mut budget = 64;
            while budget > 0 && gtk::events_pending() {
                gtk::main_iteration_do(false);
                budget -= 1;
            }
        }
    });
}
