import type { AgentStatus, BubbleKey, Outcome } from '@onecarat/domain';

export type Lang = 'en' | 'ja';

const en = {
  tagline: 'Visual workspace for Claude Code',
  demoChip: 'DEMO · sample data',
  liveChip: 'Live',
  noSession: 'No session',
  demoRibbon: 'Demo mode — scripted replay, not a real session',
  terminal: 'Terminal',
  conversation: 'Conversation',
  maximize: 'Maximize',
  restore: 'Restore',
  console: 'Console',
  manager: 'Manager',
  user: 'User',
  chatEmpty: 'Waiting for a request…',
  chatPlaceholder: 'Type your request in Claude Code (terminal / Desktop app)',
  chatNote: 'Read-only here. Type requests in the built-in terminal (when available) or in Claude Code itself.',
  send: 'Send (not available)',
  currentTask: 'Current task',
  status: 'Status',
  activity: 'Now',
  outcomeNote: 'Claude Code does not report success/failure; this is an estimate from events.',
  noEvents: 'No events yet.',
  agent: 'Agent',
  board: 'Agent Board',
  boardEmpty: 'No subagents yet',
  active: 'active',
  completed: 'completed',
  failed: 'failed',
  agentsNone: 'No subagents',
  settings: 'Settings',
  sessions: 'Sessions',
  office: 'Office',
  theme: 'Theme',
  motion: 'Motion',
  language: 'Language',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  reduce: 'Reduced',
  full: 'Full',
  replay: 'Restart demo',
  pause: 'Pause demo',
  resume: 'Resume demo',
  highFiveNote: 'The high-five is a visual effect for an (estimated) successful hand-off. It does not mean agents exchanged extra messages.',
  sessionsNote: 'Sessions are kept in memory only and disappear when Office stops.',
  selectAgentHint: 'Click a figure (or use ←/→) to see its events.',
  reconnecting: 'Reconnecting…',
  offline: 'Bridge offline',
  liveWaiting: 'Waiting for Claude Code events… Use Claude Code as usual (terminal, IDE or Desktop app).',
  liveSource: 'Live (Claude Code)',
  demoSource: 'Demo (sample data)',
  autoFollow: 'Follow the most active session',
  ended: 'ended',
  clearHistory: 'Clear in-memory history',
  joinedMidway: 'Office connected in the middle of this session; earlier messages are not available.',
  termTab: 'Claude Code',
  modeLabel: 'Permission mode (at last action)',
  modeNote: 'Reported by Claude Code hooks at its last action, so a Shift+Tab change shows after the next request or tool use. Set by your Claude Code settings; Office never changes it.',
  historyNote: 'Requests and final replies from the hooks of this session (read-only).',
  historyTab: 'Conversation log',
  termStart: 'Start Claude Code here',
  termStop: 'Stop Claude Code',
  termRestart: 'Start in this folder',
  termFolder: 'Folder',
  termFolderPick: 'Other folders',
  termIntro: 'This is the real interactive Claude Code. Type requests and answer permission prompts here yourself — Office never answers for you. Output is kept in memory only.',
  termUnavailable: 'The built-in terminal is not available on this computer ({reason}). Use Claude Code in your own terminal; Office keeps showing it.',
  termExited: 'Claude Code exited (code {code}).',
  termConfirmRestart: 'Stop the running Claude Code and start a new one in this folder?',
  termConnecting: 'Connecting to the terminal…',
  locked: 'This page was opened without its access key. Open Office from Claude Code: ask "Open Onecarat Agent Office" or run /onecarat-agent-office:office open.',
  lockedChip: 'No access key',
  stoppedChip: 'Stopped',
  stoppedClaudeEnded: 'Claude Code has ended, so Office has stopped.',
  stoppedByStop: 'Office has stopped.',
  stoppedRestart: 'To use it again, run /onecarat-agent-office:office start in Claude Code.',
  termOfficeStopped: 'Office has stopped. The terminal is no longer connected.',
} as const;

type Dict = { [K in keyof typeof en]: string };

