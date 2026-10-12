import Editor, { loader } from "@monaco-editor/react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { lookupFieldDoc, type OpenAPIDocument } from "../../lib/openapi";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";

loader.config({ monaco });

type YamlEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  className?: string;
  // Optional context for OpenAPI hover descriptions. When all three are
  // provided we register a Monaco hover provider that walks back through the
  // YAML to compute a dot-separated JSON path and surfaces the Kubernetes
  // schema description for the field under the cursor.
  kind?: string;
  apiVersion?: string;
  openApiDoc?: OpenAPIDocument | null;
};

// Cap how far back we walk when reconstructing a path; pathological deeply
// nested YAML shouldn't tank the hover provider.
const MAX_PATH_DEPTH = 32;

// Extract the leading indent (in columns; tabs counted as one column) and the
// key portion of a YAML key line. Returns null for non-key lines (comments,
// blanks, pure list items without a `key:` after the marker).
function parseKeyLine(
  line: string,
): { indent: number; key: string; isListMarker: boolean } | null {
  // Skip comments and blank lines.
  if (/^\s*(#|$)/.test(line)) return null;
  const match = line.match(/^(\s*)(-\s+)?([^\s:#-][^:#]*?):(?:\s|$)/);
  if (!match) return null;
  const indentText = match[1] ?? "";
  const listMarker = match[2];
  const key = (match[3] ?? "").trim();
  if (!key) return null;
  const indent = indentText.length;
  // If a list marker is present, the key effectively sits at indent + 2
  // (`- key:`) — but we use the indent column of the marker itself so it
  // counts as a sibling under the same parent list as other `- key:` entries.
  return { indent, key, isListMarker: Boolean(listMarker) };
}

// Compute the dot-separated YAML path that the cursor at (lineNumber, column)
// belongs to. lineNumber/column are 1-based (Monaco convention).
function computeYamlPath(text: string, lineNumber: number): string[] {
  const lines = text.split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) return [];
  const currentLine = lines[lineNumber - 1] ?? "";
  const current = parseKeyLine(currentLine);
  if (!current) return [];
  const segments: string[] = [current.key];
  let targetIndent = current.indent;
  let depth = 0;
  for (let i = lineNumber - 2; i >= 0 && depth < MAX_PATH_DEPTH; i -= 1) {
    const parsed = parseKeyLine(lines[i] ?? "");
    if (!parsed) continue;
    if (parsed.indent < targetIndent) {
      // List markers reset/own indentation: when a `- key:` line appears at
      // an indent strictly less than our current target, that key is the
      // parent we belong to.
      segments.unshift(parsed.key);
      targetIndent = parsed.indent;
      depth += 1;
      if (targetIndent === 0) break;
    }
  }
  return segments;
}

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
  height = "calc(100vh - 21rem)",
  className,
  kind,
  apiVersion,
  openApiDoc,
}: YamlEditorProps) {
  const [copied, setCopied] = useState(false);

  // Keep the doc/kind/apiVersion in refs so the (stable) hover provider
  // closure always sees the latest values without re-registering.
  const docRef = useRef<OpenAPIDocument | null>(openApiDoc ?? null);
  const kindRef = useRef<string>(kind ?? "");
  const apiVersionRef = useRef<string>(apiVersion ?? "");
  useEffect(() => {
    docRef.current = openApiDoc ?? null;
  }, [openApiDoc]);
  useEffect(() => {
    kindRef.current = kind ?? "";
  }, [kind]);
  useEffect(() => {
    apiVersionRef.current = apiVersion ?? "";
  }, [apiVersion]);

  // Register a single hover provider for the yaml language across the app
  // lifetime. Monaco silently no-ops when the closure returns undefined, so
  // editors without OpenAPI context simply see no hovers.
  const registeredRef = useRef(false);
  useEffect(() => {
    if (registeredRef.current) return;
    registeredRef.current = true;
    monaco.languages.registerHoverProvider("yaml", {
      provideHover(model, position) {
        const doc = docRef.current;
        const activeKind = kindRef.current;
        const activeApiVersion = apiVersionRef.current;
        if (!doc || !activeKind || !activeApiVersion) return undefined;
        const word = model.getWordAtPosition(position);
        if (!word) return undefined;
        const lineText = model.getLineContent(position.lineNumber);
        // Only hover when the cursor is on the key portion (before the colon).
        const colonIdx = lineText.indexOf(":");
        if (colonIdx < 0 || position.column - 1 > colonIdx) return undefined;
        const path = computeYamlPath(model.getValue(), position.lineNumber);
        if (path.length === 0) return undefined;
        const description = lookupFieldDoc(
          doc,
          activeKind,
          activeApiVersion,
          path.join("."),
        );
        if (!description) return undefined;
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          ),
          contents: [
            { value: `**${path.join(".")}**` },
            { value: description },
          ],
        };
      },
    });
  }, []);

  const copyYaml = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [value]);

  const downloadYaml = useCallback(() => {
    const url = URL.createObjectURL(new Blob([value], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "resource.yaml";
    link.click();
    URL.revokeObjectURL(url);
  }, [value]);

  return (
    <div
      className={cn(
        "flex min-h-[calc(100vh-21rem)] flex-col overflow-hidden rounded-lg border border-border bg-terminal",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-terminal px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-terminal-foreground/60">
          YAML
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyYaml()}
            className="rounded p-1.5 text-terminal-foreground/80 transition-colors hover:bg-white/10 hover:text-terminal-foreground"
            title={copied ? "Copied" : "Copy"}
            aria-label={copied ? "Copied YAML" : "Copy YAML"}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={downloadYaml}
            className="rounded p-1.5 text-terminal-foreground/80 transition-colors hover:bg-white/10 hover:text-terminal-foreground"
            title="Download"
            aria-label="Download YAML"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Editor
        height={height}
        defaultLanguage="yaml"
        theme="vs-dark"
        value={value}
        loading={
          <div className="flex h-full items-center justify-center bg-terminal">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        }
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
        options={{
          automaticLayout: true,
          folding: true,
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 22,
          lineNumbers: "on",
          minimap: { enabled: false },
          padding: { top: 8 },
          readOnly,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
