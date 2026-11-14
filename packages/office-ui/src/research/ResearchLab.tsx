// Research Lab: another view of the same Claude Code session. The manager and its researchers at the top, the
// one picked shown large on the left, the Findings Board on the right. No terminal and no console here: Enter and
// every permission answer are given in the Office view's terminal.
//
// Nothing here is made up: a card exists only for a result file the bridge read and checked; a researcher exists
// only for a SubagentStart of the researcher type; "what it is doing" is the tool call its hooks reported (masked
// and shortened by the adapter, as in the Office view). Poses are a visual effect.
// Card texts come from files built from web pages: they are rendered as plain text (React escapes them), and a
// source is a link only when it is an http(s) URL.
import { useEffect, useRef, useState } from 'react';
import { MANAGER_ID, expressionOf, type AgentState, type Face, type SessionState } from '@onecarat/domain';
import { Figure, type FigurePose } from '../office/Figure.tsx';
import { Bubble, DeskBack, DeskFront } from '../office/Stage.tsx';
import { WaitRows, type WaitItem } from '../office/Waits.tsx';
import { Dialog, shortPath } from '../panels.tsx';
import { bubbleShort, bubbleText, displayName, modeText, type Lang } from '../i18n.ts';
import type { ResearchCard, ResearchLink, ResearchRun, ResearchWaiting, Researcher } from '../live/useResearch.ts';

