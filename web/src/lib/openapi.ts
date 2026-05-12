// OpenAPI v2 schema helpers. The server proxies the cluster's /openapi/v2
// document; we cache it per cluster id and answer field-description lookups
// against it.

import { useEffect, useState } from "react";
import { api } from "./api";

type OpenAPISchema = {
  description?: string;
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
};

export type OpenAPIDocument = {
  definitions?: Record<string, OpenAPISchema>;
};

export function useOpenAPIDoc(clusterId?: string) {
  const [doc, setDoc] = useState<OpenAPIDocument | null>(null);
  useEffect(() => {
    if (!clusterId) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    getOpenAPISchema(clusterId)
      .then((value) => {
        if (!cancelled) setDoc(value);
      })
      .catch(() => {
        if (!cancelled) setDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);
  return doc;
}

const cache = new Map<string, Promise<OpenAPIDocument>>();

export async function getOpenAPISchema(clusterId: string): Promise<OpenAPIDocument> {
  let existing = cache.get(clusterId);
  if (!existing) {
    existing = api
      .openapi(clusterId)
      .then((value) => value as unknown as OpenAPIDocument)
      .catch((error) => {
        cache.delete(clusterId);
        throw error;
      });
    cache.set(clusterId, existing);
  }
  return existing;
}

// Headlamp-style mapping: kind=Deployment + apiVersion=apps/v1 →
// definition key `io.k8s.api.apps.v1.Deployment`. Falls back to a scan if the
// constructed key is missing.
export function definitionKeyFor(kind: string, apiVersion: string) {
  if (!kind || !apiVersion) return "";
  const [group, version] = apiVersion.includes("/") ? apiVersion.split("/") : ["", apiVersion];
  if (group === "") {
    return `io.k8s.api.core.${version}.${kind}`;
  }
  const groupParts = group.split(".");
  if (groupParts.length === 1) {
    return `io.k8s.api.${group}.${version}.${kind}`;
  }
  // e.g. networking.k8s.io → io.k8s.api.networking.v1.Ingress
  if (groupParts[1] === "k8s" && groupParts[2] === "io") {
    return `io.k8s.api.${groupParts[0]}.${version}.${kind}`;
  }
  return `${groupParts.reverse().join(".")}.${version}.${kind}`;
}

function dereference(doc: OpenAPIDocument, schema: OpenAPISchema | undefined, seen: Set<string>): OpenAPISchema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  const ref = schema.$ref;
  if (seen.has(ref)) return schema;
  seen.add(ref);
  const key = ref.replace(/^#\/definitions\//, "");
  const next = doc.definitions?.[key];
  return dereference(doc, next, seen);
}

// Look up the description for a JSON-path-like field inside the schema for a
// given kind/apiVersion. `path` is dot-separated (e.g. "spec.replicas").
export function lookupFieldDoc(doc: OpenAPIDocument, kind: string, apiVersion: string, path: string): string | undefined {
  if (!doc.definitions || !kind || !apiVersion) return undefined;
  const start = doc.definitions[definitionKeyFor(kind, apiVersion)];
  if (!start) return undefined;
  let node: OpenAPISchema | undefined = start;
  for (const segment of path.split(".").filter(Boolean)) {
    node = dereference(doc, node, new Set());
    if (!node?.properties) return undefined;
    node = node.properties[segment];
    if (!node) return undefined;
  }
  node = dereference(doc, node, new Set());
  return node?.description;
}
