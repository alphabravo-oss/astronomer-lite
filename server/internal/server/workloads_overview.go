package server

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/cache"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
)

const (
	statusHealthy   = "healthy"
	statusDegraded  = "degraded"
	statusFailing   = "failing"
	statusSucceeded = "succeeded"
)

type workloadsOverview struct {
	Pods         workloadCounts         `json:"pods"`
	Deployments  workloadCounts         `json:"deployments"`
	StatefulSets workloadCounts         `json:"statefulsets"`
	DaemonSets   workloadCounts         `json:"daemonsets"`
	Jobs         workloadCounts         `json:"jobs"`
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

	set := s.informers.Get(id, client)
	pods, deployments, statefulSets, daemonSets, jobs := materializeWorkloads(ctx, set, client)

	for _, pod := range pods {
		out.Pods.Total++
		switch podRollupStatus(pod) {
		case statusSucceeded:
			out.Pods.Succeeded++
		case statusFailing:
			out.Pods.Failing++
			out.Failing = appendFailing(out.Failing, "Pod", pod.Namespace, pod.Name, failingPodReason(pod))
		case statusDegraded:
			out.Pods.Degraded++
		default:
			out.Pods.Healthy++
		}
	}
	for _, d := range deployments {
		out.Deployments.Total++
		switch replicaStatus(d.Status.ReadyReplicas, deploymentDesired(d.Spec.Replicas)) {
		case statusFailing:
			out.Deployments.Failing++
			out.Failing = appendFailing(out.Failing, "Deployment", d.Namespace, d.Name, "no ready replicas")
		case statusDegraded:
			out.Deployments.Degraded++
		default:
			out.Deployments.Healthy++
		}
	}
	for _, sts := range statefulSets {
		out.StatefulSets.Total++
		switch replicaStatus(sts.Status.ReadyReplicas, deploymentDesired(sts.Spec.Replicas)) {
		case statusFailing:
			out.StatefulSets.Failing++
			out.Failing = appendFailing(out.Failing, "StatefulSet", sts.Namespace, sts.Name, "no ready replicas")
		case statusDegraded:
			out.StatefulSets.Degraded++
		default:
			out.StatefulSets.Healthy++
		}
	}
	for _, daemon := range daemonSets {
		out.DaemonSets.Total++
		switch replicaStatus(daemon.Status.NumberReady, daemon.Status.DesiredNumberScheduled) {
		case statusFailing:
			out.DaemonSets.Failing++
			out.Failing = appendFailing(out.Failing, "DaemonSet", daemon.Namespace, daemon.Name, "no ready pods")
		case statusDegraded:
			out.DaemonSets.Degraded++
		default:
			out.DaemonSets.Healthy++
		}
	}
	for _, job := range jobs {
		out.Jobs.Total++
		switch {
		case job.Status.Succeeded > 0:
			out.Jobs.Succeeded++
		case job.Status.Failed > 0:
			out.Jobs.Failing++
			out.Failing = appendFailing(out.Failing, "Job", job.Namespace, job.Name, "job has failures")
		default:
			out.Jobs.Healthy++
		}
	}

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

// materializeWorkloads returns pointer-slices of pods, deployments,
// statefulsets, daemonsets, and jobs. Prefers informer caches when synced;
// otherwise fans out parallel List calls so callers don't pay 5 sequential
// round-trips. Returning []*T (rather than []T) avoids an O(n) per-pod copy
// on the informer path, where shared listers already hand back pointers.
func materializeWorkloads(ctx context.Context, set *cache.InformerSet, client *kubernetes.Clientset) (
	pods []*corev1.Pod,
	deps []*appsv1.Deployment,
	ss []*appsv1.StatefulSet,
	ds []*appsv1.DaemonSet,
	jobs []*batchv1.Job,
) {
	if set.WaitForSync(ctx) {
		pods, _ = set.Pods.List(labels.Everything())
		deps, _ = set.Deployments.List(labels.Everything())
		ss, _ = set.StatefulSets.List(labels.Everything())
		ds, _ = set.DaemonSets.List(labels.Everything())
		jobs, _ = set.Jobs.List(labels.Everything())
		return
	}
	var wg sync.WaitGroup
	wg.Add(5)
	go func() {
		defer wg.Done()
		if pl, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{Limit: 1000}); err == nil {
			pods = pointerSlice(pl.Items)
		}
	}()
	go func() {
		defer wg.Done()
		if dl, err := client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			deps = pointerSlice(dl.Items)
		}
	}()
	go func() {
		defer wg.Done()
		if sl, err := client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			ss = pointerSlice(sl.Items)
		}
	}()
	go func() {
		defer wg.Done()
		if dl, err := client.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			ds = pointerSlice(dl.Items)
		}
	}()
	go func() {
		defer wg.Done()
		if jl, err := client.BatchV1().Jobs("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			jobs = pointerSlice(jl.Items)
		}
	}()
	wg.Wait()
	return
}

func pointerSlice[T any](items []T) []*T {
	out := make([]*T, len(items))
	for i := range items {
		out[i] = &items[i]
	}
	return out
}

func deploymentDesired(replicas *int32) int32 {
	if replicas == nil {
		return 1
	}
	return *replicas
}

func replicaStatus(ready, desired int32) string {
	if desired == 0 && ready == 0 {
		return statusHealthy
	}
	if ready == desired {
		return statusHealthy
	}
	if ready == 0 {
		return statusFailing
	}
	return statusDegraded
}

func appendFailing(rows []failingWorkloadEntry, kind, namespace, name, reason string) []failingWorkloadEntry {
	if len(rows) >= 20 {
		return rows
	}
	return append(rows, failingWorkloadEntry{Kind: kind, Namespace: namespace, Name: name, Reason: reason})
}

func podRollupStatus(pod *corev1.Pod) string {
	switch pod.Status.Phase {
	case corev1.PodSucceeded:
		return statusSucceeded
	case corev1.PodFailed:
		return statusFailing
	case corev1.PodRunning:
		for _, c := range pod.Status.ContainerStatuses {
			if !c.Ready {
				if c.State.Waiting != nil && c.State.Waiting.Reason == "CrashLoopBackOff" {
					return statusFailing
				}
				return statusDegraded
			}
		}
		return statusHealthy
	default:
		return statusDegraded
	}
}

func failingPodReason(pod *corev1.Pod) string {
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