const ja: Dict = {
  tagline: 'Claude Code のためのビジュアルワークスペース',
  demoChip: 'デモ · サンプルデータ',
  liveChip: 'ライブ',
  noSession: 'セッションなし',
  demoRibbon: 'デモモード — 台本どおりの再生です（実際のセッションではありません）',
  terminal: 'ターミナル',
  conversation: '会話',
  maximize: '最大化',
  restore: '元に戻す',
  console: 'コンソール',
  manager: 'マネージャー',
  user: 'あなた',
  chatEmpty: '依頼を待っています…',
  chatPlaceholder: '依頼は Claude Code（ターミナル／Desktop app）で入力してください',
  chatNote: 'ここは読み取り専用です。依頼は内蔵ターミナル（使える場合）か Claude Code 本体で入力してください。',
  send: '送信（未対応）',
  currentTask: '担当タスク',
  status: '状態',
  activity: 'いまの作業',
  outcomeNote: 'Claude Code は成功／失敗を通知しないため、イベントからの推定です。',
  noEvents: 'まだイベントはありません。',
  agent: 'エージェント',
  board: 'エージェントボード',
  boardEmpty: 'サブエージェントはまだいません',
  active: '稼働中',
  completed: '完了',
  failed: '失敗',
  agentsNone: 'サブエージェントなし',
  settings: '設定',
  sessions: 'セッション',
  office: 'オフィス',
  theme: 'テーマ',
  motion: 'アニメーション',
  language: '言語',
  system: 'システムに合わせる',
  light: 'ライト',
  dark: 'ダーク',
  reduce: '控えめ',
  full: '通常',
  replay: 'デモを最初から',
  pause: 'デモを一時停止',
  resume: 'デモを再開',
  highFiveNote: 'ハイタッチは（推定）成功の引き継ぎを表す演出です。エージェント同士が追加でやり取りしたことを意味しません。',
  sessionsNote: 'セッションはメモリ上だけに保持し、Office を止めると消えます。',
  selectAgentHint: '棒人間をクリック（または ←/→）するとイベントを表示します。',
  reconnecting: '再接続中…',
  offline: 'ブリッジ未接続',
  liveWaiting: 'Claude Code のイベントを待っています… いつもどおり Claude Code（ターミナル・IDE・Desktop app）を使ってください。',
  liveSource: 'ライブ（Claude Code）',
  demoSource: 'デモ（サンプルデータ）',
  autoFollow: 'いちばん動いているセッションを自動で表示',
  ended: '終了',
  clearHistory: 'メモリ上の履歴を消去',
  joinedMidway: 'このセッションの途中から接続したため、それ以前のやり取りは表示できません。',
  termTab: 'Claude Code',
  modeLabel: '許可モード（直近の操作時）',
  modeNote: 'Claude Code の Hook が直近の操作時に報告した値です。Shift+Tab で切り替えた場合は、次の依頼やツール実行のときに反映されます。設定は Claude Code のもので、Office は変更しません。',
  historyNote: 'このセッションの Hook から得た依頼と最終返答です（読み取り専用）。',
  historyTab: '会話履歴',
  termStart: 'ここで Claude Code を開始',
  termStop: 'Claude Code を終了',
  termRestart: 'このフォルダで開始',
  termFolder: 'フォルダ',
  termFolderPick: 'ほかのフォルダ',
  termIntro: 'ここは本物の対話型 Claude Code です。依頼の入力も承認の操作も、ここで自分で行います（Office が代わりに答えることはありません）。出力はメモリ上だけに保持します。',
  termUnavailable: 'このコンピューターでは内蔵ターミナルを使えません（{reason}）。Claude Code はいつものターミナルで使ってください。Office はその様子を表示し続けます。',
  termExited: 'Claude Code が終了しました（コード {code}）。',
  termConfirmRestart: '実行中の Claude Code を終了して、このフォルダで新しく開始しますか？',
  termConnecting: 'ターミナルに接続しています…',
  locked: 'このページはアクセス用のキーなしで開かれています。Claude Code から開き直してください（「Onecarat Agent Officeを開いて」と頼むか、/onecarat-agent-office:office open を実行）。',
  lockedChip: 'キーなし',
  stoppedChip: '停止しました',
  stoppedClaudeEnded: 'Claude Code が終了したので、Office も停止しました。',
  stoppedByStop: 'Office は停止しました。',
  stoppedRestart: 'もう一度使うときは、Claude Code で /onecarat-agent-office:office start を実行してください。',
  termOfficeStopped: 'Office が停止したため、ターミナルは切断されています。',
};

