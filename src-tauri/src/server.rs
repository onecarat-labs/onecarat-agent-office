//! The local listener the hook forwarder posts to. It answers on 127.0.0.1 only, and it has no way to send
//! anything to Claude Code: requests come in, nothing goes out.
//!
//! `decide` is pure (request in, reply and action out) so the rules can be tested without a socket.
//! KEEP IN SYNC with plugin/onecarat-agent-office/scripts/forward.mjs and forward-lib.mjs (health proof, headers).

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

pub const APP_NAME: &str = "onecarat-agent-office";
/// The forwarder sends a few short fields (a few KB at most). Anything larger is not from it.
pub const MAX_BODY: usize = 64 * 1024;
const MAX_CLOCK_SKEW_MS: u64 = 60_000;

pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub host: Option<&'a str>,
    pub token: Option<&'a str>,
    pub nonce: Option<&'a str>,
    /// The request carries browser markers (Origin / Sec-Fetch-*). The forwarder is a Node process, never a browser.
    pub from_browser: bool,
    pub hook_time: Option<&'a str>,
    /// The length the request announced (Content-Length), if it did.
    pub content_length: Option<usize>,
    /// Empty unless `wants_body` said to read it.
    pub body: &'a [u8],
}

#[derive(Debug, PartialEq)]
pub enum Action {
    None,
    /// A hook input and the time it happened (ms).
    Hook(Value, u64),
    Show,
    Shutdown,
}

#[derive(Debug, PartialEq)]
pub struct Reply {
    pub status: u16,
    pub body: String,
    pub action: Action,
}

fn reply(status: u16, body: Value) -> Reply {
    Reply { status, body: body.to_string(), action: Action::None }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// HMAC-SHA256(token, "office-health:<nonce>") as hex: proves to the forwarder that this listener is the app
/// that wrote the runtime file, before the forwarder sends it anything.
pub fn health_proof(token: &str, nonce: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(format!("office-health:{nonce}").as_bytes());
    hex(&mac.finalize().into_bytes())
}

/// Compare without stopping at the first different byte.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn host_allowed(host: Option<&str>, port: u16) -> bool {
    match host {
        Some(h) => {
            let h = h.to_ascii_lowercase();
            h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}")
        }
        None => false,
    }
}

fn authorized(req: &Request, port: u16, token: &str) -> bool {
    host_allowed(req.host, port) && !req.from_browser && req.token.is_some_and(|t| same(t, token))
}

/// Whether the body is read at all: only a hook from a sender that holds the token, and only when it is not
/// announced as too large. Decided from the headers alone. Everyone else is answered without waiting for a
/// body: three clients without the token that announced a body and then sent nothing used to hold all three
/// listener threads, and no hook got through (audit 2026-11-21).
pub fn wants_body(req: &Request, port: u16, token: &str) -> bool {
    req.method == "POST" && req.path == "/hook" && authorized(req, port, token) && !req.content_length.is_some_and(|n| n > MAX_BODY)
}

