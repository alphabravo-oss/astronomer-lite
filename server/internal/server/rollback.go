package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

func (s *Server) handleResourceRollback(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	if namespace == "_" || namespace == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for rollback"))
		return
	}
	if resource != "deployments" && resource != "statefulsets" && resource != "daemonsets" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rollback is supported only for deployments, statefulsets, and daemonsets"))
		return
	}
	var body struct {
		Revision int64 `json:"revision"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Revision <= 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("revision must be a positive integer"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: namespace,
		Verb:      "patch",
		Group:     "apps",
		Resource:  resource,
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
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	switch resource {
	case "deployments":
		s.rollbackDeployment(ctx, w, client, namespace, name, body.Revision)
	case "statefulsets":
		s.rollbackStatefulSet(ctx, w, client, namespace, name, body.Revision)
	case "daemonsets":
		s.rollbackDaemonSet(ctx, w, client, namespace, name, body.Revision)
	}
}

func (s *Server) rollbackDeployment(ctx context.Context, w http.ResponseWriter, client kubernetes.Interface, namespace, name string, revision int64) {
	dep, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	rsList, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var target *appsv1.ReplicaSet
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		if !isOwnedBy(rs.OwnerReferences, dep.UID) {
			continue
		}
		if rs.Annotations["deployment.kubernetes.io/revision"] == strconv.FormatInt(revision, 10) {
			target = rs
			break
		}
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ReplicaSet found for revision %d", revision))
		return
	}
	patch := map[string]any{
		"spec": map[string]any{
			"template": target.Spec.Template,
		},
		"metadata": map[string]any{
			"annotations": map[string]string{
				"kubernetes.io/change-cause": fmt.Sprintf("rollback to revision %d", revision),
			},
		},
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	updated, err := client.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": updated.Name})
}

func (s *Server) rollbackStatefulSet(ctx context.Context, w http.ResponseWriter, client kubernetes.Interface, namespace, name string, revision int64) {
	ss, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := findControllerRevision(ctx, client, namespace, ss.UID, revision)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ControllerRevision found for revision %d", revision))
		return
	}
	patched, err := client.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, target.Data.Raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": patched.Name})
}

func (s *Server) rollbackDaemonSet(ctx context.Context, w http.ResponseWriter, client kubernetes.Interface, namespace, name string, revision int64) {
	ds, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := findControllerRevision(ctx, client, namespace, ds.UID, revision)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ControllerRevision found for revision %d", revision))
		return
	}
	patched, err := client.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, target.Data.Raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": patched.Name})
}

func findControllerRevision(ctx context.Context, client kubernetes.Interface, namespace string, ownerUID types.UID, revision int64) (*appsv1.ControllerRevision, error) {
	list, err := client.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range list.Items {
		cr := &list.Items[i]
		if !isOwnedBy(cr.OwnerReferences, ownerUID) {
			continue
		}
		if cr.Revision == revision {
			return cr, nil
		}
	}
	return nil, nil
}

func isOwnedBy(refs []metav1.OwnerReference, uid types.UID) bool {
	for _, ref := range refs {
		if ref.UID == uid {
			return true
		}
	}
	return false
}