const L = {
  ja: {
    researcher: 'リサーチャー',
    manager: 'マネージャー',
    subagent: 'サブエージェント',
    board: 'Findings Board',
    theme: '調査テーマ',
    themePh: '例：最近公開された軽量LLMの特徴と用途を調べる',
    count: '結果の件数',
    countUnit: '件',
    start: '調査開始',
    more: '保存先と注意',
    saveTo: '保存先',
    saveNote: '調査結果は Claude Code がこのフォルダに書きます。Office は読むだけで、書き換えも削除もしません。',
    gitNote: 'このフォルダは Git の管理下にあります。research/ が変更として現れることがあります（.gitignore は変更しません）。',
    sendNote: '「調査開始」を押すと、Office が調査用のコマンドを Office のターミナルに貼り付けて、Office 画面に切り替えます。送信（Enter）は自分で行います。',
    skill: '調査方法：マネージャーがリサーチャーをバックグラウンドで起動します（プラグイン同梱の Skill）',
    idle: '調査テーマを入れて「調査開始」を押すと、成果がここに1枚ずつ貼られます。',
    people: 'リサーチャーの人数',
    peopleUnit: '人',
    peopleNote: '人数を増やすと、その分だけ利用枠の消費が増えます。',
    needVersion: 'Research Lab には Claude Code 2.1.198 以上が必要です（動作確認済み：2.1.323〜2.1.325。その間の版は未確認）。',
    stopNote: '調査を止めるには、Office 画面のターミナルで自分で操作します：Esc でマネージャーの作業を中断し、バックグラウンドのリサーチャーはターミナルの一覧（「↓ to manage」）から止めます。Office からは止めません。',
    permMode: '現在の権限モード: {mode}',
    permDefault: '現在のモードでは、検索ごと・サイトごと・書き込みごとに承認が出ます。1件の調査で5〜10回ほどが目安です。',
    permBypass: '現在のモードでは、承認は出ません。',
    permOther: '承認の出方は権限モードによって変わります。承認が出たら、Office のターミナルで自分で答えてください。',
    permUnknown: '権限モードはまだ届いていません（Office のターミナルの Claude Code から最初のイベントが届くと表示されます）。',
    permAnswer: '承認には Office のターミナルで自分で答えます。Office は答えません。',
    'awaiting-enter': 'Enter 待ち',
    unconfirmed: '完了を確認できず',
    dismissed: '取り消し',
    enterHint: 'コマンドを Office 画面のターミナル（左下）の入力欄に貼り付けました。そのターミナルで Enter を押すと調査が始まります。Office は Enter を押しません。',
    enterStuckTitle: 'Enter を押しても始まらない場合',
    enterStuck: 'ターミナルに「Unknown command」と表示された場合、その Claude Code は調査用のコマンドをまだ読み込んでいません。Claude Code を開き直してから、もう一度お試しください。このとき Claude Code からは何も届かないので、Office は Enter が押されたことを知ることができません。この表示は「取り消す」で消せます。',
    goOffice: 'Office 画面へ',
    copyHint: 'コマンドは貼り付けていません（{why}）。次の行をコピーして、Claude Code で実行してください。',
    copyWhy: { 'no-terminal': 'Office のターミナルで Claude Code が動いていないため', 'not-started': 'Office のターミナルの Claude Code が始まったことをまだ確認できないため', 'waiting-permission': '承認待ちがあるため', 'wait-unknown': '表示を消した承認の結果を、Office は知ることができないため' } as Record<string, string>,
    staleWait: '承認の結果を Office は知ることができないため、貼り付けません（表示を消しても変わりません）。コマンドをコピーして、ご自身で貼り付けてください。Claude Code から次のイベント（入力、ツールの完了、ターン終了）が届くと、また貼り付けられるようになります。',
    copy: 'コピー',
    copied: 'コピーしました',
    dismiss: '取り消す',
    dismissNote: '取り消しても、貼り付けたコマンドはターミナルの入力欄に残ります。自分で消してください。',
    unconfirmedHint: 'まとめのファイル（summary.json）が書かれないままマネージャーの作業が終わりました。完了とは表示しません。',
    verdict: { confirmed: '確認済み', 'needs-check': '要確認' } as Record<string, string>,
    dReview: 'マネージャーの確認',
    seeLab: 'Research Lab を見る',
    busyOffice: 'Research Lab を見る（調査中）',
    waitOffice: 'Research Lab を見る（承認待ちあり）',
    enterOffice: '下のターミナルで Enter を押すと、調査が始まります。',
    enterOfficeMore: '「Unknown command」と表示された場合は、Claude Code を開き直してください。この表示は「取り消す」で消せます。',
    heldOffice: '承認の結果を Office はまだ知らないため、Research Lab へは自動で戻りません（表示を消しても変わりません）。',
    researching: '調査中',
    waiting: '承認待ち',
    waitingHint: '承認待ちがあります。Office 画面のターミナルで答えてください（Office は答えません）。',
    publishing: '登録中',
    completed: '完了',
    failed: 'エラー',
    rStatus: { working: '作業中', reported: '報告あり', completed: '完了', failed: '失敗', stopped: '停止' } as Record<string, string>,
    cardsBy: 'カード {n}枚',
    task: '担当',
    now: 'いま',
    noNow: '（届いているイベントはありません）',
    by: '担当: {who}',
    shortfall: '{want}件のうち{got}件が保存されました（不足 {n}件）。',
    restored: '保存済みの調査（ディスクから復元）',
    noTheme: '（テーマの記録なし）',
    pastLabel: '表示する調査',
    current: '今回',
    reload: '再読み込み',
    sources: '参照元 {n}件',
    noSources: '参照元なし',
    partial: '一部',
    fileErrors: '読み込めなかったファイル',
    dSummary: '要約',
    dDetails: '詳細',
    dFindings: '主な発見',
    dSources: '根拠・参照元',
    dNoSources: '参照元は取得されていません。',
    dCaveats: '注意点・不確実性',
    dMeta: 'メタデータ',
    close: '閉じる',
    offline: 'Office に接続していないため、Research Lab は使えません。',
    modeOffice: 'Office',
    modeLab: 'Research Lab',
    prev: '前の画面',
    next: '次の画面',
    reasons: {
      'bad-theme': '調査テーマを入力してください。',
      'bad-count': '件数が正しくありません。',
      'bad-researchers': '人数が正しくありません。',
      pending: '先に貼り付けたコマンドが、まだターミナルの入力欄に残っています。Enter を押して始めるか、入力欄を消してから「取り消す」を押してください。',
      failed: 'Office に依頼できませんでした。',
    } as Record<string, string>,
    fileReasons: { 'invalid-json': 'JSON として読めません', 'too-large': '大きすぎます', 'not-an-object': '形式が違います', 'wrong-research-id': '別の調査のファイルです', 'no-title': 'タイトルがありません', unreadable: '読めません', 'not-a-regular-file': '通常のファイルではありません', 'bad-verdict': '確認結果の値が違います' } as Record<string, string>,
  },
  en: {
    researcher: 'Researcher',
    manager: 'Manager',
    subagent: 'Subagent',
    board: 'Findings Board',
    theme: 'Research theme',
    themePh: 'e.g. Features and uses of recently released small LLMs',
    count: 'Findings',
    countUnit: '',
    start: 'Start research',
    more: 'Where it is saved, and notes',
    saveTo: 'Saved to',
    saveNote: 'Claude Code writes the results into this folder. Office only reads them; it never changes or deletes them.',
    gitNote: 'This folder is in a Git working tree: research/ may show up as a change (.gitignore is not touched).',
    sendNote: 'When you press "Start research", Office pastes the research command into the Office terminal and switches to the Office view. You send it (Enter) yourself.',
    skill: 'Method: the manager starts researchers in the background (the skill shipped with the plugin)',
    idle: 'Enter a theme and press "Start research": findings are pinned here one by one.',
    people: 'Researchers',
    peopleUnit: '',
    peopleNote: 'More researchers use that much more of your usage allowance.',
    needVersion: 'Research Lab needs Claude Code 2.1.198 or newer (checked on 2.1.323 to 2.1.325; versions in between are untested).',
    stopNote: 'To stop a research, use the terminal in the Office view yourself: Esc interrupts the manager, and background researchers are stopped from the terminal\'s list ("↓ to manage"). Office never stops them.',
    permMode: 'Current permission mode: {mode}',
    permDefault: 'In this mode, Claude Code asks for permission for each search, each site and each file it writes: about 5 to 10 times for one finding.',
    permBypass: 'In this mode, no permission prompt appears.',
    permOther: 'How often Claude Code asks depends on the permission mode. When it asks, answer in the Office terminal yourself.',
    permUnknown: 'The permission mode has not arrived yet (it is shown after the first event from Claude Code in the Office terminal).',
    permAnswer: 'You answer permission prompts in the Office terminal yourself. Office never answers.',
    'awaiting-enter': 'Press Enter',
    unconfirmed: 'End not confirmed',
    dismissed: 'Dropped',
    enterHint: 'The command is in the input box of the terminal in the Office view (bottom left). Press Enter in that terminal to start the research. Office does not press Enter.',
    enterStuckTitle: 'If nothing starts after Enter',
    enterStuck: 'If the terminal shows "Unknown command", that Claude Code has not loaded the research command yet: reopen Claude Code and try again. Claude Code sends nothing in that case, so Office cannot know that Enter was pressed. "Drop it" removes this notice.',
    goOffice: 'Go to the Office view',
    copyHint: 'The command was not pasted ({why}). Copy the line below and run it in Claude Code.',
    copyWhy: { 'no-terminal': 'Claude Code is not running in the Office terminal', 'not-started': 'the start of Claude Code in the Office terminal is not confirmed yet', 'waiting-permission': 'something waits for your approval', 'wait-unknown': 'Office cannot know how the permission request you hid ended' } as Record<string, string>,
    staleWait: 'Office cannot know how a permission request ended, so it does not paste (hiding the wait does not change that). Copy the command and paste it yourself. Pasting works again after the next event from Claude Code (a prompt, a finished tool call, the end of the turn).',
    copy: 'Copy',
    copied: 'Copied',
    dismiss: 'Drop it',
    dismissNote: 'A pasted command stays in the terminal\'s input box after this. Clear it yourself.',
    unconfirmedHint: 'The manager\'s work ended without a summary file (summary.json). It is not shown as done.',
    verdict: { confirmed: 'Confirmed', 'needs-check': 'Needs check' } as Record<string, string>,
    dReview: 'Manager\'s check',
    seeLab: 'See the Research Lab',
    busyOffice: 'See the Research Lab (researching)',
    waitOffice: 'See the Research Lab (needs approval)',
    enterOffice: 'Press Enter in the terminal below to start the research.',
    enterOfficeMore: 'If it shows "Unknown command", reopen Claude Code. "Drop it" removes this notice.',
    heldOffice: 'Office does not know yet how a permission request ended, so the view does not go back to the Research Lab by itself (hiding the wait does not change that).',
    researching: 'Researching',
    waiting: 'Needs approval',
    waitingHint: 'Waiting for your approval: answer in the terminal of the Office view (Office never answers).',
    publishing: 'Pinning',
    completed: 'Done',
    failed: 'Error',
    rStatus: { working: 'Working', reported: 'Reported', completed: 'Done', failed: 'Failed', stopped: 'Stopped' } as Record<string, string>,
    cardsBy: '{n} cards',
    task: 'Task',
    now: 'Now',
    noNow: '(no event has arrived)',
    by: 'By {who}',
    shortfall: '{got} of {want} findings were saved ({n} short).',
    restored: 'Saved research (restored from disk)',
    noTheme: '(no theme recorded)',
    pastLabel: 'Research shown',
    current: 'Current',
    reload: 'Reload',
    sources: '{n} sources',
    noSources: 'No sources',
    partial: 'Partial',
    fileErrors: 'Files that could not be read',
    dSummary: 'Summary',
    dDetails: 'Details',
    dFindings: 'Key findings',
    dSources: 'Sources',
    dNoSources: 'No sources were collected.',
    dCaveats: 'Caveats and uncertainty',
    dMeta: 'Metadata',
    close: 'Close',
    offline: 'Not connected to Office: Research Lab is unavailable.',
    modeOffice: 'Office',
    modeLab: 'Research Lab',
    prev: 'Previous view',
    next: 'Next view',
    reasons: {
      'bad-theme': 'Enter a research theme.',
      'bad-count': 'The number of findings is not valid.',
      'bad-researchers': 'The number of researchers is not valid.',
      pending: 'The command pasted earlier is still in the terminal\'s input box. Press Enter to start it, or clear the box and press "Drop it".',
      failed: 'The request to Office failed.',
    } as Record<string, string>,
    fileReasons: { 'invalid-json': 'not valid JSON', 'too-large': 'too large', 'not-an-object': 'wrong format', 'wrong-research-id': 'belongs to another research', 'no-title': 'no title', unreadable: 'unreadable', 'not-a-regular-file': 'not a regular file', 'bad-verdict': 'not one of the two verdicts' } as Record<string, string>,
  },
};

