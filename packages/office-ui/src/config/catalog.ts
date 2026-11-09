// What each Claude Code configuration location is for, shown even when the file does not exist.
// Only Claude Code's own, documented locations. Ids match packages/event-bridge/src/config-scan.ts.
import type { Lang } from '../i18n.ts';

export type Layer = 'managed' | 'user' | 'project';

export interface CatalogEntry {
  id: string;
  layer: Layer;
  /** Display name (path relative to its root). */
  label: string;
  /** Who writes it: you, your team (shared in git), your organization. */
  owner: 'org' | 'you' | 'team' | 'claude';
  text: Record<Lang, { role: string; settable: string[]; example: string }>;
}

export const LAYER_TEXT: Record<Lang, Record<Layer, { title: string; note: string }>> = {
  ja: {
    managed: { title: '組織の管理ポリシー', note: '管理者が配布する設定。いちばん強く、ユーザーやプロジェクトでは上書きできません。' },
    user: { title: 'ユーザー（このPCのあなた）', note: 'すべてのプロジェクトに効く、あなた個人の設定です。' },
    project: { title: 'プロジェクト', note: 'Claude Code を起動したフォルダの設定。.local が付くものは自分専用（git 管理外）、それ以外はチームで共有します。' },
  },
  en: {
    managed: { title: 'Organization policy', note: 'Deployed by an administrator. Highest precedence; users and projects cannot override it.' },
    user: { title: 'User (you on this PC)', note: 'Your personal settings, applied to every project.' },
    project: { title: 'Project', note: 'Settings of the folder Claude Code starts in. Files with .local are yours only (not in git); the others are shared with the team.' },
  },
};

export const OWNER_TEXT: Record<Lang, Record<CatalogEntry['owner'], string>> = {
  ja: { org: '組織が配布', you: '自分用', team: 'チームで共有', claude: 'Claude Code が書く' },
  en: { org: 'by your organization', you: 'just you', team: 'shared with the team', claude: 'written by Claude Code' },
};

const settingsKeys = {
  ja: ['permissions（allow / ask / deny でツールの許可・確認・禁止、defaultMode、additionalDirectories）', 'env（Claude Code に渡す環境変数）', 'hooks（ツール実行の前後などに自動で動くコマンド）', 'model（既定のモデル）', 'enabledPlugins / extraKnownMarketplaces（プラグイン）', 'statusLine、outputStyle、theme などの表示'],
  en: ['permissions (allow / ask / deny tools, defaultMode, additionalDirectories)', 'env (environment variables for Claude Code)', 'hooks (commands run automatically, e.g. before/after tools)', 'model (default model)', 'enabledPlugins / extraKnownMarketplaces (plugins)', 'display: statusLine, outputStyle, theme…'],
};

