package server

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"
	"unicode/utf8"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (s *Server) handleSecretReveal(w http.ResponseWriter, r *http.Request, id string, namespace string, name string, key string) {
	if namespace == "" || namespace == "_" || name == "" || key == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace, secret name, and key are required"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: namespace,
		Verb:      "get",
		Group:     "",
		Resource:  "secrets",
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.kubeClientFor(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	secret, err := client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	value, ok := secret.Data[key]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("secret key %q not found", key))
		return
	}
	response := map[string]any{
		"key":    key,
		"base64": base64.StdEncoding.EncodeToString(value),
		"binary": !utf8.Valid(value),
	}
	if utf8.Valid(value) {
		response["value"] = string(value)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func isSecretResource(resource string, gvr schema.GroupVersionResource) bool {
	return resource == "secrets" || (gvr.Group == "" && gvr.Version == "v1" && gvr.Resource == "secrets")
}

func maskSecret(item *unstructured.Unstructured) {
	redactSecretMap(item.Object, "data")
	redactSecretMap(item.Object, "stringData")
}

func redactSecretMap(object map[string]any, field string) {
	value, ok := object[field]
	if !ok {
		return
	}
	switch typed := value.(type) {
	case map[string]string:
		for key := range typed {
			typed[key] = "********"
		}
		object[field] = typed
	case map[string]any:
		for key := range typed {
			typed[key] = "********"
		}
		object[field] = typed
	}
}