export type ViewMode = 'office' | 'research';

/**
 * "<" / ">" on the edges of the stage, the name of the view, and (in the Office view) what the Research Lab needs
 * from the user. Only the view changes: nothing is started or stopped. `held`: the automatic return to the
 * Research Lab was not made because something waits for approval.
 */
export function ModeSwitch({ mode, setMode, lang, research, held }: { mode: ViewMode; setMode: (m: ViewMode) => void; lang: Lang; research?: ResearchLink; held?: boolean }) {
  const t = L[lang];
  const other: ViewMode = mode === 'office' ? 'research' : 'office';
  const name = (m: ViewMode) => (m === 'office' ? t.modeOffice : t.modeLab);
  const cur = research?.info?.current;
  const asks = cur?.status === 'researching' && cur.waiting.length > 0;
  let note: React.ReactNode = null;
  if (mode === 'office' && cur?.status === 'awaiting-enter' && cur.pasted) {
    note = (
      <div className="mode-banner warn" role="status">
        <b>{t.enterOffice}</b>
        <button className="btn" title={t.dismissNote} onClick={() => void research!.dismiss()}>{t.dismiss}</button>
        <small>{t.enterOfficeMore}</small>
      </div>
    );
  } else if (mode === 'office' && cur?.status === 'researching' && held) {
    note = (
      <div className="mode-banner warn" role="status">
        <b>{t.heldOffice}</b>
        <button className="btn" onClick={() => setMode('research')}>{t.seeLab}</button>
      </div>
    );
  } else if (mode === 'office' && cur?.status === 'researching') {
    note = <button className={`mode-note${asks ? ' warn' : ''}`} onClick={() => setMode('research')}><span className="dot" aria-hidden="true" />{asks ? t.waitOffice : t.busyOffice}</button>;
  } else if (mode === 'office' && cur?.status === 'awaiting-enter') {
    note = <button className="mode-note warn" onClick={() => setMode('research')}><span className="dot" aria-hidden="true" />{t.seeLab}</button>;
  }
  return (
    <>
      <button className="mode-arrow left" aria-label={`${t.prev}: ${name(other)}`} title={`${t.prev}: ${name(other)}`} onClick={() => setMode(other)}>‹</button>
      <button className="mode-arrow right" aria-label={`${t.next}: ${name(other)}`} title={`${t.next}: ${name(other)}`} onClick={() => setMode(other)}>›</button>
      <div className="mode-name" aria-live="polite">{name(mode)}</div>
      {/* While the Office view is shown, the Research Lab must not work or wait unseen. */}
      {note}
    </>
  );
}

