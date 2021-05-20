
import { CoreV1Api, KubeConfig, Watch, V1Endpoints, V1Service, V1Secret } from "@kubernetes/client-node";
import { Config } from "../config";
import { Watcher } from "./watcher";
import { ElectedEndpointModel } from "../models/elected-endpoint.model";
import { ElectionHandler } from "./election-handler/election-handler";
import { DefaultElectionHandler } from "./election-handler/default.election-handler";
import { PostgresElectionHandler } from "./election-handler/postgres.election-handler";
import { isManagedByMe } from "../helpers/kube.helper";

export class WatchService {

  private readonly kubeConfig: KubeConfig;
  private readonly apiClient: CoreV1Api;
  private readonly endpointWatchers: Watcher<V1Endpoints>[] = [];
  private readonly serviceWatchers: Watcher<V1Service>[] = [];
  private readonly secretWatchers: Watcher<V1Secret>[] = [];

  private serviceHandlers: {[name: string]: ElectionHandler} = {};
  private secretStore: {[name: string]: V1Secret} = {};
  private endpointStore: {[name: string]: V1Endpoints} = {};

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
      let endpointWatcher = new Watcher<V1Endpoints>(watchClient, `/api/v1/endpoints`, Config.watch.selector);
      this.endpointWatchers.push(endpointWatcher);

      let serviceWatcher = new Watcher<V1Service>(watchClient, `/api/v1/services`, Config.watch.selector);
      this.serviceWatchers.push(serviceWatcher);

      let secretWatcher = new Watcher<V1Secret>(watchClient, `/api/v1/secrets`, Config.watch.selector);
      this.secretWatchers.push(secretWatcher);

    } else {
      // Watch specific namespaces
      for (let ns of Config.watch.namespaces) {
        let endpointWatcher = new Watcher<V1Endpoints>(watchClient, `/api/v1/namespaces/${ns}/endpoints`, Config.watch.selector);
        this.endpointWatchers.push(endpointWatcher);
        let serviceWatcher = new Watcher<V1Service>(watchClient, `/api/v1/namespaces/${ns}/services`, Config.watch.selector);
        this.serviceWatchers.push(serviceWatcher);
        let secretWatcher = new Watcher<V1Secret>(watchClient, `/api/v1/namespaces/${ns}/secrets`, Config.watch.selector);
        this.secretWatchers.push(secretWatcher);
      }
    }

    // Subscribe on watchers
    for (let watcher of this.endpointWatchers) {
      watcher.subscribe(async (type, endpoints) => {
        let name = `${endpoints.metadata?.namespace}/${endpoints.metadata?.name}`;
        if (type === "ADDED" || type === "MODIFIED") {
          if (!isManagedByMe(endpoints.metadata)) {
            this.onUpdateEndpoint(name, endpoints);
          }
        } else if(type === "DELETED") {
          this.onDeleteEndpoint(name, endpoints);
        }
      });
    }

    for (let watcher of this.serviceWatchers) {
      watcher.subscribe(async (type, service) => {
        let name = `${service.metadata?.namespace}/${service.metadata?.name}`;
        if (type === "ADDED" || type === "MODIFIED") {
          if (!isManagedByMe(service.metadata)) {
            this.onUpdateService(name, service);
          }
        } else if(type === "DELETED") {
          this.onDeleteService(name, service);
        }
      });
    }

    for (let watcher of this.secretWatchers) {
      watcher.subscribe(async (type, secret) => {
        let name = `${secret.metadata?.namespace}/${secret.metadata?.name}`;
        if (type === "ADDED" || type === "MODIFIED") {
          this.secretStore[name] = secret;
          for (let handlerName in this.serviceHandlers) {
            let handler = this.serviceHandlers[handlerName];
            let secretName = handler.getSecretName();
            if (secretName && secretName === secret.metadata?.name && handler.namespace === secret.metadata?.namespace) {
              handler.secret = secret;
            }
          }
        } else if(type === "DELETED") {
          if (this.secretStore[name]) {
            delete this.secretStore[name];
          }
          for (let handlerName in this.serviceHandlers) {
            let handler = this.serviceHandlers[handlerName];
            let secretName = handler.getSecretName();
            if (secretName && secretName === secret.metadata?.name) {
              handler.secret = undefined;
            }
          }
        }
      });
    }
  }

  private onUpdateEndpoint(name: string, endpoints: V1Endpoints) {
    this.endpointStore[name] = endpoints;
    let handler = this.serviceHandlers[name];
    if (handler) {
      handler.endpoints = endpoints;
    }
  }

  private onDeleteEndpoint(name: string, endpoints: V1Endpoints) {
    if (this.endpointStore[name]) {
      delete this.endpointStore[name];
    }
  }

  private onUpdateService(name: string, service: V1Service) {
    let handler = this.serviceHandlers[name];
    if (handler) {
      handler.service = service;
    } else {
      let handler = this.createHandler(name, service.metadata?.annotations);
      if (handler) {
        handler.service = service;

        this.serviceHandlers[name] = handler;
        let secretName = handler.getSecretName();
        if (secretName) {
          let secret = this.secretStore[`${service.metadata?.namespace}/${secretName}`];
          if (secret) {
            handler.secret = secret;
          }
        }

        let endpoints = this.endpointStore[name];
        if (endpoints) {
          handler.endpoints = endpoints;
        }
      }
    }
  }

  private onDeleteService(name: string, endpoints: V1Service) {
    let handler = this.serviceHandlers[name];
    if (handler) {
      handler.destroy();
      delete this.serviceHandlers[name];
    }
  }

  private createHandler(name: string, annotations?: {[key: string]: string}): ElectionHandler | null {
    let protocol = annotations?.["writer-elector.myonlinestore.com/elector"] || "default";
    let handler: ElectionHandler | undefined;
    switch(protocol) {
      case "default":
        handler = new DefaultElectionHandler(name, this.apiClient);
        break;
      case "postgres":
        handler = new PostgresElectionHandler(name, this.apiClient);
        break;
    }

    if (handler) {
      handler.info(`Created ${protocol} election handler`)
      return handler;
    } else {
      console.warn(`[${new Date().toISOString()}] [${name}] Invalid protocol: '${protocol}'`);
    }
    return null;
  }

  public getEndpoints(): ElectedEndpointModel[] {
    return Object.values(this.serviceHandlers).map(handler => {
      return handler.getElectedEndpoint();
    })
  }

}
