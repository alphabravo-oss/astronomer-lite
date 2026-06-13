package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	k8syaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/yaml"
)

type resourceDefinition struct {
	Label      string
	GVR        schema.GroupVersionResource
	Namespaced bool
}

func resourceClientFor(client dynamic.Interface, def resourceDefinition, namespace string) dynamic.ResourceInterface {
	if def.Namespaced && namespace != "" {
		return client.Resource(def.GVR).Namespace(namespace)
	}
	return client.Resource(def.GVR)
}

var resourceDefinitions = map[string]resourceDefinition{
	"pods":                            {Label: "Pods", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}, Namespaced: true},
	"deployments":                     {Label: "Deployments", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, Namespaced: true},
	"statefulsets":                    {Label: "StatefulSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}, Namespaced: true},
	"daemonsets":                      {Label: "DaemonSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, Namespaced: true},
	"replicasets":                     {Label: "ReplicaSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "replicasets"}, Namespaced: true},
	"controllerrevisions":             {Label: "ControllerRevisions", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "controllerrevisions"}, Namespaced: true},
	"jobs":                            {Label: "Jobs", GVR: schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "jobs"}, Namespaced: true},
	"cronjobs":                        {Label: "CronJobs", GVR: schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "cronjobs"}, Namespaced: true},
	"services":                        {Label: "Services", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}, Namespaced: true},
	"endpointslices":                  {Label: "EndpointSlices", GVR: schema.GroupVersionResource{Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"}, Namespaced: true},
	"ingresses":                       {Label: "Ingresses", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, Namespaced: true},
	"ingressclasses":                  {Label: "IngressClasses", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingressclasses"}, Namespaced: false},
	"gateways":                        {Label: "Gateways", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gateways"}, Namespaced: true},
	"gatewayclasses":                  {Label: "GatewayClasses", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gatewayclasses"}, Namespaced: false},
	"httproutes":                      {Label: "HTTPRoutes", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "httproutes"}, Namespaced: true},
	"grpcroutes":                      {Label: "GRPCRoutes", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "grpcroutes"}, Namespaced: true},
	"referencegrants":                 {Label: "ReferenceGrants", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1beta1", Resource: "referencegrants"}, Namespaced: true},
	"backendtlspolicies":              {Label: "BackendTLSPolicies", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1alpha3", Resource: "backendtlspolicies"}, Namespaced: true},
	"xbackendtrafficpolicies":         {Label: "XBackendTrafficPolicies", GVR: schema.GroupVersionResource{Group: "gateway.networking.x-k8s.io", Version: "v1alpha1", Resource: "xbackendtrafficpolicies"}, Namespaced: true},
	"networkpolicies":                 {Label: "NetworkPolicies", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, Namespaced: true},
	"horizontalpodautoscalers":        {Label: "HorizontalPodAutoscalers", GVR: schema.GroupVersionResource{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"}, Namespaced: true},
	"persistentvolumes":               {Label: "PersistentVolumes", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumes"}, Namespaced: false},
	"persistentvolumeclaims":          {Label: "PersistentVolumeClaims", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"}, Namespaced: true},
	"storageclasses":                  {Label: "StorageClasses", GVR: schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}, Namespaced: false},
	"configmaps":                      {Label: "ConfigMaps", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}, Namespaced: true},
	"secrets":                         {Label: "Secrets", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}, Namespaced: true},
	"serviceaccounts":                 {Label: "ServiceAccounts", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "serviceaccounts"}, Namespaced: true},
	"leases":                          {Label: "Leases", GVR: schema.GroupVersionResource{Group: "coordination.k8s.io", Version: "v1", Resource: "leases"}, Namespaced: true},
	"resourcequotas":                  {Label: "ResourceQuotas", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "resourcequotas"}, Namespaced: true},
	"limitranges":                     {Label: "LimitRanges", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "limitranges"}, Namespaced: true},
	"roles":                           {Label: "Roles", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, Namespaced: true},
	"rolebindings":                    {Label: "RoleBindings", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, Namespaced: true},
	"clusterroles":                    {Label: "ClusterRoles", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, Namespaced: false},
	"clusterrolebindings":             {Label: "ClusterRoleBindings", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, Namespaced: false},
	"priorityclasses":                 {Label: "PriorityClasses", GVR: schema.GroupVersionResource{Group: "scheduling.k8s.io", Version: "v1", Resource: "priorityclasses"}, Namespaced: false},
	"runtimeclasses":                  {Label: "RuntimeClasses", GVR: schema.GroupVersionResource{Group: "node.k8s.io", Version: "v1", Resource: "runtimeclasses"}, Namespaced: false},
	"mutatingwebhookconfigurations":   {Label: "MutatingWebhookConfigurations", GVR: schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"}, Namespaced: false},
	"validatingwebhookconfigurations": {Label: "ValidatingWebhookConfigurations", GVR: schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"}, Namespaced: false},
	"nodes":                           {Label: "Nodes", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}, Namespaced: false},
	"namespaces":                      {Label: "Namespaces", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "namespaces"}, Namespaced: false},
	"events":                          {Label: "Events", GVR: schema.GroupVersionResource{Group: "events.k8s.io", Version: "v1", Resource: "events"}, Namespaced: true},
	"crds":                            {Label: "CustomResourceDefinitions", GVR: schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}, Namespaced: false},
	"endpoints":                       {Label: "Endpoints", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "endpoints"}, Namespaced: true},
	"poddisruptionbudgets":            {Label: "PodDisruptionBudgets", GVR: schema.GroupVersionResource{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"}, Namespaced: true},
	"verticalpodautoscalers":          {Label: "VerticalPodAutoscalers", GVR: schema.GroupVersionResource{Group: "autoscaling.k8s.io", Version: "v1", Resource: "verticalpodautoscalers"}, Namespaced: true},
	"jobsets":                         {Label: "JobSets", GVR: schema.GroupVersionResource{Group: "jobset.x-k8s.io", Version: "v1alpha2", Resource: "jobsets"}, Namespaced: true},
}

type resourceOwnerRef struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid,omitempty"`
	Controller bool   `json:"controller,omitempty"`
}

func (s *Server) handleResourceList(w http.ResponseWriter, r *http.Request, id string, resource string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	labelSelector := r.URL.Query().Get("labelSelector")
	fieldSelector := r.URL.Query().Get("fieldSelector")
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	type resourceRow struct {
		Name            string             `json:"name"`
		Namespace       string             `json:"namespace,omitempty"`
		Kind            string             `json:"kind"`
		APIVersion      string             `json:"apiVersion"`
		Status          string             `json:"status,omitempty"`
		Age             string             `json:"age"`
		OwnerReferences []resourceOwnerRef `json:"ownerReferences,omitempty"`
	}
	rows := []resourceRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{LabelSelector: labelSelector, FieldSelector: fieldSelector})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, resourceRow{
				Name:            item.GetName(),
				Namespace:       item.GetNamespace(),
				Kind:            item.GetKind(),
				APIVersion:      item.GetAPIVersion(),
				Status:          resourceStatus(item),
				Age:             time.Since(item.GetCreationTimestamp().Time).Round(time.Second).String(),
				OwnerReferences: resourceOwnerRefs(item.GetOwnerReferences()),
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":   resource,
		"label":      def.Label,
		"namespaced": def.Namespaced,
		"items":      rows,
	})
}

