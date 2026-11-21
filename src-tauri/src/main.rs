//! Onecarat Agent Office: small always-on-top windows that show what Claude Code sessions are doing.
//!
//! One process, one window per session. The app only receives: hook inputs arrive on 127.0.0.1 from the
//! plugin's forwarder, are kept in memory, and are read by the window of their session. There is no code
//! path from a window (or from this process) toward Claude Code.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod router;
mod server;

use router::{slot_position, Rect, Routed, Router};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, PhysicalPosition, RunEvent, State, UserAttentionType, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const TITLE: &str = "Onecarat Agent Office";
const DEFAULT_PORT: u16 = 47821;
/// Inner size of a new window in logical pixels, and the smallest size it can be dragged to.
const WIN_W: f64 = 420.0;
const WIN_H: f64 = 262.0;
const MIN_W: f64 = 220.0;
const MIN_H: f64 = 140.0;
/// Distance from the screen edge and between windows, in logical pixels.
const MARGIN: f64 = 12.0;
const GAP: f64 = 8.0;

struct Shared {
    router: Mutex<Router>,
    /// Windows this app is closing itself (the session ended). Every other close is the user's.
    closed_by_app: Mutex<HashSet<String>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Lock that keeps working after a panic elsewhere: a poisoned lock must not take the windows down.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- commands the page may call: read its own events, set its own title, close itself ----------

/// The hook inputs of the calling window's session that came after `after`.
#[tauri::command]
fn poll(window: WebviewWindow, state: State<Shared>, after: u64) -> Value {
    let (epoch, events) = lock(&state.router).poll(window.label(), after);
    let events: Vec<Value> = events.iter().map(|e| json!([e.seq, e.at, &*e.hook])).collect();
    json!({ "epoch": epoch, "events": events })
}

/// The title bar (and the taskbar) says which folder the window belongs to and whether approval is awaited.
/// `label` is the page's word for "waiting for approval" in the user's language (the words live in one table,
/// packages/domain/src/i18n.ts); it is plain text for the title and nothing else.
#[tauri::command]
fn set_status(window: WebviewWindow, waiting: bool, folder: String, label: String) {
    let _ = window.set_title(&title_text(waiting, &folder, &label));
    // A window put away in the taskbar cannot show its frame and banner: its taskbar button lights up instead,
    // until the wait is over or the window is brought back.
    let put_away = window.is_minimized().unwrap_or(false);
    let _ = window.request_user_attention(if waiting && put_away { Some(UserAttentionType::Informational) } else { None });
}

fn title_text(waiting: bool, folder: &str, label: &str) -> String {
    let clean = |s: &str, max: usize| -> String { s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string() };
    let folder = clean(folder, 60);
    let name = if folder.is_empty() { TITLE.to_string() } else { folder };
    if !waiting {
        return name;
    }
    let label = clean(label, 40);
    if label.is_empty() { format!("⚠ {name}") } else { format!("⚠ {label} — {name}") }
}

/// The page finished its goodbye. Ignored when the window was given to another session in the meantime.
#[tauri::command]
fn close_me(window: WebviewWindow, state: State<Shared>, epoch: u64) {
    if lock(&state.router).epoch(window.label()) != Some(epoch) {
        return;
    }
    lock(&state.closed_by_app).insert(window.label().to_string());
    let _ = window.destroy();
}

// ---------- windows ----------

fn open_window(app: &AppHandle, label: &str, slot: usize) {
    let work = work_area(app);
    let scale = work.map(|(_, s)| s).unwrap_or(1.0);
    // First guess of the outer size (title bar and borders); corrected below once the window exists.
    let guess = work.map(|(r, s)| slot_position(r, ((WIN_W + 16.0) * s) as i32, ((WIN_H + 40.0) * s) as i32, slot, (MARGIN * s) as i32, (GAP * s) as i32));
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(TITLE)
        .inner_size(WIN_W, WIN_H)
        .min_inner_size(MIN_W, MIN_H)
        .resizable(true)
        .maximizable(false)
        // Like any app, a window can be put away in the taskbar and brought back from there.
        .minimizable(true)
        .always_on_top(true)
        // The user is typing in the terminal: a new window must not take the keyboard.
        .focused(false);
    if let Some((x, y)) = guess {
        builder = builder.position(x as f64 / scale, y as f64 / scale);
    }
    // The first three are the defaults of the window component (they are replaced, not added to, once any
    // argument is given). The rest keeps the page awake while its window is in the taskbar: a browser slows
    // the timers of a page nobody sees (to one a minute after five minutes), and this page must go on reading
    // its events, so that the title and the taskbar button tell of a wait for approval without delay.
    #[allow(unused_mut)]
    let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows");
    // Only in the build made for tests/app/check-app.mjs (never shipped): lets the check look inside the windows.
    // The check can also ask for one of the two languages there, so that both are looked at on one PC. The
    // shipped app has no such choice: it follows the Windows display language.
    #[cfg(feature = "inspect")]
    if let Ok(port) = std::env::var("ONECARAT_OFFICE_INSPECT_PORT") {
        if port.parse::<u16>().is_ok() {
            args.push_str(&format!(" --remote-debugging-port={port}"));
            match std::env::var("ONECARAT_OFFICE_INSPECT_LANG").as_deref() {
                Ok("ja") => args.push_str(" --lang=ja"),
                Ok("en") => args.push_str(" --lang=en-US"),
                _ => {}
            }
        }
    }
    builder = builder.additional_browser_args(&args);
    match builder.build() {
        Ok(win) => {
            if let (Some((r, s)), Ok(size)) = (work, win.outer_size()) {
                let (x, y) = slot_position(r, size.width as i32, size.height as i32, slot, (MARGIN * s) as i32, (GAP * s) as i32);
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
        Err(_) => lock(&app.state::<Shared>().router).window_closed(label, false),
    }
}

/// The primary monitor's work area (without the taskbar) in physical pixels, and its scale factor.
fn work_area(app: &AppHandle) -> Option<(Rect, f64)> {
    let m = app.primary_monitor().ok().flatten()?;
    let wa = m.work_area();
    Some((Rect { x: wa.position.x, y: wa.position.y, w: wa.size.width as i32, h: wa.size.height as i32 }, m.scale_factor()))
}

fn open_placeholder(app: &AppHandle) {
    let made = lock(&app.state::<Shared>().router).placeholder();
    if let Some((label, slot)) = made {
        open_window(app, &label, slot);
    }
}

// ---------- the local listener ----------

fn header<'a>(rq: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    rq.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

fn owned(rq: &tiny_http::Request, name: &'static str) -> Option<String> {
    header(rq, name).map(str::to_owned)
}

fn serve(server: Arc<tiny_http::Server>, app: AppHandle, port: u16, token: Arc<String>) {
    loop {
        let mut rq = match server.recv() {
            Ok(rq) => rq,
            Err(_) => return,
        };
        let method = rq.method().as_str().to_string();
        let path = rq.url().split('?').next().unwrap_or("").to_string();
        let from_browser = header(&rq, "Origin").is_some() || header(&rq, "Sec-Fetch-Site").is_some() || header(&rq, "Sec-Fetch-Mode").is_some();
        let (host, sent_token, nonce, hook_time) = (owned(&rq, "Host"), owned(&rq, "X-Office-Token"), owned(&rq, "X-Office-Nonce"), owned(&rq, "X-Office-Hook-Time"));
        let content_length = rq.body_length();
        let mut body = Vec::new();
        let mut request = server::Request {
            method: &method,
            path: &path,
            host: host.as_deref(),
            token: sent_token.as_deref(),
            nonce: nonce.as_deref(),
            from_browser,
            hook_time: hook_time.as_deref(),
            content_length,
            body: &[],
        };
        // The body is read only for a hook from a sender that holds the token (server::wants_body).
        let read_body = server::wants_body(&request, port, &token);
        if read_body {
            // One byte more than allowed is enough to know it is too large.
            let _ = rq.as_reader().take(server::MAX_BODY as u64 + 1).read_to_end(&mut body);
            request.body = &body;
        }
        let windows = lock(&app.state::<Shared>().router).window_count();
        let reply = server::decide(&request, port, &token, now_ms(), env!("CARGO_PKG_VERSION"), windows);
        let mut response = tiny_http::Response::from_string(reply.body).with_status_code(reply.status);
        if let Ok(h) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
            response = response.with_header(h);
        }
        // A body that was announced and not read: the HTTP library waits for the rest of it when the request is
        // let go (bodies of up to 1024 bytes it has read already). That wait must not happen on a listener
        // thread, or a client that sends nothing would hold it. Such a request is answered on a thread of its own.
        let waits_for_more = content_length.is_some_and(|n| n > 1024) || header(&rq, "Transfer-Encoding").is_some() || header(&rq, "Expect").is_some();
        let unread = !read_body && waits_for_more;
        if unread {
            let _ = std::thread::Builder::new().spawn(move || {
                let _ = rq.respond(response);
            });
        } else {
            let _ = rq.respond(response);
        }

        match reply.action {
            server::Action::None => {}
            server::Action::Hook(hook, at) => {
                let routed = lock(&app.state::<Shared>().router).route(hook, at);
                if let Routed::Created { label, slot } = routed {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || open_window(&handle, &label, slot));
                }
            }
            server::Action::Show => {
                lock(&app.state::<Shared>().router).show_again();
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if lock(&handle.state::<Shared>().router).window_count() == 0 {
                        open_placeholder(&handle);
                    }
                });
            }
            server::Action::Shutdown => app.exit(0),
        }
    }
}

