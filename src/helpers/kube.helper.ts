import { V1ObjectMeta } from "@kubernetes/client-node";
import { Config } from "../config";

export function isManagedByMe(metadata?: V1ObjectMeta): boolean {
  return getManagedBy(metadata) === Config.info.name;
}

export function getManagedBy(metadata?: V1ObjectMeta): string {
  return metadata?.labels?.['app.kubernetes.io/managed-by'] || "";
}