func (s *Server) handleGVRList(w http.ResponseWriter, r *http.Request, id string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceList(w, r, id, def, def.GVR.Resource)
}

func (s *Server) handleGVRDetail(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceDetail(w, r, id, def, namespace, name, "")
}

func (s *Server) handleGVRApply(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceApply(w, r, id, def, namespace, name, "")
}

func (s *Server) handleGVRDelete(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceDelete(w, r, id, def, namespace, name)
}

func (s *Server) handleGVRScale(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceScale(w, r, id, def, namespace, name)
}

func (s *Server) handleDynamicResourceList(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, resource string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	type resourceRow struct {
		Name            string             `json:"name"`
		Namespace       string             `json:"namespace,omitempty"`
		Kind            string             `json:"kind"`
		APIVersion      string             `json:"apiVersion"`
		Status          string             `json:"status,omitempty"`
		Age             string             `json:"age"`
		OwnerReferences []resourceOwnerRef `json:"ownerReferences,omitempty"`
	}
	rows := []resourceRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, resourceRow{
				Name:            item.GetName(),
				Namespace:       item.GetNamespace(),
				Kind:            item.GetKind(),
				APIVersion:      item.GetAPIVersion(),
				Status:          resourceStatus(item),
				Age:             time.Since(item.GetCreationTimestamp().Time).Round(time.Second).String(),
				OwnerReferences: resourceOwnerRefs(item.GetOwnerReferences()),
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":   resource,
		"label":      def.Label,
		"namespaced": def.Namespaced,
		"items":      rows,
	})
}

