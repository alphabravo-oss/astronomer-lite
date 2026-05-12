package config

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type Config struct {
	Port           string
	ConfigDir      string
	ClustersDir    string
	DisplayFile    string
	Kubeconfig     string
	PortForwardTTL time.Duration
}

func Load() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}

	cfgDir := getenv("ASTRONOMER_LITE_CONFIG_DIR", filepath.Join(home, ".config", "astronomer-lite"))
	portForwardTTL, err := time.ParseDuration(getenv("ASTRONOMER_LITE_PORT_FORWARD_TTL", "60m"))
	if err != nil {
		return Config{}, fmt.Errorf("ASTRONOMER_LITE_PORT_FORWARD_TTL: %w", err)
	}
	return Config{
		Port:           getenv("PORT", "8080"),
		ConfigDir:      cfgDir,
		ClustersDir:    filepath.Join(cfgDir, "clusters.d"),
		DisplayFile:    filepath.Join(cfgDir, "cluster-display.json"),
		Kubeconfig:     os.Getenv("KUBECONFIG"),
		PortForwardTTL: portForwardTTL,
	}, nil
}

func (c Config) EnsureDirs() error {
	return os.MkdirAll(c.ClustersDir, 0o700)
}

func SystemKubeconfigPath(explicit string) []string {
	if explicit != "" {
		return filepath.SplitList(explicit)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{filepath.Join(home, ".kube", "config")}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