// ---------- the runtime file: where the forwarder finds the port and the per-launch token ----------
// KEEP IN SYNC with plugin/onecarat-agent-office/scripts/forward-lib.mjs (runtimeFilePath) and packages/launcher.

fn runtime_file() -> Option<PathBuf> {
    let dir = match std::env::var_os("ONECARAT_OFFICE_RUNTIME_DIR").filter(|v| !v.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(server::APP_NAME),
    };
    Some(dir.join("bridge.json"))
}

fn write_runtime_file(port: u16, token: &str) -> std::io::Result<()> {
    let file = runtime_file().ok_or_else(|| std::io::Error::other("no LOCALAPPDATA"))?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let info = json!({ "port": port, "token": token, "pid": std::process::id(), "startedAt": now_ms(), "version": env!("CARGO_PKG_VERSION") });
    let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, info.to_string())?;
    std::fs::rename(&tmp, &file)
}

/// Remove the file only if it is still ours (another launch may have replaced it).
fn remove_runtime_file() {
    let Some(file) = runtime_file() else { return };
    let ours = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|v| v["pid"] == json!(std::process::id()));
    if ours {
        let _ = std::fs::remove_file(file);
    }
}

fn new_token() -> Option<String> {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `--port N` is the only option.
fn port_from_args() -> u16 {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == "--port").and_then(|i| args.get(i + 1)).and_then(|v| v.parse::<u16>().ok()).filter(|p| *p >= 1024).unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::title_text;

    #[test]
    fn the_title_names_the_folder_and_says_the_wait_in_the_pages_words() {
        assert_eq!(title_text(false, "alpha", "承認待ち"), "alpha");
        assert_eq!(title_text(false, "", ""), "Onecarat Agent Office");
        assert_eq!(title_text(true, "alpha", "承認待ち"), "⚠ 承認待ち — alpha");
        assert_eq!(title_text(true, "alpha", "Needs your approval"), "⚠ Needs your approval — alpha");
        assert_eq!(title_text(true, "", "Needs your approval"), "⚠ Needs your approval — Onecarat Agent Office");
        // The page is not trusted with more than a short plain text.
        assert_eq!(title_text(true, "a\u{0}l\npha", "Wait\r\ning\u{7}"), "⚠ Waiting — alpha");
        assert_eq!(title_text(true, "alpha", ""), "⚠ alpha");
        assert_eq!(title_text(true, "alpha", &"x".repeat(500)).chars().count(), 2 + 40 + 3 + 5);
    }
}

