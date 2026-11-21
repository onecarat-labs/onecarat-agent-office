// Every word Onecarat Agent Office shows, in Japanese and in English: the window, its title bar and the
// launcher's messages. This is the ONLY place for them. The language is never a setting: the window and the
// launcher each look at the Windows display language (Japanese -> 'ja', anything else -> 'en').
import type { BubbleKey } from './expression.ts';

export type Lang = 'en' | 'ja';

/** The language for a language tag such as "ja", "ja-JP" or "en-US". Anything that is not Japanese is English. */
export function langOf(tag: unknown): Lang {
  return typeof tag === 'string' && /^ja(?:[-_]|$)/i.test(tag.trim()) ? 'ja' : 'en';
}

// ---------- the window ----------

export interface Dict {
  manager: string;
  office: string;
  /** Shown while no Claude Code session has sent anything to this window yet. */
  waitingForSession: string;
  /** The banner while Claude Code waits for the user's approval. Also in the title bar: "⚠ … — folder". */
  needsApproval: string;
  /** Where the user answers it (the window itself cannot). */
  answerInTerminal: string;
  /** Subagents that do not fit in the window: "+3". */
  more: (n: number) => string;
}

export const dict: Record<Lang, Dict> = {
  en: {
    manager: 'Manager',
    office: 'Office',
    waitingForSession: 'Waiting for Claude Code…',
    needsApproval: 'Needs your approval',
    answerInTerminal: 'Answer in Claude Code',
    more: (n) => `${n} more at work`,
  },
  ja: {
    manager: 'マネージャー',
    office: 'オフィス',
    waitingForSession: 'Claude Code の動きを待っています',
    needsApproval: '承認待ち',
    answerInTerminal: 'Claude Code 側で答えてください',
    more: (n) => `ほかに ${n} 人が作業中`,
  },
};

/** Short labels shown above the figures. */
export const bubbleShort: Record<Lang, Record<BubbleKey, string>> = {
  en: {
    delegating: 'Delegating',
    thinking: 'Thinking',
    reading: 'Reading',
    editing: 'Editing',
    executing: 'Running',
    testing: 'Testing',
    researching: 'Research',
    reporting: 'Reporting',
    waiting_permission: 'Needs OK',
    blocked: 'Interrupted',
    retrying: 'Retrying',
    failed: 'Stuck',
    done: 'Done',
    done_unknown: 'Finished',
  },
  ja: {
    delegating: '指示中',
    thinking: '考え中',
    reading: '調査中',
    editing: '編集中',
    executing: '実行中',
    testing: 'テスト中',
    researching: '調べ中',
    reporting: '報告中',
    waiting_permission: '承認待ち',
    blocked: '中断',
    retrying: 'やり直し中',
    failed: 'うまくいかず',
    done: '完了',
    done_unknown: '終了',
  },
};

/** Display-only names for Claude Code's built-in subagent types. Custom agents keep their own name. */
export const builtinAlias: Record<Lang, Record<string, string>> = {
  en: { Explore: 'Explorer', Plan: 'Planner', 'general-purpose': 'General', 'claude-code-guide': 'Guide', 'statusline-setup': 'Status line', claude: 'General', 'web-fetch': 'Page fetch' },
  ja: { Explore: '調査', Plan: '設計', 'general-purpose': '汎用', 'claude-code-guide': 'ガイド', 'statusline-setup': 'ステータス設定', claude: '汎用', 'web-fetch': 'ページ取得' },
};

// ---------- the launcher (office.mjs check | start | stop | status) ----------

export interface LauncherText {
  usage: string;
  unknownCommand: (arg: string) => string;
  unknownOption: (arg: string) => string;
  badPort: string;
  windowsOnly: string;
  alreadyRunning: string;
  exeNotFound: (exe: string) => string;
  started: string;
  startedHow: string;
  portInUse: (port: number, other: number) => string;
  couldNotStart: string;
  notRunning: string;
  notRunningStale: string;
  /** Its process exists but the listener gave no answer in time: nothing is changed. */
  notAnswering: string;
  stopped: string;
  running: (version: string, pid: number, port: number, windows: string) => string;
  /** The lines of "check". Each starts with what is checked, so they read the same in both languages. */
  checkNodeOk: (version: string) => string;
  checkNodeOld: (version: string, min: number) => string;
  checkWindowsOk: string;
  checkWindowsNo: (platform: string) => string;
  checkApp: (path: string) => string;
  checkAppMissing: (exe: string) => string;
  checkWebView: string;
}