export const CATALOG: CatalogEntry[] = [
  // ---- managed ----
  {
    id: 'managed-settings', layer: 'managed', label: 'managed-settings.json', owner: 'org',
    text: {
      ja: { role: '組織が強制する設定。ここに書かれた内容は、ユーザー・プロジェクトの設定より優先されます。', settable: [...settingsKeys.ja, '管理者専用の項目（例: 承認済みマーケットプレイスだけを許可する、管理フック以外を禁止する）'], example: '通常は組織の管理者が配布します。個人では作りません。' },
      en: { role: 'Settings enforced by the organization. They take precedence over user and project settings.', settable: [...settingsKeys.en, 'admin-only keys (e.g. allow only approved marketplaces, only managed hooks)'], example: 'Normally deployed by an administrator, not created by hand.' },
    },
  },
  {
    id: 'managed-mcp', layer: 'managed', label: 'managed-mcp.json', owner: 'org',
    text: {
      ja: { role: '組織が用意する MCP サーバー（外部ツール連携）の一覧。', settable: ['mcpServers（サーバー名ごとに起動コマンドや URL）'], example: '通常は組織の管理者が配布します。' },
      en: { role: 'MCP servers (external tool connections) provided by the organization.', settable: ['mcpServers (command or URL per server name)'], example: 'Normally deployed by an administrator.' },
    },
  },
  {
    id: 'managed-claude-md', layer: 'managed', label: 'CLAUDE.md', owner: 'org',
    text: {
      ja: { role: '組織全体で Claude に守らせたい指示（メモリ）。', settable: ['自由な文章（コーディング規約、禁止事項など）'], example: '通常は組織の管理者が配布します。' },
      en: { role: 'Instructions (memory) for Claude across the whole organization.', settable: ['free text (coding rules, things not to do…)'], example: 'Normally deployed by an administrator.' },
    },
  },
  // ---- user ----
  {
    id: 'user-settings', layer: 'user', label: '.claude/settings.json', owner: 'you',
    text: {
      ja: { role: 'あなた個人の設定。すべてのプロジェクトに効きます。/config や /permissions、/plugin の操作もここに保存されます。', settable: settingsKeys.ja, example: '「~/.claude/settings.json の permissions.allow に Bash(npm test) を追加して」' },
      en: { role: 'Your personal settings for every project. /config, /permissions and /plugin save here too.', settable: settingsKeys.en, example: '"Add Bash(npm test) to permissions.allow in ~/.claude/settings.json"' },
    },
  },
  {
    id: 'user-claude-json', layer: 'user', label: '.claude.json', owner: 'claude',
    text: {
      ja: { role: 'Claude Code 自身が書く状態ファイル。大半は起動回数やキャッシュなどの記録で、ログイン情報も含みます。Office は設定にあたる部分（ユーザー単位の MCP サーバーと、このプロジェクトの許可・MCP）だけを読み、ほかは読み出しません。', settable: ['mcpServers（ユーザー単位の MCP。claude mcp add --scope user で追加）', 'projects.<フォルダ>.mcpServers（このプロジェクトだけの MCP。--scope local）', 'projects.<フォルダ>.allowedTools など（許可ダイアログで「今後も許可」した記録）'], example: '直接編集せず、claude mcp add / remove や /mcp を使います。' },
      en: { role: "Claude Code's own state file. Mostly counters and caches, plus the signed-in account. Office reads only the configuration parts (user MCP servers and this project's permissions/MCP) and nothing else.", settable: ['mcpServers (user-scope MCP; claude mcp add --scope user)', 'projects.<folder>.mcpServers (this project only; --scope local)', 'projects.<folder>.allowedTools… (answers to "always allow")'], example: 'Do not edit by hand; use claude mcp add / remove or /mcp.' },
    },
  },
  {
    id: 'user-claude-md', layer: 'user', label: '.claude/CLAUDE.md', owner: 'you',
    text: {
      ja: { role: 'すべてのプロジェクトで Claude に伝えたい、あなた個人の指示（メモリ）。セッション開始時に読み込まれます。', settable: ['自由な文章（話し方、好みのツール、いつも守ってほしいこと）', '@パス で別ファイルを取り込み'], example: '「~/.claude/CLAUDE.md に『回答は日本語で』と書いて」' },
      en: { role: 'Your personal instructions (memory) for every project, loaded when a session starts.', settable: ['free text (tone, preferred tools, things to always do)', '@path imports another file'], example: '"Write \'Answer in Japanese\' in ~/.claude/CLAUDE.md"' },
    },
  },
  {
    id: 'user-rules', layer: 'user', label: '.claude/rules/', owner: 'you',
    text: {
      ja: { role: 'CLAUDE.md をテーマごとに分けたルール集（*.md）。全プロジェクトに効きます。', settable: ['1ファイル1テーマの指示', 'front matter の paths で、特定のファイルを扱うときだけ効かせる'], example: '「~/.claude/rules/ に git の運用ルールを作って」' },
      en: { role: 'CLAUDE.md split by topic (*.md files), for every project.', settable: ['one topic per file', 'paths in front matter: apply only to matching files'], example: '"Create a git workflow rule in ~/.claude/rules/"' },
    },
  },
  {
    id: 'user-agents', layer: 'user', label: '.claude/agents/', owner: 'you',
    text: {
      ja: { role: 'あなたが定義したサブエージェント（*.md）。Office の棒人間として登場するのもこれです。', settable: ['name / description（いつ使うか）', 'tools（使えるツールの制限）、model', '本文: そのエージェントへの指示'], example: '「コードレビュー用のサブエージェントを ~/.claude/agents/ に作って」' },
      en: { role: 'Subagents you define (*.md). They appear as figures in the office.', settable: ['name / description (when to use it)', 'tools (restrict tools), model', 'body: instructions for that agent'], example: '"Create a code-review subagent in ~/.claude/agents/"' },
    },
  },
  {
    id: 'user-commands', layer: 'user', label: '.claude/commands/', owner: 'you',
    text: {
      ja: { role: '自作のスラッシュコマンド（*.md）。ファイル名が /コマンド名 になります。現在はスキルに統合されつつあります。', settable: ['本文: コマンドで送るプロンプト（$ARGUMENTS で引数）', 'description、allowed-tools など'], example: '「/standup コマンドを ~/.claude/commands/ に作って」' },
      en: { role: 'Your own slash commands (*.md); the file name becomes /name. Being merged into skills.', settable: ['body: the prompt to send ($ARGUMENTS for arguments)', 'description, allowed-tools…'], example: '"Create a /standup command in ~/.claude/commands/"' },
    },
  },
  {
    id: 'user-skills', layer: 'user', label: '.claude/skills/', owner: 'you',
    text: {
      ja: { role: '自作スキル。フォルダごとに SKILL.md を置くと、Claude が必要なときに読み込みます（/スキル名 でも呼べます）。', settable: ['SKILL.md の name / description（いつ使うか）', '手順書・スクリプト・参考資料を同じフォルダに'], example: '「リリース手順のスキルを ~/.claude/skills/ に作って」' },
      en: { role: 'Your own skills: a folder with SKILL.md that Claude loads when needed (or /name).', settable: ['name / description in SKILL.md (when to use it)', 'steps, scripts and references in the same folder'], example: '"Create a release-steps skill in ~/.claude/skills/"' },
    },
  },
  {
    id: 'user-output-styles', layer: 'user', label: '.claude/output-styles/', owner: 'you',
    text: {
      ja: { role: '出力スタイル（*.md）。Claude の応答の仕方（システムプロンプト）を切り替えます。', settable: ['name / description', '本文: 応答の仕方の指示'], example: '「説明多めの出力スタイルを作って」→ /output-style で選択' },
      en: { role: "Output styles (*.md) that change how Claude answers (its system prompt).", settable: ['name / description', 'body: how to answer'], example: '"Create an explanatory output style", then pick it with /output-style' },
    },
  },
  {
    id: 'user-keybindings', layer: 'user', label: '.claude/keybindings.json', owner: 'you',
    text: {
      ja: { role: 'Claude Code のキー割り当て。', settable: ['操作ごとのキー（コード入力の連続キーも可）'], example: '「Ctrl+S で送信できるようにして」' },
      en: { role: "Claude Code's key bindings.", settable: ['a key (or chord) per action'], example: '"Make Ctrl+S submit"' },
    },
  },
  {
    id: 'user-memory', layer: 'user', label: '.claude/projects/<project>/memory/', owner: 'claude',
    text: {
      ja: { role: '自動メモリ。Claude Code がこのプロジェクトで覚えたこと（あなたの好み、決まりごと）を保存します。MEMORY.md が目次です。', settable: ['「覚えておいて」と頼むと Claude が追加', '不要なものは「忘れて」で削除'], example: '「承認は一度でいいことを覚えておいて」' },
      en: { role: 'Auto memory: what Claude Code learned in this project (your preferences, decisions). MEMORY.md is the index.', settable: ['ask "remember …" and Claude adds it', 'ask "forget …" to remove'], example: '"Remember that one approval is enough"' },
    },
  },
  // ---- project ----
  {
    id: 'project-settings', layer: 'project', label: '.claude/settings.json', owner: 'team',
    text: {
      ja: { role: 'このプロジェクトの共有設定。git に入れてチームで同じ設定を使います。ユーザー設定より優先されます。', settable: settingsKeys.ja, example: '「このプロジェクトの .claude/settings.json で npm test を許可して」' },
      en: { role: 'Shared settings for this project, committed to git. Override user settings.', settable: settingsKeys.en, example: '"Allow npm test in this project\'s .claude/settings.json"' },
    },
  },
  {
    id: 'project-settings-local', layer: 'project', label: '.claude/settings.local.json', owner: 'you',
    text: {
      ja: { role: 'このプロジェクトでの自分だけの設定（git 管理外）。共有設定より優先されます。許可ダイアログで「このプロジェクトで今後も許可」を選ぶとここに入ります。', settable: settingsKeys.ja, example: '「自分用に、このプロジェクトだけ編集を自動許可にして」' },
      en: { role: 'Your own settings for this project (not in git). Override the shared ones. "Always allow in this project" saves here.', settable: settingsKeys.en, example: '"For me only, auto-accept edits in this project"' },
    },
  },
  {
    id: 'project-claude-md', layer: 'project', label: 'CLAUDE.md', owner: 'team',
    text: {
      ja: { role: 'プロジェクトの説明と決まりごと（.claude/CLAUDE.md でも可）。チームで共有します。/init で作れます。', settable: ['ビルド・テストのコマンド、構成、コーディング規約', '@パス で別ファイルを取り込み'], example: '「/init で CLAUDE.md を作って」' },
      en: { role: 'Project description and rules (or .claude/CLAUDE.md), shared with the team. /init creates one.', settable: ['build/test commands, layout, coding rules', '@path imports another file'], example: '"Run /init to create CLAUDE.md"' },
    },
  },
  {
    id: 'project-claude-local-md', layer: 'project', label: 'CLAUDE.local.md', owner: 'you',
    text: {
      ja: { role: 'このプロジェクトでの自分だけのメモ（git 管理外）。', settable: ['自分の環境の URL、テスト用データなど'], example: '「CLAUDE.local.md にローカルの DB 接続先を書いて」' },
      en: { role: 'Your own notes for this project (not in git).', settable: ['your local URLs, test data…'], example: '"Note my local DB URL in CLAUDE.local.md"' },
    },
  },
  {
    id: 'project-ancestors', layer: 'project', label: '../CLAUDE.md', owner: 'you',
    text: {
      ja: { role: '親フォルダにある CLAUDE.md / CLAUDE.local.md。起動フォルダから上へたどって見つかったものも読み込まれます。', settable: ['複数プロジェクトをまとめるフォルダ共通の指示'], example: '「C:\\work に全プロジェクト共通の CLAUDE.md を置いて」' },
      en: { role: 'CLAUDE.md / CLAUDE.local.md in parent folders, found walking up from the start folder; they are loaded too.', settable: ['instructions shared by a folder of projects'], example: '"Put a CLAUDE.md shared by all projects in C:\\work"' },
    },
  },
  {
    id: 'project-rules', layer: 'project', label: '.claude/rules/', owner: 'team',
    text: {
      ja: { role: 'プロジェクトのルール集（*.md）。CLAUDE.md をテーマごとに分けたもの。', settable: ['1ファイル1テーマ', 'paths で対象ファイルを限定（例: src/api/**）'], example: '「API 用のルールを .claude/rules/ に作って」' },
      en: { role: 'Project rules (*.md): CLAUDE.md split by topic.', settable: ['one topic per file', 'paths limits it to files (e.g. src/api/**)'], example: '"Create API rules in .claude/rules/"' },
    },
  },
  {
    id: 'project-mcp', layer: 'project', label: '.mcp.json', owner: 'team',
    text: {
      ja: { role: 'チームで共有する MCP サーバー。初回は使ってよいか確認が出ます。', settable: ['mcpServers（サーバー名ごとに command / args / env、または url）'], example: '「claude mcp add --scope project で ○○ を追加して」' },
      en: { role: 'MCP servers shared with the team. Claude Code asks before using them the first time.', settable: ['mcpServers (command / args / env, or url, per server)'], example: '"Add … with claude mcp add --scope project"' },
    },
  },
  {
    id: 'project-agents', layer: 'project', label: '.claude/agents/', owner: 'team',
    text: {
      ja: { role: 'このプロジェクト専用のサブエージェント。同名ならユーザーのものより優先。', settable: ['name / description / tools / model と指示'], example: '「このリポジトリ用のテスト担当サブエージェントを作って」' },
      en: { role: 'Subagents for this project; win over user ones with the same name.', settable: ['name / description / tools / model and instructions'], example: '"Create a test-runner subagent for this repo"' },
    },
  },
  {
    id: 'project-commands', layer: 'project', label: '.claude/commands/', owner: 'team',
    text: {
      ja: { role: 'このプロジェクト専用のスラッシュコマンド。', settable: ['本文のプロンプト、description、allowed-tools'], example: '「/deploy コマンドを .claude/commands/ に作って」' },
      en: { role: 'Slash commands for this project.', settable: ['prompt body, description, allowed-tools'], example: '"Create a /deploy command in .claude/commands/"' },
    },
  },
  {
    id: 'project-skills', layer: 'project', label: '.claude/skills/', owner: 'team',
    text: {
      ja: { role: 'このプロジェクト専用のスキル（フォルダごとに SKILL.md）。', settable: ['name / description、手順、スクリプト'], example: '「このアプリの起動手順をスキルにして」' },
      en: { role: 'Skills for this project (a folder with SKILL.md each).', settable: ['name / description, steps, scripts'], example: '"Turn this app\'s run steps into a skill"' },
    },
  },
  {
    id: 'project-output-styles', layer: 'project', label: '.claude/output-styles/', owner: 'team',
    text: {
      ja: { role: 'このプロジェクト専用の出力スタイル。', settable: ['name / description、応答の仕方'], example: '「レビュー向けの出力スタイルを作って」' },
      en: { role: 'Output styles for this project.', settable: ['name / description, how to answer'], example: '"Create a review output style"' },
    },
  },
];

