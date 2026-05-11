import Editor, { loader } from "@monaco-editor/react";
import { Check, Copy, Download, Loader2, Save } from "lucide-react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { useCallback, useState } from "react";
import { cn } from "../../lib/utils";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";

loader.config({ monaco });

type YamlEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onSave?: (value: string) => void;
  saving?: boolean;
  height?: string;
  className?: string;
};

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
  onSave,
  saving,
  height = "calc(100vh - 21rem)",
  className
}: YamlEditorProps) {
  const [copied, setCopied] = useState(false);

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
    <div className={cn("flex min-h-[calc(100vh-21rem)] flex-col overflow-hidden rounded-lg border border-border bg-[#0a0a0f]", className)}>
      <div className="flex items-center justify-between border-b border-[#3c3c3c] bg-[#252526] px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-[#cccccc]/60">YAML</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyYaml()}
            className="rounded p-1.5 text-[#cccccc]/80 transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
            title={copied ? "Copied" : "Copy"}
            aria-label={copied ? "Copied YAML" : "Copy YAML"}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={downloadYaml}
            className="rounded p-1.5 text-[#cccccc]/80 transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
            title="Download"
            aria-label="Download YAML"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {!readOnly && onSave ? (
            <button
              type="button"
              onClick={() => onSave(value)}
              disabled={saving}
              className="ml-1 inline-flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          ) : null}
        </div>
      </div>
      <Editor
        height={height}
        defaultLanguage="yaml"
        theme="vs-dark"
        value={value}
        loading={
          <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
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
          wordWrap: "on"
        }}
      />
    </div>
  );
}