export const launcherText: Record<Lang, LauncherText> = {
  en: {
    usage: 'Usage: office <check|start|stop|status> [--port N]',
    unknownCommand: (arg) => `unknown command: ${arg}`,
    unknownOption: (arg) => `unknown option: ${arg}`,
    badPort: '--port needs a number between 1024 and 65535',
    windowsOnly: 'Onecarat Agent Office runs on Windows only.',
    alreadyRunning: 'Already running. Each Claude Code session gets its own small window at the top right of the screen.',
    exeNotFound: (exe) => `The app (${exe}) was not found next to the launcher.`,
    started: 'Started Onecarat Agent Office: a small window opened at the top right of the screen.',
    startedHow: 'It only shows what Claude Code is doing. Keep working in Claude Code as usual.',
    portInUse: (port, other) => `Could not start: port ${port} is in use (an older Onecarat Agent Office may still be running). Stop it, or use: start --port ${other}`,
    couldNotStart: 'Could not start the app. Run "check" to see what is missing.',
    notRunning: 'Not running.',
    notRunningStale: 'Not running (a stale runtime file was removed).',
    notAnswering: 'The app is running but did not answer in time. Nothing was changed. Try again; if it stays this way, close its windows and start it again.',
    stopped: 'Stopped. All windows are closed; nothing was saved.',
    running: (version, pid, port, windows) => `Running (version ${version}, pid ${pid}, port ${port}, windows: ${windows}).`,
    checkNodeOk: (version) => `Node.js ${version} — OK`,
    checkNodeOld: (version, min) => `Node.js ${version} — too old, need ${min}+`,
    checkWindowsOk: 'Windows: OK',
    checkWindowsNo: (platform) => `Windows: no (${platform}); this app runs on Windows only`,
    checkApp: (path) => `App: ${path}`,
    checkAppMissing: (exe) => `App: not found (${exe})`,
    checkWebView: 'The app shows its windows with Microsoft Edge WebView2, which is part of Windows 10 (current versions) and Windows 11.',
  },
  ja: {
    usage: '使い方: office <check|start|stop|status> [--port N]',
    unknownCommand: (arg) => `知らないコマンドです: ${arg}`,
    unknownOption: (arg) => `知らないオプションです: ${arg}`,
    badPort: '--port には 1024 から 65535 までの数を指定してください',
    windowsOnly: 'Onecarat Agent Office は Windows 専用です。',
    alreadyRunning: 'すでに動いています。Claude Code のセッションごとに、画面の右上に小さな窓が 1 枚出ます。',
    exeNotFound: (exe) => `アプリ（${exe}）が、起動スクリプトと同じ場所に見つかりません。`,
    started: 'Onecarat Agent Office を起動しました。画面の右上に小さな窓が開きました。',
    startedHow: '窓は Claude Code の様子を映すだけです。これまでどおり Claude Code で作業を続けてください。',
    portInUse: (port, other) => `起動できませんでした。ポート ${port} が使われています（以前の Onecarat Agent Office が動いたままかもしれません）。それを止めるか、start --port ${other} を使ってください。`,
    couldNotStart: 'アプリを起動できませんでした。"check" を実行して、足りないものを確かめてください。',
    notRunning: '動いていません。',
    notRunningStale: '動いていません（残っていた古い実行時ファイルを消しました）。',
    notAnswering: 'アプリは動いていますが、時間内に返事がありませんでした。何も変更していません。もう一度試してください。続く場合は、小窓をすべて閉じてから起動し直してください。',
    stopped: '終了しました。窓はすべて閉じました。保存したものはありません。',
    running: (version, pid, port, windows) => `動いています（バージョン ${version}、pid ${pid}、ポート ${port}、窓 ${windows} 枚）。`,
    checkNodeOk: (version) => `Node.js ${version} — OK`,
    checkNodeOld: (version, min) => `Node.js ${version} — 古すぎます。${min} 以上が必要です`,
    checkWindowsOk: 'Windows: OK',
    checkWindowsNo: (platform) => `Windows: いいえ（${platform}）。このアプリは Windows 専用です`,
    checkApp: (path) => `アプリ: ${path}`,
    checkAppMissing: (exe) => `アプリ: 見つかりません（${exe}）`,
    checkWebView: '窓の表示には Microsoft Edge WebView2 を使います。Windows 10（現行の版）と Windows 11 に入っています。',
  },
};
