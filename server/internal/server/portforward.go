package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

type portForwardRequest struct {
	Namespace    string `json:"namespace"`
	Pod          string `json:"pod"`
	ResourceKind string `json:"resourceKind,omitempty"`
	ResourceName string `json:"resourceName,omitempty"`
	LocalPort    int    `json:"localPort"`
	RemotePort   int    `json:"remotePort"`
}

type portForwardRow struct {
	ID           string `json:"id"`
	ClusterID    string `json:"clusterId"`
	Namespace    string `json:"namespace"`
	Pod          string `json:"pod"`
	ResourceKind string `json:"resourceKind"`
	ResourceName string `json:"resourceName"`
	LocalPort    int    `json:"localPort"`
	RemotePort   int    `json:"remotePort"`
	URL          string `json:"url"`
	CreatedAt    string `json:"createdAt"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	Error        string `json:"error,omitempty"`
}

type portForwardSession struct {
	row      portForwardRow
	stop     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

func (session *portForwardSession) stopForward() {
	session.stopOnce.Do(func() {
		close(session.stop)
	})
}

// armPortForwardTTL stops the session once ttl elapses, unless the forward has
// already finished (session.done). This bounds a forward's lifetime so it can't
// outlive its usefulness (US-14 idle timeout).
func armPortForwardTTL(session *portForwardSession, ttl time.Duration) {
	timer := time.NewTimer(ttl)
	defer timer.Stop()
	select {
	case <-timer.C:
		session.stopForward()
	case <-session.done:
	}
}

func (s *Server) handlePortForwards(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		s.portForwardMu.Lock()
		rows := []portForwardRow{}
		for _, session := range s.portForwards {
			if session.row.ClusterID == id {
				rows = append(rows, session.row)
			}
		}
		s.portForwardMu.Unlock()
		sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt > rows[j].CreatedAt })
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var request portForwardRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
		if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
			Namespace:   request.Namespace,
			Verb:        "create",
			Group:       "",
			Resource:    "pods",
			Subresource: "portforward",
		}); err != nil {
			authzCancel()
			writeError(w, http.StatusBadGateway, err)
			return
		}
		authzCancel()
		row, err := s.startPortForward(r.Context(), id, request)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePortForwardDelete(w http.ResponseWriter, _ *http.Request, id string, sessionID string) {
	s.portForwardMu.Lock()
	session, ok := s.portForwards[sessionID]
	if ok && session.row.ClusterID == id {
		delete(s.portForwards, sessionID)
	}
	s.portForwardMu.Unlock()
	if !ok || session.row.ClusterID != id {
		writeError(w, http.StatusNotFound, os.ErrNotExist)
		return
	}
	session.stopForward()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) startPortForward(ctx context.Context, id string, request portForwardRequest) (portForwardRow, error) {
	namespace := strings.TrimSpace(request.Namespace)
	pod := strings.TrimSpace(request.Pod)
	resourceKind := strings.ToLower(strings.TrimSpace(request.ResourceKind))
	resourceName := strings.TrimSpace(request.ResourceName)
	if resourceKind == "" {
		resourceKind = "pod"
	}
	if resourceName == "" {
		resourceName = pod
	}
	if namespace == "" || resourceName == "" {
		return portForwardRow{}, fmt.Errorf("namespace and resource name are required")
	}
	if resourceKind != "pod" && resourceKind != "service" {
		return portForwardRow{}, fmt.Errorf("resourceKind must be pod or service")
	}
	if request.RemotePort <= 0 || request.RemotePort > 65535 {
		return portForwardRow{}, fmt.Errorf("remotePort must be between 1 and 65535")
	}
	targetPort := request.RemotePort
	if resourceKind == "service" {
		client, err := s.kubeClientFor(id)
		if err != nil {
			return portForwardRow{}, err
		}
		resolvedPod, resolvedPort, err := resolveServicePortForwardTarget(ctx, client, namespace, resourceName, request.RemotePort)
		if err != nil {
			return portForwardRow{}, err
		}
		pod = resolvedPod
		targetPort = resolvedPort
	} else if pod == "" {
		return portForwardRow{}, fmt.Errorf("namespace and pod are required")
	}
	localPort := request.LocalPort
	if localPort == 0 {
		nextPort, err := freeLocalPort()
		if err != nil {
			return portForwardRow{}, err
		}
		localPort = nextPort
	}
	if localPort <= 0 || localPort > 65535 {
		return portForwardRow{}, fmt.Errorf("localPort must be between 1 and 65535")
	}
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		return portForwardRow{}, err
	}
	transport, upgrader, err := spdy.RoundTripperFor(cfg)
	if err != nil {
		return portForwardRow{}, err
	}
	hostURL, err := url.Parse(cfg.Host)
	if err != nil {
		return portForwardRow{}, err
	}
	hostURL.Path = path.Join(hostURL.Path, "api", "v1", "namespaces", namespace, "pods", pod, "portforward")
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, hostURL)
	stopChan := make(chan struct{})
	readyChan := make(chan struct{})
	doneChan := make(chan struct{})
	errChan := make(chan error, 1)
	forwarder, err := portforward.NewOnAddresses(
		dialer,
		[]string{"127.0.0.1"},
		[]string{fmt.Sprintf("%d:%d", localPort, targetPort)},
		stopChan,
		readyChan,
		io.Discard,
		io.Discard,
	)
	if err != nil {
		return portForwardRow{}, err
	}
	sessionID := fmt.Sprintf("pf-%d-%d", time.Now().UnixNano(), rand.Intn(100000))
	now := time.Now()
	expiresAt := ""
	if s.Config.PortForwardTTL > 0 {
		expiresAt = now.Add(s.Config.PortForwardTTL).Format(time.RFC3339Nano)
	}
	row := portForwardRow{
		ID:           sessionID,
		ClusterID:    id,
		Namespace:    namespace,
		Pod:          pod,
		ResourceKind: resourceKind,
		ResourceName: resourceName,
		LocalPort:    localPort,
		RemotePort:   request.RemotePort,
		URL:          fmt.Sprintf("http://127.0.0.1:%d", localPort),
		CreatedAt:    now.Format(time.RFC3339Nano),
		ExpiresAt:    expiresAt,
	}
	session := &portForwardSession{row: row, stop: stopChan, done: doneChan}
	go func() {
		defer close(doneChan)
		if err := forwarder.ForwardPorts(); err != nil {
			errChan <- err
			s.portForwardMu.Lock()
			if current, ok := s.portForwards[sessionID]; ok {
				current.row.Error = err.Error()
			}
			s.portForwardMu.Unlock()
		}
		s.portForwardMu.Lock()
		delete(s.portForwards, sessionID)
		s.portForwardMu.Unlock()
	}()
	select {
	case <-readyChan:
		s.portForwardMu.Lock()
		s.portForwards[sessionID] = session
		s.portForwardMu.Unlock()
		if s.Config.PortForwardTTL > 0 {
			go armPortForwardTTL(session, s.Config.PortForwardTTL)
		}
		return row, nil
	case err := <-errChan:
		session.stopForward()
		return portForwardRow{}, err
	case <-ctx.Done():
		session.stopForward()
		return portForwardRow{}, ctx.Err()
	case <-time.After(10 * time.Second):
		session.stopForward()
		return portForwardRow{}, fmt.Errorf("timed out waiting for port-forward")
	}
}

func resolveServicePortForwardTarget(ctx context.Context, client kubernetes.Interface, namespace string, serviceName string, servicePort int) (string, int, error) {
	service, err := client.CoreV1().Services(namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		return "", 0, err
	}
	if len(service.Spec.Selector) == 0 {
		return "", 0, fmt.Errorf("service %q has no selector", serviceName)
	}
	targetPort := servicePort
	var targetName string
	for _, port := range service.Spec.Ports {
		if int(port.Port) != servicePort {
			continue
		}
		if port.TargetPort.Type == intstr.String {
			targetName = port.TargetPort.StrVal
		} else if port.TargetPort.IntVal > 0 {
			targetPort = int(port.TargetPort.IntVal)
		}
		break
	}
	selector := labels.SelectorFromSet(service.Spec.Selector).String()
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return "", 0, err
	}
	for _, pod := range pods.Items {
		if pod.Status.Phase != corev1.PodRunning {
			continue
		}
		if targetName != "" {
			if namedPort, ok := containerPortByName(pod, targetName); ok {
				return pod.Name, namedPort, nil
			}
			continue
		}
		return pod.Name, targetPort, nil
	}
	if targetName != "" {
		return "", 0, fmt.Errorf("no running pod behind service %q exposes named targetPort %q", serviceName, targetName)
	}
	return "", 0, fmt.Errorf("no running pods found behind service %q", serviceName)
}

func containerPortByName(pod corev1.Pod, name string) (int, bool) {
	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if port.Name == name && port.ContainerPort > 0 {
				return int(port.ContainerPort), true
			}
		}
	}
	return 0, false
}

func freeLocalPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = listener.Close() }()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected listener address %s", listener.Addr().String())
	}
	return address.Port, nil
}
