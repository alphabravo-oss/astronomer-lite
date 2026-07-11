import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { Eye, Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { cn } from "../../lib/utils";
import type { OpenAPIDocument } from "../../lib/openapi";

const YamlEditor = lazy(() => import("./yaml-editor").then((module) => ({ default: module.YamlEditor })));

type YamlViewDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  yaml: string;
  editedYaml: string;
  onEditedYamlChange: (value: string) => void;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  allowEdit?: boolean;
  readOnly?: boolean;
  actions?: ReactNode;
  message?: ReactNode;
  childrenAfterEditor?: ReactNode;
  kind?: string;
  apiVersion?: string;
  openApiDoc?: OpenAPIDocument | null;
};

export function YamlViewDialog({
  open,
  onClose,
  title,
  yaml,
  editedYaml,
  onEditedYamlChange,
  editMode,
  onEditModeChange,
  allowEdit = true,
  readOnly = false,
  actions,
  message,
  childrenAfterEditor,
  kind,
  apiVersion,
  openApiDoc
}: YamlViewDialogProps) {
  const editable = allowEdit && !readOnly;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
            {allowEdit ? (
              <div className="flex items-center rounded bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => onEditModeChange(false)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    !editMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Eye className="h-3 w-3" />
                  View
                </button>
                <button
                  type="button"
                  onClick={() => onEditModeChange(true)}
                  disabled={!editable}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    editMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
        {message ? <div className="border-b border-border px-4 py-3">{message}</div> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <YamlEditor
              value={editMode && editable ? editedYaml : yaml}
              onChange={editMode && editable ? onEditedYamlChange : undefined}
              readOnly={!editMode || !editable}
              height={childrenAfterEditor ? "48vh" : "100%"}
              className="min-h-0 flex-1"
              kind={kind}
              apiVersion={apiVersion}
              openApiDoc={openApiDoc}
            />
          </Suspense>
          {childrenAfterEditor ? <div className="max-h-[28vh] overflow-auto border-t border-border">{childrenAfterEditor}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
