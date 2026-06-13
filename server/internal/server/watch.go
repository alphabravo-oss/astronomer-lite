package server

import (
	"context"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
)

type watchFrame struct {
	Type    string `json:"type"`
	Object  any    `json:"object,omitempty"`
	Message string `json:"message,omitempty"`
}

func (s *Server) handleWatchWS(w http.ResponseWriter, r *http.Request, id string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()

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

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	var writeMu sync.Mutex
	var wg sync.WaitGroup
	for _, namespace := range namespaces {
		namespace := namespace
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.watchResource(ctx, client, def, namespace, conn, &writeMu); err != nil && ctx.Err() == nil {
				writeMu.Lock()
				_ = conn.WriteJSON(watchFrame{Type: "ERROR", Message: err.Error()})
				writeMu.Unlock()
				cancel()
			}
		}()
	}
	wg.Wait()
}

func (s *Server) watchResource(ctx context.Context, client dynamic.Interface, def resourceDefinition, namespace string, conn *websocket.Conn, writeMu *sync.Mutex) error {
	resourceClient := resourceClientFor(client, def, namespace)
	resourceVersion := ""
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}
		timeout := int64(300)
		watcher, err := resourceClient.Watch(ctx, metav1.ListOptions{
			AllowWatchBookmarks: true,
			ResourceVersion:     resourceVersion,
			TimeoutSeconds:      &timeout,
		})
		if err != nil {
			if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
				nextResourceVersion, resetErr := resetWatchResourceVersion(ctx, resourceClient)
				if resetErr != nil {
					return resetErr
				}
				resourceVersion = nextResourceVersion
				if err := writeWatchFrame(conn, writeMu, watchFrame{Type: "RESET"}); err != nil {
					return err
				}
				continue
			}
			return err
		}
		for event := range watcher.ResultChan() {
			if event.Type == watch.Error {
				watcher.Stop()
				statusErr := apierrors.FromObject(event.Object)
				if apierrors.IsResourceExpired(statusErr) || apierrors.IsGone(statusErr) {
					nextResourceVersion, resetErr := resetWatchResourceVersion(ctx, resourceClient)
					if resetErr != nil {
						return resetErr
					}
					resourceVersion = nextResourceVersion
					if err := writeWatchFrame(conn, writeMu, watchFrame{Type: "RESET"}); err != nil {
						return err
					}
					break
				}
				return statusErr
			}

			frame := watchFrame{Type: string(event.Type)}
			object, nextResourceVersion := watchObjectPayload(event.Object, def.GVR)
			if nextResourceVersion != "" {
				resourceVersion = nextResourceVersion
			}
			frame.Object = object
			if err := writeWatchFrame(conn, writeMu, frame); err != nil {
				return err
			}
		}
		watcher.Stop()
	}
}

func resetWatchResourceVersion(ctx context.Context, resourceClient dynamic.ResourceInterface) (string, error) {
	list, err := resourceClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}
	return list.GetResourceVersion(), nil
}

func watchObjectPayload(object any, gvr schema.GroupVersionResource) (any, string) {
	switch typed := object.(type) {
	case *unstructured.Unstructured:
		if isSecretResource("", gvr) {
			maskSecret(typed)
		}
		return typed.Object, typed.GetResourceVersion()
	default:
		return object, ""
	}
}

func writeWatchFrame(conn *websocket.Conn, writeMu *sync.Mutex, frame watchFrame) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	return conn.WriteJSON(frame)
}
