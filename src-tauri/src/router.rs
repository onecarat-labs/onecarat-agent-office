//! Which window shows which Claude Code session. Pure bookkeeping (no windows are touched here), so the
//! separation of sessions can be tested without starting the app.
//!
//! Hook inputs are kept in memory only, per window, and only until that window closes. Nothing is written
//! to disk. The meaning of the events is decided in the page (the shared adapter and reducer); the only
//! fields read here are `session_id`, `cwd` and whether the event is `SessionEnd`.

use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::Arc;

/// More sessions than this get no window (their events are ignored until a window closes).
pub const MAX_WINDOWS: usize = 8;
/// Oldest hook inputs of a window are dropped beyond this.
pub const MAX_EVENTS: usize = 4000;
const MAX_ID_LEN: usize = 200;
const MAX_DISMISSED: usize = 500;

/// One stored hook input. Sent to the page as `[seq, at, hook]`.
#[derive(Clone)]
pub struct Stored {
    pub seq: u64,
    pub at: u64,
    pub hook: Arc<Value>,
}

struct Win {
    session: Option<String>,
    cwd: Option<String>,
    /// The session of this window has ended (its goodbye is showing). Such a window can be taken over.
    ended: bool,
    /// Changes whenever the window is given to another session: the page then starts from nothing.
    epoch: u64,
    slot: usize,
    events: VecDeque<Stored>,
}

/// What happened to one hook input.
#[derive(Debug, PartialEq, Eq)]
pub enum Routed {
    /// Stored for a window that already shows this session.
    Stored { label: String },
    /// Stored, and an existing window (waiting, or showing an ended session) now shows this session.
    Adopted { label: String },
    /// Stored, and a new window must be opened at this slot.
    Created { label: String, slot: usize },
    /// Not stored: not a usable hook input, a session whose window the user closed, or too many windows.
    Ignored,
}

#[derive(Default)]
pub struct Router {
    windows: BTreeMap<String, Win>,
    by_session: HashMap<String, String>,
    /// Sessions whose window the user closed. They get no window again until the app is asked to show.
    dismissed: HashSet<String>,
    seq: u64,
    epoch: u64,
    next_label: u64,
}

fn text<'a>(hook: &'a Value, key: &str) -> Option<&'a str> {
    hook.get(key).and_then(Value::as_str)
}

impl Router {
    pub fn new() -> Self {
        Self::default()
    }

    fn free_slot(&self) -> usize {
        let used: HashSet<usize> = self.windows.values().map(|w| w.slot).collect();
        (0..).find(|s| !used.contains(s)).unwrap_or(0)
    }

    fn new_window(&mut self) -> (String, usize) {
        self.next_label += 1;
        self.epoch += 1;
        let label = format!("w{}", self.next_label);
        let slot = self.free_slot();
        self.windows.insert(label.clone(), Win { session: None, cwd: None, ended: false, epoch: self.epoch, slot, events: VecDeque::new() });
        (label, slot)
    }

    /// A window that waits for its first session. `None` when one already waits, or there are too many windows.
    pub fn placeholder(&mut self) -> Option<(String, usize)> {
        if self.windows.len() >= MAX_WINDOWS || self.windows.values().any(|w| w.session.is_none()) {
            return None;
        }
        Some(self.new_window())
    }

