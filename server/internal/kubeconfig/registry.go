package kubeconfig

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/version"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubeversion "k8s.io/apimachinery/pkg/version"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type Source string

const (
	SourceSystem  Source = "system"
	SourceManaged Source = "managed"
)

type ReachabilityStatus string

const (
	StatusReachable   ReachabilityStatus = "reachable"
	StatusDegraded    ReachabilityStatus = "degraded"
	StatusUnreachable ReachabilityStatus = "unreachable"
)

type Cluster struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Context         string        `json:"context"`
	Server          string        `json:"server"`
	Source          Source        `json:"source"`
	Reachable       bool          `json:"reachable"`
	Status          string        `json:"status"`
	Version         string        `json:"version,omitempty"`
	Error           string        `json:"error,omitempty"`
	DisplayColor    string        `json:"displayColor"`
	DisplayInitials string        `json:"displayInitials"`
	Links           []ClusterLink `json:"links"`

	filePath string
	raw      []byte
}

// ClusterLink is an admin-attached out-of-cluster URL — e.g. a Grafana
// dashboard or runbook — shown alongside the cluster in the UI.
type ClusterLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// DisplayPalette lists the chip background colors the UI exposes. Index 0 is
// the fallback. Picking a deterministic index by hashing the cluster ID gives
// each cluster a stable color without admins having to choose one.
var DisplayPalette = []string{
	"blue",
	"violet",
	"emerald",
	"amber",
	"rose",
	"cyan",
	"fuchsia",
	"indigo",
}

type displayOverride struct {
	Color    string        `json:"color,omitempty"`
	Initials string        `json:"initials,omitempty"`
	Links    []ClusterLink `json:"links,omitempty"`
}

type ContextPreview struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Cluster       string `json:"cluster"`
	User          string `json:"user,omitempty"`
	Server        string `json:"server"`
	Current       bool   `json:"current"`
	AlreadyExists bool   `json:"alreadyExists"`
}

type Registry struct {
	mu          sync.RWMutex
	clusters    map[string]Cluster
	restConfigs map[string]*rest.Config
	clients     map[string]*kubernetes.Clientset
	dynamics    map[string]dynamic.Interface
	systemPaths []string
	managedDir  string
	displayFile string
	displays    map[string]displayOverride
	logger      *slog.Logger
	httpClient  *http.Client
}

func NewRegistry(systemPaths []string, managedDir, displayFile string, logger *slog.Logger) *Registry {
	r := &Registry{
		clusters:    map[string]Cluster{},
		restConfigs: map[string]*rest.Config{},
		clients:     map[string]*kubernetes.Clientset{},
		dynamics:    map[string]dynamic.Interface{},
		systemPaths: systemPaths,
		managedDir:  managedDir,
		displayFile: displayFile,
		displays:    map[string]displayOverride{},
		logger:      logger,
		httpClient:  &http.Client{Timeout: 3 * time.Second},
	}
	if err := r.loadDisplays(); err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.Warn("failed to load cluster display overrides", "error", err)
	}
	return r
}

func (r *Registry) loadDisplays() error {
	if r.displayFile == "" {
		return nil
	}
	raw, err := os.ReadFile(r.displayFile)
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var parsed map[string]displayOverride
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	r.displays = parsed
	return nil
}

func (r *Registry) writeDisplays() error {
	if r.displayFile == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(r.displayFile), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(r.displays, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.displayFile, raw, 0o600)
}

func (r *Registry) applyDisplay(c Cluster) Cluster {
	override := r.displays[c.ID]
	if override.Color != "" {
		c.DisplayColor = override.Color
	} else {
		c.DisplayColor = defaultDisplayColor(c.ID)
	}
	if override.Initials != "" {
		c.DisplayInitials = override.Initials
	} else {
		c.DisplayInitials = defaultDisplayInitials(c.Name)
	}
	c.Links = append([]ClusterLink{}, override.Links...)
	return c
}

