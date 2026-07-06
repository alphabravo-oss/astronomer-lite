package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/version"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
)

// P0-1: /api/version must exist and report the build stamp.
func TestHandleVersion(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	s.handleVersion(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["version"] != version.Version {
		t.Fatalf("version = %q, want %q", resp["version"], version.Version)
	}
	if resp["userAgent"] != version.UserAgent() {
		t.Fatalf("userAgent = %q, want %q", resp["userAgent"], version.UserAgent())
	}
}

// P1-1: exec/attach must return 403 (errForbidden) before any stream is opened
// when the SelfSubjectAccessReview is denied.
func TestHandlePodExecWSDeniedByRBAC(t *testing.T) {
	s := kubeServer(false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/?ns=default&pod=busybox", nil)
	s.handlePodExecWS(rec, req, "c1")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied exec should be 403, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "forbidden") {
		t.Fatalf("expected forbidden error, got %q", rec.Body.String())
	}
}

func TestHandlePodAttachWSDeniedByRBAC(t *testing.T) {
	s := kubeServer(false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/?ns=default&pod=busybox", nil)
	s.handlePodAttachWS(rec, req, "c1")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied attach should be 403, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// exec without required query params should 400 before touching auth.
func TestHandlePodExecWSRequiresParams(t *testing.T) {
	s := kubeServer(true)
	rec := httptest.NewRecorder()
	s.handlePodExecWS(rec, httptest.NewRequest(http.MethodGet, "/?ns=default", nil), "c1")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing pod should be 400, got %d", rec.Code)
	}
}

// P1-2: the raw /k8s proxy must reject mutating verbs (read-only escape hatch).
func TestKubernetesProxyRejectsWrites(t *testing.T) {
	s := &Server{}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/clusters/c1/k8s/api/v1/namespaces/default/pods", nil)
		s.handleKubernetesProxy(rec, req, "c1", "/api/v1/namespaces/default/pods")
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s to /k8s should be 405, got %d (%s)", method, rec.Code, rec.Body.String())
		}
	}
}

// P1-6: node drain cordons the node, evicts eligible pods, and honors skip
// reasons and RBAC gating.
func TestHandleNodeDrain(t *testing.T) {
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1"}}
	eligible := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "web", Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web", Controller: boolPtr(true)}},
		},
		Spec:   corev1.PodSpec{NodeName: "node-1"},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	daemon := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "agent", Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{{Kind: "DaemonSet", Name: "agent", Controller: boolPtr(true)}},
		},
		Spec:   corev1.PodSpec{NodeName: "node-1"},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	clientset := k8sfake.NewClientset(node, eligible, daemon)
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(kubetesting.Action) (bool, runtime.Object, error) {
		return true, &authorizationv1.SelfSubjectAccessReview{Status: authorizationv1.SubjectAccessReviewStatus{Allowed: true}}, nil
	})
	evicted := 0
	clientset.PrependReactor("create", "pods", func(action kubetesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() == "eviction" {
			evicted++
			return true, nil, nil
		}
		return false, nil, nil
	})
	s := &Server{kubeClientFor: func(string) (kubernetes.Interface, error) { return clientset, nil }}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"force":false,"deleteEmptyDirData":false}`))
	s.handleNodeDrain(rec, req, "c1", "node-1")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp nodeDrainResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.NodeCordoned {
		t.Fatalf("node should be cordoned")
	}
	if len(resp.Evicted) != 1 || resp.Evicted[0].Name != "web" {
		t.Fatalf("expected web evicted, got %+v", resp.Evicted)
	}
	if len(resp.Skipped) != 1 || resp.Skipped[0].Name != "agent" {
		t.Fatalf("expected agent skipped (DaemonSet), got %+v", resp.Skipped)
	}
	if evicted != 1 {
		t.Fatalf("expected exactly 1 eviction call, got %d", evicted)
	}
	// The node object should now be unschedulable.
	updated, err := clientset.CoreV1().Nodes().Get(req.Context(), "node-1", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get node: %v", err)
	}
	if !updated.Spec.Unschedulable {
		t.Fatalf("node should be marked unschedulable after drain")
	}
}

func TestHandleNodeDrainDeniedByRBAC(t *testing.T) {
	s := kubeServer(false, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1"}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	s.handleNodeDrain(rec, req, "c1", "node-1")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied drain should be 403, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func boolPtr(b bool) *bool { return &b }

// P1-3: a port-forward session is torn down once its TTL elapses, and
// stopForward is idempotent (safe to call from the TTL timer and the forwarder
// goroutine).
func TestArmPortForwardTTLStopsSession(t *testing.T) {
	session := &portForwardSession{stop: make(chan struct{}), done: make(chan struct{})}
	go armPortForwardTTL(session, 20*time.Millisecond)

	select {
	case <-session.stop:
		// stopped by TTL as expected
	case <-time.After(2 * time.Second):
		t.Fatal("session was not stopped after its TTL elapsed")
	}
	// Idempotent: a second stop (e.g. from the forwarder exiting) must not panic.
	session.stopForward()
}

func TestArmPortForwardTTLYieldsWhenDone(t *testing.T) {
	session := &portForwardSession{stop: make(chan struct{}), done: make(chan struct{})}
	finished := make(chan struct{})
	go func() {
		armPortForwardTTL(session, time.Hour)
		close(finished)
	}()
	close(session.done) // forward ended before the TTL

	select {
	case <-finished:
		// TTL goroutine returned without stopping the (already-done) session
	case <-time.After(2 * time.Second):
		t.Fatal("armPortForwardTTL did not return when the session finished")
	}
	select {
	case <-session.stop:
		t.Fatal("session.stop should not be closed when the forward finished before its TTL")
	default:
	}
}
