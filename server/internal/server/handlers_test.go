package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
)

// kubeServer builds a Server whose kube-client seam returns the given fake
// clientset, with a SelfSubjectAccessReview reactor reflecting `allow`.
func kubeServer(allow bool, objects ...runtime.Object) *Server {
	clientset := k8sfake.NewClientset(objects...)
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(kubetesting.Action) (bool, runtime.Object, error) {
		return true, &authorizationv1.SelfSubjectAccessReview{
			Status: authorizationv1.SubjectAccessReviewStatus{Allowed: allow},
		}, nil
	})
	return &Server{kubeClientFor: func(string) (kubernetes.Interface, error) { return clientset, nil }}
}

func secretRequest() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/", nil)
}

func TestHandleSecretRevealDeniedByRBAC(t *testing.T) {
	s := kubeServer(false, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
		Data:       map[string][]byte{"password": []byte("s3cret")},
	})
	rec := httptest.NewRecorder()
	s.handleSecretReveal(rec, secretRequest(), "c1", "default", "db", "password")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied SAR should map to 403, got %d (%s)", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "forbidden") {
		t.Fatalf("expected forbidden error, got %q", body)
	}
}

func TestHandleSecretRevealReturnsValueWhenAllowed(t *testing.T) {
	s := kubeServer(true, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
		Data:       map[string][]byte{"password": []byte("s3cret")},
	})
	rec := httptest.NewRecorder()
	s.handleSecretReveal(rec, secretRequest(), "c1", "default", "db", "password")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("revealed secret must not be cached, got Cache-Control %q", got)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["value"] != "s3cret" {
		t.Fatalf("expected decoded value s3cret, got %v", resp["value"])
	}
	if resp["binary"] != false {
		t.Fatalf("utf8 secret should not be flagged binary, got %v", resp["binary"])
	}
}

func TestHandleSecretRevealMissingKey(t *testing.T) {
	s := kubeServer(true, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
		Data:       map[string][]byte{"password": []byte("s3cret")},
	})
	rec := httptest.NewRecorder()
	s.handleSecretReveal(rec, secretRequest(), "c1", "default", "db", "absent")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing key should be 404, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestHandleSecretRevealRequiresParams(t *testing.T) {
	s := kubeServer(true)
	rec := httptest.NewRecorder()
	s.handleSecretReveal(rec, secretRequest(), "c1", "default", "db", "")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing key param should be 400, got %d", rec.Code)
	}
}

func TestHandleResourceListReturnsRows(t *testing.T) {
	scheme := runtime.NewScheme()
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	pod := func(name, ns string) *unstructured.Unstructured {
		return &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata":   map[string]any{"name": name, "namespace": ns},
			"status":     map[string]any{"phase": "Running"},
		}}
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		scheme,
		map[schema.GroupVersionResource]string{gvr: "PodList"},
		pod("b-pod", "default"),
		pod("a-pod", "default"),
	)
	s := &Server{dynamicClientFor: func(string) (dynamic.Interface, error) { return dyn, nil }}

	rec := httptest.NewRecorder()
	s.handleResourceList(rec, httptest.NewRequest(http.MethodGet, "/", nil), "c1", "pods")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Resource   string `json:"resource"`
		Namespaced bool   `json:"namespaced"`
		Items      []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Resource != "pods" || !resp.Namespaced {
		t.Fatalf("unexpected metadata: %+v", resp)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(resp.Items))
	}
	// Rows are sorted by namespace then name.
	if resp.Items[0].Name != "a-pod" || resp.Items[1].Name != "b-pod" {
		t.Fatalf("rows not sorted by name: %+v", resp.Items)
	}
	if resp.Items[0].Status != "Running" {
		t.Fatalf("expected status Running, got %q", resp.Items[0].Status)
	}
}

func TestHandleResourceListUnknownResource(t *testing.T) {
	s := &Server{dynamicClientFor: func(string) (dynamic.Interface, error) {
		return dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()), nil
	}}
	rec := httptest.NewRecorder()
	s.handleResourceList(rec, httptest.NewRequest(http.MethodGet, "/", nil), "c1", "widgets")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown resource should be 404, got %d", rec.Code)
	}
}
