use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use webview2_com::Microsoft::Web::WebView2::Win32::{CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2EnvironmentOptions};
use webview2_com::{CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler};
use windows::Win32::Foundation::HWND;
use windows_core::{HSTRING, PCWSTR};

enum Stage {
    Starting,
    Warming(ICoreWebView2Environment),
    Ready(ICoreWebView2Environment),
    Failed(String),
}

type Slot = Rc<RefCell<Stage>>;
type Warm = Rc<RefCell<Option<Option<ICoreWebView2Controller>>>>;

struct Entry {
    folder: Option<PathBuf>,
    slot: Slot,
    warm: Warm,
    warm_started: bool,
}

thread_local! {
    static ENTRIES: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
}

fn with_entry<T>(folder: Option<&Path>, action: impl FnOnce(&mut Entry) -> T) -> Option<T> {
    ENTRIES.with(|entries| entries.borrow_mut().iter_mut().find(|entry| entry.folder.as_deref() == folder).map(action))
}

pub fn begin(folder: Option<&Path>) -> Result<(), String> {
    let failed = with_entry(folder, |entry| matches!(&*entry.slot.borrow(), Stage::Failed(_)));
    match failed {
        Some(false) => return Ok(()),
        Some(true) => ENTRIES.with(|entries| entries.borrow_mut().retain(|entry| entry.folder.as_deref() != folder)),
        None => {}
    }
    if let Some(dir) = folder {
        let _ = std::fs::create_dir_all(dir);
    }
    let slot: Slot = Rc::new(RefCell::new(Stage::Starting));
    let filled = slot.clone();
    let options = CoreWebView2EnvironmentOptions::default();
    unsafe {
        options.set_additional_browser_arguments(crate::BROWSER_ARGUMENTS.to_string());
        options.set_are_browser_extensions_enabled(false);
    }
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |error_code, environment| {
        *filled.borrow_mut() = match (error_code, environment) {
            (Ok(()), Some(environment)) => Stage::Warming(environment),
            (Err(error), _) => Stage::Failed(format!("WebView2 could not start: {error}")),
            (Ok(()), None) => Stage::Failed("WebView2 returned no environment".to_string()),
        };
        Ok(())
    }));
    let data = folder.map(|dir| HSTRING::from(dir.as_os_str())).unwrap_or_default();
    let options: ICoreWebView2EnvironmentOptions = options.into();
    unsafe { CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &data, &options, &handler) }.map_err(|error| format!("WebView2 could not start: {error}"))?;
    ENTRIES.with(|entries| entries.borrow_mut().push(Entry { folder: folder.map(Path::to_path_buf), slot, warm: Rc::new(RefCell::new(None)), warm_started: false }));
    Ok(())
}

pub fn poll(folder: Option<&Path>, parent: isize) -> Result<bool, String> {
    let known = with_entry(folder, |_| ()).is_some();
    if !known {
        begin(folder)?;
        return Ok(false);
    }
    with_entry(folder, |entry| {
        let stage = std::mem::replace(&mut *entry.slot.borrow_mut(), Stage::Starting);
        let (next, result) = match stage {
            Stage::Starting => (Stage::Starting, Ok(false)),
            Stage::Ready(environment) => (Stage::Ready(environment), Ok(true)),
            Stage::Failed(error) => (Stage::Failed(error.clone()), Err(error)),
            Stage::Warming(environment) => {
                if !entry.warm_started {
                    entry.warm_started = true;
                    let warm = entry.warm.clone();
                    let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |_error_code, controller| {
                        *warm.borrow_mut() = Some(controller);
                        Ok(())
                    }));
                    if unsafe { environment.CreateCoreWebView2Controller(HWND(parent as _), &handler) }.is_err() {
                        *entry.warm.borrow_mut() = Some(None);
                    }
                }
                let done = entry.warm.borrow_mut().take();
                match done {
                    Some(controller) => {
                        if let Some(controller) = controller {
                            let _ = unsafe { controller.Close() };
                        }
                        (Stage::Ready(environment), Ok(true))
                    }
                    None => (Stage::Warming(environment), Ok(false)),
                }
            }
        };
        *entry.slot.borrow_mut() = next;
        result
    })
    .unwrap_or(Ok(false))
}

pub fn ready(folder: Option<&Path>) -> Result<ICoreWebView2Environment, String> {
    with_entry(folder, |entry| match &*entry.slot.borrow() {
        Stage::Ready(environment) | Stage::Warming(environment) => Ok(environment.clone()),
        Stage::Failed(error) => Err(error.clone()),
        Stage::Starting => Err("WebView2 is still starting".into()),
    })
    .unwrap_or_else(|| Err("WebView2 was not started".into()))
}
