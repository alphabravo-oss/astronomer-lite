package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/release"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/util/validation"
	"sigs.k8s.io/yaml"
)

type helmDeployRequest struct {
	Repository      string `json:"repository"`
	Chart           string `json:"chart"`
	Version         string `json:"version"`
	Archive         string `json:"archive"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Values          string `json:"values"`
	Digest          string `json:"digest"`
	DryRun          bool   `json:"dryRun"`
	CreateNamespace bool   `json:"createNamespace"`
}

func (s *Server) helmDeploy(w http.ResponseWriter, r *http.Request, id string, upgrade bool) {
	// Bound work and prevent concurrent deploy requests in one workspace.
	if !s.helmDeployMu.TryLock() {
		writeError(w, 409, fmt.Errorf("another Helm operation is in progress"))
		return
	}
	defer s.helmDeployMu.Unlock()
	var body helmDeployRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 30<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if len(body.Name) > 53 || len(validation.IsDNS1123Subdomain(body.Name)) != 0 || len(validation.IsDNS1123Label(body.Namespace)) != 0 {
		writeError(w, 400, fmt.Errorf("a valid release name (at most 53 characters) and namespace are required"))
		return
	}
	if len(body.Values) > 1<<20 {
		writeError(w, 400, fmt.Errorf("values exceed 1 MiB"))
		return
	}
	values := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(body.Values), &values); err != nil {
		writeError(w, 400, fmt.Errorf("invalid values: %w", err))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if err := s.authorize(ctx, id, authorizationv1.ResourceAttributes{Namespace: body.Namespace, Verb: "create", Resource: "secrets"}); err != nil {
		writeError(w, 502, err)
		return
	}
	var archive []byte
	var err error
	if body.Archive != "" {
		if body.Repository != "" {
			writeError(w, 400, fmt.Errorf("choose either a repository or an uploaded chart"))
			return
		}
		archive, err = base64.StdEncoding.DecodeString(body.Archive)
	} else {
		archive, err = s.downloadChart(ctx, body.Repository, body.Chart, body.Version)
	}
	if err != nil {
		writeError(w, 400, err)
		return
	}
	if len(archive) == 0 || len(archive) > maxChartArchive {
		writeError(w, 400, fmt.Errorf("chart archive must be 1 byte to 20 MiB"))
		return
	}
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	if !body.DryRun && body.Digest != digest {
		writeError(w, 409, fmt.Errorf("chart changed or was not previewed; preview it again"))
		return
	}
	chart, err := loader.LoadArchive(bytes.NewReader(archive))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	if chart.Metadata.Type != "" && chart.Metadata.Type != "application" {
		writeError(w, 400, fmt.Errorf("only application charts can be installed"))
		return
	}
	if err := action.CheckDependencies(chart, chart.Metadata.Dependencies); err != nil {
		writeError(w, 400, fmt.Errorf("package the chart with its dependencies before uploading: %w", err))
		return
	}
	cfg, err := s.helmActionConfig(id, body.Namespace)
	if err != nil {
		writeError(w, 502, err)
		return
	}
	// Rendered templates and values can contain secrets. Do not send Helm debug
	// output to the shared server log.
	cfg.Log = func(string, ...interface{}) {}
	var result *release.Release
	if upgrade {
		operation := action.NewUpgrade(cfg)
		operation.Namespace = body.Namespace
		operation.DryRun, operation.HideSecret = body.DryRun, body.DryRun
		if body.DryRun {
			operation.DryRunOption = "server"
		}
		operation.Timeout = 5 * time.Minute
		operation.ResetValues = true
		result, err = operation.RunWithContext(ctx, body.Name, chart, values)
	} else {
		operation := action.NewInstall(cfg)
		operation.ReleaseName, operation.Namespace = body.Name, body.Namespace
		operation.DryRun, operation.HideSecret = body.DryRun, body.DryRun
		if body.DryRun {
			operation.DryRunOption = "server"
		}
		operation.CreateNamespace = body.CreateNamespace
		operation.Timeout = 5 * time.Minute
		result, err = operation.RunWithContext(ctx, chart, values)
	}
	if err != nil {
		writeError(w, helmStatusForError(err), err)
		return
	}
	defaults, err := yaml.Marshal(chart.Values)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	response := map[string]any{"release": releaseSummary(result), "digest": digest, "dryRun": body.DryRun}
	if body.DryRun {
		response["manifest"], response["defaults"] = result.Manifest, string(defaults)
		// Hooks are meaningful changes too, and are shown in the confirmation view.
		hooks := []map[string]string{}
		for _, hook := range result.Hooks {
			if hook.Kind == "Secret" {
				hooks = append(hooks, map[string]string{"name": hook.Name, "manifest": "# Secret hook content hidden"})
				continue
			}
			hooks = append(hooks, map[string]string{"name": hook.Name, "manifest": hook.Manifest})
		}
		response["hooks"] = hooks
	}
	writeJSON(w, 200, response)
}