export const active = (r: ResearchRun | undefined) => r?.status === 'awaiting-enter' || r?.status === 'researching';
const cardKey = (run: ResearchRun, c: ResearchCard) => `${run.id}/${c.file}`;
const FLY_MS = 900;

function httpUrl(u: string): string | undefined {
  if (!/^https?:\/\//i.test(u)) return undefined;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : undefined;
  } catch {
    return undefined;
  }
}

/** One of the people of a research, as shown (small at the top, large when picked). */
interface Person {
  key: string;
  /** Absent = the manager. */
  agentId?: string;
  name: string;
  manager: boolean;
  pose: FigurePose;
  face: Face;
  sweat: boolean;
  /** Status word and its tone (pill and the label above the figure). */
  status: string;
  tone: 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
  busy: boolean;
  attention: boolean;
  cards?: number;
  task?: string;
  /** What its latest tool call is, as the hooks reported it. */
  now?: string;
}

type T = (typeof L)['ja'];

function nowOf(a: AgentState | undefined, lang: Lang): string | undefined {
  if (!a) return undefined;
  const e = expressionOf(a);
  if (!e.bubble || a.status === 'completed' || a.status === 'failed') return undefined;
  return `${bubbleText[lang][e.bubble.key]}${a.activityDetail ? ` · ${a.activityDetail}` : ''}`;
}

function managerOf(run: ResearchRun, mgr: AgentState | undefined, t: T, lang: Lang): Person {
  const base = { key: MANAGER_ID, name: t.manager, manager: true, sweat: false, busy: false, attention: false, task: run.theme || undefined };
  if (run.status === 'awaiting-enter') return { ...base, pose: 'wait', face: 'neutral', status: t['awaiting-enter'], tone: 'warn', attention: true };
  if (run.status === 'completed') return { ...base, pose: 'cheer', face: 'happy', status: t.completed, tone: 'ok' };
  if (run.status === 'unconfirmed') return { ...base, pose: 'stand', face: 'troubled', sweat: true, status: t.unconfirmed, tone: 'warn', attention: true };
  if (run.waiting.some((w) => !w.agentId)) return { ...base, pose: 'wait', face: 'neutral', status: t.waiting, tone: 'warn', attention: true, now: nowOf(mgr, lang) };
  const e = mgr ? expressionOf(mgr) : undefined;
  const atWork = mgr?.status === 'working' || mgr?.status === 'delegating';
  return { ...base, pose: atWork ? e!.pose : 'stand', face: atWork ? e!.face : 'smile', status: atWork && e?.bubble ? bubbleShort[lang][e.bubble.key] : t.researching, tone: 'accent', busy: atWork, now: atWork ? nowOf(mgr, lang) : undefined };
}

