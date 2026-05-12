package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// workloadsOverview is the cluster-wide rollup the dashboard renders. Counts
// are computed from typed list calls; we cap total pod/deployment work by
// using Limit so a runaway cluster doesn't tip the request over.
type workloadsOverview struct {
	Pods         workloadCounts        `json:"pods"`
	Deployments  workloadCounts        `json:"deployments"`
	StatefulSets workloadCounts        `json:"statefulsets"`
	DaemonSets   workloadCounts        `json:"daemonsets"`
	Jobs         workloadCounts        `json:"jobs"`
	Failing      []failingWorkloadEntry `json:"failing"`
}

type workloadCounts struct {
	Healthy   int `json:"healthy"`
	Degraded  int `json:"degraded"`
	Failing   int `json:"failing"`
	Succeeded int `json:"succeeded,omitempty"`
	Total     int `json:"total"`
}

type failingWorkloadEntry struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Reason    string `json:"reason"`
}

func (s *Server) handleWorkloadsOverview(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	out := workloadsOverview{Failing: []failingWorkloadEntry{}}

	if pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{Limit: 1000}); err == nil {
		for _, pod := range pods.Items {
			out.Pods.Total++
			switch podRollupStatus(pod) {
			case "succeeded":
				out.Pods.Succeeded++
			case "failing":
				out.Pods.Failing++
				if len(out.Failing) < 20 {
					out.Failing = append(out.Failing, failingWorkloadEntry{Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name, Reason: failingPodReason(pod)})
				}
			case "degraded":
				out.Pods.Degraded++
			default:
				out.Pods.Healthy++
			}
		}
	}

	if deps, err := client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
		for _, d := range deps.Items {
			out.Deployments.Total++
			desired := int32(1)
			if d.Spec.Replicas != nil {
				desired = *d.Spec.Replicas
			}
			ready := d.Status.ReadyReplicas
			switch {
			case desired == 0 && ready == 0:
				out.Deployments.Healthy++
			case ready == desired:
				out.Deployments.Healthy++
			case ready == 0:
				out.Deployments.Failing++
				if len(out.Failing) < 20 {
					out.Failing = append(out.Failing, failingWorkloadEntry{Kind: "Deployment", Namespace: d.Namespace, Name: d.Name, Reason: "no ready replicas"})
				}
			default:
				out.Deployments.Degraded++
			}
		}
	}

	if ss, err := client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
		for _, s := range ss.Items {
			out.StatefulSets.Total++
			desired := int32(1)
			if s.Spec.Replicas != nil {
				desired = *s.Spec.Replicas
			}
			ready := s.Status.ReadyReplicas
			switch {
			case desired == 0 && ready == 0:
				out.StatefulSets.Healthy++
			case ready == desired:
				out.StatefulSets.Healthy++
			case ready == 0:
				out.StatefulSets.Failing++
				if len(out.Failing) < 20 {
					out.Failing = append(out.Failing, failingWorkloadEntry{Kind: "StatefulSet", Namespace: s.Namespace, Name: s.Name, Reason: "no ready replicas"})
				}
			default:
				out.StatefulSets.Degraded++
			}
		}
	}

	if ds, err := client.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
		for _, d := range ds.Items {
			out.DaemonSets.Total++
			desired := d.Status.DesiredNumberScheduled
			ready := d.Status.NumberReady
			switch {
			case desired == ready:
				out.DaemonSets.Healthy++
			case ready == 0:
				out.DaemonSets.Failing++
				if len(out.Failing) < 20 {
					out.Failing = append(out.Failing, failingWorkloadEntry{Kind: "DaemonSet", Namespace: d.Namespace, Name: d.Name, Reason: "no ready pods"})
				}
			default:
				out.DaemonSets.Degraded++
			}
		}
	}

	if jobs, err := client.BatchV1().Jobs("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
		for _, j := range jobs.Items {
			out.Jobs.Total++
			switch {
			case j.Status.Succeeded > 0:
				out.Jobs.Succeeded++
			case j.Status.Failed > 0:
				out.Jobs.Failing++
				if len(out.Failing) < 20 {
					out.Failing = append(out.Failing, failingWorkloadEntry{Kind: "Job", Namespace: j.Namespace, Name: j.Name, Reason: "job has failures"})
				}
			default:
				out.Jobs.Healthy++
			}
		}
	}

	// Stable order so the table doesn't flicker between refreshes.
	sort.Slice(out.Failing, func(i, j int) bool {
		if out.Failing[i].Kind != out.Failing[j].Kind {
			return out.Failing[i].Kind < out.Failing[j].Kind
		}
		if out.Failing[i].Namespace != out.Failing[j].Namespace {
			return out.Failing[i].Namespace < out.Failing[j].Namespace
		}
		return out.Failing[i].Name < out.Failing[j].Name
	})

	writeJSON(w, http.StatusOK, out)
}

func podRollupStatus(pod corev1.Pod) string {
	switch pod.Status.Phase {
	case corev1.PodSucceeded:
		return "succeeded"
	case corev1.PodFailed:
		return "failing"
	case corev1.PodRunning:
		// "Running" but with a container in CrashLoopBackOff / not ready is
		// degraded territory.
		for _, c := range pod.Status.ContainerStatuses {
			if !c.Ready {
				if c.State.Waiting != nil && c.State.Waiting.Reason == "CrashLoopBackOff" {
					return "failing"
				}
				return "degraded"
			}
		}
		return "healthy"
	default:
		return "degraded"
	}
}

func failingPodReason(pod corev1.Pod) string {
	if pod.Status.Phase == corev1.PodFailed {
		return string(pod.Status.Phase)
	}
	for _, c := range pod.Status.ContainerStatuses {
		if c.State.Waiting != nil && c.State.Waiting.Reason != "" {
			return c.State.Waiting.Reason
		}
		if c.State.Terminated != nil && c.State.Terminated.Reason != "" {
			return c.State.Terminated.Reason
		}
	}
	return string(pod.Status.Phase)
}
