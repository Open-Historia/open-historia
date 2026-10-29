use std::cell::RefCell;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;

use godot::classes::display_server::HandleType;
use godot::classes::display_server::WindowMode;
use godot::classes::{Control, DisplayServer, IControl, Json, Os, Window};
#[cfg(target_os = "linux")]
use godot::classes::ProjectSettings;
use godot::prelude::*;

#[repr(C)]
struct Config {
    kind: u32,
    window: u64,
    display: u64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: *const c_char,
    html: *const c_char,
    data_dir: *const c_char,
    allowed: *const c_char,
    visible: u8,
    focused: u8,
    devtools: u8,
    background: u32,
}

type Handle = *mut c_void;

#[derive(Clone, Copy)]
struct Api {
    abi: unsafe extern "C" fn() -> u32,
    probe: unsafe extern "C" fn(*mut *mut c_char) -> i32,
    create: unsafe extern "C" fn(*const Config, *mut *mut c_char) -> Handle,
    set_bounds: unsafe extern "C" fn(Handle, f64, f64, f64, f64) -> i32,
    set_visible: unsafe extern "C" fn(Handle, u8) -> i32,
    load_url: unsafe extern "C" fn(Handle, *const c_char) -> i32,
    load_html: unsafe extern "C" fn(Handle, *const c_char) -> i32,
    eval: unsafe extern "C" fn(Handle, *const c_char) -> i32,
    focus: unsafe extern "C" fn(Handle, u8) -> i32,
    poll: unsafe extern "C" fn(Handle) -> i32,
    url: unsafe extern "C" fn(Handle) -> *mut c_char,
    next_event: unsafe extern "C" fn(Handle) -> *mut c_char,
    destroy: unsafe extern "C" fn(Handle),
    free: unsafe extern "C" fn(*mut c_char),
    pump: unsafe extern "C" fn(),
}

const ABI_VERSION: u32 = 2;

#[cfg(not(target_os = "linux"))]
fn load_api() -> Result<Api, String> {
    unsafe {
        Ok(Api {
            abi: ohweb::ohweb_abi,
            probe: ohweb::ohweb_probe,
            create: std::mem::transmute::<unsafe extern "C" fn(*const ohweb::OhwebConfig, *mut *mut c_char) -> *mut ohweb::Panel, unsafe extern "C" fn(*const Config, *mut *mut c_char) -> Handle>(ohweb::ohweb_create),
            set_bounds: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, f64, f64, f64, f64) -> i32, unsafe extern "C" fn(Handle, f64, f64, f64, f64) -> i32>(ohweb::ohweb_set_bounds),
            set_visible: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, u8) -> i32, unsafe extern "C" fn(Handle, u8) -> i32>(ohweb::ohweb_set_visible),
            load_url: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, *const c_char) -> i32, unsafe extern "C" fn(Handle, *const c_char) -> i32>(ohweb::ohweb_load_url),
            load_html: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, *const c_char) -> i32, unsafe extern "C" fn(Handle, *const c_char) -> i32>(ohweb::ohweb_load_html),
            eval: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, *const c_char) -> i32, unsafe extern "C" fn(Handle, *const c_char) -> i32>(ohweb::ohweb_eval),
            focus: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel, u8) -> i32, unsafe extern "C" fn(Handle, u8) -> i32>(ohweb::ohweb_focus),
            poll: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel) -> i32, unsafe extern "C" fn(Handle) -> i32>(ohweb::ohweb_poll),
            url: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel) -> *mut c_char, unsafe extern "C" fn(Handle) -> *mut c_char>(ohweb::ohweb_url),
            next_event: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel) -> *mut c_char, unsafe extern "C" fn(Handle) -> *mut c_char>(ohweb::ohweb_next_event),
            destroy: std::mem::transmute::<unsafe extern "C" fn(*mut ohweb::Panel), unsafe extern "C" fn(Handle)>(ohweb::ohweb_destroy),
            free: ohweb::ohweb_free,
            pump: ohweb::ohweb_pump,
        })
    }
}

