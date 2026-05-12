package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/types"
)

type topologyNode struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Status    string `json:"status,omitempty"`
}

type topologyEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Relationship: "owns" | "selects" | "mounts"
	Kind string `json:"kind"`
}

type topologyGraph struct {
	Namespace string         `json:"namespace"`
	Nodes     []topologyNode `json:"nodes"`
	Edges     []topologyEdge `json:"edges"`
}

func nodeID(kind, namespace, name string) string {
	return kind + "/" + namespace + "/" + name
}

func (s *Server) handleTopology(w http.ResponseWriter, r *http.Request, id string) {
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if namespace == "" {
		writeError(w, http.StatusBadRequest, errMissingNamespace)
		return
	}
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	nodes := map[string]topologyNode{}
	edges := []topologyEdge{}

	addNode := func(n topologyNode) {
		if _, ok := nodes[n.ID]; !ok {
			nodes[n.ID] = n
		}
	}

	// Build a UID → (kind, name) index so ownerReferences can be resolved
	// without listing each parent type separately.
	uidIndex := map[types.UID]topologyNode{}

	// Pull from informer-backed listers when synced; fall back to typed list
	// calls otherwise. The lister returns *T pointers per the client-go API;
	// the typed list returns []T values. We materialise both into shared
	// []*Pod-style slices so the rest of the code is identical.
	set := s.informers.Get(id, client)
	useInformer := set.WaitForSync(ctx)

	var (
		deps        []appsv1.Deployment
		rss         []appsv1.ReplicaSet
		statefulSet []appsv1.StatefulSet
		daemonSet   []appsv1.DaemonSet
		pods        []corev1.Pod
		services    []corev1.Service
	)

	if useInformer {
		if list, err := set.Deployments.Deployments(namespace).List(labels.Everything()); err == nil {
			for _, d := range list {
				deps = append(deps, *d)
			}
		}
		if list, err := set.ReplicaSets.ReplicaSets(namespace).List(labels.Everything()); err == nil {
			for _, rs := range list {
				rss = append(rss, *rs)
			}
		}
		if list, err := set.StatefulSets.StatefulSets(namespace).List(labels.Everything()); err == nil {
			for _, ss := range list {
				statefulSet = append(statefulSet, *ss)
			}
		}
		if list, err := set.DaemonSets.DaemonSets(namespace).List(labels.Everything()); err == nil {
			for _, ds := range list {
				daemonSet = append(daemonSet, *ds)
			}
		}
		if list, err := set.Pods.Pods(namespace).List(labels.Everything()); err == nil {
			for _, p := range list {
				pods = append(pods, *p)
			}
		}
		if list, err := set.Services.Services(namespace).List(labels.Everything()); err == nil {
			for _, svc := range list {
				services = append(services, *svc)
			}
		}
	} else {
		if list, err := client.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			deps = list.Items
		}
		if list, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			rss = list.Items
		}
		if list, err := client.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			statefulSet = list.Items
		}
		if list, err := client.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			daemonSet = list.Items
		}
		if list, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1000}); err == nil {
			pods = list.Items
		}
		if list, err := client.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{Limit: 500}); err == nil {
			services = list.Items
		}
	}

	for _, d := range deps {
		n := topologyNode{ID: nodeID("Deployment", d.Namespace, d.Name), Kind: "Deployment", Namespace: d.Namespace, Name: d.Name, Status: deploymentStatus(d.Status.ReadyReplicas, d.Status.Replicas)}
		addNode(n)
		uidIndex[d.UID] = n
	}
	for _, rs := range rss {
		n := topologyNode{ID: nodeID("ReplicaSet", rs.Namespace, rs.Name), Kind: "ReplicaSet", Namespace: rs.Namespace, Name: rs.Name, Status: deploymentStatus(rs.Status.ReadyReplicas, rs.Status.Replicas)}
		addNode(n)
		uidIndex[rs.UID] = n
		for _, ref := range rs.OwnerReferences {
			if parent, ok := uidIndex[ref.UID]; ok {
				edges = append(edges, topologyEdge{From: parent.ID, To: n.ID, Kind: "owns"})
			}
		}
	}
	for _, ss := range statefulSet {
		n := topologyNode{ID: nodeID("StatefulSet", ss.Namespace, ss.Name), Kind: "StatefulSet", Namespace: ss.Namespace, Name: ss.Name, Status: deploymentStatus(ss.Status.ReadyReplicas, ss.Status.Replicas)}
		addNode(n)
		uidIndex[ss.UID] = n
	}
	for _, ds := range daemonSet {
		n := topologyNode{ID: nodeID("DaemonSet", ds.Namespace, ds.Name), Kind: "DaemonSet", Namespace: ds.Namespace, Name: ds.Name, Status: deploymentStatus(ds.Status.NumberReady, ds.Status.DesiredNumberScheduled)}
		addNode(n)
		uidIndex[ds.UID] = n
	}

	for _, pod := range pods {
		pn := topologyNode{ID: nodeID("Pod", pod.Namespace, pod.Name), Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name, Status: podRollupStatus(pod)}
		addNode(pn)
		uidIndex[pod.UID] = pn
		for _, ref := range pod.OwnerReferences {
			if parent, ok := uidIndex[ref.UID]; ok {
				edges = append(edges, topologyEdge{From: parent.ID, To: pn.ID, Kind: "owns"})
			}
		}
		for _, vol := range pod.Spec.Volumes {
			if vol.ConfigMap != nil {
				cmID := nodeID("ConfigMap", pod.Namespace, vol.ConfigMap.Name)
				addNode(topologyNode{ID: cmID, Kind: "ConfigMap", Namespace: pod.Namespace, Name: vol.ConfigMap.Name})
				edges = append(edges, topologyEdge{From: pn.ID, To: cmID, Kind: "mounts"})
			}
			if vol.Secret != nil {
				secID := nodeID("Secret", pod.Namespace, vol.Secret.SecretName)
				addNode(topologyNode{ID: secID, Kind: "Secret", Namespace: pod.Namespace, Name: vol.Secret.SecretName})
				edges = append(edges, topologyEdge{From: pn.ID, To: secID, Kind: "mounts"})
			}
			if vol.PersistentVolumeClaim != nil {
				pvcID := nodeID("PersistentVolumeClaim", pod.Namespace, vol.PersistentVolumeClaim.ClaimName)
				addNode(topologyNode{ID: pvcID, Kind: "PersistentVolumeClaim", Namespace: pod.Namespace, Name: vol.PersistentVolumeClaim.ClaimName})
				edges = append(edges, topologyEdge{From: pn.ID, To: pvcID, Kind: "mounts"})
			}
		}
	}

	for _, svc := range services {
		svcID := nodeID("Service", svc.Namespace, svc.Name)
		addNode(topologyNode{ID: svcID, Kind: "Service", Namespace: svc.Namespace, Name: svc.Name})
		if len(svc.Spec.Selector) == 0 || len(pods) == 0 {
			continue
		}
		selector := labels.SelectorFromSet(svc.Spec.Selector)
		for _, pod := range pods {
			if selector.Matches(labels.Set(pod.Labels)) {
				edges = append(edges, topologyEdge{From: svcID, To: nodeID("Pod", pod.Namespace, pod.Name), Kind: "selects"})
			}
		}
	}

	out := topologyGraph{Namespace: namespace, Nodes: make([]topologyNode, 0, len(nodes)), Edges: edges}
	for _, n := range nodes {
		out.Nodes = append(out.Nodes, n)
	}
	writeJSON(w, http.StatusOK, out)
}

func deploymentStatus(ready, total int32) string {
	if total == 0 {
		return "healthy"
	}
	if ready == total {
		return "healthy"
	}
	if ready == 0 {
		return "failing"
	}
	return "degraded"
}

var errMissingNamespace = httpErr("namespace query parameter is required")

type httpErr string

func (e httpErr) Error() string { return string(e) }

var _ corev1.PodList // keep corev1 import in case future fields are inspected