/** Known top-level keys of settings.json-style files. Unknown keys are shown without a description. */
export const KEY_TEXT: Record<Lang, Record<string, string>> = {
  ja: {
    permissions: 'ツールの許可（allow）・確認（ask）・禁止（deny）、既定の権限モード、追加で触れるフォルダ',
    env: 'Claude Code に渡す環境変数（値は Office では伏せて表示）',
    hooks: 'イベントごとに自動で動くコマンド',
    model: '既定のモデル',
    enabledPlugins: '有効にするプラグイン（名前@マーケットプレイス）',
    extraKnownMarketplaces: '追加で使うプラグインのマーケットプレイス',
    statusLine: '画面下のステータス行の表示内容',
    outputStyle: '使う出力スタイル',
    theme: '配色テーマ',
    tui: '画面の表示方式',
    autoUpdatesChannel: '自動更新のチャンネル（latest / stable）',
    apiKeyHelper: 'API キーを出力するスクリプト',
    cleanupPeriodDays: '会話履歴を残す日数',
    includeCoAuthoredBy: 'コミットに Co-Authored-By を付けるか',
    attribution: 'コミットや PR に付ける署名',
    enableAllProjectMcpServers: '.mcp.json のサーバーを確認なしで全部使う',
    enabledMcpjsonServers: '.mcp.json のうち使うサーバー',
    disabledMcpjsonServers: '.mcp.json のうち使わないサーバー',
    forceLoginMethod: 'ログイン方法の固定',
    alwaysThinkingEnabled: '拡張思考を常に有効にする',
    language: '応答の言語',
    sandbox: 'コマンドを隔離して実行するサンドボックス',
    disableAllHooks: 'すべてのフックを止める',
    companyAnnouncements: '起動時に表示するお知らせ',
    spinnerTipsEnabled: '待ち時間のヒント表示',
    mcpServers: 'MCP サーバー（サーバー名 → 起動方法）',
    project: 'このプロジェクトの記録（許可したツール、ローカル MCP）',
    projectsKnown: 'Claude Code が記録しているプロジェクトの数',
    $schema: 'エディタ補完用のスキーマ',
  },
  en: {
    permissions: 'allow / ask / deny tools, default permission mode, extra folders',
    env: 'environment variables for Claude Code (values hidden in Office)',
    hooks: 'commands run automatically on events',
    model: 'default model',
    enabledPlugins: 'plugins to enable (name@marketplace)',
    extraKnownMarketplaces: 'extra plugin marketplaces',
    statusLine: 'the status line at the bottom',
    outputStyle: 'output style in use',
    theme: 'color theme',
    tui: 'screen mode',
    autoUpdatesChannel: 'update channel (latest / stable)',
    apiKeyHelper: 'script that prints an API key',
    cleanupPeriodDays: 'days to keep conversation history',
    includeCoAuthoredBy: 'add Co-Authored-By to commits',
    attribution: 'attribution for commits and PRs',
    enableAllProjectMcpServers: 'use every .mcp.json server without asking',
    enabledMcpjsonServers: '.mcp.json servers to use',
    disabledMcpjsonServers: '.mcp.json servers not to use',
    forceLoginMethod: 'fixed sign-in method',
    alwaysThinkingEnabled: 'always use extended thinking',
    language: 'answer language',
    sandbox: 'run commands in a sandbox',
    disableAllHooks: 'turn off all hooks',
    companyAnnouncements: 'announcements shown at start',
    spinnerTipsEnabled: 'tips while waiting',
    mcpServers: 'MCP servers (name → how to start)',
    project: "this project's records (allowed tools, local MCP)",
    projectsKnown: 'projects Claude Code keeps records for',
    $schema: 'schema for editor completion',
  },
};
