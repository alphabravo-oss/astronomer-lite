package server

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type logFrame struct {
	Type      string `json:"type"`
	Message   string `json:"message,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

func (s *Server) handlePodLogsWS(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	query := r.URL.Query()
	namespace := strings.TrimSpace(query.Get("ns"))
	pod := strings.TrimSpace(query.Get("pod"))
	if namespace == "" || pod == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("ns and pod query parameters are required"))
		return
	}
	tailLines := int64(100)
	if value := strings.TrimSpace(query.Get("tailLines")); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("tailLines must be a non-negative integer"))
			return
		}
		tailLines = parsed
	}
	options := &corev1.PodLogOptions{
		Container:  query.Get("container"),
		Follow:     query.Get("follow") != "false",
		TailLines:  &tailLines,
		Timestamps: query.Get("timestamps") == "true",
	}
	var sinceTimeValue time.Time
	var hasSinceTime bool
	if value := strings.TrimSpace(query.Get("sinceTime")); value != "" {
		parsed, err := time.Parse(time.RFC3339Nano, value)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("sinceTime must be RFC3339Nano: %w", err))
			return
		}
		sinceTimeValue = parsed
		hasSinceTime = true
		sinceTime := metav1.NewTime(parsed)
		options.SinceTime = &sinceTime
		options.TailLines = nil
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	stream, err := client.CoreV1().Pods(namespace).GetLogs(pod, options).Stream(ctx)
	if err != nil {
		_ = conn.WriteJSON(logFrame{Type: "error", Message: err.Error()})
		return
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		frame := logLineFrame(scanner.Text(), options.Timestamps)
		if hasSinceTime && frame.Timestamp != "" {
			timestamp, err := time.Parse(time.RFC3339Nano, frame.Timestamp)
			if err == nil && !timestamp.After(sinceTimeValue) {
				continue
			}
		}
		if err := conn.WriteJSON(frame); err != nil {
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(ctx.Err(), context.Canceled) {
		_ = conn.WriteJSON(logFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = conn.WriteJSON(logFrame{Type: "end"})
}

func logLineFrame(line string, timestamps bool) logFrame {
	frame := logFrame{Type: "line", Message: line}
	if !timestamps {
		return frame
	}
	timestamp, message, ok := strings.Cut(line, " ")
	if !ok {
		return frame
	}
	if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
		return frame
	}
	frame.Timestamp = timestamp
	frame.Message = message
	return frame
}