func defaultDisplayColor(id string) string {
	if id == "" {
		return DisplayPalette[0]
	}
	sum := sha1.Sum([]byte(id))
	return DisplayPalette[int(sum[0])%len(DisplayPalette)]
}

func defaultDisplayInitials(name string) string {
	parts := strings.FieldsFunc(name, func(r rune) bool {
		return r == '-' || r == '_' || r == ' ' || r == '.' || r == '/' || r == ':'
	})
	out := make([]rune, 0, 2)
	for _, part := range parts {
		for _, ch := range part {
			out = append(out, ch)
			break
		}
		if len(out) >= 2 {
			break
		}
	}
	if len(out) == 0 {
		return "?"
	}
	return strings.ToUpper(string(out))
}

func isValidDisplayColor(c string) bool {
	for _, name := range DisplayPalette {
		if name == c {
			return true
		}
	}
	return false
}

// SetDisplay updates the persisted color/initials override for a cluster.
// Empty values reset color/initials back to the deterministic defaults;
// existing links are preserved.
func (r *Registry) SetDisplay(id, color, initials string) (Cluster, error) {
	color = strings.TrimSpace(color)
	initials = strings.TrimSpace(initials)
	if color != "" && !isValidDisplayColor(color) {
		return Cluster{}, fmt.Errorf("unknown color %q", color)
	}
	if l := len([]rune(initials)); l > 3 {
		return Cluster{}, fmt.Errorf("initials must be 1-3 characters")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cluster, ok := r.clusters[id]
	if !ok {
		return Cluster{}, os.ErrNotExist
	}
	existing := r.displays[id]
	existing.Color = color
	existing.Initials = strings.ToUpper(initials)
	if existing.Color == "" && existing.Initials == "" && len(existing.Links) == 0 {
		delete(r.displays, id)
	} else {
		r.displays[id] = existing
	}
	if err := r.writeDisplays(); err != nil {
		return Cluster{}, err
	}
	cluster = r.applyDisplay(cluster)
	cluster.filePath = ""
	cluster.raw = nil
	return cluster, nil
}

// SetLinks replaces the persisted weblinks for a cluster. URLs must be
// http(s) and labels non-empty.
func (r *Registry) SetLinks(id string, links []ClusterLink) (Cluster, error) {
	clean := make([]ClusterLink, 0, len(links))
	for _, link := range links {
		label := strings.TrimSpace(link.Label)
		urlStr := strings.TrimSpace(link.URL)
		if label == "" || urlStr == "" {
			continue
		}
		if !strings.HasPrefix(urlStr, "http://") && !strings.HasPrefix(urlStr, "https://") {
			return Cluster{}, fmt.Errorf("link %q must start with http:// or https://", label)
		}
		clean = append(clean, ClusterLink{Label: label, URL: urlStr})
	}
	if len(clean) > 16 {
		return Cluster{}, fmt.Errorf("too many links (max 16)")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cluster, ok := r.clusters[id]
	if !ok {
		return Cluster{}, os.ErrNotExist
	}
	existing := r.displays[id]
	existing.Links = clean
	if existing.Color == "" && existing.Initials == "" && len(existing.Links) == 0 {
		delete(r.displays, id)
	} else {
		r.displays[id] = existing
	}
	if err := r.writeDisplays(); err != nil {
		return Cluster{}, err
	}
	cluster = r.applyDisplay(cluster)
	cluster.filePath = ""
	cluster.raw = nil
	return cluster, nil
}

func (r *Registry) Start(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		r.ReloadAndProbe(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.ReloadAndProbe(ctx)
			}
		}
	}()
}

func (r *Registry) ReloadAndProbe(ctx context.Context) {
	if err := r.Reload(); err != nil {
		r.logger.Warn("failed to reload kubeconfigs", "error", err)
	}
	r.ProbeAll(ctx)
}