#[cfg(target_os = "linux")]
fn library_candidates() -> Vec<PathBuf> {
    let name = "libohweb.so";
    let mut found = Vec::new();
    if let Ok(path) = std::env::var("OH_WEBPANEL_LIB") {
        found.push(PathBuf::from(path));
        return found;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            found.push(dir.join(name));
        }
    }
    let bin = ProjectSettings::singleton().globalize_path("res://bin").to_string();
    if !bin.is_empty() && !bin.starts_with("res://") {
        found.push(PathBuf::from(bin).join(name));
    }
    found
}

#[cfg(target_os = "linux")]
fn load_api() -> Result<Api, String> {
    let mut errors = Vec::new();
    for path in library_candidates() {
        if !path.exists() {
            continue;
        }
        match unsafe { libloading::Library::new(&path) } {
            Ok(library) => {
                let library: &'static libloading::Library = Box::leak(Box::new(library));
                macro_rules! symbol {
                    ($name:literal) => {
                        *unsafe { library.get($name) }.map_err(|error| format!("{}: {error}", path.display()))?
                    };
                }
                return Ok(Api {
                    abi: symbol!(b"ohweb_abi\0"),
                    probe: symbol!(b"ohweb_probe\0"),
                    create: symbol!(b"ohweb_create\0"),
                    set_bounds: symbol!(b"ohweb_set_bounds\0"),
                    set_visible: symbol!(b"ohweb_set_visible\0"),
                    load_url: symbol!(b"ohweb_load_url\0"),
                    load_html: symbol!(b"ohweb_load_html\0"),
                    eval: symbol!(b"ohweb_eval\0"),
                    focus: symbol!(b"ohweb_focus\0"),
                    poll: symbol!(b"ohweb_poll\0"),
                    url: symbol!(b"ohweb_url\0"),
                    next_event: symbol!(b"ohweb_next_event\0"),
                    destroy: symbol!(b"ohweb_destroy\0"),
                    free: symbol!(b"ohweb_free\0"),
                    pump: symbol!(b"ohweb_pump\0"),
                });
            }
            Err(error) => errors.push(format!("WebKitGTK could not be loaded ({error})")),
        }
    }
    if errors.is_empty() {
        Err("the web view library is not installed next to the game".into())
    } else {
        Err(errors.join("; "))
    }
}

struct Runtime {
    api: Option<Api>,
    reason: String,
}

thread_local! {
    static RUNTIME: RefCell<Option<Runtime>> = const { RefCell::new(None) };
}

fn take_text(api: &Api, value: *mut c_char) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let text = unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned();
    unsafe { (api.free)(value) };
    Some(text)
}

fn display_kind() -> Result<u32, String> {
    let name = DisplayServer::singleton().get_name().to_string();
    match name.as_str() {
        "Windows" => Ok(1),
        "macOS" => Ok(2),
        "X11" => Ok(3),
        "headless" => Err("there is no window to hold a web view (headless)".into()),
        other => Err(format!("web views are not supported on the {other} display server")),
    }
}

fn runtime() -> (Option<Api>, String) {
    RUNTIME.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let built = (|| -> Result<Api, String> {
                if std::env::var("OH_WEBPANEL").map(|value| value == "0").unwrap_or(false) {
                    return Err("web views are turned off (OH_WEBPANEL=0)".into());
                }
                display_kind()?;
                let api = load_api()?;
                if unsafe { (api.abi)() } != ABI_VERSION {
                    return Err("the web view library is from another build".into());
                }
                let mut detail: *mut c_char = std::ptr::null_mut();
                let ok = unsafe { (api.probe)(&mut detail) };
                let detail = take_text(&api, detail).unwrap_or_default();
                if ok == 1 {
                    Ok(api)
                } else {
                    Err(detail)
                }
            })();
            *slot = Some(match built {
                Ok(api) => Runtime { api: Some(api), reason: String::new() },
                Err(reason) => Runtime { api: None, reason },
            });
        }
        let runtime = slot.as_ref().unwrap();
        (runtime.api, runtime.reason.clone())
    })
}

fn data_dir() -> PathBuf {
    if let Ok(root) = std::env::var("OH_NATIVE_ROOT") {
        if !root.is_empty() {
            return PathBuf::from(root).join("native-cache").join("webview");
        }
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(&home).join("AppData").join("Roaming"))
    } else if cfg!(target_os = "macos") {
        PathBuf::from(&home).join("Library").join("Application Support")
    } else {
        std::env::var("XDG_DATA_HOME").ok().filter(|value| value.starts_with('/')).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(&home).join(".local").join("share"))
    };
    base.join("Open Historia Native").join("native-cache").join("webview")
}

