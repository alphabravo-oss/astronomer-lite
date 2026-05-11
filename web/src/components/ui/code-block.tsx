import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

type CodeBlockProps = {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  className?: string;
};

export function CodeBlock({ code, language = "yaml", title, showLineNumbers = false, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title || language}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void handleCopy()} className="h-7 px-2 text-xs">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="max-h-[calc(100vh-15rem)] overflow-auto bg-[#0a0a0f]">
        <pre className="p-4 font-mono text-[13px] leading-6">
          <code>
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="flex">
                {showLineNumbers ? (
                  <span className="mr-4 w-8 shrink-0 select-none text-right text-zinc-600">{index + 1}</span>
                ) : null}
                <span className="whitespace-pre text-zinc-300">{line || " "}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
