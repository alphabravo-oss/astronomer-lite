package server

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/alphabravo/astronomer-lite/server/internal/cache"
	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/alphabravo/astronomer-lite/server/internal/kubeconfig"
	"github.com/alphabravo/astronomer-lite/server/internal/plugins"
	"github.com/gorilla/websocket"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/restmapper"
)

// The web bundle is a build artifact, not committed to the repo (only the
// .gitkeep placeholder is). `all:` includes that dotfile so the package still
// compiles before `make web-build` populates static/dist.
//
//go:embed all:static/dist
var embeddedDist embed.FS

type Server struct {
	Config        config.Config
	registry      *kubeconfig.Registry
	logger        *slog.Logger
	portForwardMu sync.Mutex
	portForwards  map[string]*portForwardSession
	informers     *cache.InformerManager
	helmGetterMu  sync.Mutex
	helmGetters   map[string]*restClientGetter
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func New(logger *slog.Logger) (*Server, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if err := cfg.EnsureDirs(); err != nil {
		return nil, err
	}
	registry := kubeconfig.NewRegistry(config.SystemKubeconfigPath(cfg.Kubeconfig), cfg.ClustersDir, cfg.DisplayFile, logger)
	ctx := context.Background()
	if err := registry.Reload(); err != nil {
		logger.Warn("failed to reload kubeconfigs", "error", err)
	}
	registry.Start(ctx)
	informerMgr := cache.NewInformerManager()
	s := &Server{Config: cfg, registry: registry, logger: logger, portForwards: map[string]*portForwardSession{}, informers: informerMgr, helmGetters: map[string]*restClientGetter{}}
	// Drop per-cluster cached state (openapi, prom detection, informer
	// factories, helm getters) when a kubeconfig disappears or is reloaded
	// so the next request rebuilds from scratch.
	registry.OnClusterInvalidated(func(id string) {
		openAPICache.Invalidate(id)
		promCache.Invalidate(id)
		restMapperCache.Invalidate(id)
		informerMgr.Invalidate(id)
		s.invalidateHelmGetters(id)
	})
	return s, nil
}

func (s *Server) restMapperFor(id string) (meta.RESTMapper, error) {
	return restMapperCache.Do(id, func() (meta.RESTMapper, error) {
		restConfig, err := s.registry.RESTConfig(id)
		if err != nil {
			return nil, err
		}
		discoveryClient, err := discovery.NewDiscoveryClientForConfig(restConfig)
		if err != nil {
			return nil, err
		}
		groupResources, err := restmapper.GetAPIGroupResources(discoveryClient)
		if err != nil {
			return nil, err
		}
		return restmapper.NewDiscoveryRESTMapper(groupResources), nil
	})
}

func (s *Server) invalidateHelmGetters(id string) {
	s.helmGetterMu.Lock()
	defer s.helmGetterMu.Unlock()
	prefix := id + "\x00"
	for key := range s.helmGetters {
		if strings.HasPrefix(key, prefix) {
			delete(s.helmGetters, key)
		}
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/clusters/preview", s.handleKubeconfigPreview)
	mux.HandleFunc("/api/clusters", s.handleClusters)
	mux.HandleFunc("/api/clusters/", s.handleCluster)
	mux.HandleFunc("/api/plugins/nav", s.handlePluginNav)
	mux.Handle("/", s.spaHandler())
	return logRequests(s.logger, mux)
}

func (s *Server) handlePluginNav(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, plugins.DefaultRegistry().NavItems())
}

func (s *Server) spaHandler() http.Handler {
	dist, err := fs.Sub(embeddedDist, "static/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, os.ErrNotExist)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if file, err := dist.Open(path); err == nil {
				_ = file.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