function researcherOf(run: ResearchRun, r: Researcher, a: AgentState | undefined, t: T, lang: Lang): Person {
  const base = { key: r.agentId, agentId: r.agentId, name: `${t.researcher} ${r.n}`, manager: false, sweat: false, busy: false, attention: false, cards: r.cards, task: a?.task };
  if (run.waiting.some((w) => w.agentId === r.agentId)) return { ...base, pose: 'wait', face: 'neutral', status: t.waiting, tone: 'warn', attention: true, now: nowOf(a, lang) };
  switch (r.status) {
    case 'working': {
      const e = a ? expressionOf(a) : undefined;
      return { ...base, pose: e?.pose ?? 'type', face: e?.face ?? 'focused', status: t.rStatus.working!, tone: 'accent', busy: true, now: nowOf(a, lang) };
    }
    case 'reported': return { ...base, pose: 'report', face: 'smile', status: t.rStatus.reported!, tone: 'accent' };
    case 'completed': return { ...base, pose: 'stand', face: 'happy', status: t.rStatus.completed!, tone: 'ok' };
    case 'failed': return { ...base, pose: 'stand', face: 'troubled', sweat: true, status: t.rStatus.failed!, tone: 'danger', attention: true };
    default: return { ...base, pose: 'stand', face: 'neutral', status: t.rStatus.stopped!, tone: 'muted' };
  }
}