    /// Take one hook input. Anything that is not an object with a usable `session_id` is ignored.
    pub fn route(&mut self, hook: Value, at: u64) -> Routed {
        let Some(sid) = text(&hook, "session_id").filter(|s| !s.is_empty() && s.len() <= MAX_ID_LEN).map(str::to_owned) else {
            return Routed::Ignored;
        };
        if self.dismissed.contains(&sid) {
            return Routed::Ignored;
        }
        let is_end = text(&hook, "hook_event_name") == Some("SessionEnd");
        let cwd = text(&hook, "cwd").map(str::to_owned);

        let routed = if let Some(label) = self.by_session.get(&sid).cloned() {
            Routed::Stored { label }
        } else if is_end {
            // The end of a session that has no window: nothing to show.
            return Routed::Ignored;
        } else if let Some(label) = self.adoptable(cwd.as_deref()) {
            self.epoch += 1;
            let epoch = self.epoch;
            let win = self.windows.get_mut(&label).expect("adoptable window exists");
            if let Some(old) = win.session.take() {
                self.by_session.remove(&old);
            }
            win.events.clear();
            win.epoch = epoch;
            win.session = Some(sid.clone());
            self.by_session.insert(sid.clone(), label.clone());
            Routed::Adopted { label }
        } else if self.windows.len() >= MAX_WINDOWS {
            return Routed::Ignored;
        } else {
            let (label, slot) = self.new_window();
            self.windows.get_mut(&label).expect("just made").session = Some(sid.clone());
            self.by_session.insert(sid.clone(), label.clone());
            Routed::Created { label, slot }
        };

        let label = match &routed {
            Routed::Stored { label } | Routed::Adopted { label } | Routed::Created { label, .. } => label.clone(),
            Routed::Ignored => return routed,
        };
        self.seq += 1;
        let seq = self.seq;
        let win = self.windows.get_mut(&label).expect("routed window exists");
        win.ended = is_end;
        if win.cwd.is_none() || cwd.is_some() {
            win.cwd = cwd.or(win.cwd.take());
        }
        if win.events.len() >= MAX_EVENTS {
            win.events.pop_front();
        }
        win.events.push_back(Stored { seq, at, hook: Arc::new(hook) });
        routed
    }

    /// A window a new session may take: one whose session ended in the same folder (/clear, a restart), else one
    /// that still waits for its first session.
    fn adoptable(&self, cwd: Option<&str>) -> Option<String> {
        let same_folder = self.windows.iter().find(|(_, w)| w.ended && w.session.is_some() && cwd.is_some() && w.cwd.as_deref() == cwd);
        let waiting = self.windows.iter().filter(|(_, w)| w.session.is_none()).min_by_key(|(_, w)| w.slot);
        same_folder.or(waiting).map(|(l, _)| l.clone())
    }

    /// The hook inputs of this window after `after`, and the window's epoch. An unknown window has none.
    pub fn poll(&self, label: &str, after: u64) -> (u64, Vec<Stored>) {
        match self.windows.get(label) {
            Some(w) => (w.epoch, w.events.iter().filter(|e| e.seq > after).cloned().collect()),
            None => (0, Vec::new()),
        }
    }

    pub fn epoch(&self, label: &str) -> Option<u64> {
        self.windows.get(label).map(|w| w.epoch)
    }

    /// The window is gone. `by_user`: the user closed it, so its session gets no window again by itself.
    pub fn window_closed(&mut self, label: &str, by_user: bool) {
        if let Some(w) = self.windows.remove(label) {
            if let Some(sid) = w.session {
                self.by_session.remove(&sid);
                if by_user && !w.ended {
                    if self.dismissed.len() >= MAX_DISMISSED {
                        self.dismissed.clear();
                    }
                    self.dismissed.insert(sid);
                }
            }
        }
    }

    /// The user asked for the office again: sessions whose window was closed may get one again.
    pub fn show_again(&mut self) {
        self.dismissed.clear();
    }

