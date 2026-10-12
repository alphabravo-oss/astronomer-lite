package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	PluginsEnabled        bool
	Host                  string
	TrustedProxies        []string
	ProxyUserHeader       string
	ProxyGroupsHeader     string
	ProxyAdminGroups      []string
	ProxyRequiredGroups   []string
	CredentialHelpersFile string
	ForwardDomain         string
	PluginCatalogURL      string
	PluginTrustKeyFile    string
	Port                  string
	ConfigDir             string
	ClustersDir           string
	DisplayFile           string
	Kubeconfig            string
	PortForwardTTL        time.Duration
	AuthMode              string
	PublicURL             string
	AdminUser             string
	AdminPasswordFile     string
	OIDCIssuer            string
	OIDCClientID          string
	OIDCSecretFile        string
	OIDCRefresh           bool
	OIDCGroupsClaim       string
	OIDCAdminGroups       []string
	OIDCRequiredGroups    []string
	PluginsDir            string
	AllowedClusterServers []string
	HelmRepositories      []string
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
		PluginsEnabled:        getenv("ASTRONOMER_LITE_PLUGINS_ENABLED", "false") == "true",
		Host:                  os.Getenv("ASTRONOMER_LITE_HOST"),
		CredentialHelpersFile: os.Getenv("ASTRONOMER_LITE_CREDENTIAL_HELPERS_FILE"),
		ForwardDomain:         os.Getenv("ASTRONOMER_LITE_FORWARD_DOMAIN"),
		PluginCatalogURL:      os.Getenv("ASTRONOMER_LITE_PLUGIN_CATALOG_URL"),
		PluginTrustKeyFile:    os.Getenv("ASTRONOMER_LITE_PLUGIN_TRUST_KEY_FILE"),
		TrustedProxies:        strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_TRUSTED_PROXIES"), func(r rune) bool { return r == ',' || r == '\n' }),
		ProxyUserHeader:       os.Getenv("ASTRONOMER_LITE_PROXY_USER_HEADER"),
		ProxyGroupsHeader:     os.Getenv("ASTRONOMER_LITE_PROXY_GROUPS_HEADER"),
		ProxyAdminGroups:      strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_PROXY_ADMIN_GROUPS"), func(r rune) bool { return r == ',' || r == '\n' }),
		ProxyRequiredGroups:   strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_PROXY_REQUIRED_GROUPS"), func(r rune) bool { return r == ',' || r == '\n' }),
		Port:                  getenv("PORT", "8080"),
		ConfigDir:             cfgDir,
		ClustersDir:           filepath.Join(cfgDir, "clusters.d"),
		DisplayFile:           filepath.Join(cfgDir, "cluster-display.json"),
		Kubeconfig:            os.Getenv("KUBECONFIG"),
		PortForwardTTL:        portForwardTTL,
		AuthMode:              getenv("ASTRONOMER_LITE_AUTH_MODE", "single-user"),
		PublicURL:             os.Getenv("ASTRONOMER_LITE_PUBLIC_URL"),
		AdminUser:             getenv("ASTRONOMER_LITE_ADMIN_USER", "admin"),
		AdminPasswordFile:     os.Getenv("ASTRONOMER_LITE_ADMIN_PASSWORD_FILE"),
		OIDCIssuer:            os.Getenv("ASTRONOMER_LITE_OIDC_ISSUER"),
		OIDCClientID:          os.Getenv("ASTRONOMER_LITE_OIDC_CLIENT_ID"),
		OIDCSecretFile:        os.Getenv("ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE"),
		OIDCRefresh:           getenv("ASTRONOMER_LITE_OIDC_REFRESH", "true") == "true",
		OIDCGroupsClaim:       getenv("ASTRONOMER_LITE_OIDC_GROUPS_CLAIM", "groups"),
		OIDCAdminGroups:       strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_OIDC_ADMIN_GROUPS"), func(r rune) bool { return r == ',' || r == '\n' }),
		OIDCRequiredGroups:    strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_OIDC_REQUIRED_GROUPS"), func(r rune) bool { return r == ',' || r == '\n' }),
		PluginsDir:            os.Getenv("ASTRONOMER_LITE_PLUGINS_DIR"),
		AllowedClusterServers: strings.FieldsFunc(os.Getenv("ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS"), func(r rune) bool { return r == ',' || r == '\n' }),
		HelmRepositories:      strings.FieldsFunc(getenv("ASTRONOMER_LITE_HELM_REPOSITORIES", "https://prometheus-community.github.io/helm-charts,https://kubernetes-sigs.github.io/metrics-server/"), func(r rune) bool { return r == ',' || r == '\n' }),
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
