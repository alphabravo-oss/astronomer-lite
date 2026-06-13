package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	if errors.Is(err, errForbidden) {
		status = http.StatusForbidden
	} else if errors.Is(err, os.ErrNotExist) {
		status = http.StatusNotFound
	} else if apiStatus, ok := err.(apierrors.APIStatus); ok {
		if code := int(apiStatus.Status().Code); code > 0 {
			status = code
		}
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}
