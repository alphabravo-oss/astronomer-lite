package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

type execFrame struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
}

type execControlFrame struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func (s *Server) handlePodExecWS(w http.ResponseWriter, r *http.Request, id string) {
	cfg, err := s.registry.RESTConfig(id)
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
	command := splitCommand(query["command"])
	if len(command) == 0 {
		command = []string{"/bin/sh"}
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stream := newExecWebSocketStream(conn, cancel)
	go stream.readLoop()

	execConfig := rest.CopyConfig(cfg)
	execConfig.APIPath = "/api"
	execConfig.GroupVersion = &corev1.SchemeGroupVersion
	execConfig.NegotiatedSerializer = scheme.Codecs.WithoutConversion()

	restClient, err := rest.RESTClientFor(execConfig)
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	req := restClient.Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: query.Get("container"),
			Command:   command,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(execConfig, http.MethodPost, req.URL())
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	if err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stream,
		Stdout:            stream.stdoutWriter(),
		Stderr:            stream.stderrWriter(),
		Tty:               true,
		TerminalSizeQueue: stream,
	}); err != nil && ctx.Err() == nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = stream.writeFrame(execFrame{Type: "end"})
}

func (s *Server) handlePodAttachWS(w http.ResponseWriter, r *http.Request, id string) {
	cfg, err := s.registry.RESTConfig(id)
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
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stream := newExecWebSocketStream(conn, cancel)
	go stream.readLoop()

	attachConfig := rest.CopyConfig(cfg)
	attachConfig.APIPath = "/api"
	attachConfig.GroupVersion = &corev1.SchemeGroupVersion
	attachConfig.NegotiatedSerializer = scheme.Codecs.WithoutConversion()

	restClient, err := rest.RESTClientFor(attachConfig)
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	req := restClient.Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod).
		SubResource("attach").
		VersionedParams(&corev1.PodAttachOptions{
			Container: query.Get("container"),
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(attachConfig, http.MethodPost, req.URL())
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	if err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stream,
		Stdout:            stream.stdoutWriter(),
		Stderr:            stream.stderrWriter(),
		Tty:               true,
		TerminalSizeQueue: stream,
	}); err != nil && ctx.Err() == nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = stream.writeFrame(execFrame{Type: "end"})
}

func splitCommand(values []string) []string {
	var out []string
	for _, value := range values {
		for _, part := range strings.Split(value, "\x00") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

type execWebSocketStream struct {
	conn    *websocket.Conn
	cancel  context.CancelFunc
	stdin   chan []byte
	resize  chan remotecommand.TerminalSize
	pending []byte
	writeMu sync.Mutex
}

func newExecWebSocketStream(conn *websocket.Conn, cancel context.CancelFunc) *execWebSocketStream {
	return &execWebSocketStream{
		conn:   conn,
		cancel: cancel,
		stdin:  make(chan []byte, 64),
		resize: make(chan remotecommand.TerminalSize, 16),
	}
}

func (s *execWebSocketStream) readLoop() {
	defer s.cancel()
	defer close(s.stdin)
	defer close(s.resize)
	for {
		messageType, payload, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType == websocket.TextMessage {
			var frame execControlFrame
			if err := json.Unmarshal(payload, &frame); err == nil && frame.Type == "resize" && frame.Cols > 0 && frame.Rows > 0 {
				select {
				case s.resize <- remotecommand.TerminalSize{Width: frame.Cols, Height: frame.Rows}:
				default:
				}
				continue
			}
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if len(payload) == 0 {
			continue
		}
		next := append([]byte(nil), payload...)
		s.stdin <- next
	}
}

func (s *execWebSocketStream) Read(p []byte) (int, error) {
	for len(s.pending) == 0 {
		next, ok := <-s.stdin
		if !ok {
			return 0, io.EOF
		}
		s.pending = next
	}
	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *execWebSocketStream) Next() *remotecommand.TerminalSize {
	size, ok := <-s.resize
	if !ok {
		return nil
	}
	return &size
}

func (s *execWebSocketStream) stdoutWriter() io.Writer {
	return execFrameWriter{stream: s, frameType: "stdout"}
}

func (s *execWebSocketStream) stderrWriter() io.Writer {
	return execFrameWriter{stream: s, frameType: "stderr"}
}

func (s *execWebSocketStream) writeFrame(frame execFrame) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(frame)
}

type execFrameWriter struct {
	stream    *execWebSocketStream
	frameType string
}

func (w execFrameWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if err := w.stream.writeFrame(execFrame{Type: w.frameType, Message: string(p)}); err != nil {
		return 0, err
	}
	return len(p), nil
}
