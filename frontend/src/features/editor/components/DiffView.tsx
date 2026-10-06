import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { use } from "react";
import { Loading } from "@/components/ui";
import { monacoModule } from "../monaco/load";
import {
  MONACO_FONT_FAMILY,
  MONACO_FONT_SIZE,
  MONACO_LINE_HEIGHT,
  MONACO_THEME_NAME,
} from "../monaco/theme";

export interface DiffViewProps {
  original: string;
  modified: string;
  /** Naast elkaar (standaard) of inline. */
  sideBySide?: boolean;
  /** Toegankelijke naam, bv. "Verschil v6 ⟷ v7". */
  ariaLabel: string;
  height?: number | string;
  /** Ongewijzigde stukken inklappen (standaard aan; met een balk om ze te openen). */
  collapseUnchanged?: boolean;
}

/**
 * `@monaco-editor/react` gooit bij het opruimen eerst de modellen weg en dan pas de editor
 * ("TextModel got disposed before DiffEditorWidget model got reset"). Daarom houdt de
 * bibliotheek de modellen (`keepCurrent…Model`) en ruimen wij ze op nadat de editor weg is.
 */
const disposeModelsWithEditor: DiffOnMount = (editor) => {
  const model = editor.getModel();
  const subscription = editor.onDidDispose(() => {
    subscription.dispose();
    model?.original.dispose();
    model?.modified.dispose();
  });
};

/**
 * Monaco-`DiffEditor` (alleen lezen) in het eigen thema, voor versies en conflicten.
 * Laadt Monaco zelf (Suspense-grens erboven).
 */
export function DiffView({
  original,
  modified,
  sideBySide = true,
  ariaLabel,
  height = "100%",
  collapseUnchanged = true,
}: DiffViewProps) {
  use(monacoModule());
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language="css"
      theme={MONACO_THEME_NAME}
      height={height}
      loading={<Loading />}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={disposeModelsWithEditor}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        // Monaco valt standaard al onder 900 px terug op inline; dan toont de versiepagina op
        // een gewoon laptopscherm (diffpaneel ~840 px) inline terwijl "Naast elkaar" aan staat.
        // Pas op echt smalle schermen (< 600 px, twee kolommen van 300 px) inline.
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 600,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        fontFamily: MONACO_FONT_FAMILY,
        fontSize: MONACO_FONT_SIZE,
        lineHeight: MONACO_LINE_HEIGHT,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: true,
        hideUnchangedRegions: {
          enabled: collapseUnchanged,
          contextLineCount: 3,
          minimumLineCount: 4,
          revealLineCount: 20,
        },
        ariaLabel,
        originalAriaLabel: `${ariaLabel} (A)`,
        modifiedAriaLabel: `${ariaLabel} (B)`,
      }}
    />
  );
}