fn main() {
    let port = port_from_args();
    let Some(token) = new_token() else { std::process::exit(2) };
    let token = Arc::new(token);
    // Loopback only. The port is also what keeps the app single: a second launch cannot bind it and leaves.
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(_) => std::process::exit(3),
    };

    let setup_token = token.clone();
    let app = tauri::Builder::default()
        .manage(Shared { router: Mutex::new(Router::new()), closed_by_app: Mutex::new(HashSet::new()) })
        .invoke_handler(tauri::generate_handler![poll, set_status, close_me])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<Shared>();
                let by_app = lock(&state.closed_by_app).remove(window.label());
                lock(&state.router).window_closed(window.label(), !by_app);
            }
        })
        .setup(move |app| {
            open_placeholder(app.handle());
            for _ in 0..3 {
                let (server, handle, token) = (server.clone(), app.handle().clone(), setup_token.clone());
                std::thread::spawn(move || serve(server, handle, port, token));
            }
            // Written last: from now on the forwarder may post.
            write_runtime_file(port, &setup_token)?;
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(_) => std::process::exit(4),
    };
    // Closing the last window ends the app (Tauri's default); the runtime file goes with it.
    app.run(|_, event| {
        if let RunEvent::Exit = event {
            remove_runtime_file();
        }
    });
}
