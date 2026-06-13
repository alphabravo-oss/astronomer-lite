package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type accessReviewRequest struct {
	Verb        string `json:"verb"`
	Group       string `json:"group"`
	Resource    string `json:"resource"`
	Subresource string `json:"subresource,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name,omitempty"`
}

type accessReviewResponse struct {
	Allowed         bool   `json:"allowed"`
	Denied          bool   `json:"denied"`
	Reason          string `json:"reason,omitempty"`
	EvaluationError string `json:"evaluationError,omitempty"`
}

func (s *Server) handleAccessReview(w http.ResponseWriter, r *http.Request, id string) {
	var body accessReviewRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	body.Verb = strings.TrimSpace(body.Verb)
	body.Group = strings.TrimSpace(body.Group)
	body.Resource = strings.TrimSpace(body.Resource)
	body.Subresource = strings.TrimSpace(body.Subresource)
	body.Namespace = strings.TrimSpace(body.Namespace)
	body.Name = strings.TrimSpace(body.Name)
	if body.Namespace == "_" {
		body.Namespace = ""
	}
	if body.Verb == "" || body.Resource == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("verb and resource are required"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	status, err := s.selfSubjectAccessReview(ctx, id, authorizationv1.ResourceAttributes{
		Namespace:   body.Namespace,
		Verb:        body.Verb,
		Group:       body.Group,
		Resource:    body.Resource,
		Subresource: body.Subresource,
		Name:        body.Name,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, accessReviewResponse{
		Allowed:         status.Allowed,
		Denied:          status.Denied,
		Reason:          status.Reason,
		EvaluationError: status.EvaluationError,
	})
}

// errForbidden is returned by (*Server).authorize when a SelfSubjectAccessReview
// reports the caller is not allowed to perform the requested action. writeError
// maps it to HTTP 403 so the server-side double-check produces a clean error
// path independent of the eventual K8s 403 propagated as 502 BadGateway.
var errForbidden = errors.New("forbidden by Kubernetes RBAC")

// selfSubjectAccessReview is the shared SSAR primitive used by both the
// /can-i endpoint and the server-side authorize() guard.
func (s *Server) selfSubjectAccessReview(ctx context.Context, id string, attrs authorizationv1.ResourceAttributes) (authorizationv1.SubjectAccessReviewStatus, error) {
	client, err := s.kubeClientFor(id)
	if err != nil {
		return authorizationv1.SubjectAccessReviewStatus{}, err
	}
	review, err := client.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &attrs},
	}, metav1.CreateOptions{})
	if err != nil {
		return authorizationv1.SubjectAccessReviewStatus{}, err
	}
	return review.Status, nil
}

// authorize returns errForbidden when the SSAR for attrs is not allowed.
// Failures to reach the authorization API are returned as wrapped errors
// (callers propagate via writeError -> 502 BadGateway).
func (s *Server) authorize(ctx context.Context, id string, attrs authorizationv1.ResourceAttributes) error {
	status, err := s.selfSubjectAccessReview(ctx, id, attrs)
	if err != nil {
		return fmt.Errorf("authorize %s %s/%s: %w", attrs.Verb, attrs.Group, attrs.Resource, err)
	}
	if status.Allowed && !status.Denied {
		return nil
	}
	reason := strings.TrimSpace(status.Reason)
	if reason == "" {
		reason = status.EvaluationError
	}
	if reason != "" {
		return fmt.Errorf("%w: %s %s/%s in %q: %s", errForbidden, attrs.Verb, attrs.Group, attrs.Resource, attrs.Namespace, reason)
	}
	return fmt.Errorf("%w: %s %s/%s in %q", errForbidden, attrs.Verb, attrs.Group, attrs.Resource, attrs.Namespace)
}