func (r *Registry) Reload() error {
	nextClusters := map[string]Cluster{}
	nextREST := map[string]*rest.Config{}
	var joined error

	for _, path := range r.systemPaths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		if err := r.loadFile(path, SourceSystem, nextClusters, nextREST); err != nil && !errors.Is(err, os.ErrNotExist) {
			joined = errors.Join(joined, err)
		}
	}

	entries, err := os.ReadDir(r.managedDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		joined = errors.Join(joined, err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		path := filepath.Join(r.managedDir, entry.Name())
		if err := r.loadFile(path, SourceManaged, nextClusters, nextREST); err != nil {
			joined = errors.Join(joined, err)
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for id, existing := range r.clusters {
		if next, ok := nextClusters[id]; ok {
			next.Reachable = existing.Reachable
			next.Status = existing.Status
			next.Version = existing.Version
			next.Error = existing.Error
			nextClusters[id] = next
		}
	}
	r.clusters = nextClusters
	r.restConfigs = nextREST
	r.clients = map[string]*kubernetes.Clientset{}
	r.dynamics = map[string]dynamic.Interface{}
	return joined
}

func (r *Registry) loadFile(path string, source Source, clusters map[string]Cluster, configs map[string]*rest.Config) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	cfg, err := clientcmd.Load(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	for contextName, contextDef := range cfg.Contexts {
		clusterDef := cfg.Clusters[contextDef.Cluster]
		if clusterDef == nil {
			continue
		}
		id := stableID(clusterDef.Server, contextName)
		if err := validateExecPlugin(cfg, contextDef); err != nil {
			clusters[id] = Cluster{
				ID: id, Name: displayName(contextName, contextDef.Cluster), Context: contextName,
				Server: clusterDef.Server, Source: source, Status: string(StatusUnreachable), Error: err.Error(), filePath: path, raw: raw,
			}
			continue
		}
		restCfg, err := restConfigFromAPI(cfg, contextName)
		if err != nil {
			clusters[id] = Cluster{
				ID: id, Name: displayName(contextName, contextDef.Cluster), Context: contextName,
				Server: clusterDef.Server, Source: source, Status: string(StatusUnreachable), Error: err.Error(), filePath: path, raw: raw,
			}
			continue
		}
		clusters[id] = Cluster{
			ID: id, Name: displayName(contextName, contextDef.Cluster), Context: contextName,
			Server: clusterDef.Server, Source: source, Status: string(StatusUnreachable), filePath: path, raw: raw,
		}
		configs[id] = restCfg
	}
	return nil
}

func validateExecPlugin(cfg *clientcmdapi.Config, contextDef *clientcmdapi.Context) error {
	if contextDef == nil || contextDef.AuthInfo == "" {
		return nil
	}
	authInfo := cfg.AuthInfos[contextDef.AuthInfo]
	if authInfo == nil || authInfo.Exec == nil || strings.TrimSpace(authInfo.Exec.Command) == "" {
		return nil
	}
	command := strings.TrimSpace(authInfo.Exec.Command)
	if _, err := exec.LookPath(command); err != nil {
		return fmt.Errorf("Exec plugin `%s` not found on PATH", command)
	}
	return nil
}

func restConfigFromAPI(cfg *clientcmdapi.Config, contextName string) (*rest.Config, error) {
	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextName}
	clientCfg := clientcmd.NewDefaultClientConfig(*cfg, overrides)
	restCfg, err := clientCfg.ClientConfig()
	if err != nil {
		return nil, err
	}
	restCfg.UserAgent = version.UserAgent()
	return restCfg, nil
}

func (r *Registry) Preview(raw []byte) ([]ContextPreview, error) {
	cfg, err := clientcmd.Load(raw)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	existing := map[string]bool{}
	for id := range r.clusters {
		existing[id] = true
	}
	r.mu.RUnlock()
	contexts := make([]ContextPreview, 0, len(cfg.Contexts))
	for contextName, contextDef := range cfg.Contexts {
		clusterDef := cfg.Clusters[contextDef.Cluster]
		if clusterDef == nil {
			continue
		}
		id := stableID(clusterDef.Server, contextName)
		contexts = append(contexts, ContextPreview{
			ID:            id,
			Name:          contextName,
			Cluster:       contextDef.Cluster,
			User:          contextDef.AuthInfo,
			Server:        clusterDef.Server,
			Current:       contextName == cfg.CurrentContext,
			AlreadyExists: existing[id],
		})
	}
	sort.Slice(contexts, func(i, j int) bool {
		if contexts[i].Current != contexts[j].Current {
			return contexts[i].Current
		}
		return strings.ToLower(contexts[i].Name) < strings.ToLower(contexts[j].Name)
	})
	return contexts, nil
}

func (r *Registry) AddManaged(raw []byte, selectedContexts []string) ([]Cluster, error) {
	cfg, err := clientcmd.Load(raw)
	if err != nil {
		return nil, err
	}
	if len(selectedContexts) > 0 {
		cfg, err = filterConfigContexts(cfg, selectedContexts)
		if err != nil {
			return nil, err
		}
	}
	if err := r.ensureNoDuplicateContexts(cfg); err != nil {
		return nil, err
	}
	raw, err = clientcmd.Write(*cfg)
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum(raw)
	path := filepath.Join(r.managedDir, hex.EncodeToString(sum[:])+".yaml")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return nil, err
	}
	if err := r.Reload(); err != nil {
		return nil, err
	}
	r.ProbeAll(context.Background())
	return r.List(), nil
}