fn c_text(value: &str) -> CString {
    CString::new(value.replace('\0', " ")).unwrap_or_default()
}

#[derive(GodotClass)]
#[class(base = Control)]
pub struct WebPanel {
    base: Base<Control>,
    api: Option<Api>,
    handle: Handle,
    live: bool,
    applied: Option<[i64; 4]>,
    shown: Option<bool>,
    error: String,
    loaded_url: String,
    #[var]
    allowed: GString,
    #[var]
    keep_hidden: bool,
    #[var]
    take_focus: bool,
    #[var]
    background: Color,
}

#[godot_api]
impl IControl for WebPanel {
    fn init(base: Base<Control>) -> Self {
        Self {
            base,
            api: None,
            handle: std::ptr::null_mut(),
            live: false,
            applied: None,
            shown: None,
            error: String::new(),
            loaded_url: String::new(),
            allowed: GString::new(),
            keep_hidden: false,
            take_focus: false,
            background: Color::from_rgba(0.0, 0.0, 0.0, 1.0),
        }
    }

    fn ready(&mut self) {
        self.base_mut().set_process(true);
    }

    fn process(&mut self, _delta: f64) {
        let Some(api) = self.api else { return };
        unsafe { (api.pump)() };
        if self.handle.is_null() {
            return;
        }
        if !self.live {
            match unsafe { (api.poll)(self.handle) } {
                1 => {
                    self.live = true;
                    self.applied = None;
                    self.shown = None;
                }
                -1 => {
                    self.live = false;
                }
                _ => {}
            }
        }
        self.sync();
        let mut events = Vec::new();
        for _ in 0..256 {
            match take_text(&api, unsafe { (api.next_event)(self.handle) }) {
                Some(event) => events.push(event),
                None => break,
            }
        }
        if events.is_empty() {
            return;
        }
        let mut node = self.to_gd();
        for event in events {
            let mut chars = event.chars();
            let tag = chars.next().unwrap_or(' ');
            let rest = chars.as_str().to_string();
            let name = match tag {
                'm' => "message",
                'k' => "key_pressed",
                'o' => "open_external",
                'l' => {
                    self.loaded_url = rest.clone();
                    "page_loaded"
                }
                'r' => "opened",
                'e' => {
                    self.error = rest.clone();
                    let handle = std::mem::replace(&mut self.handle, std::ptr::null_mut());
                    unsafe { (api.destroy)(handle) };
                    "failed"
                }
                _ => continue,
            };
            if tag == 'r' {
                node.call_deferred("emit_signal", &[name.to_variant()]);
            } else {
                node.call_deferred("emit_signal", &[name.to_variant(), GString::from(rest.as_str()).to_variant()]);
            }
            if self.handle.is_null() {
                break;
            }
        }
    }

    fn exit_tree(&mut self) {
        if let (Some(api), false) = (self.api, self.handle.is_null()) {
            unsafe { (api.set_visible)(self.handle, 0) };
            self.shown = Some(false);
        }
    }

    fn on_notification(&mut self, what: godot::classes::notify::ControlNotification) {
        if what == godot::classes::notify::ControlNotification::PREDELETE {
            self.close();
        }
    }
}

impl WebPanel {
    fn host_window(&self) -> (Option<Gd<Window>>, i32) {
        let mut window = self.base().get_window();
        while let Some(current) = window.clone() {
            if !current.is_embedded() {
                let id = current.get_window_id();
                return (Some(current), id);
            }
            window = current.get_parent().and_then(|parent| parent.try_cast::<Node>().ok()).and_then(|node| node.get_window());
        }
        (None, 0)
    }

    fn screen_rect(&self) -> Rect2 {
        let base = self.base();
        let size = base.get_size();
        let Some(viewport) = base.get_viewport() else {
            return Rect2::new(Vector2::ZERO, Vector2::ZERO);
        };
        let transform = viewport.get_screen_transform() * base.get_global_transform_with_canvas();
        let a = transform * Vector2::ZERO;
        let b = transform * size;
        Rect2::new(Vector2::new(a.x.min(b.x), a.y.min(b.y)), Vector2::new((b.x - a.x).abs(), (b.y - a.y).abs()))
    }

