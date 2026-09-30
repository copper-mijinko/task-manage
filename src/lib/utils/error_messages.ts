/**
 * main プロセスから返るエラーを、画面に出せる日本語にする。
 *
 * グラフの検証エラーは main 側で英語のまま投げられ、IPC を通ると
 * 「Error invoking remote method 'ws:execute-graph-command': Error: …」という
 * 内部の前置きまで付いて画面に出ていた。ここで前置きを落とし、既知の
 * 理由は利用者の言葉に置き換える。
 */

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

/**
 * 既知の理由と、その言い換え。上から順に照合する。言い換えが `null` のものは、
 * すでに利用者向けの日本語なので、そのまま出す（ただし入力の拒否として扱う）。
 */
const KNOWN: [RegExp, string | null][] = [
  // 保存先のファイルが、アプリの外で書き換えられていた（何も書いていない）。
  [/アプリの外で変更されています/, null],
  [/Start date is after due date/i, "開始日が期限日より後になっています。日付を確認してください。"],
  [/Invalid node date/i, "日付の形式が正しくありません（YYYY-MM-DD）。"],
  [/cannot create a cycle|cyclic subgraph/i, "この操作では循環する親子関係を作れません。"],
  [/Duplicate edges/i, "同じ親子関係がすでにあります。"],
  [/Self edges/i, "ノードを自分自身の子にはできません。"],
  [/workspace root (is protected|cannot)/i, "ワークスペースのルートにはこの操作を実行できません。"],
  [/Edge not found/i, "対象の配置が見つかりません。表示を更新してからやり直してください。"],
  [
    /Unknown (node|parent)/i,
    "対象のノードが見つかりません。表示を更新してからやり直してください。",
  ],
  [/changed|conflict|revision/i, "別の変更が先に保存されました。最新の内容を読み込みました。"],
  [/No workspace graph is loaded/i, "ワークスペースが開かれていません。"],
];

/**
 * 入力の拒否ではなく、本当に失敗したときの理由（ファイルの読み書きなど）。
 * 言い換えるだけで、保存失敗の扱いは変えない。
 */
const FAILURES: [RegExp, string][] = [
  [/ENOSPC/, "ディスクの空き容量が足りません。"],
  [/EACCES|EPERM|EBUSY/, "ファイルにアクセスできません（使用中か、権限がありません）。"],
  [/ENOENT/, "ファイルまたはフォルダーが見つかりません。"],
  [
    /Active workspace is not registered/i,
    "このワークスペースは登録されていません。設定から開き直してください。",
  ],
  [
    /not approved by the directory picker/i,
    "フォルダーの選択を確認できませんでした。もう一度選んでください。",
  ],
  [
    /Invalid workspace graph|Invalid node record|Every node must be reachable/i,
    "ワークスペースのデータを読み込めませんでした（形式が正しくありません）。",
  ],
  [
    /Cannot read legacy|Invalid legacy|legacy .* was not imported/i,
    "旧形式のファイルを読み込めませんでした。",
  ],
  [/Only image assets|Unsupported image URL/i, "この画像は表示できません。"],
  [/Task does not exist in workspace/i, "ノードが見つかりません。"],
  [/API unavailable/i, "アプリの内部機能に接続できませんでした。再起動してください。"],
];

/** 画面に出すメッセージ。 */
export function userErrorMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(
    IPC_PREFIX,
    ""
  );
  for (const [pattern, message] of [...KNOWN, ...FAILURES])
    if (pattern.test(raw)) return message ?? raw;
  return raw || "操作できませんでした。";
}

/**
 * 入力や操作が受け付けられなかっただけで、ファイルには何も書いていない
 * エラーか。この場合は保存に失敗したわけではないので「保存失敗」にしない
 * （以前は拒否された入力のあと、ずっと赤い「保存失敗」が残っていた）。
 */
export function isRejectedOperation(error: unknown): boolean {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(
    IPC_PREFIX,
    ""
  );
  if (FAILURES.some(([pattern]) => pattern.test(raw))) return false;
  return (
    KNOWN.some(([pattern]) => pattern.test(raw)) ||
    /Inbox|できません|Invalid|Unknown|not allowed|protected|require/i.test(raw)
  );
}

/** 日本語のメッセージを持つエラーに包み直す（元のエラーは cause に残す）。 */
export function toUserError(error: unknown): Error & { rejected: boolean } {
  const wrapped = new Error(userErrorMessage(error), { cause: error }) as Error & {
    rejected: boolean;
  };
  wrapped.rejected = isRejectedOperation(error);
  return wrapped;
}
