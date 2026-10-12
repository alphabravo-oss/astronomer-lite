package server

import (
	"context"
	"fmt"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

func addTopologyExtras(ctx context.Context, client kubernetes.Interface, namespace string, pods []corev1.Pod, nodes map[string]topologyNode, edges *[]topologyEdge) []string {
	warnings := []string{}
	report := func(kind string, err error, continuation string) {
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", kind, err))
		} else if continuation != "" {
			warnings = append(warnings, kind+": inventory limited; use the resource browser for more results")
		}
	}
	add := func(kind, name string) string {
		id := nodeID(kind, namespace, name)
		if _, ok := nodes[id]; !ok {
			nodes[id] = topologyNode{ID: id, Kind: kind, Namespace: namespace, Name: name}
		}
		return id
	}
	link := func(from, kind, name, relation string) {
		if name != "" {
			*edges = append(*edges, topologyEdge{From: from, To: add(kind, name), Kind: relation})
		}
	}
	owners := map[types.UID]string{}
	crons, err := client.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{Limit: 500})
	if err != nil {
		report("cronjobs", err, "")
	} else {
		report("cronjobs", nil, crons.Continue)
		for _, cron := range crons.Items {
			owners[cron.UID] = add("CronJob", cron.Name)
		}
	}
	jobs, err := client.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{Limit: 500})
	if err != nil {
		report("jobs", err, "")
	} else {
		report("jobs", nil, jobs.Continue)
		for _, job := range jobs.Items {
			id := add("Job", job.Name)
			owners[job.UID] = id
			for _, owner := range job.OwnerReferences {
				if parent := owners[owner.UID]; parent != "" {
					*edges = append(*edges, topologyEdge{From: parent, To: id, Kind: "owns"})
				}
			}
		}
	}
	for _, pod := range pods {
		id := nodeID("Pod", namespace, pod.Name)
		for _, owner := range pod.OwnerReferences {
			if parent := owners[owner.UID]; parent != "" {
				*edges = append(*edges, topologyEdge{From: parent, To: id, Kind: "owns"})
			}
		}
		link(id, "ServiceAccount", pod.Spec.ServiceAccountName, "uses")
		containers := append([]corev1.Container{}, pod.Spec.Containers...)
		containers = append(containers, pod.Spec.InitContainers...)
		for _, container := range containers {
			for _, env := range container.EnvFrom {
				if env.ConfigMapRef != nil {
					link(id, "ConfigMap", env.ConfigMapRef.Name, "uses")
				}
				if env.SecretRef != nil {
					link(id, "Secret", env.SecretRef.Name, "uses")
				}
			}
			for _, env := range container.Env {
				if env.ValueFrom == nil {
					continue
				}
				if env.ValueFrom.ConfigMapKeyRef != nil {
					link(id, "ConfigMap", env.ValueFrom.ConfigMapKeyRef.Name, "uses")
				}
				if env.ValueFrom.SecretKeyRef != nil {
					link(id, "Secret", env.ValueFrom.SecretKeyRef.Name, "uses")
				}
			}
		}
		for _, volume := range pod.Spec.Volumes {
			if volume.Projected == nil {
				continue
			}
			for _, source := range volume.Projected.Sources {
				if source.ConfigMap != nil {
					link(id, "ConfigMap", source.ConfigMap.Name, "mounts")
				}
				if source.Secret != nil {
					link(id, "Secret", source.Secret.Name, "mounts")
				}
			}
		}
	}
	ingresses, err := client.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{Limit: 500})
	if err != nil {
		report("ingresses", err, "")
	} else {
		report("ingresses", nil, ingresses.Continue)
		for _, ingress := range ingresses.Items {
			id := add("Ingress", ingress.Name)
			if ingress.Spec.DefaultBackend != nil && ingress.Spec.DefaultBackend.Service != nil {
				link(id, "Service", ingress.Spec.DefaultBackend.Service.Name, "routes")
			}
			for _, rule := range ingress.Spec.Rules {
				if rule.HTTP == nil {
					continue
				}
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil {
						link(id, "Service", path.Backend.Service.Name, "routes")
					}
				}
			}
			for _, tls := range ingress.Spec.TLS {
				link(id, "Secret", tls.SecretName, "uses")
			}
		}
	}
	autoscalers, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{Limit: 500})
	if err != nil {
		report("horizontalpodautoscalers", err, "")
	} else {
		report("horizontalpodautoscalers", nil, autoscalers.Continue)
		for _, hpa := range autoscalers.Items {
			id := add("HorizontalPodAutoscaler", hpa.Name)
			target := hpa.Spec.ScaleTargetRef
			link(id, target.Kind, target.Name, "scales")
		}
	}
	return warnings
}
