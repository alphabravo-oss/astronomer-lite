package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestNodeDrainSkipReason(t *testing.T) {
	controller := true
	tests := []struct {
		name    string
		pod     corev1.Pod
		request nodeDrainRequest
		want    string
	}{
		{
			name: "completed pod",
			pod: corev1.Pod{
				Status: corev1.PodStatus{Phase: corev1.PodSucceeded},
			},
			want: "Pod is already completed",
		},
		{
			name: "static mirror pod",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Annotations: map[string]string{corev1.MirrorPodAnnotationKey: "mirror"},
				},
			},
			want: "Static mirror Pods cannot be evicted",
		},
		{
			name: "daemonset pod",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					OwnerReferences: []metav1.OwnerReference{{
						APIVersion: "apps/v1",
						Kind:       "DaemonSet",
						Name:       "node-agent",
						Controller: &controller,
					}},
				},
			},
			want: "DaemonSet-managed Pods are ignored during drain",
		},
		{
			name: "unmanaged pod requires force",
			pod:  corev1.Pod{},
			want: "Pod has no controller; enable force to evict unmanaged Pods",
		},
		{
			name:    "unmanaged pod allowed with force",
			pod:     corev1.Pod{},
			request: nodeDrainRequest{Force: true},
			want:    "",
		},
		{
			name: "emptydir pod requires opt in",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					OwnerReferences: []metav1.OwnerReference{{
						APIVersion: "apps/v1",
						Kind:       "ReplicaSet",
						Name:       "web",
						Controller: &controller,
					}},
				},
				Spec: corev1.PodSpec{
					Volumes: []corev1.Volume{{
						Name:         "cache",
						VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
					}},
				},
			},
			want: "Pod uses emptyDir data; allow emptyDir deletion to evict it",
		},
		{
			name: "replicaset pod is eligible",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					OwnerReferences: []metav1.OwnerReference{{
						APIVersion: "apps/v1",
						Kind:       "ReplicaSet",
						Name:       "web",
						Controller: &controller,
					}},
				},
			},
			want: "",
		},
		{
			name: "emptydir pod allowed with opt in",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					OwnerReferences: []metav1.OwnerReference{{
						APIVersion: "apps/v1",
						Kind:       "ReplicaSet",
						Name:       "web",
						Controller: &controller,
					}},
				},
				Spec: corev1.PodSpec{
					Volumes: []corev1.Volume{{
						Name:         "cache",
						VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
					}},
				},
			},
			request: nodeDrainRequest{DeleteEmptyDirData: true},
			want:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nodeDrainSkipReason(tt.pod, tt.request)
			if got != tt.want {
				t.Fatalf("nodeDrainSkipReason() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPodUsesEmptyDir(t *testing.T) {
	if podUsesEmptyDir(corev1.Pod{}) {
		t.Fatal("podUsesEmptyDir() = true for pod with no volumes")
	}
	if !podUsesEmptyDir(corev1.Pod{Spec: corev1.PodSpec{Volumes: []corev1.Volume{{
		Name:         "scratch",
		VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
	}}}}) {
		t.Fatal("podUsesEmptyDir() = false for pod with emptyDir volume")
	}
}

func TestMaskSecretRedactsDataAndStringData(t *testing.T) {
	secret := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]any{
			"name": "example",
		},
		"data": map[string]any{
			"password": "c2VjcmV0LXZhbHVl",
		},
		"stringData": map[string]any{
			"token": "plain-secret",
		},
	}}

	maskSecret(secret)

	if got, _, _ := unstructured.NestedString(secret.Object, "data", "password"); got != "********" {
		t.Fatalf("masked data password = %q, want ********", got)
	}
	if got, _, _ := unstructured.NestedString(secret.Object, "stringData", "token"); got != "********" {
		t.Fatalf("masked stringData token = %q, want ********", got)
	}
}

func TestLogRequestsDoesNotLogSecretValues(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := logRequests(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/clusters/test/apply?token=query-secret", strings.NewReader("password=body-secret"))
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	output := logs.String()
	if strings.Contains(output, "query-secret") || strings.Contains(output, "body-secret") {
		t.Fatalf("request log leaked secret value: %s", output)
	}
	if !strings.Contains(output, "/api/clusters/test/apply") {
		t.Fatalf("request log = %q, want path without query", output)
	}
}
