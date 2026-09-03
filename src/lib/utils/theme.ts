export const THEME_DARK = {
  color: {
    Shadow: {
      main: "rgba(0,0,0,0.1)",
      sub: "rgba(255,255,255,0.1)",
      "main-translucent": "rgba(0,0,0,0.2)",
      "sub-translucent": "rgba(255,255,255,0.2)",
    },
    Primary: {
      light: "#e3f2fd",
      main: "#90caf9",
      dark: "#42a5f5",
      /**
       * 文字に載せる用、および「その上に文字を載せる塗り」用。ダークテーマ
       * では `main` がそのまま AA を満たすので同値。ライトテーマ側の同名
       * トークンと組で使うことで、テーマを跨いで 4.5:1 を確保する。
       */
      text: "#90caf9",
    },
    Secondary: {
      light: "#f3e5f5",
      main: "#ce93d8",
      dark: "#ab47bc",
    },
    Error: {
      light: "#e57373",
      main: "#f44336",
      dark: "#d32f2f",
      /**
       * 文字に載せる用。`main` は 8px のドットや 1px の枠線としては十分でも、
       * 12px の文字にすると行背景に対して 2.8:1 前後しか出ず WCAG AA
       * (4.5:1) を満たせない。枠線やドットは `main` のまま、文字だけ
       * この値にする。
       */
      text: "#ffb4ab",
    },
    Warning: {
      light: "#ffb74d",
      main: "#ffa726",
      dark: "#f57c00",
      /** 文字に載せる用。理由は Error.text と同じ。 */
      text: "#ffb74d",
    },
    Info: {
      light: "#4fc3f7",
      main: "#29b6f6",
      dark: "#0288d1",
    },
    Success: {
      light: "#81c784",
      main: "#66bb6a",
      dark: "#388e3c",
    },
    Main: {
      light: "#394249",
      main: "#262D32",
      dark: "#101315",
    },
    Sub: {
      light: "#F9F9F9",
      main: "#E8EDF0",
      dark: "#D9DEE1",
    },
    Accent: {
      light: "#FBA9C7",
      main: "#FF2E63",
      dark: "#DA1E4E",
    },
    Theme: {
      light: "#2B52BC",
      main: "#143693",
      dark: "#082062",
    },
  },
};

export const THEME_LIGHT = {
  color: {
    Shadow: {
      main: "rgba(255,255,255,0.1)",
      sub: "rgba(0,0,0,0.1)",
      "main-translucent": "rgba(255,255,255,0.2)",
      "sub-translucent": "rgba(0,0,0,0.2)",
    },
    Primary: {
      main: "#1976d2",
      light: "#42a5f5",
      dark: "#1565c0",
      /**
       * 文字に載せる用、および「その上に文字を載せる塗り」用。`main`
       * (#1976d2) は淡い背景の上で 3.9〜4.4:1 にとどまり AA に僅かに届か
       * ない。塗りとして使う場合も、白文字との比が 4.37:1 で足りない。
       */
      text: "#1565c0",
    },
    Secondary: {
      light: "#ba68c8",
      main: "#9c27b0",
      dark: "#7b1fa2",
    },
    Error: {
      light: "#ef5350",
      main: "#d32f2f",
      dark: "#c62828",
      /** 文字に載せる用。理由は THEME_DARK の Error.text と同じ。 */
      text: "#a31515",
    },
    Warning: {
      light: "#ff9800",
      main: "#ed6c02",
      dark: "#e65100",
      /**
       * 文字に載せる用。ライトテーマの `main` (#ed6c02) は行背景に対して
       * 2.96:1 しかなく、色付き文字の中でいちばん読みにくかった。
       */
      text: "#8a4000",
    },
    Info: {
      light: "#03a9f4",
      main: "#0288d1",
      dark: "#01579b",
    },
    Success: {
      light: "#4caf50",
      main: "#2e7d32",
      dark: "#1b5e20",
    },
    Main: {
      light: "#F9F9F9",
      main: "#EFF2F3",
      dark: "#D9DEE1",
    },
    Sub: {
      light: "#394249",
      main: "#262D32",
      dark: "#101315",
    },
    Accent: {
      light: "#FBA9C7",
      main: "#FF2E63",
      dark: "#DA1E4E",
    },
    Theme: {
      light: "#2B52BC",
      main: "#143693",
      dark: "#082062",
    },
  },
};
