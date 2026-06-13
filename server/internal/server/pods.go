package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Server) handlePods(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	namespaces := splitQueryList(r.URL.Query()["namespace"])
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	type podRow struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Status    string `json:"status"`
		Restarts  int32  `json:"restarts"`
		Age       string `json:"age"`
		Node      string `json:"node"`
		Ready     string `json:"ready"`
		IP        string `json:"ip"`
	}
	rows := []podRow{}
	listNamespaces := namespaces
	if len(listNamespaces) == 0 {
		listNamespaces = []string{""}
	}
	for _, namespace := range listNamespaces {
		pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, pod := range pods.Items {
			var restarts int32
			ready := 0
			for _, status := range pod.Status.ContainerStatuses {
				restarts += status.RestartCount
				if status.Ready {
					ready++
				}
			}
			rows = append(rows, podRow{
				Name:      pod.Name,
				Namespace: pod.Namespace,
				Status:    string(pod.Status.Phase),
				Restarts:  restarts,
				Age:       time.Since(pod.CreationTimestamp.Time).Round(time.Second).String(),
				Node:      pod.Spec.NodeName,
				Ready:     strconvPair(ready, len(pod.Spec.Containers)),
				IP:        pod.Status.PodIP,
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handlePodDetail(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	type containerRow struct {
		Name       string            `json:"name"`
		Image      string            `json:"image"`
		Ready      bool              `json:"ready"`
		Restarts   int32             `json:"restarts"`
		State      string            `json:"state"`
		Ports      []int32           `json:"ports,omitempty"`
		Requests   map[string]string `json:"requests,omitempty"`
		Limits     map[string]string `json:"limits,omitempty"`
		PullPolicy string            `json:"pullPolicy,omitempty"`
	}
	type volumeRow struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	type tolerationRow struct {
		Key               string `json:"key,omitempty"`
		Value             string `json:"value,omitempty"`
		Operator          string `json:"operator,omitempty"`
		Effect            string `json:"effect,omitempty"`
		TolerationSeconds *int64 `json:"tolerationSeconds,omitempty"`
	}
	type ownerReferenceRow struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		UID        string `json:"uid,omitempty"`
		Controller bool   `json:"controller,omitempty"`
	}
	type conditionRow struct {
		Type    string `json:"type"`
		Status  string `json:"status"`
		Reason  string `json:"reason,omitempty"`
		Message string `json:"message,omitempty"`
	}
	statusByName := map[string]containerRow{}
	for _, status := range pod.Status.ContainerStatuses {
		state := "waiting"
		if status.State.Running != nil {
			state = "running"
		} else if status.State.Terminated != nil {
			state = "terminated"
		}
		statusByName[status.Name] = containerRow{
			Name: status.Name, Image: status.Image, Ready: status.Ready, Restarts: status.RestartCount, State: state,
		}
	}
	containers := make([]containerRow, 0, len(pod.Spec.Containers))
	for _, container := range pod.Spec.Containers {
		row, ok := statusByName[container.Name]
		if !ok {
			row = containerRow{Name: container.Name, Image: container.Image, State: "pending"}
		}
		row.PullPolicy = string(container.ImagePullPolicy)
		row.Requests = resourceListStrings(container.Resources.Requests)
		row.Limits = resourceListStrings(container.Resources.Limits)
		for _, port := range container.Ports {
			row.Ports = append(row.Ports, port.ContainerPort)
		}
		containers = append(containers, row)
	}
	initContainers := make([]containerRow, 0, len(pod.Spec.InitContainers))
	for _, container := range pod.Spec.InitContainers {
		row := containerRow{Name: container.Name, Image: container.Image, State: "init", PullPolicy: string(container.ImagePullPolicy), Requests: resourceListStrings(container.Resources.Requests), Limits: resourceListStrings(container.Resources.Limits)}
		for _, port := range container.Ports {
			row.Ports = append(row.Ports, port.ContainerPort)
		}
		initContainers = append(initContainers, row)
	}
	volumes := make([]volumeRow, 0, len(pod.Spec.Volumes))
	for _, volume := range pod.Spec.Volumes {
		volumes = append(volumes, volumeRow{Name: volume.Name, Type: podVolumeType(volume)})
	}
	tolerations := make([]tolerationRow, 0, len(pod.Spec.Tolerations))
	for _, toleration := range pod.Spec.Tolerations {
		tolerations = append(tolerations, tolerationRow{
			Key: toleration.Key, Value: toleration.Value, Operator: string(toleration.Operator), Effect: string(toleration.Effect), TolerationSeconds: toleration.TolerationSeconds,
		})
	}
	ownerReferences := make([]ownerReferenceRow, 0, len(pod.OwnerReferences))
	for _, owner := range pod.OwnerReferences {
		ownerReferences = append(ownerReferences, ownerReferenceRow{
			APIVersion: owner.APIVersion,
			Kind:       owner.Kind,
			Name:       owner.Name,
			UID:        string(owner.UID),
			Controller: owner.Controller != nil && *owner.Controller,
		})
	}
	podIPs := make([]string, 0, len(pod.Status.PodIPs))
	for _, ip := range pod.Status.PodIPs {
		podIPs = append(podIPs, ip.IP)
	}
	hostIPs := make([]string, 0, len(pod.Status.HostIPs))
	for _, ip := range pod.Status.HostIPs {
		hostIPs = append(hostIPs, ip.IP)
	}
	conditions := make([]conditionRow, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, conditionRow{
			Type: string(condition.Type), Status: string(condition.Status), Reason: condition.Reason, Message: condition.Message,
		})
	}
	var restarts int32
	ready := 0
	for _, status := range pod.Status.ContainerStatuses {
		restarts += status.RestartCount
		if status.Ready {
			ready++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":               pod.Name,
		"namespace":          pod.Namespace,
		"uid":                string(pod.UID),
		"status":             string(pod.Status.Phase),
		"ready":              strconvPair(ready, len(pod.Spec.Containers)),
		"restarts":           restarts,
		"age":                time.Since(pod.CreationTimestamp.Time).Round(time.Second).String(),
		"createdAt":          pod.CreationTimestamp.Time.Format(time.RFC3339),
		"node":               pod.Spec.NodeName,
		"podIP":              pod.Status.PodIP,
		"podIPs":             podIPs,
		"hostIP":             pod.Status.HostIP,
		"hostIPs":            hostIPs,
		"serviceAccountName": pod.Spec.ServiceAccountName,
		"qosClass":           string(pod.Status.QOSClass),
		"priority":           pod.Spec.Priority,
		"labels":             pod.Labels,
		"annotations":        pod.Annotations,
		"ownerReferences":    ownerReferences,
		"containers":         containers,
		"initContainers":     initContainers,
		"volumes":            volumes,
		"tolerations":        tolerations,
		"conditions":         conditions,
	})
}

func resourceListStrings(values corev1.ResourceList) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[string(key)] = value.String()
	}
	return result
}

func podVolumeType(volume corev1.Volume) string {
	switch {
	case volume.ConfigMap != nil:
		return "ConfigMap"
	case volume.Secret != nil:
		return "Secret"
	case volume.PersistentVolumeClaim != nil:
		return "PersistentVolumeClaim"
	case volume.EmptyDir != nil:
		return "EmptyDir"
	case volume.Projected != nil:
		return "Projected"
	case volume.DownwardAPI != nil:
		return "DownwardAPI"
	case volume.HostPath != nil:
		return "HostPath"
	case volume.CSI != nil:
		return "CSI"
	case volume.Ephemeral != nil:
		return "Ephemeral"
	default:
		return "Other"
	}
}