export const dict: Record<Lang, Dict> = { en, ja };

export const bubbleText: Record<Lang, Record<BubbleKey, string>> = {
  en: {
    delegating: 'Delegating',
    thinking: 'Thinking…',
    reading: 'Reading files',
    editing: 'Editing files',
    executing: 'Running a command',
    testing: 'Running tests',
    researching: 'Researching',
    reporting: 'Reporting',
    waiting_permission: 'Waiting for your OK in Claude Code',
    blocked: 'Interrupted',
    retrying: 'Hit an error, retrying',
    failed: 'Stuck',
    done: 'Done',
    done_unknown: 'Finished',
  },
  ja: {
    delegating: '指示中',
    thinking: '考え中…',
    reading: 'ファイル調査中',
    editing: '編集中',
    executing: 'コマンド実行中',
    testing: 'テスト中',
    researching: '調べもの中',
    reporting: '報告中',
    waiting_permission: 'Claude Code で許可待ち',
    blocked: '中断',
    retrying: 'エラー、やり直し中',
    failed: 'うまくいかず',
    done: '完了',
    done_unknown: '終了',
  },
};

export const statusText: Record<Lang, Record<AgentStatus, string>> = {
  en: { created: 'Starting', idle: 'Idle', delegating: 'Delegating', working: 'In progress', waiting_permission: 'Waiting for permission', blocked: 'Interrupted', completed: 'Completed', failed: 'Failed', unknown: 'Unknown' },
  ja: { created: '起動中', idle: '待機中', delegating: '指示中', working: '作業中', waiting_permission: '許可待ち', blocked: '中断', completed: '完了', failed: '失敗', unknown: '不明' },
};

export const outcomeText: Record<Lang, Record<Outcome, string>> = {
  en: { success_estimated: 'Success (estimated)', failure_estimated: 'Failure (estimated)', unknown: 'Outcome unknown' },
  ja: { success_estimated: '成功（推定）', failure_estimated: '失敗（推定）', unknown: '結果は不明' },
};

export function detectLang(): Lang {
  try {
    return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Display-only aliases for Claude Code's BUILT-IN subagent types. Custom agents keep their own name.
 * The event identifiers (agent_id / agent_type) are never changed; Console shows the raw agent_type.
 */
const builtinAlias: Record<Lang, Record<string, string>> = {
  en: { Explore: 'Explorer', Plan: 'Planner', 'general-purpose': 'General', 'claude-code-guide': 'Guide', 'statusline-setup': 'Status line', claude: 'General' },
  ja: { Explore: '調査', Plan: '設計', 'general-purpose': '汎用', 'claude-code-guide': 'ガイド', 'statusline-setup': 'ステータス設定', claude: '汎用' },
};

export function displayName(a: { role: 'manager' | 'subagent'; agentType: string; label: string }, lang: Lang): string {
  if (a.role === 'manager') return dict[lang].manager;
  return builtinAlias[lang][a.agentType] ?? a.label;
}

/** Claude Code permission modes as reported by hooks. Unknown values are shown raw. */
export const modeText: Record<Lang, Record<string, string>> = {
  en: { default: 'Ask each time', acceptEdits: 'Auto-accept edits', plan: 'Plan only', auto: 'Auto (Claude decides)', dontAsk: "Don't ask", bypassPermissions: 'No prompts (bypass)' },
  ja: { default: '毎回確認', acceptEdits: '編集は自動で許可', plan: '計画のみ', auto: '自動（Claude が判断）', dontAsk: '確認しない', bypassPermissions: '確認なし（バイパス）' },
};
