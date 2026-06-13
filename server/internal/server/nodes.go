package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
)

type nodeDrainRequest struct {
	Force              bool `json:"force"`
	DeleteEmptyDirData bool `json:"deleteEmptyDirData"`
}

type nodeDrainPodResult struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
}

type nodeDrainResponse struct {
	NodeCordoned    bool                 `json:"nodeCordoned"`
	NodeWasCordoned bool                 `json:"nodeWasCordoned"`
	Evicted         []nodeDrainPodResult `json:"evicted"`
	Skipped         []nodeDrainPodResult `json:"skipped"`
	Errors          []nodeDrainPodResult `json:"errors"`
}

func (s *Server) handleNodeDrain(w http.ResponseWriter, r *http.Request, id string, name string) {
	var request nodeDrainRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Verb:     "patch",
		Group:    "",
		Resource: "nodes",
		Name:     name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Verb:        "create",
		Group:       "",
		Resource:    "pods",
		Subresource: "eviction",
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
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	node, err := client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	response := nodeDrainResponse{
		NodeCordoned:    true,
		NodeWasCordoned: node.Spec.Unschedulable,
		Evicted:         []nodeDrainPodResult{},
		Skipped:         []nodeDrainPodResult{},
		Errors:          []nodeDrainPodResult{},
	}
	if !node.Spec.Unschedulable {
		next := node.DeepCopy()
		next.Spec.Unschedulable = true
		if _, err := client.CoreV1().Nodes().Update(ctx, next, metav1.UpdateOptions{}); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("cordon node before drain: %w", err))
			return
		}
	}

	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("spec.nodeName", name).String(),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	for _, pod := range pods.Items {
		ref := nodeDrainPodResult{Namespace: pod.Namespace, Name: pod.Name}
		if reason := nodeDrainSkipReason(pod, request); reason != "" {
			ref.Reason = reason
			response.Skipped = append(response.Skipped, ref)
			continue
		}

		eviction := &policyv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{Name: pod.Name, Namespace: pod.Namespace},
		}
		if err := client.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil {
			ref.Error = err.Error()
			response.Errors = append(response.Errors, ref)
			continue
		}
		response.Evicted = append(response.Evicted, ref)
	}
	writeJSON(w, http.StatusOK, response)
}

func nodeDrainSkipReason(pod corev1.Pod, request nodeDrainRequest) string {
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return "Pod is already completed"
	}
	if _, ok := pod.Annotations[corev1.MirrorPodAnnotationKey]; ok {
		return "Static mirror Pods cannot be evicted"
	}
	controller := metav1.GetControllerOf(&pod)
	if controller != nil && controller.Kind == "DaemonSet" {
		return "DaemonSet-managed Pods are ignored during drain"
	}
	if controller == nil && !request.Force {
		return "Pod has no controller; enable force to evict unmanaged Pods"
	}
	if podUsesEmptyDir(pod) && !request.DeleteEmptyDirData {
		return "Pod uses emptyDir data; allow emptyDir deletion to evict it"
	}
	return ""
}

func podUsesEmptyDir(pod corev1.Pod) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.EmptyDir != nil {
			return true
		}
	}
	return false
}
