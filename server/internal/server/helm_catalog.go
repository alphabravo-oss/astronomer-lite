package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/repo"
	"sigs.k8s.io/yaml"
)

const maxChartArchive = 20 << 20

type helmRepository struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

func (s *Server) chartRepositories() []helmRepository {
	out := make([]helmRepository, 0, len(s.Config.HelmRepositories))
	for _, raw := range s.Config.HelmRepositories {
		raw = strings.TrimRight(strings.TrimSpace(raw), "/") + "/"
		sum := sha256.Sum256([]byte(raw))
		out = append(out, helmRepository{ID: hex.EncodeToString(sum[:8]), URL: raw})
	}
	return out
}

func (s *Server) helmRepositories(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.chartRepositories())
}

func (s *Server) chartRepository(id string) (string, error) {
	for _, repository := range s.chartRepositories() {
		if repository.ID == id {
			return repository.URL, nil
		}
	}
	return "", fmt.Errorf("choose an operator-configured chart repository")
}

// URLs originate only in the operator's repository configuration or its index,
// never from an arbitrary user-supplied URL. No cluster or application credentials
// are attached. Redirects cannot introduce another scheme or URL credentials.
func fetchChartFile(ctx context.Context, raw string, limit int64) ([]byte, error) {
	validate := func(raw string) error {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("chart URL must use HTTP(S) without embedded credentials")
		}
		return nil
	}
	if err := validate(raw); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many chart redirects")
		}
		if len(via) > 0 && via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return fmt.Errorf("chart redirect cannot downgrade HTTPS")
		}
		return validate(req.URL.String())
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("chart repository returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("chart download exceeds %d bytes", limit)
	}
	return data, nil
}

func (s *Server) chartIndex(ctx context.Context, id string) (*repo.IndexFile, string, error) {
	base, err := s.chartRepository(id)
	if err != nil {
		return nil, "", err
	}
	data, err := fetchChartFile(ctx, base+"index.yaml", 20<<20)
	if err != nil {
		return nil, "", err
	}
	var index repo.IndexFile
	if err := yaml.Unmarshal(data, &index); err != nil {
		return nil, "", fmt.Errorf("invalid chart index: %w", err)
	}
	if index.APIVersion != "v1" || index.Entries == nil {
		return nil, "", fmt.Errorf("unsupported chart repository index")
	}
	index.SortEntries()
	return &index, base, nil
}

type catalogChart struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	AppVersion  string `json:"appVersion"`
}

func (s *Server) helmCharts(w http.ResponseWriter, r *http.Request) {
	index, _, err := s.chartIndex(r.Context(), r.URL.Query().Get("repository"))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	names := make([]string, 0, len(index.Entries))
	for name := range index.Entries {
		names = append(names, name)
	}
	sort.Strings(names)
	out := []catalogChart{}
	for _, name := range names {
		for _, version := range index.Entries[name] {
			if version == nil || version.Metadata == nil || len(version.URLs) == 0 {
				continue
			}
			out = append(out, catalogChart{Name: name, Version: version.Version, Description: version.Description, AppVersion: version.AppVersion})
		}
	}
	writeJSON(w, 200, out)
}

func (s *Server) downloadChart(ctx context.Context, repository, name, version string) ([]byte, error) {
	index, base, err := s.chartIndex(ctx, repository)
	if err != nil {
		return nil, err
	}
	if version == "" {
		return nil, fmt.Errorf("select an exact chart version")
	}
	for _, item := range index.Entries[name] {
		if item == nil || item.Metadata == nil || item.Version != version || len(item.URLs) == 0 {
			continue
		}
		parsedBase, _ := url.Parse(base)
		path, err := url.Parse(item.URLs[0])
		if err != nil {
			return nil, err
		}
		archive, err := fetchChartFile(ctx, parsedBase.ResolveReference(path).String(), maxChartArchive)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(archive)
		if item.Digest != "" && !strings.EqualFold(strings.TrimPrefix(item.Digest, "sha256:"), hex.EncodeToString(digest[:])) {
			return nil, fmt.Errorf("chart archive does not match repository digest")
		}
		return archive, nil
	}
	return nil, fmt.Errorf("chart version not found in repository")
}
