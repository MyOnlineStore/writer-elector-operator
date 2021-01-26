
import { CoreV1Api, KubeConfig, Watch, V1Endpoints, V1Service, V1EndpointAddress } from "@kubernetes/client-node";
import { Config } from "../config";
import { Watcher } from "./watcher";
import { ElectedEndpointModel, ElectedEndpointRole } from "../models/elected-endpoint.model";

export class WatchService {

  private readonly kubeConfig: KubeConfig;
  private readonly apiClient: CoreV1Api;
  private readonly watchers: Watcher<V1Endpoints>[] = [];

  private endpoints: ElectedEndpointModel[] = [];

  constructor() {
    // Init kubernetes client
    this.kubeConfig = new KubeConfig();
    this.kubeConfig.loadFromDefault();

    this.apiClient = this.kubeConfig.makeApiClient(CoreV1Api);
  }

  public init() {
    let watchClient = new Watch(this.kubeConfig);

    // Setup watchers
    let namespaces = Config.watch.namespaces.split(",").map(ns => ns.trim());
    if (namespaces.find(ns => ns === "*")) {
      // Watch all
      let watcher = new Watcher<V1Endpoints>(watchClient, `/api/v1/endpoints`, Config.watch.selector);
      this.watchers.push(watcher);

    } else {
      // Watch specific namespaces
      for (let ns of Config.watch.namespaces) {
        let watcher = new Watcher<V1Endpoints>(watchClient, `/api/v1/namespaces/${ns}/endpoints`, Config.watch.selector);
        this.watchers.push(watcher);
      }
    }

    // Subscribe on watchers
    for (let watcher of this.watchers) {
      watcher.subscribe(async (type, endpoint) => {
        if (type === "ADDED" || type === "MODIFIED") {
          await this.onEndpointChanged(endpoint);
        } else if(type === "DELETED") {
          await this.onEndpointDeleted(endpoint);
        }
      });
    }
  }

  public getEndpoints(): ElectedEndpointModel[] {
    return this.endpoints;
  }

  private async onEndpointChanged(endpoint: V1Endpoints): Promise<void> {
    if (endpoint.metadata && endpoint.metadata.name && endpoint.metadata.namespace && endpoint.subsets && endpoint.subsets.length > 0) {
      if (endpoint.metadata.labels && endpoint.metadata.labels["app.kubernetes.io/managed-by"] === Config.info.name) {
        // ignore own endpoints
        return;
      }

      let namespace: string = endpoint.metadata.namespace;
      let writerName = endpoint.metadata.name + Config.writer.suffix;
      if (endpoint.metadata.labels && endpoint.metadata.labels["myonlinestore.com/writer-elector-service-name"]) {
        writerName = endpoint.metadata.labels["myonlinestore.com/writer-elector-service-name"];
      }

      // Check Writer Endpoints
      let writerEndpoint: V1Endpoints | undefined;
      try {
        writerEndpoint = (await this.apiClient.readNamespacedEndpoints(writerName, namespace)).body;
      } catch(e) {
        if (e.statusCode !== 404) {
          throw new Error(`GET /api/v1/namespaces/${namespace}/endpoints/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`)
        }
      }

      if (writerEndpoint) {
        // Update endpoint
        await this.updateWriterEndpoint(endpoint, writerEndpoint);
      } else {
        // Create new endpoint
        await this.createWriterEndpoint(endpoint, writerName);
      }

      // Check Writer Services
      let writerService: V1Service | undefined;
      try {
        writerService = (await this.apiClient.readNamespacedService(writerName, namespace)).body;
      } catch(e) {
        if (e.statusCode !== 404) {
          throw new Error(`GET /api/v1/namespaces/${namespace}/services/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`)
        }
      }

      if (!writerService) {
        // Create new endpoint
        await this.createWriterService(endpoint, writerName);
      }
    }
  }

