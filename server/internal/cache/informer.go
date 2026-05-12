package cache

import (
	"context"
	"sync"
	"time"

	appsv1listers "k8s.io/client-go/listers/apps/v1"
	batchv1listers "k8s.io/client-go/listers/batch/v1"
	corev1listers "k8s.io/client-go/listers/core/v1"

	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	clientgocache "k8s.io/client-go/tools/cache"
)

// defaultResync is the SharedInformer resync interval. Resync re-emits typed
// events for every cached object even when nothing changed — kubectl uses 0
// (no resync) for one-shot listings, but we want a periodic safety net for
// long-lived watches.
const defaultResync = 5 * time.Minute

// SyncWait is how long callers will wait for the initial cache to sync before
// falling back to a direct list. Kept short so the first request after server
// boot doesn't hang.
const SyncWait = 5 * time.Second

// InformerSet exposes the typed listers a cluster's informer factory
// publishes. Callers should always WaitForSync before reading.
type InformerSet struct {
	factory informers.SharedInformerFactory
	stopCh  chan struct{}

	syncMu       sync.Mutex
	syncedResult bool

	Pods         corev1listers.PodLister
	Services     corev1listers.ServiceLister
	Deployments  appsv1listers.DeploymentLister
	StatefulSets appsv1listers.StatefulSetLister
	DaemonSets   appsv1listers.DaemonSetLister
	ReplicaSets  appsv1listers.ReplicaSetLister
	Jobs         batchv1listers.JobLister
}

// WaitForSync blocks up to SyncWait for every informer in the set to populate
// its cache. Returns true when sync succeeded. Once true is returned it is
// cached and future calls return immediately; failures retry up to SyncWait
// so a slow first request doesn't permanently force the fallback path.
func (i *InformerSet) WaitForSync(ctx context.Context) bool {
	if i == nil {
		return false
	}
	i.syncMu.Lock()
	if i.syncedResult {
		i.syncMu.Unlock()
		return true
	}
	i.syncMu.Unlock()

	waitCtx, cancel := context.WithTimeout(ctx, SyncWait)
	defer cancel()
	synced := i.factory.WaitForCacheSync(waitCtx.Done())
	ok := true
	for _, s := range synced {
		if !s {
			ok = false
			break
		}
	}

	i.syncMu.Lock()
	if ok {
		i.syncedResult = true
	}
	result := i.syncedResult
	i.syncMu.Unlock()
	return result
}

func (i *InformerSet) stop() {
	if i == nil {
		return
	}
	select {
	case <-i.stopCh:
	default:
		close(i.stopCh)
	}
}

// InformerManager lazily creates one SharedInformerFactory per cluster id and
// tears it down on cluster removal.
type InformerManager struct {
	mu     sync.Mutex
	byID   map[string]*InformerSet
	resync time.Duration
}

// NewInformerManager returns an empty manager. Factories are created on first
// access via Get.
func NewInformerManager() *InformerManager {
	return &InformerManager{
		byID:   map[string]*InformerSet{},
		resync: defaultResync,
	}
}

// Get returns the lazily-initialized informer set for cluster id, starting
// the factory on first access. The set is not guaranteed to be synced — call
// WaitForSync (or fall back to a direct list) before reading from listers.
func (m *InformerManager) Get(id string, client kubernetes.Interface) *InformerSet {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.byID[id]; ok {
		return existing
	}
	factory := informers.NewSharedInformerFactory(client, m.resync)
	set := &InformerSet{
		factory:      factory,
		stopCh:       make(chan struct{}),
		Pods:         factory.Core().V1().Pods().Lister(),
		Services:     factory.Core().V1().Services().Lister(),
		Deployments:  factory.Apps().V1().Deployments().Lister(),
		StatefulSets: factory.Apps().V1().StatefulSets().Lister(),
		DaemonSets:   factory.Apps().V1().DaemonSets().Lister(),
		ReplicaSets:  factory.Apps().V1().ReplicaSets().Lister(),
		Jobs:         factory.Batch().V1().Jobs().Lister(),
	}
	// Reference each informer so the factory actually starts watching for it.
	factory.Core().V1().Pods().Informer()
	factory.Core().V1().Services().Informer()
	factory.Apps().V1().Deployments().Informer()
	factory.Apps().V1().StatefulSets().Informer()
	factory.Apps().V1().DaemonSets().Informer()
	factory.Apps().V1().ReplicaSets().Informer()
	factory.Batch().V1().Jobs().Informer()
	factory.Start(set.stopCh)
	m.byID[id] = set
	return set
}

// Invalidate tears down the informer factory for cluster id, if one exists.
// The next call to Get will create a fresh one.
func (m *InformerManager) Invalidate(id string) {
	m.mu.Lock()
	set, ok := m.byID[id]
	if ok {
		delete(m.byID, id)
	}
	m.mu.Unlock()
	if ok {
		set.stop()
	}
}

// Clear tears down every running factory. Used on registry full-reload.
func (m *InformerManager) Clear() {
	m.mu.Lock()
	existing := m.byID
	m.byID = map[string]*InformerSet{}
	m.mu.Unlock()
	for _, set := range existing {
		set.stop()
	}
}

// Compile-time check: ensure WaitForCacheSync from the upstream cache package
// has the signature we expect. (No-op at runtime.)
var _ = clientgocache.WaitForCacheSync
