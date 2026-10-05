import { Editor, type OnMount } from "@monaco-editor/react";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LintResult } from "@/api/types";
import { Loading } from "@/components/ui";
import { useReducedMotion } from "@/lib/motion";
import type { DraftSession } from "../autosave/draft-session";
import { useSessionValue } from "../autosave/sessions";
import { codePointColumnToUtf16, LINT_MARKER_OWNER, lintMarkers } from "../lint-markers";
import { monacoModule, themeModelPath } from "../monaco/load";
import {
  MONACO_FONT_FAMILY,
  MONACO_FONT_SIZE,
  MONACO_LINE_HEIGHT,
  MONACO_THEME_NAME,
} from "../monaco/theme";
import { setModelPalette } from "../monaco/providers";

type MonacoEditor = Parameters<OnMount>[0];

/** Wat de rest van de pagina met de editor kan doen. */
export interface CodeEditorHandle {
  /** Naar een regel/kolom (UTF-16, zoals Monaco telt) springen en de editor focussen. */
  reveal: (line: number, column: number) => void;
  /**
   * Idem met een kolom in Unicode-codepunten, zoals de server ze in lint-meldingen geeft: op een
   * regel met emoji of andere astrale tekens verschilt die van de UTF-16-kolom van Monaco.
   */
  revealCodePoint: (line: number, column: number) => void;
  /** Tekst invoegen op de cursor (bv. `var(--ct-bg)` uit de verkenner). */
  insert: (text: string) => void;
  focus: () => void;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface CodeEditorProps {
  themeId: string;
  session: DraftSession;
  palette: { name: string; tokens: Readonly<Record<string, string>> } | null;
  lint: LintResult | undefined;
  readOnly?: boolean;
  /** Smal scherm (telefoon): geen minimap, die kost daar te veel breedte. */
  compact?: boolean;
  ariaLabel: string;
  onCursorChange?: (position: CursorPosition) => void;
  onReady?: (handle: CodeEditorHandle | null) => void;
}

/**
 * Monaco voor de CSS van één thema. Eén model per thema (`themeModelPath`), zodat wisselen
 * van tab de undo-geschiedenis en cursor bewaart. De inhoud gaat bij elke wijziging naar de
 * `DraftSession` (autosave); vervangt de sessie de inhoud van buitenaf (buffer, rollback,
 * conflict), dan werkt een effect het model bij als bewerking die ongedaan te maken is.
 */
export function CodeEditor(props: CodeEditorProps) {
  const { monaco } = use(monacoModule());
  const { themeId, session, palette, lint, readOnly = false, compact = false, ariaLabel } = props;
  // Monaco animeert scrollen en sprongen (125 ms); bij "minder beweging" niet.
  const reducedMotion = useReducedMotion();
  const editorRef = useRef<MonacoEditor | null>(null);
  const [mounted, setMounted] = useState(false);
  const latest = useRef(props);
  const revision = useSessionValue(session, (snapshot) => snapshot.revision, 0);
  const path = themeModelPath(themeId);

  useLayoutEffect(() => {
    latest.current = props;
  });

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model || model.uri.toString() !== themeModelPath(latest.current.themeId)) return;
      latest.current.session.edit(model.getValue());
    });
    editor.onDidChangeCursorPosition((event) => {
      latest.current.onCursorChange?.({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });
    const reveal = (line: number, column: number) => {
      editor.setPosition({ lineNumber: line, column });
      editor.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column });
      editor.focus();
    };
    latest.current.onReady?.({
      reveal,
      revealCodePoint: (line, column) => {
        const model = editor.getModel();
        if (!model) return;
        const lineNumber = Math.min(Math.max(1, Math.trunc(line) || 1), model.getLineCount());
        const text = model.getLineContent(lineNumber);
        const utf16 = codePointColumnToUtf16(text, Math.max(1, Math.trunc(column) || 1));
        reveal(lineNumber, Math.min(utf16, text.length + 1));
      },
      insert: (text) => {
        const selection = editor.getSelection();
        if (!selection) return;
        editor.pushUndoStop();
        editor.executeEdits("cssthema-insert", [
          { range: selection, text, forceMoveMarkers: true },
        ]);
        editor.pushUndoStop();
        editor.focus();
      },
      focus: () => editor.focus(),
    });
    setMounted(true);
  };

  useEffect(
    () => () => {
      latest.current.onReady?.(null);
    },
    [],
  );

  // Inhoud van de sessie → model (na wisselen van tab of vervanging van buitenaf).
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || model.uri.toString() !== path) return;
    const css = session.getSnapshot().css;
    if (model.getValue() === css) return;
    editor.pushUndoStop();
    editor.executeEdits("cssthema-sync", [{ range: model.getFullModelRange(), text: css }]);
    editor.pushUndoStop();
  }, [mounted, path, session, revision]);

  // Lint-markers van de server op het model van dit thema.
  useEffect(() => {
    const model = monaco.editor.getModel(monaco.Uri.parse(path));
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      LINT_MARKER_OWNER,
      lintMarkers(lint, model.getValue(), {
        severities: {
          error: monaco.MarkerSeverity.Error,
          warning: monaco.MarkerSeverity.Warning,
          info: monaco.MarkerSeverity.Info,
        },
      }),
    );
  }, [monaco, mounted, path, lint]);

  // Palet-tokens voor autocomplete en hover.
  useEffect(() => {
    const uri = monaco.Uri.parse(path).toString();
    setModelPalette(uri, palette);
  }, [monaco, path, palette]);

  return (
    <Editor
      path={path}
      defaultLanguage="css"
      defaultValue={session.getSnapshot().css}
      theme={MONACO_THEME_NAME}
      keepCurrentModel
      loading={<Loading />}
      onMount={onMount}
      options={{
        ariaLabel,
        readOnly,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        fontFamily: MONACO_FONT_FAMILY,
        fontSize: MONACO_FONT_SIZE,
        lineHeight: MONACO_LINE_HEIGHT,
        fontLigatures: false,
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: true,
        minimap: { enabled: !compact, renderCharacters: false, scale: 1 },
        scrollBeyondLastLine: false,
        smoothScrolling: !reducedMotion,
        cursorBlinking: "phase",
        renderWhitespace: "selection",
        renderLineHighlight: "all",
        stickyScroll: { enabled: true },
        colorDecorators: true,
        padding: { top: 10, bottom: 10 },
        quickSuggestions: { other: true, comments: false, strings: false },
        suggest: { showStatusBar: true, preview: true },
        accessibilitySupport: "auto",
        unicodeHighlight: { ambiguousCharacters: false },
      }}
    />
  );
}