func (r *Registry) ensureNoDuplicateContexts(cfg *clientcmdapi.Config) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for contextName, contextDef := range cfg.Contexts {
		clusterDef := cfg.Clusters[contextDef.Cluster]
		if clusterDef == nil {
			continue
		}
		id := stableID(clusterDef.Server, contextName)
		if existing, ok := r.clusters[id]; ok {
			return fmt.Errorf("context %q for %s already exists as %q", contextName, clusterDef.Server, existing.Name)
		}
	}
	return nil
}

func filterConfigContexts(cfg *clientcmdapi.Config, selectedContexts []string) (*clientcmdapi.Config, error) {
	selected := map[string]bool{}
	for _, contextName := range selectedContexts {
		contextName = strings.TrimSpace(contextName)
		if contextName != "" {
			selected[contextName] = true
		}
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("at least one context must be selected")
	}
	next := clientcmdapi.NewConfig()
	for contextName := range selected {
		contextDef := cfg.Contexts[contextName]
		if contextDef == nil {
			return nil, fmt.Errorf("context %q not found in kubeconfig", contextName)
		}
		clusterDef := cfg.Clusters[contextDef.Cluster]
		if clusterDef == nil {
			return nil, fmt.Errorf("context %q references missing cluster %q", contextName, contextDef.Cluster)
		}
		next.Contexts[contextName] = contextDef
		next.Clusters[contextDef.Cluster] = clusterDef
		if contextDef.AuthInfo != "" {
			authInfo := cfg.AuthInfos[contextDef.AuthInfo]
			if authInfo == nil {
				return nil, fmt.Errorf("context %q references missing user %q", contextName, contextDef.AuthInfo)
			}
			next.AuthInfos[contextDef.AuthInfo] = authInfo
		}
	}
	if selected[cfg.CurrentContext] {
		next.CurrentContext = cfg.CurrentContext
	} else {
		keys := make([]string, 0, len(selected))
		for contextName := range selected {
			keys = append(keys, contextName)
		}
		sort.Strings(keys)
		next.CurrentContext = keys[0]
	}
	return next, nil
}

func (r *Registry) Delete(id string) error {
	r.mu.RLock()
	cluster, ok := r.clusters[id]
	r.mu.RUnlock()
	if !ok {
		return os.ErrNotExist
	}
	if cluster.Source != SourceManaged {
		return fmt.Errorf("cluster %q is managed externally", cluster.Name)
	}
	if err := os.Remove(cluster.filePath); err != nil {
		return err
	}
	return r.Reload()
}

func (r *Registry) List() []Cluster {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Cluster, 0, len(r.clusters))
	for _, cluster := range r.clusters {
		cluster = r.applyDisplay(cluster)
		cluster.filePath = ""
		cluster.raw = nil
		out = append(out, cluster)
	}
	return out
}

