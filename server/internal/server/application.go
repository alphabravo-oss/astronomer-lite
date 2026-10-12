package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/alphabravo/astronomer-lite/server/internal/auth"
	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/alphabravo/astronomer-lite/server/internal/forward"
	"github.com/alphabravo/astronomer-lite/server/internal/plugins"
)

// Application selects the user's workspace before any cluster lookup, cache,
// informer, Helm client, or port-forward session can be accessed.
type Application struct {
	Config     config.Config
	handler    http.Handler
	identity   *auth.Manager
	mu         sync.Mutex
	workspaces map[string]*Server
}

func NewApplication(logger *slog.Logger) (*Application, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	app := &Application{Config: cfg, workspaces: map[string]*Server{}}
	if cfg.ForwardDomain != "" && cfg.AuthMode != "server" {
		return nil, fmt.Errorf("browser forwarding requires server authentication mode")
	}
	gateway, err := forward.New(cfg.ForwardDomain, cfg.PublicURL)
	if err != nil {
		return nil, err
	}
	var catalog *plugins.Catalog
	if cfg.PluginsEnabled {
		catalog, err = plugins.Load(cfg.PluginsDir, filepath.Join(cfg.ConfigDir, "plugins-state.json"))
		if err != nil {
			return nil, err
		}
		if err = catalog.ConfigureDistribution(cfg.PluginCatalogURL, cfg.PluginTrustKeyFile); err != nil {
			return nil, err
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	switch cfg.AuthMode {
	case "single-user":
		workspace, err := newWorkspace(cfg, "", logger)
		if err != nil {
			return nil, err
		}
		app.workspaces[""] = workspace
		workspace.extensions = catalog
		mux.HandleFunc("GET /api/auth/session", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, 200, map[string]any{"mode": "single-user", "user": nil, "oidc": false, "plugins": cfg.PluginsEnabled})
		})
		mux.Handle("/", workspace.Routes())
	case "server":
		identity, err := auth.New(cfg, logger)
		if err != nil {
			return nil, err
		}
		app.identity = identity
		mux.HandleFunc("/api/auth/", identity.ServeAuth)
		mux.Handle("/api/", identity.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := auth.CurrentUser(r.Context())
			app.mu.Lock()
			workspace := app.workspaces[user.ID]
			if workspace == nil {
				userConfig := cfg
				userConfig.ConfigDir = filepath.Join(cfg.ConfigDir, "users", user.ID)
				userConfig.ClustersDir = filepath.Join(userConfig.ConfigDir, "clusters.d")
				userConfig.DisplayFile = filepath.Join(userConfig.ConfigDir, "cluster-display.json")
				var workspaceErr error
				workspace, workspaceErr = newWorkspace(userConfig, user.ID, logger)
				if workspaceErr == nil {
					workspace.extensions = catalog
					workspace.forwardGateway = gateway
					app.workspaces[user.ID] = workspace
				}
			}
			app.mu.Unlock()
			if workspace == nil {
				writeError(w, 500, fmt.Errorf("could not open user workspace"))
				return
			}
			workspace.Routes().ServeHTTP(w, r)
		})))
		// The shell and login page contain no user data; every API is gated above.
		mux.Handle("/", (&Server{}).spaHandler())
	default:
		return nil, fmt.Errorf("ASTRONOMER_LITE_AUTH_MODE must be single-user or server")
	}
	app.handler = gateway.Wrap(mux)
	return app, nil
}
func (a *Application) Routes() http.Handler { return a.handler }
func (a *Application) Close() {
	if a.identity != nil {
		a.identity.Close()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, s := range a.workspaces {
		s.Close()
	}
}