/** Permission waits of a research as rows: one per agent, with the time of its oldest open request. */
function waitItems(waits: ResearchWaiting[], sessionId: string | undefined, nameOf: (agentId: string | undefined) => string): WaitItem[] {
  if (!sessionId) return [];
  const by = new Map<string, WaitItem>();
  for (const w of waits) {
    const k = w.agentId ?? '';
    const have = by.get(k);
    if (!have || w.at < have.at) by.set(k, { sessionId, agentId: w.agentId, who: nameOf(w.agentId), at: w.at, what: [w.toolName, w.detail].filter(Boolean).join(' ') });
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

export interface ResearchLabProps {
  research: ResearchLink;
  /** The session the shown research runs in (its agents' latest tool calls). */
  session?: SessionState;
  /** The session of the Office terminal (names for waits that hold back a paste). */
  termSession?: SessionState;
  lang: Lang;
  motion: boolean;
  live: boolean;
  /** The user asks for the Office view (to press Enter, or to answer a prompt). */
  goOffice: () => void;
  /** "Start research" was pressed here (the page may then switch to the Office view once). */
  onStartPressed: () => void;
}

export function ResearchLab({ research, session, termSession, lang, motion, live, goOffice, onStartPressed }: ResearchLabProps) {
  const t = L[lang];
  const { info, refused } = research;
  const cur = info?.current;
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState<number | undefined>(undefined);
  const [people, setPeople] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [pickedRun, setPickedRun] = useState<string | undefined>(undefined);
  const [pickedWho, setPickedWho] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<ResearchCard | undefined>(undefined);
  const runs = [...(cur ? [cur] : []), ...(info?.past ?? [])];
  const run = runs.find((r) => r.id === pickedRun) ?? runs[0];
  // A new research takes the board.
  const curId = cur?.id;
  useEffect(() => setPickedRun(undefined), [curId]);
  useEffect(() => setPickedWho(undefined), [run?.id]);

  // ---- cards appear one by one: a card flies from the figure to the board, then the real card is shown ----
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [flying, setFlying] = useState<string | undefined>(undefined);
  const seenRun = useRef<string | undefined>(undefined);
  const keys = run ? run.cards.map((c) => cardKey(run, c)) : [];
  const keysStr = keys.join('|');
  useEffect(() => {
    // Another research on the board (or the first load): what is already saved is shown at once.
    if (run?.id !== seenRun.current) {
      seenRun.current = run?.id;
      setFlying(undefined);
      setShown(new Set(keys));
      return;
    }
    const pending = keys.filter((k) => !shown.has(k));
    if (!pending.length) return;
    if (!motion) return setShown(new Set([...shown, ...pending]));
    const next = pending[0]!;
    setFlying(next);
    // Results that arrive meanwhile wait their turn: none is lost, they are pinned one after another.
    const tm = setTimeout(() => {
      setShown((s) => new Set([...s, next]));
      setFlying(undefined);
    }, FLY_MS);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, keysStr, shown, motion]);

  // ---- the people of the shown research ----
  // Hook events of the session describe "now": only a research followed live has people; one read back from disk
  // has cards only. The manager is shown while the research is the current one.
  const liveSession = run && !run.restored && run.sessionId === session?.id ? session : undefined;
  const persons: Person[] = [];
  if (run && !run.restored) {
    if (run === cur) persons.push(managerOf(run, liveSession?.agents[MANAGER_ID], t, lang));
    for (const r of run.researchers) persons.push(researcherOf(run, r, liveSession?.agents[r.agentId], t, lang));
  }
  const picked = persons.find((p) => p.key === pickedWho) ?? persons.find((p) => !p.manager) ?? persons[0];
  const nOf = new Map((run?.researchers ?? []).map((r) => [r.agentId, r.n]));
  const flyCard = run && flying ? run.cards.find((c) => cardKey(run, c) === flying) : undefined;
  // The card being pinned comes from the figure shown large, when it is that one's (or when nobody is known).
  const flyFromPicked = !!flyCard && (!picked || flyCard.agentId === picked.agentId || (!flyCard.agentId && picked.manager));
  const big = picked && flyFromPicked ? { ...picked, pose: 'report' as FigurePose, face: 'happy' as Face, status: t.publishing, tone: 'ok' as const, busy: false, attention: false } : picked;

  const nameOf = (agentId: string | undefined) => (!agentId ? t.manager : nOf.has(agentId) ? `${t.researcher} ${nOf.get(agentId)}` : t.subagent);
  const runWaits = run && run === cur && run.status === 'researching' ? waitItems(run.waiting, run.sessionId, nameOf) : [];
  // Waits of the Office terminal's session that held back the paste (they may be prompts that are long gone).
  const termName = (agentId: string | undefined) => {
    const a = agentId ? termSession?.agents[agentId] : undefined;
    return !agentId ? t.manager : a ? displayName(a, lang) : t.subagent;
  };
  const pasteWaits = cur?.status === 'awaiting-enter' && cur.notPasted === 'waiting-permission' ? waitItems(info?.terminal.waits ?? [], info?.terminal.sessionId, termName) : [];

  const canUse = live && !!info;
  const n = count ?? info?.defaultCount ?? 5;
  const p = people ?? info?.defaultResearchers ?? 2;
  // A research that is under way, or whose command sits in the input box, blocks a new start. One whose command
  // was only shown for copying does not (pressing again tries the paste again).
  const blocked = cur?.status === 'researching' || (cur?.status === 'awaiting-enter' && !!cur.pasted);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUse || blocked || !theme.trim()) return;
    setCopied(false);
    onStartPressed();
    void research.start(theme.trim(), n, p);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  const visible = run ? run.cards.filter((c) => shown.has(cardKey(run, c))) : [];
  const ghosts = run && active(run) ? Math.max(0, run.requestedCount - run.cards.length) : 0;
  const short = run && !active(run) && !run.restored && run.status === 'completed' ? run.requestedCount - run.cards.length : 0;
  const statusPill = (r: ResearchRun) => {
    const asks = r.status === 'researching' && r.waiting.length > 0;
    const cls = r.status === 'completed' ? 'ok' : r.status === 'dismissed' ? 'muted' : asks || r.status === 'awaiting-enter' || r.status === 'unconfirmed' ? 'warn' : 'accent';
    return <span className={`pill ${cls}`}>{asks ? t.waiting : t[r.status]}</span>;
  };
  const sep = info?.cwd.includes('\\') ? '\\' : '/';
  const mode = info?.terminal.permissionMode;
  const permFact = !mode ? t.permUnknown : mode === 'default' ? t.permDefault : mode === 'bypassPermissions' ? t.permBypass : t.permOther;

  return (
    <div className="lab">
      {persons.length ? (
        <div className="lab-people" role="group" aria-label={t.researcher}>
          {persons.map((q) => (
            <button key={q.key} className={`lab-person${picked?.key === q.key ? ' picked' : ''}${q.attention ? ' attention' : ''}`} aria-pressed={picked?.key === q.key} onClick={() => setPickedWho(q.key)}>
              <svg className="lab-mini" viewBox="-60 -196 130 204" aria-hidden="true">
                <Figure pose={q.pose} face={q.face} sweat={q.sweat} walking={false} motion={false} facing={1} manager={q.manager} />
              </svg>
              <span className="who">{q.name}</span>
              <span className={`pill ${q.tone}`}>{q.status}</span>
              {q.cards !== undefined ? <span className="n">{t.cardsBy.replace('{n}', String(q.cards))}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="lab-left">
        <svg className="lab-fig" viewBox="150 160 340 262" preserveAspectRatio="xMidYMid meet" role="img" aria-label={big ? `${big.name}: ${big.status}` : t.researcher}>
          <rect className="sky" x={150} y={160} width={340} height={140} />
          <rect className="floor" x={150} y={300} width={340} height={122} />
          <DeskBack x={320} w={250} manager={big?.manager ?? false} />
          <g transform="translate(320, 402)">
            <Figure pose={big?.pose ?? 'stand'} face={big?.face ?? 'smile'} sweat={big?.sweat ?? false} walking={false} motion={motion} facing={1} manager={big?.manager ?? false} />
            {big ? <Bubble text={big.status} tone={big.tone} busy={big.busy} attention={big.attention} /> : null}
          </g>
          <DeskFront x={320} w={250} label={big?.name ?? t.researcher} manager={big?.manager ?? false} />
        </svg>
        {big && (big.task || big.busy || big.now) ? (
          <dl className="lab-now">
            {big.task ? <><dt>{t.task}</dt><dd title={big.task}>{big.task}</dd></> : null}
            {big.busy || big.now ? <><dt>{t.now}</dt><dd title={big.now}>{big.now ?? t.noNow}</dd></> : null}
          </dl>
        ) : null}
        <form className="lab-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="lab-theme">{t.theme}</label>
          <textarea id="lab-theme" rows={2} maxLength={500} value={theme} placeholder={t.themePh} disabled={!canUse} onChange={(e) => setTheme(e.target.value)} />
          <div className="lab-row">
            <label title={t.count}>
              <span className="sr-only">{t.count}</span>
              <select value={n} disabled={!canUse} onChange={(e) => setCount(Number(e.target.value))}>
                {(info?.counts ?? [3, 5, 10, 20]).map((c) => <option key={c} value={c}>{c}{t.countUnit || ` ${t.count.toLowerCase()}`}</option>)}
              </select>
            </label>
            <label title={`${t.people}. ${t.peopleNote}`}>
              <span className="sr-only">{t.people}</span>
              <select value={p} disabled={!canUse} onChange={(e) => setPeople(Number(e.target.value))}>
                {(info?.researcherCounts ?? [1, 2, 3]).map((c) => <option key={c} value={c}>{c}{t.peopleUnit || ` ${t.people.toLowerCase()}`}</option>)}
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={!canUse || blocked || !theme.trim()} title={t.sendNote}>{t.start}</button>
          </div>
          <p className="lab-msg">{t.peopleNote}</p>
          {refused ? <p className="lab-msg warn" role="alert">{t.reasons[refused] ?? t.reasons.failed}</p> : null}
          {!live ? <p className="lab-msg">{t.offline}</p> : null}
          {/* The mode as the hooks last reported it, and what happens in it. A fact, never advice: Office does not
              suggest or change a permission mode. */}
          {info ? <p className="lab-msg lab-perm">{mode ? <b>{t.permMode.replace('{mode}', `${modeText[lang][mode] ?? mode} (${mode})`)}</b> : null} {permFact} {t.permAnswer}</p> : null}
          <p className="lab-msg">{t.needVersion}</p>
          {info ? <p className="lab-msg" title={`${info.root}${sep}(ID)`}>{t.saveTo}: <code>{shortPath(info.root)}{sep}…</code></p> : null}
          <details className="lab-more">
            <summary>{t.more}</summary>
            {info ? <p><b>{t.saveTo}</b> <code>{info.root}{sep}r-YYYYMMDD-HHMMSS-xxxx{sep}</code></p> : null}
            <p>{t.saveNote}</p>
            {info?.inGit ? <p>{t.gitNote}</p> : null}
            <p>{t.sendNote}</p>
            <p>{t.skill}</p>
          </details>
        </form>
      </div>

      <section className="lab-board" aria-label={t.board}>
        <header className="lab-board-head">
          <h3 title={run?.theme}>{run ? run.theme || t.noTheme : t.board}</h3>
          {run ? <span className="lab-count" title={t.count}>{run.cards.length} / {run.requestedCount}</span> : null}
          {run ? (run.restored ? <span className="pill muted" title={run.dir}>{t.restored}</span> : statusPill(run)) : null}
          <span className="spacer" />
          {runs.length > 1 ? (
            <label>
              <span className="sr-only">{t.pastLabel}</span>
              <select value={run?.id ?? ''} title={t.pastLabel} onChange={(e) => setPickedRun(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r === cur ? `${t.current}: ` : ''}{(r.theme || r.id).slice(0, 40)} ({r.cards.length})</option>)}
              </select>
            </label>
          ) : null}
          {cur?.status === 'awaiting-enter' ? <button className="btn" title={t.dismissNote} onClick={() => void research.dismiss()}>{t.dismiss}</button> : null}
          {live ? <button className="btn" onClick={() => void research.refresh()}>{t.reload}</button> : null}
        </header>

        {/* Someone waits for the user's answer. The view never moves by itself: the user goes to the Office view. */}
        {runWaits.length ? (
          <div className="lab-wait" role="status">
            <b>{t.waitingHint}</b>
            <button className="btn primary" onClick={goOffice}>{t.goOffice}</button>
            <WaitRows items={runWaits} lang={lang} onHide={research.hideWait} />
          </div>
        ) : null}
        {run === cur && run?.status === 'awaiting-enter' && run.pasted ? (
          <div className="lab-wait" role="status">
            <b>{t.enterHint}</b>
            <button className="btn primary" onClick={goOffice}>{t.goOffice}</button>
            <details className="lab-more"><summary>{t.enterStuckTitle}</summary><p>{t.enterStuck}</p></details>
          </div>
        ) : null}
        {run === cur && run?.status === 'awaiting-enter' && !run.pasted && run.command ? (
          <div className="lab-wait" role="status">
            <span>{t.copyHint.replace('{why}', t.copyWhy[run.notPasted ?? ''] ?? '')}</span>
            <code className="lab-cmd">{run.command}</code>
            <button className="btn" onClick={() => copy(run.command!)}>{copied ? t.copied : t.copy}</button>
            {run.notPasted === 'waiting-permission' || run.notPasted === 'wait-unknown' ? <span>{t.staleWait}</span> : null}
            {pasteWaits.length ? <WaitRows items={pasteWaits} lang={lang} onHide={research.hideWait} /> : null}
          </div>
        ) : null}
        {run === cur && run?.status === 'researching' ? <p className="lab-msg">{t.stopNote}</p> : null}
        {run?.status === 'unconfirmed' && !run.restored ?<p className="lab-msg warn" role="status">{t.unconfirmedHint}</p> : null}
        {short > 0 ? <p className="lab-msg warn" role="status">{t.shortfall.replace('{want}', String(run!.requestedCount)).replace('{got}', String(run!.cards.length)).replace('{n}', String(short))}</p> : null}
        {run?.errors.length ? <p className="lab-msg warn">{t.fileErrors}: {run.errors.map((e) => `${e.file}（${t.fileReasons[e.reason] ?? e.reason}）`).join(', ')}</p> : null}

        <div className="lab-cards">
          {!run ? <p className="lab-empty">{t.idle}</p> : null}
          {visible.map((c) => {
            const by = c.agentId ? nOf.get(c.agentId) : undefined;
            const mine = !!picked && !picked.manager && c.agentId === picked.agentId;
            return (
              <button key={c.file} className={`lab-card st-${c.status}${mine ? ' mine' : ''}`} onClick={() => setOpen(c)}>
                <span className="pin" aria-hidden="true" />
                <b>{c.title}</b>
                <span className="sum">{c.summary}</span>
                <span className="foot">
                  {by !== undefined ? <span className="pill muted by" title={t.by.replace('{who}', `${t.researcher} ${by}`)}>R{by}</span> : null}
                  {c.status !== 'completed' ? <span className={`pill ${c.status === 'failed' ? 'danger' : 'warn'}`}>{c.status === 'failed' ? t.failed : t.partial}</span> : null}
                  {c.review ? <span className={`pill ${c.review.verdict === 'confirmed' ? 'ok' : 'warn'}`}>{t.verdict[c.review.verdict]}</span> : null}
                  <span className="src">{c.sources.length ? t.sources.replace('{n}', String(c.sources.length)) : t.noSources}</span>
                </span>
              </button>
            );
          })}
          {Array.from({ length: ghosts }, (_, i) => <div key={`g${i}`} className={`lab-card ghost${i === 0 ? ' next' : ''}`} aria-hidden="true">{i === 0 && run?.status === 'researching' ? t.researching : ''}</div>)}
        </div>
      </section>

      {flying && flyFromPicked ? <div key={flying} className="lab-fly" aria-hidden="true" /> : null}

      {open ? (
        <Dialog title={open.title} closeLabel={t.close} onClose={() => setOpen(undefined)} className="dlg-card">
          {open.summary ? <div className="dlg-field"><div className="k">{t.dSummary}</div><p className="lab-text">{open.summary}</p></div> : null}
          {open.details ? <div className="dlg-field"><div className="k">{t.dDetails}</div><p className="lab-text">{open.details}</p></div> : null}
          {open.findings.length ? <div className="dlg-field"><div className="k">{t.dFindings}</div><ul className="lab-list">{open.findings.map((f, i) => <li key={i}>{f}</li>)}</ul></div> : null}
          <div className="dlg-field">
            <div className="k">{t.dSources}</div>
            {open.sources.length ? (
              <ul className="lab-list">
                {open.sources.map((s, i) => {
                  const href = httpUrl(s.url);
                  return <li key={i}>{s.title ? <span>{s.title} </span> : null}{href ? <a href={href} target="_blank" rel="noopener noreferrer">{s.url}</a> : <code>{s.url}</code>}</li>;
                })}
              </ul>
            ) : <p className="hint">{t.dNoSources}</p>}
          </div>
          {open.caveats.length ? <div className="dlg-field"><div className="k">{t.dCaveats}</div><ul className="lab-list">{open.caveats.map((f, i) => <li key={i}>{f}</li>)}</ul></div> : null}
          {open.review ? <div className="dlg-field"><div className="k">{t.dReview}</div><p className="lab-text"><span className={`pill ${open.review.verdict === 'confirmed' ? 'ok' : 'warn'}`}>{t.verdict[open.review.verdict]}</span> {open.review.note}</p></div> : null}
          <div className="dlg-field"><div className="k">{t.dMeta}</div><p className="hint">{open.engine} · {run?.id} · {open.id} · {open.file}{open.agentId && nOf.has(open.agentId) ? ` · ${t.researcher} ${nOf.get(open.agentId)}` : ''} · {new Date(open.at).toLocaleString(lang)}</p></div>
        </Dialog>
      ) : null}
    </div>
  );
}