func (r *Registry) Get(id string) (Cluster, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cluster, ok := r.clusters[id]
	if !ok {
		return cluster, false
	}
	cluster = r.applyDisplay(cluster)
	cluster.filePath = ""
	cluster.raw = nil
	return cluster, true
}

func (r *Registry) Client(id string) (*kubernetes.Clientset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if client, ok := r.clients[id]; ok {
		return client, nil
	}
	cfg, ok := r.restConfigs[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	r.clients[id] = client
	return client, nil
}

func (r *Registry) RESTConfig(id string) (*rest.Config, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cfg, ok := r.restConfigs[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return rest.CopyConfig(cfg), nil
}

func (r *Registry) Dynamic(id string) (dynamic.Interface, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if client, ok := r.dynamics[id]; ok {
		return client, nil
	}
	cfg, ok := r.restConfigs[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	r.dynamics[id] = client
	return client, nil
}

func (r *Registry) ProbeAll(ctx context.Context) {
	r.mu.RLock()
	ids := make([]string, 0, len(r.clusters))
	for id := range r.clusters {
		ids = append(ids, id)
	}
	r.mu.RUnlock()

	for _, id := range ids {
		r.probe(ctx, id)
	}
}

func (r *Registry) probe(ctx context.Context, id string) {
	client, err := r.Client(id)
	r.mu.Lock()
	cluster, ok := r.clusters[id]
	if !ok {
		r.mu.Unlock()
		return
	}
	if err != nil {
		cluster.Reachable = false
		cluster.Status = string(StatusUnreachable)
		cluster.Error = humanKubeError(err)
		r.clusters[id] = cluster
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()

	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	version := &kubeversion.Info{}
	rawVersion, err := client.Discovery().RESTClient().Get().AbsPath("/version").Do(probeCtx).Raw()
	if err == nil {
		err = json.Unmarshal(rawVersion, version)
	}
	discoveryErr := error(nil)
	if err == nil {
		_, discoveryErr = client.Discovery().ServerGroups()
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	cluster, ok = r.clusters[id]
	if !ok {
		return
	}
	if err != nil {
		cluster.Reachable = false
		cluster.Status = string(StatusUnreachable)
		cluster.Error = humanKubeError(err)
		cluster.Version = ""
	} else if discoveryErr != nil {
		cluster.Reachable = true
		cluster.Status = string(StatusDegraded)
		cluster.Error = humanKubeError(discoveryErr)
		cluster.Version = version.GitVersion
	} else {
		cluster.Reachable = true
		cluster.Status = string(StatusReachable)
		cluster.Error = ""
		cluster.Version = version.GitVersion
	}
	r.clusters[id] = cluster
}

func (r *Registry) Dashboard(ctx context.Context, id string) (map[string]any, error) {
	client, err := r.Client(id)
	if err != nil {
		return nil, err
	}
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	namespaces, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	version, _ := client.Discovery().ServerVersion()
	conditions := map[string]int{}
	for _, node := range nodes.Items {
		for _, condition := range node.Status.Conditions {
			if string(condition.Status) == "True" {
				conditions[string(condition.Type)]++
			}
		}
	}
	serverVersion := ""
	if version != nil {
		serverVersion = version.GitVersion
	}
	return map[string]any{
		"nodeCount":      len(nodes.Items),
		"podCount":       len(pods.Items),
		"namespaceCount": len(namespaces.Items),
		"serverVersion":  serverVersion,
		"conditions":     conditions,
	}, nil
}

func stableID(server, context string) string {
	sum := sha1.Sum([]byte(server + "\x00" + context))
	return hex.EncodeToString(sum[:])
}

func displayName(contextName, clusterName string) string {
	if contextName != "" {
		return contextName
	}
	return clusterName
}

func humanKubeError(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "executable") && strings.Contains(msg, "not found") {
		return msg
	}
	return msg
}
