package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/alphabravo/astronomer-lite/server/internal/credentials"
	"github.com/alphabravo/astronomer-lite/server/internal/desktop"
	appserver "github.com/alphabravo/astronomer-lite/server/internal/server"
	"github.com/gofrs/flock"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "credential-helper" {
		if err := credentials.Main(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	if err := cfg.EnsureDirs(); err != nil {
		logger.Error("cannot open state directory", "error", err)
		os.Exit(1)
	}
	lock := flock.New(filepath.Join(cfg.ConfigDir, "instance.lock"))
	locked, err := lock.TryLock()
	if err != nil || !locked {
		logger.Error("state directory is already in use or cannot be locked")
		os.Exit(1)
	}
	defer func() { _ = lock.Close() }()
	token := os.Getenv("ASTRONOMER_LITE_DESKTOP_TOKEN")
	_ = os.Unsetenv("ASTRONOMER_LITE_DESKTOP_TOKEN")

	srv, err := appserver.NewApplication(logger)
	if err != nil {
		logger.Error("failed to initialize server", "error", err)
		os.Exit(1)
	}
	defer srv.Close()

	addr := net.JoinHostPort(srv.Config.Host, srv.Config.Port)
	handler, err := desktop.Guard(srv.Routes(), token, srv.Config.Host)
	if err != nil {
		logger.Error("invalid desktop listener", "error", err)
		return
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Error("cannot listen", "error", err)
		return
	}
	defer func() { _ = listener.Close() }()
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("astronomer-lite listening", "addr", listener.Addr().String())
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	if token != "" {
		fmt.Printf("ASTRONOMER_LITE_READY=http://%s/\n", listener.Addr().String())
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop <- os.Interrupt }()
	}
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