    fn unclipped(&self) -> bool {
        let base = self.base();
        let mine = base.get_global_rect();
        let mut node = base.get_parent();
        while let Some(current) = node {
            if let Ok(control) = current.clone().try_cast::<Control>() {
                if control.is_clipping_contents() {
                    let clip = control.get_global_rect().grow(1.0);
                    if !clip.encloses(mine) {
                        return false;
                    }
                }
            }
            if current.is_class("Window") {
                break;
            }
            node = current.get_parent();
        }
        true
    }

    fn covered(&self) -> bool {
        let base = self.base();
        let Some(viewport) = base.get_viewport() else { return false };
        let mine = self.screen_rect();
        let embedder_transform = viewport.get_screen_transform();
        for window in viewport.get_embedded_subwindows().iter_shared() {
            if !window.is_visible() {
                continue;
            }
            let origin = embedder_transform * Vector2::new(window.get_position().x as f32, window.get_position().y as f32);
            let size = Vector2::new(window.get_size().x as f32, window.get_size().y as f32);
            if Rect2::new(origin, size).intersects(mine) {
                return true;
            }
        }
        false
    }

    fn sync(&mut self) {
        let Some(api) = self.api else { return };
        if self.handle.is_null() {
            return;
        }
        let rect = self.screen_rect();
        let (_, window_id) = self.host_window();
        let minimised = DisplayServer::singleton().window_get_mode_ex().window_id(window_id).done() == WindowMode::MINIMIZED;
        let visible = !self.keep_hidden && self.base().is_visible_in_tree() && !minimised && rect.size.x >= 2.0 && rect.size.y >= 2.0 && self.unclipped() && !self.covered();
        let wanted = [rect.position.x.round() as i64, rect.position.y.round() as i64, rect.size.x.round() as i64, rect.size.y.round() as i64];
        if visible && self.applied != Some(wanted) {
            unsafe { (api.set_bounds)(self.handle, wanted[0] as f64, wanted[1] as f64, wanted[2] as f64, wanted[3] as f64) };
            self.applied = Some(wanted);
        }
        if self.shown != Some(visible) {
            unsafe { (api.set_visible)(self.handle, visible as u8) };
            self.shown = Some(visible);
        }
    }

    fn create(&mut self, url: &str, html: &str) -> bool {
        self.error.clear();
        let (api, reason) = runtime();
        let Some(api) = api else {
            self.error = reason;
            return false;
        };
        self.api = Some(api);
        let kind = match display_kind() {
            Ok(kind) => kind,
            Err(reason) => {
                self.error = reason;
                return false;
            }
        };
        let (_, window_id) = self.host_window();
        let server = DisplayServer::singleton();
        let handle_type = if kind == 2 { HandleType::WINDOW_VIEW } else { HandleType::WINDOW_HANDLE };
        let window = server.window_get_native_handle_ex(handle_type).window_id(window_id).done();
        let display = server.window_get_native_handle_ex(HandleType::DISPLAY_HANDLE).window_id(window_id).done();
        if window == 0 {
            self.error = "the game window has no native handle".into();
            return false;
        }
        let rect = self.screen_rect();
        let url_text = c_text(url);
        let html_text = c_text(html);
        let dir_text = c_text(&data_dir().to_string_lossy());
        let allowed_text = c_text(&self.allowed.to_string());
        let color = self.background;
        let config = Config {
            kind,
            window: window as u64,
            display: display as u64,
            x: rect.position.x as f64,
            y: rect.position.y as f64,
            width: rect.size.x.max(1.0) as f64,
            height: rect.size.y.max(1.0) as f64,
            url: if url.is_empty() { std::ptr::null() } else { url_text.as_ptr() },
            html: if html.is_empty() { std::ptr::null() } else { html_text.as_ptr() },
            data_dir: dir_text.as_ptr(),
            allowed: allowed_text.as_ptr(),
            visible: 0,
            focused: self.take_focus as u8,
            devtools: Os::singleton().is_debug_build() as u8,
            background: color.to_u32(godot::builtin::ColorChannelOrder::RGBA),
        };
        let mut error: *mut c_char = std::ptr::null_mut();
        let handle = unsafe { (api.create)(&config, &mut error) };
        let message = take_text(&api, error);
        if handle.is_null() {
            self.error = message.unwrap_or_else(|| "the web view could not be made".into());
            return false;
        }
        self.handle = handle;
        self.live = false;
        self.applied = None;
        self.shown = Some(false);
        self.sync();
        true
    }
}

