import { useEffect, useMemo, useState } from "react";
import type { DiscoveredResource, K8sResourceRow } from "../../lib/api";
import { api } from "../../lib/api";
import {
  buildLineDiff,
  isApplyConflictError,
  validateYamlSyntax,
  type ActiveResource,
} from "../../lib/resource-detail";

export function useResourceYaml({
  clusterId,
  item,
  activeResource,
  discoveredResource,
  cleanedDetail,
  yaml,
  canEdit,
  onApplied,
  onViewChange,
}: {
  clusterId: string;
  item: K8sResourceRow;
  activeResource: ActiveResource;
  discoveredResource?: DiscoveredResource;
  cleanedDetail: Record<string, unknown> | null;
  yaml: string;
  canEdit: boolean;
  onApplied: (detail: Record<string, unknown>) => void;
  onViewChange: (view: "summary" | "yaml") => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [yamlDialogOpen, setYamlDialogOpen] = useState(false);
  const [editedYaml, setEditedYaml] = useState("");
  const [validatedYaml, setValidatedYaml] = useState("");
  const [forceApplyValidated, setForceApplyValidated] = useState(false);
  const [applyConflict, setApplyConflict] = useState(false);
  const [applyState, setApplyState] = useState<
    "idle" | "dry-running" | "applying"
  >("idle");
  const [applyMessage, setApplyMessage] = useState("");
  const [preRefreshYaml, setPreRefreshYaml] = useState("");
  const diffRows = useMemo(
    () => buildLineDiff(yaml, editedYaml),
    [editedYaml, yaml],
  );
  const yamlValidationError = useMemo(
    () => validateYamlSyntax(editedYaml),
    [editedYaml],
  );
  const hasYamlChanges = editedYaml !== yaml;
  const canApplyValidatedYaml =
    validatedYaml !== "" && editedYaml === validatedYaml;
  useEffect(() => {
    setEditedYaml(yaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
  }, [yaml]);
  useEffect(() => {
    if (!canEdit) setEditMode(false);
  }, [canEdit]);

  useEffect(() => {
    setYamlDialogOpen(false);
    setPreRefreshYaml("");
  }, [item.name, item.namespace]);
  function updateEditedYaml(value: string) {
    setEditedYaml(value);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setApplyMessage("");
  }

  function resetEditedYaml() {
    setEditedYaml(yaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setPreRefreshYaml("");
    setApplyMessage("");
  }

  async function validateYaml(force = false) {
    if (!cleanedDetail || !canEdit) return;
    if (yamlValidationError) {
      setApplyMessage(yamlValidationError);
      return;
    }
    setApplyState("dry-running");
    setApplyMessage("");
    setApplyConflict(false);
    try {
      await (discoveredResource
        ? api.applyGVRResource(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
            editedYaml,
            true,
            force,
          )
        : api.applyResource(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
            editedYaml,
            true,
            force,
          ));
      setValidatedYaml(editedYaml);
      setForceApplyValidated(force);
      setApplyMessage(
        force
          ? "Force dry run passed. Review the diff, then apply to take ownership of conflicting fields."
          : "Dry run passed. Review the diff, then apply the validated YAML.",
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to validate YAML";
      setValidatedYaml("");
      setForceApplyValidated(false);
      const conflict = isApplyConflictError(err, message);
      setApplyConflict(conflict);
      setApplyMessage(
        conflict
          ? `${message}\n\nKubernetes reported a server-side apply conflict. Force apply can take ownership of the conflicting fields after a successful force dry run.`
          : message,
      );
    } finally {
      setApplyState("idle");
    }
  }

  async function applyValidatedYaml() {
    if (!cleanedDetail || !canEdit || !canApplyValidatedYaml) return;
    setApplyState("applying");
    setApplyMessage("");
    try {
      const nextDetail = discoveredResource
        ? await api.applyGVRResource(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
            editedYaml,
            false,
            forceApplyValidated,
          )
        : await api.applyResource(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
            editedYaml,
            false,
            forceApplyValidated,
          );
      onApplied(nextDetail);
      setEditMode(false);
      onViewChange("summary");
      setValidatedYaml("");
      setForceApplyValidated(false);
      setApplyConflict(false);
      setPreRefreshYaml("");
      setApplyMessage(
        forceApplyValidated
          ? "Applied successfully with force ownership."
          : "Applied successfully.",
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to apply YAML";
      const conflict = isApplyConflictError(err, message);
      if (conflict) {
        setValidatedYaml("");
        setForceApplyValidated(false);
      }
      setApplyConflict(conflict);
      setApplyMessage(
        conflict
          ? `${message}\n\nThe resource changed or Kubernetes rejected field ownership since the last dry run. Refresh YAML or run a force dry run before applying again.`
          : message,
      );
    } finally {
      setApplyState("idle");
    }
  }

  async function refreshYamlFromServer() {
    setApplyState("dry-running");
    setApplyMessage("");
    try {
      const previousEdit = hasYamlChanges ? editedYaml : "";
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
          )
        : await api.resourceDetail(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
          );
      onApplied(nextDetail);
      setValidatedYaml("");
      setForceApplyValidated(false);
      setApplyConflict(false);
      setEditMode(false);
      setPreRefreshYaml(previousEdit);
      setApplyMessage(
        previousEdit
          ? "Refreshed latest YAML from the cluster. Your pre-refresh edits are available to restore."
          : "Refreshed latest YAML from the cluster.",
      );
    } catch (err) {
      setApplyMessage(
        err instanceof Error ? err.message : "Failed to refresh YAML",
      );
    } finally {
      setApplyState("idle");
    }
  }

  function restorePreRefreshYaml() {
    if (!preRefreshYaml) return;
    setEditedYaml(preRefreshYaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setPreRefreshYaml("");
    setEditMode(true);
    onViewChange("yaml");
    setYamlDialogOpen(true);
    setApplyMessage(
      "Restored your pre-refresh edits. Run a new dry run before applying.",
    );
  }

  return {
    forceApplyValidated,
    editMode,
    setEditMode,
    yamlDialogOpen,
    setYamlDialogOpen,
    editedYaml,
    applyConflict,
    applyState,
    applyMessage,
    preRefreshYaml,
    diffRows,
    yamlValidationError,
    hasYamlChanges,
    canApplyValidatedYaml,
    updateEditedYaml,
    resetEditedYaml,
    validateYaml,
    applyValidatedYaml,
    refreshYamlFromServer,
    restorePreRefreshYaml,
  };
}