  /**
   * Remove writer endoint when original endpoint is deleted
   * @param endpoint
   */
  private async onEndpointDeleted(endpoint: V1Endpoints): Promise<void> {
    if (endpoint.metadata && endpoint.metadata.name && endpoint.metadata.namespace) {
      if (endpoint.metadata.labels && endpoint.metadata.labels["app.kubernetes.io/managed-by"] === Config.info.name) {
        // ignore own endpoints
        return;
      }

      let namespace: string = endpoint.metadata.namespace;
      let writerName = endpoint.metadata.name + Config.writer.suffix;
      if (endpoint.metadata.labels && endpoint.metadata.labels["myonlinestore.com/writer-elector-service-name"]) {
        writerName = endpoint.metadata.labels["myonlinestore.com/writer-elector-service-name"];
      }

      // Delete Writer Endpoint
      let writerEndpoint: V1Endpoints | undefined;
      try {
        writerEndpoint = (await this.apiClient.readNamespacedEndpoints(writerName, namespace)).body;
      } catch(e) {
        if (e.statusCode !== 404) {
          throw new Error(`GET /api/v1/namespaces/${namespace}/endpoints/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`)
        }
      }

      if (writerEndpoint) {
        try {
          console.info(`[${new Date().toISOString()}] Delete writer endpoint ${namespace}/${writerName}`)
          await this.apiClient.deleteNamespacedEndpoints(writerName, namespace);

          // Delete endpoint from the metrics cache
          let index = this.endpoints.findIndex(e => e.name === writerName && e.namespace === namespace);
          if (index > -1){
            this.endpoints.splice(index, 1);
          }
        } catch(e) {
          throw new Error(`DELETE /api/v1/namespaces/${namespace}/endpoints/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`);
        }
      }

      // Delete Writer Service
      let writerService: V1Service | undefined;
      try {
        writerService = (await this.apiClient.readNamespacedService(writerName, namespace)).body;
      } catch(e) {
        if (e.statusCode !== 404) {
          throw new Error(`GET /api/v1/namespaces/${namespace}/services/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`);
        }
      }

      if (writerService) {
        try {
          console.info(`[${new Date().toISOString()}] Delete writer service ${namespace}/${writerName}`)
          await this.apiClient.deleteNamespacedService(writerName, namespace);
        } catch(e) {
          throw new Error(`DELETE /api/v1/namespaces/${namespace}/services/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`);
        }
      }
    }
  }

  /**
   * Update writer endpoint based on the origional endpoint
   * @param endpoint origional endpoint
   * @param writerEndpoint
   */
  private async updateWriterEndpoint(endpoint: V1Endpoints, writerEndpoint: V1Endpoints): Promise<void> {
    if (writerEndpoint.metadata?.namespace && writerEndpoint.metadata?.name) {
      let namespace = writerEndpoint.metadata.namespace;
      let writerName = writerEndpoint.metadata.name;

      // Check if current address is still ready
      let currentAddress = writerEndpoint.subsets &&
                          writerEndpoint.subsets[0] &&
                          writerEndpoint.subsets[0].addresses &&
                          writerEndpoint.subsets[0].addresses[0];

      let availableAddresses = endpoint.subsets &&
                              endpoint.subsets[0] &&
                              endpoint.subsets[0].addresses;

      let newAddresses: V1EndpointAddress[] | undefined = undefined;
      if (!availableAddresses || availableAddresses.length === 0) {
        if (currentAddress) {
          // No ready endpoints, empty address list
          newAddresses = [];

        }
      } else {
        if (currentAddress) {
          // Check if current address is still available
          let currentAddressStillExists = availableAddresses.find(a => a.ip === currentAddress?.ip);

          if (!currentAddressStillExists) {
            // Elect new address as writer
            newAddresses = [availableAddresses[0]];
          }
        } else {
          // Elect first address as writer
          newAddresses = [availableAddresses[0]];
        }
      }

      if (newAddresses) {
        // Prepair endpoint resource
        if (!writerEndpoint.subsets) {
          writerEndpoint.subsets = [];
        }
        if (writerEndpoint.subsets.length === 0) {
          writerEndpoint.subsets.push({
            addresses: [],
            ports: endpoint.subsets && endpoint.subsets[0] && endpoint.subsets[0].ports || []
          });
        }
        writerEndpoint.subsets[0].addresses = newAddresses

        // New address elected as writer
        console.info(`[${new Date().toISOString()}] Update writer endpoint ${namespace}/${writerName}`);

        try {
          await this.apiClient.replaceNamespacedEndpoints(writerName, namespace, writerEndpoint);
        } catch(e) {
          throw new Error(`PUT /api/v1/namespaces/${namespace}/endpoints/${writerName} failed (${e.statusCode}) ${e.response?.body?.message}`);
        }

        if (newAddresses.length > 0) {
          console.info(`[${new Date().toISOString()}] [${namespace}/${writerName}] Elect ${newAddresses[0].targetRef?.name} (${newAddresses[0].ip}) as writer`);
        } else {
          console.warn(`[${new Date().toISOString()}] [${namespace}/${writerName}] Unable to elect new writer, no ready endpoints in ${namespace}/${endpoint?.metadata?.name}`);
        }
      }

      // Update endpoint in metrics cache
      let electedEndpoint = this.endpoints.find(e => e.name === writerName && e.namespace === namespace);
      let electedAddress = newAddresses && newAddresses[0] || currentAddress;
      let pods = (availableAddresses || []).map((address: V1EndpointAddress) => {
        return {
          name: address.targetRef?.name || address.ip,
          role: electedAddress && address.ip === electedAddress.ip ? ElectedEndpointRole.WRITER : ElectedEndpointRole.READER
        }
      });
      if (electedEndpoint) {
        electedEndpoint.pods = pods;
      } else {
        this.endpoints.push({
          name: writerName,
          namespace: namespace,
          pods: pods
        });
      }
    }
  }

