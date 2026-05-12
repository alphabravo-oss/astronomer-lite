import type { Cluster } from "./api";

export type ClusterStatus = NonNullable<Cluster["status"]>;

export function clusterStatus(cluster: Cluster): ClusterStatus {
  return cluster.status ?? (cluster.reachable ? "reachable" : "unreachable");
}
