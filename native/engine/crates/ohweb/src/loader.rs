#![allow(non_snake_case, non_upper_case_globals)]
use std::ffi::c_void;
use std::sync::OnceLock;

type Hresult = i32;
type CreateEnvironment = unsafe extern "system" fn(*const u16, *const u16, *mut c_void, *mut c_void) -> Hresult;
type VersionString = unsafe extern "system" fn(*const u16, *mut *mut u16) -> Hresult;

const MISSING: Hresult = 0x8007_007Eu32 as i32;
const FROM_ADDRESS: u32 = 0x4;
const UNCHANGED_REFCOUNT: u32 = 0x2;
const ALTERED_SEARCH_PATH: u32 = 0x8;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    fn GetModuleHandleExW(flags: u32, name: *const u16, module: *mut *mut c_void) -> i32;
    fn GetModuleFileNameW(module: *mut c_void, name: *mut u16, size: u32) -> u32;
}

struct Loader {
    create: Option<CreateEnvironment>,
    version: Option<VersionString>,
}

fn wide(text: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    text.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn own_folder() -> Option<std::path::PathBuf> {
    let mut module: *mut c_void = std::ptr::null_mut();
    let anchor = own_folder as *const () as *const u16;
    if unsafe { GetModuleHandleExW(FROM_ADDRESS | UNCHANGED_REFCOUNT, anchor, &mut module) } == 0 {
        return None;
    }
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetModuleFileNameW(module, buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 {
        return None;
    }
    use std::os::windows::ffi::OsStringExt;
    let path = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length]));
    path.parent().map(|parent| parent.to_path_buf())
}

fn loader() -> &'static Loader {
    static LOADER: OnceLock<Loader> = OnceLock::new();
    LOADER.get_or_init(|| {
        let mut candidates = Vec::new();
        if let Some(folder) = own_folder() {
            candidates.push(folder.join("WebView2Loader.dll"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(folder) = exe.parent() {
                candidates.push(folder.join("WebView2Loader.dll"));
            }
        }
        for candidate in candidates {
            if !candidate.exists() {
                continue;
            }
            let module = unsafe { LoadLibraryExW(wide(&candidate).as_ptr(), std::ptr::null_mut(), ALTERED_SEARCH_PATH) };
            if module.is_null() {
                continue;
            }
            let create = unsafe { GetProcAddress(module, c"CreateCoreWebView2EnvironmentWithOptions".as_ptr() as *const u8) };
            let version = unsafe { GetProcAddress(module, c"GetAvailableCoreWebView2BrowserVersionString".as_ptr() as *const u8) };
            if create.is_null() || version.is_null() {
                continue;
            }
            return Loader {
                create: Some(unsafe { std::mem::transmute::<*mut c_void, CreateEnvironment>(create) }),
                version: Some(unsafe { std::mem::transmute::<*mut c_void, VersionString>(version) }),
            };
        }
        Loader { create: None, version: None }
    })
}

pub fn present() -> bool {
    loader().create.is_some()
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn CreateCoreWebView2EnvironmentWithOptions(folder: *const u16, data: *const u16, options: *mut c_void, handler: *mut c_void) -> Hresult {
    match loader().create {
        Some(create) => unsafe { create(folder, data, options, handler) },
        None => MISSING,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn GetAvailableCoreWebView2BrowserVersionString(folder: *const u16, version: *mut *mut u16) -> Hresult {
    match loader().version {
        Some(read) => unsafe { read(folder, version) },
        None => MISSING,
    }
}

#[unsafe(no_mangle)]
#[used]
pub static __imp_CreateCoreWebView2EnvironmentWithOptions: CreateEnvironment = CreateCoreWebView2EnvironmentWithOptions;

#[unsafe(no_mangle)]
#[used]
pub static __imp_GetAvailableCoreWebView2BrowserVersionString: VersionString = GetAvailableCoreWebView2BrowserVersionString;