  /**
   * Create writer endpoint based on the origional endpoint
   * @param endpoint original endpoint
   * @param writerName
   */
  private async createWriterEndpoint(endpoint: V1Endpoints, writerName: string): Promise<void> {
    if (endpoint.metadata && endpoint.metadata.name && endpoint.metadata.namespace && endpoint.subsets && endpoint.subsets.length > 0) {
      let namespace = endpoint.metadata.namespace;
      let newLabels = endpoint.metadata.labels || {};

      if (Config.writer.overwrite.labels) {
        for (let pair of Config.writer.overwrite.labels.split(",")) {
          let splittedPair = pair.split("=");
          newLabels[splittedPair[0].trim()] = splittedPair[1].trim();
        }
      }
      newLabels["app.kubernetes.io/managed-by"] = Config.info.name;

      // Create Endpoint definition
      let allAddreses: V1EndpointAddress[] | undefined = undefined;
      let electedAddress: V1EndpointAddress | undefined = undefined;
      let newWriterEndpoint: V1Endpoints = {
        apiVersion: "v1",
        kind: "Endpoints",
        metadata: {
          name: writerName,
          namespace: namespace,
          labels: newLabels
        },
        subsets: endpoint.subsets.map(subset => {
          // Choose first endpoint
          allAddreses = subset.addresses;
          if (subset.addresses && subset.addresses.length > 0) {
            electedAddress = subset.addresses[0];
          }

          return {
            ports: subset.ports,
            addresses: electedAddress ? [electedAddress] : []
          }
        })
      }

      // Post to kubernetes api
      console.info(`[${new Date().toISOString()}] Create writer endpoint ${namespace}/${writerName}`);
      try {
        await this.apiClient.createNamespacedEndpoints(namespace, newWriterEndpoint);
      } catch(e) {
        throw new Error(`POST /api/v1/namespaces/${namespace}/endpoints (${writerName}) failed (${e.statusCode}) ${e.response?.body?.message}`);
      }

      if (electedAddress) {
        console.info(`[${new Date().toISOString()}] [${namespace}/${writerName}] Elect ${(electedAddress as V1EndpointAddress).targetRef?.name} (${(electedAddress as V1EndpointAddress).ip}) as writer`);
      } else {
        console.warn(`[${new Date().toISOString()}] [${namespace}/${writerName}] Unable to elect writer, no ready endpoints in ${namespace}/${endpoint.metadata.name}`);
      }

      // Add endpoint in metrics cache
      this.endpoints.push({
        name: writerName,
        namespace: namespace,
        pods: (allAddreses || []).map((address: V1EndpointAddress) => {
          return {
            name: address.targetRef?.name || address.ip,
            role: electedAddress && address.ip === electedAddress.ip ? ElectedEndpointRole.WRITER : ElectedEndpointRole.READER
          }
        })
      });
    }
  }

  /**
   * Create writer service based on the origional endpoint
   * @param endpoint original endpoint
   * @param writerName
   */
  private async createWriterService(endpoint: V1Endpoints, writerName: string): Promise<void> {
    if (endpoint.metadata && endpoint.metadata.name && endpoint.metadata.namespace) {

      let namespace = endpoint.metadata.namespace;
      let newLabels = endpoint.metadata.labels || {};

      for (let pair of Config.writer.overwrite.labels.split(",")) {
        let splittedPair = pair.split("=");
        newLabels[splittedPair[0].trim()] = splittedPair[1].trim();
      }
      newLabels["app.kubernetes.io/managed-by"] = Config.info.name;

      // Create Service definition
      let newWriterService: V1Service = {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: writerName,
          namespace: namespace,
          labels: newLabels
        },
        spec: {
          sessionAffinity: "None",
          type: "ClusterIP",
          ports: endpoint.subsets &&
                 endpoint.subsets[0] &&
                 endpoint.subsets[0].ports &&
                 endpoint.subsets[0].ports.map(port => {
                  return {
                    name: port.name,
                    port: port.port,
                    protocol: port.protocol,
                    targetPort: port.port as any
                  }
                })
        }
      }

      // Post to kubernetes api
      console.info(`[${new Date().toISOString()}] Create writer service ${namespace}/${writerName}`);
      try {
       await this.apiClient.createNamespacedService(namespace, newWriterService);
      } catch(e) {
        throw new Error(`POST /api/v1/namespaces/${namespace}/services (${writerName}) failed (${e.statusCode}) ${e.response?.body?.message}`);
      }
    }
  }

}
