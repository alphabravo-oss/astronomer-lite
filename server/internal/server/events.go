package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.dynamicClientFor(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	def := resourceDefinitions["events"]
	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if len(namespaces) == 0 {
		namespaces = []string{""}
	}
	rows := []eventRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, eventRowFromObject(item.Object))
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].LastTimestamp > rows[j].LastTimestamp
	})
	writeJSON(w, http.StatusOK, rows)
}

type eventRow struct {
	Name                string `json:"name"`
	Namespace           string `json:"namespace,omitempty"`
	Type                string `json:"type"`
	Reason              string `json:"reason"`
	Note                string `json:"note"`
	Action              string `json:"action"`
	RegardingKind       string `json:"regardingKind"`
	RegardingName       string `json:"regardingName"`
	RegardingNamespace  string `json:"regardingNamespace,omitempty"`
	ReportingController string `json:"reportingController"`
	Count               int64  `json:"count"`
	EventTime           string `json:"eventTime"`
	FirstTimestamp      string `json:"firstTimestamp"`
	LastTimestamp       string `json:"lastTimestamp"`
	Age                 string `json:"age"`
}

func eventRowFromObject(object map[string]any) eventRow {
	meta := recordFromMap(object, "metadata")
	regarding := recordFromMap(object, "regarding")
	series := recordFromMap(object, "series")
	eventTime := stringFromMap(object, "eventTime")
	firstTimestamp := stringFromMap(object, "deprecatedFirstTimestamp")
	lastTimestamp := stringFromMap(object, "deprecatedLastTimestamp")
	if seriesLastObserved := stringFromMap(series, "lastObservedTime"); seriesLastObserved != "" {
		lastTimestamp = seriesLastObserved
	}
	if lastTimestamp == "" {
		lastTimestamp = eventTime
	}
	if firstTimestamp == "" {
		firstTimestamp = eventTime
	}
	count := int64FromMap(object, "deprecatedCount")
	if seriesCount := int64FromMap(series, "count"); seriesCount > 0 {
		count = seriesCount
	}
	if count == 0 {
		count = 1
	}
	return eventRow{
		Name:                stringFromMap(meta, "name"),
		Namespace:           stringFromMap(meta, "namespace"),
		Type:                stringFromMap(object, "type"),
		Reason:              stringFromMap(object, "reason"),
		Note:                stringFromMap(object, "note"),
		Action:              stringFromMap(object, "action"),
		RegardingKind:       stringFromMap(regarding, "kind"),
		RegardingName:       stringFromMap(regarding, "name"),
		RegardingNamespace:  stringFromMap(regarding, "namespace"),
		ReportingController: stringFromMap(object, "reportingController"),
		Count:               count,
		EventTime:           eventTime,
		FirstTimestamp:      firstTimestamp,
		LastTimestamp:       lastTimestamp,
		Age:                 ageFromKubernetesTimestamp(lastTimestamp),
	}
}