    pub fn window_count(&self) -> usize {
        self.windows.len()
    }
}

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Top-left corner of the window in `slot`: slot 0 is the top right corner of the work area, the next ones go
/// down, and when the column is full the next column starts to the left. Windows never overlap.
pub fn slot_position(work: Rect, win_w: i32, win_h: i32, slot: usize, margin: i32, gap: i32) -> (i32, i32) {
    let rows = (((work.h - 2 * margin + gap) / (win_h + gap).max(1)).max(1)) as usize;
    let cols = (((work.w - 2 * margin + gap) / (win_w + gap).max(1)).max(1)) as usize;
    let col = ((slot / rows) % cols) as i32;
    let row = (slot % rows) as i32;
    let x = work.x + work.w - margin - win_w - col * (win_w + gap);
    let y = work.y + margin + row * (win_h + gap);
    (x.max(work.x), y.max(work.y))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hook(sid: &str, name: &str, cwd: &str) -> Value {
        json!({ "session_id": sid, "hook_event_name": name, "cwd": cwd })
    }

    #[test]
    fn first_session_takes_the_waiting_window_and_others_get_their_own() {
        let mut r = Router::new();
        let (first, slot) = r.placeholder().unwrap();
        assert_eq!(slot, 0);
        assert_eq!(r.placeholder(), None, "only one window waits at a time");
        assert_eq!(r.route(hook("a", "PreToolUse", "C:\\x"), 1), Routed::Adopted { label: first.clone() });
        assert_eq!(r.route(hook("a", "PostToolUse", "C:\\x"), 2), Routed::Stored { label: first.clone() });
        let b = r.route(hook("b", "UserPromptSubmit", "C:\\y"), 3);
        let Routed::Created { label: second, slot } = b else { panic!("expected a new window, got {b:?}") };
        assert_eq!(slot, 1);
        assert_ne!(first, second);
    }

    #[test]
    fn events_of_one_session_never_reach_another_window() {
        let mut r = Router::new();
        let (wa, _) = r.placeholder().unwrap();
        r.route(hook("a", "PreToolUse", "C:\\x"), 1);
        let Routed::Created { label: wb, .. } = r.route(hook("b", "PreToolUse", "C:\\x"), 2) else { panic!() };
        for i in 0..20 {
            r.route(hook(if i % 2 == 0 { "a" } else { "b" }, "PostToolUse", "C:\\x"), 10 + i);
        }
        let (_, ea) = r.poll(&wa, 0);
        let (_, eb) = r.poll(&wb, 0);
        assert_eq!(ea.len(), 11);
        assert_eq!(eb.len(), 11);
        assert!(ea.iter().all(|e| e.hook["session_id"] == "a"));
        assert!(eb.iter().all(|e| e.hook["session_id"] == "b"));
        // sequence numbers are increasing, and polling "after" returns only newer ones
        let last = ea.last().unwrap().seq;
        assert!(r.poll(&wa, last).1.is_empty());
        assert_eq!(r.poll("no-such-window", 0).1.len(), 0);
    }

    #[test]
    fn unusable_input_is_ignored() {
        let mut r = Router::new();
        r.placeholder();
        for v in [json!(null), json!(42), json!("text"), json!([1, 2]), json!({}), json!({ "session_id": 7 }), json!({ "session_id": "" }), json!({ "session_id": "x".repeat(201) })] {
            assert_eq!(r.route(v, 1), Routed::Ignored);
        }
        // An unknown event name, unknown fields and wrong types are stored as they are: the page ignores them.
        assert!(matches!(r.route(json!({ "session_id": "a", "hook_event_name": "FutureEvent", "cwd": 5, "new_field": { "x": [1] } }), 1), Routed::Adopted { .. }));
        // The end of a session nobody shows opens nothing.
        assert_eq!(r.route(hook("z", "SessionEnd", "C:\\x"), 2), Routed::Ignored);
    }

    #[test]
    fn a_window_closed_by_the_user_stays_closed_until_asked_again() {
        let mut r = Router::new();
        let (w, _) = r.placeholder().unwrap();
        r.route(hook("a", "PreToolUse", "C:\\x"), 1);
        r.window_closed(&w, true);
        assert_eq!(r.route(hook("a", "PostToolUse", "C:\\x"), 2), Routed::Ignored);
        r.show_again();
        assert!(matches!(r.route(hook("a", "PostToolUse", "C:\\x"), 3), Routed::Created { slot: 0, .. }));
    }

    #[test]
    fn a_window_closed_after_the_session_ended_does_not_block_a_resume() {
        let mut r = Router::new();
        let (w, _) = r.placeholder().unwrap();
        r.route(hook("a", "PreToolUse", "C:\\x"), 1);
        r.route(hook("a", "SessionEnd", "C:\\x"), 2);
        r.window_closed(&w, false);
        assert!(matches!(r.route(hook("a", "SessionStart", "C:\\x"), 3), Routed::Created { .. }));
    }

    #[test]
    fn a_new_session_in_the_same_folder_takes_over_the_ended_window() {
        let mut r = Router::new();
        let (w, _) = r.placeholder().unwrap();
        r.route(hook("a", "PreToolUse", "C:\\x"), 1);
        let before = r.epoch(&w).unwrap();
        r.route(hook("a", "SessionEnd", "C:\\x"), 2);
        // another folder: its own window
        assert!(matches!(r.route(hook("other", "SessionStart", "C:\\elsewhere"), 3), Routed::Created { .. }));
        // same folder (/clear): the same window, starting from nothing
        assert_eq!(r.route(hook("b", "SessionStart", "C:\\x"), 4), Routed::Adopted { label: w.clone() });
        let (epoch, events) = r.poll(&w, 0);
        assert_ne!(epoch, before);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].hook["session_id"], "b");
        // the old session is no longer shown anywhere; a late event of it gets a window of its own
        assert!(matches!(r.route(hook("a", "PostToolUse", "C:\\x"), 5), Routed::Created { .. }));
    }

    #[test]
    fn slots_are_reused_and_windows_are_limited() {
        let mut r = Router::new();
        let mut labels = Vec::new();
        for i in 0..MAX_WINDOWS {
            match r.route(hook(&format!("s{i}"), "PreToolUse", "C:\\x"), 1) {
                Routed::Created { label, slot } => {
                    assert_eq!(slot, i);
                    labels.push(label);
                }
                other => panic!("{other:?}"),
            }
        }
        assert_eq!(r.route(hook("one-too-many", "PreToolUse", "C:\\x"), 1), Routed::Ignored);
        r.window_closed(&labels[2], true);
        assert_eq!(r.window_count(), MAX_WINDOWS - 1);
        assert!(matches!(r.route(hook("one-too-many", "PreToolUse", "C:\\x"), 2), Routed::Created { slot: 2, .. }));
    }

    #[test]
    fn old_events_are_dropped_beyond_the_limit() {
        let mut r = Router::new();
        let (w, _) = r.placeholder().unwrap();
        for i in 0..(MAX_EVENTS as u64 + 10) {
            r.route(hook("a", "PreToolUse", "C:\\x"), i);
        }
        assert_eq!(r.poll(&w, 0).1.len(), MAX_EVENTS);
    }

    #[test]
    fn windows_start_top_right_and_do_not_overlap() {
        let work = Rect { x: 0, y: 0, w: 1920, h: 1040 };
        let (w, h, m, g) = (440, 300, 16, 12);
        let mut seen: Vec<(i32, i32)> = Vec::new();
        for slot in 0..MAX_WINDOWS {
            let (x, y) = slot_position(work, w, h, slot, m, g);
            assert!(x >= 0 && y >= 0 && x + w <= work.w && y + h <= work.h, "slot {slot} is off the work area: {x},{y}");
            for (ox, oy) in &seen {
                assert!((x - ox).abs() >= w || (y - oy).abs() >= h, "slot {slot} overlaps");
            }
            seen.push((x, y));
        }
        assert_eq!(seen[0], (1920 - 16 - 440, 16));
        assert_eq!(seen[1], (1920 - 16 - 440, 16 + 300 + 12));
        // a work area that does not start at 0,0 (taskbar on the left or top, second monitor)
        assert_eq!(slot_position(Rect { x: 100, y: 50, w: 1000, h: 700 }, w, h, 0, m, g), (100 + 1000 - 16 - 440, 66));
        // a work area smaller than the window: still on screen
        assert_eq!(slot_position(Rect { x: 0, y: 0, w: 300, h: 200 }, w, h, 3, m, g), (0, 16));
    }
}