pub fn decide(req: &Request, port: u16, token: &str, now_ms: u64, version: &str, windows: usize) -> Reply {
    // DNS-rebinding guard: only requests addressed to the loopback name we listen on.
    if !host_allowed(req.host, port) {
        return reply(403, json!({ "error": "host" }));
    }
    let authorized = authorized(req, port, token);
    match (req.method, req.path) {
        ("GET", "/api/health") => {
            if req.from_browser {
                return reply(403, json!({ "error": "forbidden" }));
            }
            let mut body = json!({ "app": APP_NAME, "ok": true, "version": version, "windows": windows });
            if let Some(n) = req.nonce.filter(|n| !n.is_empty() && n.len() <= 128 && n.bytes().all(|b| b.is_ascii_hexdigit())) {
                body["proof"] = json!(health_proof(token, n));
            }
            reply(200, body)
        }
        ("POST", "/hook") => {
            if !authorized {
                return reply(403, json!({ "error": "forbidden" }));
            }
            if req.content_length.is_some_and(|n| n > MAX_BODY) || req.body.len() > MAX_BODY {
                return reply(413, json!({ "error": "too large" }));
            }
            // Anything that is not a JSON object is accepted and dropped: a hook must never see an error.
            let action = match serde_json::from_slice::<Value>(req.body) {
                Ok(v) if v.is_object() => {
                    let at = req.hook_time.and_then(|t| t.parse::<u64>().ok()).filter(|t| t.abs_diff(now_ms) < MAX_CLOCK_SKEW_MS).unwrap_or(now_ms);
                    Action::Hook(v, at)
                }
                _ => Action::None,
            };
            Reply { status: 204, body: String::new(), action }
        }
        ("POST", "/api/show") if authorized => Reply { status: 200, body: json!({ "ok": true }).to_string(), action: Action::Show },
        ("POST", "/api/shutdown") if authorized => Reply { status: 200, body: json!({ "ok": true }).to_string(), action: Action::Shutdown },
        ("POST", "/api/show") | ("POST", "/api/shutdown") => reply(403, json!({ "error": "forbidden" })),
        _ => reply(404, json!({ "error": "not found" })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 47821;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    fn req<'a>(method: &'a str, path: &'a str, body: &'a [u8]) -> Request<'a> {
        Request { method, path, host: Some("127.0.0.1:47821"), token: Some(TOKEN), nonce: None, from_browser: false, hook_time: None, content_length: Some(body.len()), body }
    }
    fn run(r: &Request) -> Reply {
        decide(r, PORT, TOKEN, 1_000_000, "1.0.0", 2)
    }

    #[test]
    fn health_proves_the_token_without_showing_it() {
        let mut r = req("GET", "/api/health", b"");
        r.token = None;
        r.nonce = Some("00ff");
        let out = run(&r);
        assert_eq!(out.status, 200);
        let v: Value = serde_json::from_str(&out.body).unwrap();
        assert_eq!(v["app"], APP_NAME);
        assert_eq!(v["proof"], health_proof(TOKEN, "00ff"));
        assert!(!out.body.contains(TOKEN));
        // known answer, also pinned in packages/launcher/test/launcher.test.ts against the forwarder's healthProof
        assert_eq!(health_proof("key", "00ff"), "0884d92b18b8a98f9e33d75c799a00d5c9523cd19b49ea4207d4b176b79a110a");
        // a nonce that is not hex gets no proof
        r.nonce = Some("zz");
        let v: Value = serde_json::from_str(&run(&r).body).unwrap();
        assert!(v.get("proof").is_none());
    }

    #[test]
    fn a_hook_needs_the_token_and_must_not_come_from_a_browser() {
        let body = br#"{"session_id":"a","hook_event_name":"PreToolUse"}"#;
        let ok = run(&req("POST", "/hook", body));
        assert_eq!(ok.status, 204);
        assert!(matches!(ok.action, Action::Hook(_, 1_000_000)));

        let mut no_token = req("POST", "/hook", body);
        no_token.token = None;
        assert_eq!(run(&no_token).status, 403);
        let mut wrong = req("POST", "/hook", body);
        wrong.token = Some("0123456789abcdef0123456789abcdef0123456789abcdeX");
        assert_eq!(run(&wrong).status, 403);
        let mut browser = req("POST", "/hook", body);
        browser.from_browser = true;
        assert_eq!(run(&browser), Reply { status: 403, body: json!({ "error": "forbidden" }).to_string(), action: Action::None });
        let mut other_host = req("POST", "/hook", body);
        other_host.host = Some("evil.example:47821");
        assert_eq!(run(&other_host).status, 403);
        let mut no_host = req("POST", "/hook", body);
        no_host.host = None;
        assert_eq!(run(&no_host).status, 403);
    }

    #[test]
    fn broken_hook_bodies_are_accepted_and_dropped() {
        for body in [&b""[..], b"not json", b"[1,2,3]", b"\"text\"", b"null", b"{\"a\":", &[0xff, 0xfe, 0x00][..]] {
            let out = run(&req("POST", "/hook", body));
            assert_eq!(out.status, 204, "{body:?}");
            assert_eq!(out.action, Action::None, "{body:?}");
        }
        let big = vec![b' '; MAX_BODY + 1];
        assert_eq!(run(&req("POST", "/hook", &big)).status, 413);
    }

    #[test]
    fn a_body_is_read_only_for_a_hook_with_the_token() {
        let body = br#"{"session_id":"a"}"#;
        assert!(wants_body(&req("POST", "/hook", body), PORT, TOKEN));
        // announced without a length (chunked): read, up to the limit
        let mut chunked = req("POST", "/hook", body);
        chunked.content_length = None;
        assert!(wants_body(&chunked, PORT, TOKEN));

        let mut no_token = req("POST", "/hook", body);
        no_token.token = None;
        let mut wrong = req("POST", "/hook", body);
        wrong.token = Some("0123456789abcdef0123456789abcdef0123456789abcdeX");
        let mut browser = req("POST", "/hook", body);
        browser.from_browser = true;
        let mut other_host = req("POST", "/hook", body);
        other_host.host = Some("evil.example:47821");
        let mut too_large = req("POST", "/hook", body);
        too_large.content_length = Some(MAX_BODY + 1);
        for (name, r) in [("no token", &no_token), ("wrong token", &wrong), ("browser", &browser), ("other host", &other_host), ("too large", &too_large)] {
            assert!(!wants_body(r, PORT, TOKEN), "{name}");
        }
        // announced as too large: refused from the headers alone, with nothing read
        too_large.body = b"";
        assert_eq!(run(&too_large).status, 413);
        // no other request has a body worth reading, with the token or without
        for (m, p) in [("GET", "/api/health"), ("POST", "/api/show"), ("POST", "/api/shutdown"), ("GET", "/hook"), ("POST", "/other")] {
            assert!(!wants_body(&req(m, p, body), PORT, TOKEN), "{m} {p}");
        }
    }

    #[test]
    fn the_hook_time_is_used_only_when_it_is_close_to_now() {
        let body = br#"{"session_id":"a"}"#;
        let mut r = req("POST", "/hook", body);
        r.hook_time = Some("999500");
        assert!(matches!(run(&r).action, Action::Hook(_, 999_500)));
        r.hook_time = Some("5");
        assert!(matches!(run(&r).action, Action::Hook(_, 1_000_000)));
        r.hook_time = Some("soon");
        assert!(matches!(run(&r).action, Action::Hook(_, 1_000_000)));
    }

    #[test]
    fn show_and_shutdown_need_the_token_and_nothing_else_exists() {
        assert_eq!(run(&req("POST", "/api/show", b"")).action, Action::Show);
        assert_eq!(run(&req("POST", "/api/shutdown", b"")).action, Action::Shutdown);
        let mut r = req("POST", "/api/shutdown", b"");
        r.token = None;
        assert_eq!(run(&r).status, 403);
        assert_eq!(run(&r).action, Action::None);
        for (m, p) in [("GET", "/"), ("GET", "/hook"), ("POST", "/api/health"), ("GET", "/events"), ("POST", "/pty"), ("POST", "/api/prompt"), ("DELETE", "/hook")] {
            let out = run(&req(m, p, b""));
            assert_eq!(out.status, 404, "{m} {p}");
            assert_eq!(out.action, Action::None);
        }
    }
}