#[godot_api]
impl WebPanel {
    #[signal]
    fn message(text: GString);

    #[signal]
    fn key_pressed(key: GString);

    #[signal]
    fn open_external(url: GString);

    #[signal]
    fn page_loaded(url: GString);

    #[signal]
    fn opened();

    #[signal]
    fn failed(reason: GString);

    #[func]
    fn is_available() -> bool {
        runtime().0.is_some()
    }

    #[func]
    fn unavailable_reason() -> GString {
        GString::from(runtime().1.as_str())
    }

    #[func]
    fn open_url(&mut self, url: GString) -> bool {
        let url = url.to_string();
        if let (Some(api), false) = (self.api, self.handle.is_null()) {
            let text = c_text(&url);
            return unsafe { (api.load_url)(self.handle, text.as_ptr()) } == 1;
        }
        self.create(&url, "")
    }

    #[func]
    fn open_html(&mut self, html: GString) -> bool {
        let html = html.to_string();
        if let (Some(api), false) = (self.api, self.handle.is_null()) {
            let text = c_text(&html);
            return unsafe { (api.load_html)(self.handle, text.as_ptr()) } == 1;
        }
        self.create("", &html)
    }

    #[func]
    fn eval(&mut self, script: GString) -> bool {
        let (Some(api), false) = (self.api, self.handle.is_null()) else { return false };
        let text = c_text(&script.to_string());
        unsafe { (api.eval)(self.handle, text.as_ptr()) == 1 }
    }

    #[func]
    fn post_message(&mut self, text: GString) -> bool {
        let quoted = Json::stringify(&text.to_variant());
        self.eval(GString::from(format!("window.dispatchEvent(new MessageEvent('oh-message', {{data: {quoted}}}));").as_str()))
    }

    #[func]
    fn focus_web(&mut self) -> bool {
        let (Some(api), false) = (self.api, self.handle.is_null()) else { return false };
        unsafe { (api.focus)(self.handle, 1) == 1 }
    }

    #[func]
    fn focus_app(&mut self) -> bool {
        let (Some(api), false) = (self.api, self.handle.is_null()) else { return false };
        unsafe { (api.focus)(self.handle, 0) == 1 }
    }

    #[func]
    fn close(&mut self) {
        if let (Some(api), false) = (self.api, self.handle.is_null()) {
            let handle = std::mem::replace(&mut self.handle, std::ptr::null_mut());
            unsafe { (api.destroy)(handle) };
        }
        self.live = false;
        self.applied = None;
        self.shown = None;
        self.loaded_url.clear();
    }

    #[func]
    fn is_live(&self) -> bool {
        !self.handle.is_null() && self.live
    }

    #[func]
    fn is_open(&self) -> bool {
        !self.handle.is_null()
    }

    #[func]
    fn is_shown(&self) -> bool {
        !self.handle.is_null() && self.live && self.shown == Some(true)
    }

    #[func]
    fn get_error(&self) -> GString {
        GString::from(self.error.as_str())
    }

    #[func]
    fn get_loaded_url(&self) -> GString {
        GString::from(self.loaded_url.as_str())
    }

    #[func]
    fn get_current_url(&self) -> GString {
        let (Some(api), false) = (self.api, self.handle.is_null()) else { return GString::new() };
        GString::from(take_text(&api, unsafe { (api.url)(self.handle) }).unwrap_or_default().as_str())
    }

    #[func]
    fn get_native_rect(&self) -> Rect2 {
        match self.applied {
            Some([x, y, w, h]) => Rect2::new(Vector2::new(x as f32, y as f32), Vector2::new(w as f32, h as f32)),
            None => Rect2::new(Vector2::ZERO, Vector2::ZERO),
        }
    }

    #[func]
    fn sync_now(&mut self) {
        self.sync();
    }
}

impl Drop for WebPanel {
    fn drop(&mut self) {
        if let (Some(api), false) = (self.api, self.handle.is_null()) {
            let handle = std::mem::replace(&mut self.handle, std::ptr::null_mut());
            unsafe { (api.destroy)(handle) };
        }
    }
}