func resourceOwnerRefs(refs []metav1.OwnerReference) []resourceOwnerRef {
	rows := make([]resourceOwnerRef, 0, len(refs))
	for _, ref := range refs {
		rows = append(rows, resourceOwnerRef{
			APIVersion: ref.APIVersion,
			Kind:       ref.Kind,
			Name:       ref.Name,
			UID:        string(ref.UID),
			Controller: ref.Controller != nil && *ref.Controller,
		})
	}
	return rows
}

func (s *Server) handleResourceDetail(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceDetail(w, r, id, def, namespace, name, resource)
}

func (s *Server) handleResourceApply(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceApply(w, r, id, def, namespace, name, resource)
}

func (s *Server) handleResourceDelete(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceDelete(w, r, id, def, namespace, name)
}

func (s *Server) handleResourceScale(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceScale(w, r, id, def, namespace, name)
}

func (s *Server) handleDynamicResourceDetail(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string, resource string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	resourceClient := resourceClientFor(client, def, namespace)
	item, err := resourceClient.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if isSecretResource(resource, def.GVR) {
		maskSecret(item)
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func (s *Server) handleDynamicResourceApply(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string, resource string) {
	if isSecretResource(resource, def.GVR) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("secret editing is disabled because secret values are masked in this UI"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	authzNamespace := namespace
	if !def.Namespaced || authzNamespace == "_" {
		authzNamespace = ""
	}
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: authzNamespace,
		Verb:      "patch",
		Group:     def.GVR.Group,
		Resource:  def.GVR.Resource,
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	jsonBody, err := yaml.YAMLToJSON(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var object unstructured.Unstructured
	if err := json.Unmarshal(jsonBody, &object.Object); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if object.GetName() != name {
		writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.name must remain %q", name))
		return
	}
	if def.Namespaced {
		if namespace == "_" || namespace == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace is required for namespaced resources"))
			return
		}
		if object.GetNamespace() != namespace {
			writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace must remain %q", namespace))
			return
		}
	} else if object.GetNamespace() != "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace must be empty for cluster-scoped resources"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	resourceClient := resourceClientFor(client, def, namespace)
	options := applyPatchOptions(r)
	if r.URL.Query().Get("dryRun") == "true" {
		options.DryRun = []string{metav1.DryRunAll}
	}
	item, err := resourceClient.Patch(ctx, name, types.ApplyPatchType, jsonBody, options)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	mapper, err := s.restMapperFor(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	objects, err := decodeApplyObjects(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(objects) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("at least one YAML document is required"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	options := applyPatchOptions(r)
	dryRun := r.URL.Query().Get("dryRun") == "true"
	if dryRun {
		options.DryRun = []string{metav1.DryRunAll}
	}

	type applyResult struct {
		APIGroup   string `json:"apiGroup"`
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Resource   string `json:"resource"`
		Namespace  string `json:"namespace,omitempty"`
		Name       string `json:"name"`
		DryRun     bool   `json:"dryRun"`
	}
	results := []applyResult{}
	for index, object := range objects {
		gvk := object.GroupVersionKind()
		if gvk.Empty() || gvk.Kind == "" || gvk.Version == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d must include apiVersion and kind", index+1))
			return
		}
		if object.GetName() == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d must include metadata.name", index+1))
			return
		}
		mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d %s: %w", index+1, gvk.String(), err))
			return
		}
		namespace := object.GetNamespace()
		var resourceClient dynamic.ResourceInterface
		if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
			if namespace == "" {
				writeError(w, http.StatusBadRequest, fmt.Errorf("document %d %s/%s requires metadata.namespace", index+1, gvk.Kind, object.GetName()))
				return
			}
			resourceClient = client.Resource(mapping.Resource).Namespace(namespace)
		} else {
			object.SetNamespace("")
			resourceClient = client.Resource(mapping.Resource)
		}
		if err := s.authorize(ctx, id, authorizationv1.ResourceAttributes{
			Namespace: object.GetNamespace(),
			Verb:      "patch",
			Group:     mapping.Resource.Group,
			Resource:  mapping.Resource.Resource,
			Name:      object.GetName(),
		}); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("document %d %s/%s: %w", index+1, gvk.Kind, object.GetName(), err))
			return
		}
		jsonBody, err := json.Marshal(object.Object)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		item, err := resourceClient.Patch(ctx, object.GetName(), types.ApplyPatchType, jsonBody, options)
		if err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("document %d %s/%s: %w", index+1, gvk.Kind, object.GetName(), err))
			return
		}
		results = append(results, applyResult{
			APIGroup:   mapping.Resource.Group,
			APIVersion: item.GetAPIVersion(),
			Kind:       item.GetKind(),
			Resource:   mapping.Resource.Resource,
			Namespace:  item.GetNamespace(),
			Name:       item.GetName(),
			DryRun:     dryRun,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"dryRun": dryRun, "items": results})
}

