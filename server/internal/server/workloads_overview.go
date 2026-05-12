package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// workloadsOverview is the cluster-wide rollup the dashboard renders. Counts
// are computed from typed list calls; we cap total pod/deployment work by
// using Limit so a runaway cluster doesn't tip the request over.
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

	// Prefer the informer-backed listers when their caches are synced. On the
	// very first request after server boot the cache may not be ready in time
	// — fall back to a direct typed list call so we never block the user.
	set := s.informers.Get(id, client)
	useInformer := set.WaitForSync(ctx)

	var (
		pods         []*corev1.Pod
		podsDirect   []corev1.Pod
		deployments  []*appsv1.Deployment
		depsDirect   []appsv1.Deployment
		statefulSets []*appsv1.StatefulSet
		ssDirect     []appsv1.StatefulSet
		daemonSets   []*appsv1.DaemonSet
		dsDirect     []appsv1.DaemonSet
		jobs         []*batchv1.Job
		jobsDirect   []batchv1.Job
	)

	if useInformer {
		pods, _ = set.Pods.List(labels.Everything())
		deployments, _ = set.Deployments.List(labels.Everything())
		statefulSets, _ = set.StatefulSets.List(labels.Everything())
		daemonSets, _ = set.DaemonSets.List(labels.Everything())
		jobs, _ = set.Jobs.List(labels.Everything())
	} else {
		if pl, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{Limit: 1000}); err == nil {
			podsDirect = pl.Items
		}
		if dl, err := client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			depsDirect = dl.Items
		}
		if sl, err := client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			ssDirect = sl.Items
		}
		if dl, err := client.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			dsDirect = dl.Items
		}
		if jl, err := client.BatchV1().Jobs("").List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			jobsDirect = jl.Items
		}
	}

	walkPod := func(pod corev1.Pod) {
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
	if useInformer {
		for _, p := range pods {
			walkPod(*p)
		}
	} else {
		for _, p := range podsDirect {
			walkPod(p)
		}
	}

	walkDeployment := func(d appsv1.Deployment) {
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
	if useInformer {
		for _, d := range deployments {
			walkDeployment(*d)
		}
	} else {
		for _, d := range depsDirect {
			walkDeployment(d)
		}
	}

	walkStatefulSet := func(s appsv1.StatefulSet) {
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
	if useInformer {
		for _, ss := range statefulSets {
			walkStatefulSet(*ss)
		}
	} else {
		for _, ss := range ssDirect {
			walkStatefulSet(ss)
		}
	}

	walkDaemonSet := func(d appsv1.DaemonSet) {
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
	if useInformer {
		for _, ds := range daemonSets {
			walkDaemonSet(*ds)
		}
	} else {
		for _, ds := range dsDirect {
			walkDaemonSet(ds)
		}
	}

	walkJob := func(j batchv1.Job) {
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
	if useInformer {
		for _, j := range jobs {
			walkJob(*j)
		}
	} else {
		for _, j := range jobsDirect {
			walkJob(j)
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
