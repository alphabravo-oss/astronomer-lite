package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request, id string) {
	dynamicClient, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	typedClient, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	nodeMetrics, err := dynamicClient.Resource(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"available": false,
			"error":     err.Error(),
			"nodes":     []metricsRow{},
			"pods":      []metricsRow{},
		})
		return
	}
	podMetrics, err := dynamicClient.Resource(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"available": false,
			"error":     err.Error(),
			"nodes":     []metricsRow{},
			"pods":      []metricsRow{},
		})
		return
	}

	nodes, err := typedClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	capacityByNode := map[string]struct {
		cpuMilli   int64
		memoryByte int64
	}{}
	for _, node := range nodes.Items {
		capacityByNode[node.Name] = struct {
			cpuMilli   int64
			memoryByte int64
		}{
			cpuMilli:   node.Status.Allocatable.Cpu().MilliValue(),
			memoryByte: node.Status.Allocatable.Memory().Value(),
		}
	}

	nodeRows := make([]metricsRow, 0, len(nodeMetrics.Items))
	var totalCPU int64
	var totalMemory int64
	var totalCapacityCPU int64
	var totalCapacityMemory int64
	for _, item := range nodeMetrics.Items {
		cpu := metricQuantityMilli(item.Object, "usage", "cpu")
		memory := metricQuantityBytes(item.Object, "usage", "memory")
		capacity := capacityByNode[item.GetName()]
		totalCPU += cpu
		totalMemory += memory
		totalCapacityCPU += capacity.cpuMilli
		totalCapacityMemory += capacity.memoryByte
		nodeRows = append(nodeRows, metricsRow{
			Name:              item.GetName(),
			CPU:               cpu,
			Memory:            memory,
			CPUPercent:        percent(cpu, capacity.cpuMilli),
			MemoryPercent:     percent(memory, capacity.memoryByte),
			Window:            stringFromMap(item.Object, "window"),
			Timestamp:         stringFromMap(item.Object, "timestamp"),
			CapacityCPU:       capacity.cpuMilli,
			CapacityMemory:    capacity.memoryByte,
			Namespace:         item.GetNamespace(),
			ContainerCount:    0,
			RegardingResource: "node",
		})
	}

	podRows := make([]metricsRow, 0, len(podMetrics.Items))
	for _, item := range podMetrics.Items {
		containers, _, _ := unstructured.NestedSlice(item.Object, "containers")
		var cpu int64
		var memory int64
		for _, container := range containers {
			containerMap, ok := container.(map[string]any)
			if !ok {
				continue
			}
			cpu += metricQuantityMilli(containerMap, "usage", "cpu")
			memory += metricQuantityBytes(containerMap, "usage", "memory")
		}
		podRows = append(podRows, metricsRow{
			Name:              item.GetName(),
			Namespace:         item.GetNamespace(),
			CPU:               cpu,
			Memory:            memory,
			Window:            stringFromMap(item.Object, "window"),
			Timestamp:         stringFromMap(item.Object, "timestamp"),
			ContainerCount:    int64(len(containers)),
			RegardingResource: "pod",
		})
	}
	sort.Slice(nodeRows, func(i, j int) bool {
		if nodeRows[i].CPU == nodeRows[j].CPU {
			return nodeRows[i].Name < nodeRows[j].Name
		}
		return nodeRows[i].CPU > nodeRows[j].CPU
	})
	sort.Slice(podRows, func(i, j int) bool {
		if podRows[i].CPU == podRows[j].CPU {
			return podRows[i].Name < podRows[j].Name
		}
		return podRows[i].CPU > podRows[j].CPU
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"available":           true,
		"nodeCount":           len(nodeRows),
		"podCount":            len(podRows),
		"totalCPU":            totalCPU,
		"totalMemory":         totalMemory,
		"totalCapacityCPU":    totalCapacityCPU,
		"totalCapacityMemory": totalCapacityMemory,
		"cpuPercent":          percent(totalCPU, totalCapacityCPU),
		"memoryPercent":       percent(totalMemory, totalCapacityMemory),
		"nodes":               nodeRows,
		"pods":                podRows,
	})
}

type metricsRow struct {
	Name              string  `json:"name"`
	Namespace         string  `json:"namespace,omitempty"`
	CPU               int64   `json:"cpu"`
	Memory            int64   `json:"memory"`
	CPUPercent        float64 `json:"cpuPercent,omitempty"`
	MemoryPercent     float64 `json:"memoryPercent,omitempty"`
	CapacityCPU       int64   `json:"capacityCPU,omitempty"`
	CapacityMemory    int64   `json:"capacityMemory,omitempty"`
	Window            string  `json:"window,omitempty"`
	Timestamp         string  `json:"timestamp,omitempty"`
	ContainerCount    int64   `json:"containerCount,omitempty"`
	RegardingResource string  `json:"regardingResource"`
}

func metricQuantityMilli(object map[string]any, fields ...string) int64 {
	value, ok, _ := unstructured.NestedString(object, fields...)
	if !ok || value == "" {
		return 0
	}
	quantity, err := resource.ParseQuantity(value)
	if err != nil {
		return 0
	}
	return quantity.MilliValue()
}

func metricQuantityBytes(object map[string]any, fields ...string) int64 {
	value, ok, _ := unstructured.NestedString(object, fields...)
	if !ok || value == "" {
		return 0
	}
	quantity, err := resource.ParseQuantity(value)
	if err != nil {
		return 0
	}
	return quantity.Value()
}

func percent(value int64, capacity int64) float64 {
	if capacity <= 0 {
		return 0
	}
	return float64(value) / float64(capacity) * 100
}