func applyPatchOptions(r *http.Request) metav1.PatchOptions {
	options := metav1.PatchOptions{FieldManager: "astronomer-lite"}
	if r.URL.Query().Get("force") == "true" {
		force := true
		options.Force = &force
	}
	return options
}

func (s *Server) handleDynamicResourceDelete(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string) {
	if def.Namespaced && (namespace == "_" || namespace == "") {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for namespaced resources"))
		return
	}
	authzNamespace := namespace
	if !def.Namespaced {
		authzNamespace = ""
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: authzNamespace,
		Verb:      "delete",
		Group:     def.GVR.Group,
		Resource:  def.GVR.Resource,
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	resourceClient := resourceClientFor(client, def, namespace)
	if err := resourceClient.Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDynamicResourceScale(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string) {
	if !supportsScale(def.GVR) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("%s/%s does not support scale actions", def.GVR.GroupVersion().String(), def.GVR.Resource))
		return
	}
	if namespace == "_" || namespace == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for scale actions"))
		return
	}
	var body struct {
		Replicas *int32 `json:"replicas"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Replicas == nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("replicas is required"))
		return
	}
	if *body.Replicas < 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("replicas must be greater than or equal to 0"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace:   namespace,
		Verb:        "patch",
		Group:       def.GVR.Group,
		Resource:    def.GVR.Resource,
		Subresource: "scale",
		Name:        name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	scale := autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       autoscalingv1.ScaleSpec{Replicas: *body.Replicas},
	}
	raw, err := json.Marshal(scale)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := client.Resource(def.GVR).Namespace(namespace).Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}, "scale")
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func supportsScale(gvr schema.GroupVersionResource) bool {
	return gvr.Group == "apps" && gvr.Version == "v1" && (gvr.Resource == "deployments" || gvr.Resource == "statefulsets" || gvr.Resource == "replicasets")
}

func decodeApplyObjects(raw []byte) ([]unstructured.Unstructured, error) {
	decoder := k8syaml.NewYAMLOrJSONDecoder(bytes.NewReader(raw), 4096)
	objects := []unstructured.Unstructured{}
	for {
		var object unstructured.Unstructured
		if err := decoder.Decode(&object); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, err
		}
		if len(object.Object) == 0 {
			continue
		}
		objects = append(objects, object)
	}
	return objects, nil
}

func resourceDefinitionFromQuery(r *http.Request) (resourceDefinition, error) {
	query := r.URL.Query()
	resource := strings.TrimSpace(query.Get("resource"))
	version := strings.TrimSpace(query.Get("version"))
	if resource == "" || version == "" {
		return resourceDefinition{}, fmt.Errorf("resource and version query parameters are required")
	}
	group := strings.TrimSpace(query.Get("group"))
	namespaced := query.Get("namespaced") == "true"
	label := strings.TrimSpace(query.Get("kind"))
	if label == "" {
		label = resource
	}
	return resourceDefinition{
		Label:      label,
		GVR:        schema.GroupVersionResource{Group: group, Version: version, Resource: resource},
		Namespaced: namespaced,
	}, nil
}

func containsVerb(verbs []string, wanted string) bool {
	for _, verb := range verbs {
		if verb == wanted {
			return true
		}
	}
	return false
}

func resourceStatus(item unstructured.Unstructured) string {
	if phase, ok, _ := unstructured.NestedString(item.Object, "status", "phase"); ok && phase != "" {
		return phase
	}
	if replicas, ok, _ := unstructured.NestedInt64(item.Object, "status", "readyReplicas"); ok {
		desired, _, _ := unstructured.NestedInt64(item.Object, "spec", "replicas")
		if desired > 0 {
			return fmt.Sprintf("%d/%d ready", replicas, desired)
		}
		return fmt.Sprintf("%d ready", replicas)
	}
	if available, ok, _ := unstructured.NestedInt64(item.Object, "status", "availableReplicas"); ok {
		desired, _, _ := unstructured.NestedInt64(item.Object, "status", "replicas")
		if desired > 0 {
			return fmt.Sprintf("%d/%d available", available, desired)
		}
	}
	if typeValue, ok, _ := unstructured.NestedString(item.Object, "type"); ok && typeValue != "" {
		return typeValue
	}
	return ""
}
