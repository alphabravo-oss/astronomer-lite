package server

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

func recordFromMap(object map[string]any, key string) map[string]any {
	value, ok := object[key]
	if !ok {
		return map[string]any{}
	}
	record, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return record
}

func stringFromMap(object map[string]any, key string) string {
	value, ok := object[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(value)
	}
}

func int64FromMap(object map[string]any, key string) int64 {
	value, ok := object[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	default:
		return 0
	}
}

func ageFromKubernetesTimestamp(value string) string {
	if value == "" {
		return ""
	}
	timestamp, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return ""
	}
	return time.Since(timestamp).Round(time.Second).String()
}

func splitQueryList(values []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}

func strconvPair(ready, total int) string {
	return fmt.Sprintf("%d/%d", ready, total)
}
