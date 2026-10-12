package server

import (
	"errors"
	"strings"
	"testing"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestTopologyExtrasPreserveOwnershipAndReportPartialPermissions(t *testing.T) {
	ns := "example"
	cron := &batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: ns, UID: "cron-uid"}}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "nightly-job", Namespace: ns, UID: "job-uid", OwnerReferences: []metav1.OwnerReference{{UID: "cron-uid", Kind: "CronJob", Name: "nightly"}}}}
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: ns, OwnerReferences: []metav1.OwnerReference{{UID: "job-uid", Kind: "Job", Name: "nightly-job"}}}, Spec: corev1.PodSpec{ServiceAccountName: "worker", Containers: []corev1.Container{{Name: "main", EnvFrom: []corev1.EnvFromSource{{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "credentials"}}}}}}}}
	ingress := &networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: ns}, Spec: networkingv1.IngressSpec{DefaultBackend: &networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "frontend"}}, TLS: []networkingv1.IngressTLS{{SecretName: "tls"}}}}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: metav1.ObjectMeta{Name: "scale", Namespace: ns}, Spec: autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{Kind: "Deployment", Name: "frontend"}}}
	client := fake.NewClientset(cron, job, ingress, hpa)
	nodes := map[string]topologyNode{}
	edges := []topologyEdge{}
	warnings := addTopologyExtras(t.Context(), client, ns, []corev1.Pod{pod}, nodes, &edges)
	if len(warnings) != 0 {
		t.Fatal(warnings)
	}
	for _, want := range []topologyEdge{
		{From: nodeID("CronJob", ns, "nightly"), To: nodeID("Job", ns, "nightly-job"), Kind: "owns"},
		{From: nodeID("Job", ns, "nightly-job"), To: nodeID("Pod", ns, "worker"), Kind: "owns"},
		{From: nodeID("Pod", ns, "worker"), To: nodeID("Secret", ns, "credentials"), Kind: "uses"},
		{From: nodeID("Ingress", ns, "web"), To: nodeID("Service", ns, "frontend"), Kind: "routes"},
		{From: nodeID("HorizontalPodAutoscaler", ns, "scale"), To: nodeID("Deployment", ns, "frontend"), Kind: "scales"},
	} {
		found := false
		for _, edge := range edges {
			if edge == want {
				found = true
			}
		}
		if !found {
			t.Errorf("missing edge %+v", want)
		}
	}
	for _, action := range client.Actions() {
		if action.GetResource().Resource == "secrets" {
			t.Fatal("graph read secret contents")
		}
	}
	client.PrependReactor("list", "ingresses", func(ktesting.Action) (bool, runtime.Object, error) { return true, nil, errors.New("RBAC denied") })
	warnings = addTopologyExtras(t.Context(), client, ns, nil, map[string]topologyNode{}, &edges)
	if len(warnings) != 1 || !strings.Contains(warnings[0], "ingresses") {
		t.Fatal("permission failure hidden", warnings)
	}
}
