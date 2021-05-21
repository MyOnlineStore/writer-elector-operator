import { CoreV1Api, V1EndpointAddress, V1Endpoints, V1ObjectMeta, V1Secret, V1Service } from "@kubernetes/client-node";
import deepEqual from "deep-equal";
import { Config } from "../../config";
import { FriendlyError } from "../../errors/friendly.error";
import { getManagedBy, isManagedByMe } from "../../helpers/kube.helper";
import { ElectedEndpointModel, ElectedEndpointRole, ElectedPodModel } from "../../models/elected-endpoint.model";

export const WRITER_NAME = "writer";
export const READER_NAME = "reader";

export abstract class ElectionHandler {

  private _destroy: boolean = false;
  private _ready: boolean = false;
  private _init: boolean = false;
  private working: boolean = false;
  private pendingTask: boolean = false;

  private _endpoints?: V1Endpoints;
  private _service?: V1Service
  private _secret?: V1Secret;
  private electedAddresses?: ElectedAddresses;

  constructor(private readonly id: string, private apiClient: CoreV1Api) {
  }

  protected onInit() {
    // do nothing
  }

  protected onDestroy() {
    // do nothing
  }

  public get namespace(): string {
    return this.metadata?.namespace || "";
  }

  public get originalName(): string {
    return this.metadata?.name || "";
  }

  public get writerName(): string {
    let overwriteName = this.metadata?.annotations?.["writer-elector.myonlinestore.com/writer-service-name"];
    if (overwriteName) {
      return overwriteName;
    }
    return this.originalName + "-writer";
  }

  public get readerName(): string {
    let overwriteName = this.metadata?.annotations?.["writer-elector.myonlinestore.com/reader-service-name"];
    if (overwriteName) {
      return overwriteName;
    }
    return this.originalName + "-reader";
  }

  public getSecretName(): string | undefined {
    return this.metadata?.annotations?.["writer-elector.myonlinestore.com/secret-name"];
  }

  protected getKeyFromSecret(key: string): string {
    if (!this._secret) {
      let secretName = this.getSecretName();
      if (!secretName) {
        throw new FriendlyError(`annotation 'writer-elector.myonlinestore.com/secret-name' is not set`);
      } else {
        throw new FriendlyError(`secret '${secretName}' is not found in namespace '${this.namespace}'`);
      }
    }
    let value = this._secret.data?.[key];
    if (!value) {
      let secretName = this.getSecretName();
      throw new FriendlyError(`secret '${secretName}' doesn't has the key '${key}'`);
    }
    return Buffer.from(value, "base64").toString();
  }

  public get metadata(): V1ObjectMeta | undefined {
    if (this._service) {
      return this._service.metadata;
    }
    return undefined;
  }

  public destroy(): void {
    this._destroy = true;
    this.onDestroy();
  }

  public getElectedEndpoint(): ElectedEndpointModel {
    let pods: ElectedPodModel[] = [];
    if (this.electedAddresses) {
      if (this.electedAddresses.writer) {
        this.electedAddresses.writer.forEach(writerAddress => {
          pods.push({
            name: writerAddress.targetRef?.name || "",
            role: ElectedEndpointRole.WRITER
          })
        })
      }
      if (this.electedAddresses.reader) {
        this.electedAddresses.reader.forEach(readerAddress => {
          let name = readerAddress.targetRef?.name || "";
          if (!pods.find(p => p.name === name)) {
            pods.push({
              name: name,
              role: ElectedEndpointRole.READER
            })
          }
        })
      }
    }
    return {
      name: this.originalName,
      namespace: this.namespace,
      ready: this._ready,
      pods: pods
    }
  }

  public get ready(): boolean {
    return this._ready;
  }

  public get createReaderService(): boolean {
    return this._service?.metadata?.annotations?.["writer-elector.myonlinestore.com/reader-create"] === "true"
  }

  public get createWriterService(): boolean {
    return this._service?.metadata?.annotations?.["writer-elector.myonlinestore.com/writer-create"] !== "false"
  }

  public get readFromWriter(): boolean {
    return this._service?.metadata?.annotations?.['writer-elector.myonlinestore.com/read-from-writer'] !== "false"
  }

  public set endpoints(endpoints: V1Endpoints) {
    this._endpoints = endpoints;
    this._ready = false;
    this.recoile();
  }

  public set service(service: V1Service) {
    this._service = service;
    this._ready = false;
    this.recoile();
  }

  public set secret(secret: V1Secret | undefined) {
    this._secret = secret;
  }

  protected getSecret(): V1Secret | undefined {
    return this._secret;
  }

  public recoile(scheduleTask = true) {
    if (this._destroy || !this._service || !this._endpoints) {
      return;
    }
    if (!this._init) {
      this.onInit();
      this._init = true;
    }
    if (this.working) {
      if (scheduleTask) {
        this.pendingTask = true;
      }
      return;
    }
    this.working = true;
    this.pendingTask = false;
    this.doRecoile().then(() => {
      this.working = false;
      this._ready = true;
      if (this.pendingTask) {
        this.recoile();
      }
    }).catch(e => {
      // todo: better error handling and backoff
      this.error(e);
      this.working = false;
      setTimeout(() => {
        this.recoile(false);
      }, 1000)
    });
  }

  private async doRecoile(): Promise<void> {
    if (!this._service || !this._endpoints) {
      return;
    }

    let allAddreses: V1EndpointAddress[] = [];
    if (this._endpoints.subsets) {
      this._endpoints.subsets.forEach(subset => {
        if (subset.addresses) {
          allAddreses.push(...subset.addresses);
        }
      });
    }

    if (!this.electedAddresses) {
      // Load elected addresses first time
      let writerEndpoint = await this.getEndpoints(this.writerName);
      let readerEndpoint = await this.getEndpoints(this.readerName);
      this.electedAddresses = {
        writer: writerEndpoint?.subsets?.[0].addresses || [],
        reader: readerEndpoint?.subsets?.[0].addresses || []
      }
    }

    // Elect new addresses
    let newAddresses = this.electAddresses(allAddreses, this.electedAddresses);

    if (this.createWriterService) {
      // create/update writer service
      if (!deepEqual(newAddresses.writer.map(addr => addr.ip), this.electedAddresses.writer.map(addr => addr.ip))) {
        this.info(`Elect [${newAddresses.writer.map(addr => addr.targetRef?.name).join(", ")}] as writer(s), was: ${this.electedAddresses.writer.map(addr => addr.targetRef?.name).join(", ")}`);
        await this.updateEndpoints(WRITER_NAME, this.writerName, newAddresses)
        await this.ensureService(WRITER_NAME, this.writerName);
      }
    }
    if (this.createReaderService) {
      // create/update reader service
      if (!this.readFromWriter) {
        // filter out write address
        newAddresses.reader = newAddresses.reader.filter(addr => {
          for (let writerAddr of newAddresses.writer) {
            if (addr.ip === writerAddr.ip) {
              return false;
            }
          }
          return true;
        })
      }
      if (!deepEqual(newAddresses.reader.map(addr => addr.ip), this.electedAddresses.reader.map(addr => addr.ip))) {
        this.info(`Elect [${newAddresses.reader.map(addr => addr.targetRef?.name).join(", ")}] as readers(s), was: ${this.electedAddresses.reader.map(addr => addr.targetRef?.name).join(", ")}`);
        await this.updateEndpoints(READER_NAME, this.readerName, newAddresses)
        await this.ensureService(READER_NAME, this.readerName);
      }
    }

    this.electedAddresses = newAddresses;
  }

  private async getEndpoints(endpointName: string): Promise<V1Endpoints | undefined> {
    let namespace = this.namespace;
    let endpointsRes = await this.apiClient.readNamespacedEndpoints(endpointName, namespace).catch(e => {
      if (e.statusCode !== 404) {
        throw new Error(`GET /api/v1/namespaces/${namespace}/endpoints/${endpointName} failed (${e.statusCode}) ${e.response?.body?.message}`)
      }
      return null;
    });
    return endpointsRes && endpointsRes.body || undefined;
  }

  private async updateEndpoints(suffix: string, endpointName: string, electedAddresses: ElectedAddresses): Promise<void> {
    let namespace = this.namespace;
    let endpoints = await this.getEndpoints(endpointName);

    let subsets = [{
      addresses: (electedAddresses as any)[suffix],
      ports: this._endpoints?.subsets?.[0].ports
    }];
    let hasEndpoints = (electedAddresses as any)[suffix].length > 0;

    if (endpoints) {
      if (!isManagedByMe(endpoints.metadata)) {
        this.warn(`Service ${endpointName} is managed by ${getManagedBy(endpoints.metadata)}`)
      } else {
        if (hasEndpoints) {
          endpoints.subsets = subsets;
          this.info(`Update ${suffix} endpoints ${namespace}/${endpointName}`);
          await this.apiClient.replaceNamespacedEndpoints(endpointName, namespace, endpoints);
        } else {
          this.info(`No ${suffix} endpoints ${namespace}/${endpointName}`);
          await this.apiClient.deleteNamespacedEndpoints(endpointName, namespace);
        }
      }
    } else if (hasEndpoints) {
      let newLabels = this._endpoints?.metadata?.labels || {};

      if (Config.writer.overwrite.labels) {
        for (let pair of Config.writer.overwrite.labels.split(",")) {
          let splittedPair = pair.split("=");
          newLabels[splittedPair[0].trim()] = splittedPair[1].trim();
        }
      }
      newLabels["app.kubernetes.io/managed-by"] = Config.info.name;

      let endpoints: V1Endpoints = {
        apiVersion: "v1",
        kind: "Endpoints",
        metadata: {
          name: endpointName,
          namespace: namespace,
          labels: newLabels,
          ownerReferences: [{
            apiVersion: "v1",
            kind: "Endpoints",
            name: this._endpoints?.metadata?.name || "",
            uid: this._endpoints?.metadata?.uid || ""
          }]
        },
        subsets: subsets
      }
      this.info(`Create ${suffix} endpoints ${namespace}/${endpointName}`);
      await this.apiClient.createNamespacedEndpoints(namespace, endpoints);
    }

  }

  private async ensureService(suffix: string, serviceName: string): Promise<void> {
    let namespace = this.namespace;

    let serviceRes = await this.apiClient.readNamespacedService(serviceName, namespace).catch(e => {
      if (e.statusCode !== 404) {
        throw new Error(`GET /api/v1/namespaces/${namespace}/services/${serviceName} failed (${e.statusCode}) ${e.response?.body?.message}`)
      }
      return null;
    });
    let service = serviceRes && serviceRes.body;

    if (!service) {
      // Create service
      let newLabels = this._service?.metadata?.labels || {};

      for (let pair of Config.writer.overwrite.labels.split(",").map(p => p.trim()).filter(p => p)) {
        let splittedPair = pair.split("=");
        newLabels[splittedPair[0].trim()] = splittedPair[1].trim();
      }
      newLabels["app.kubernetes.io/managed-by"] = Config.info.name;

      // Create Service definition
      let newService: V1Service = {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: serviceName,
          namespace: namespace,
          labels: newLabels
        },
        spec: {
          sessionAffinity: "None",
          type: "ClusterIP",
          ports: this._service?.spec?.ports
        }
      }

      this.info(`Create service ${namespace}/${serviceName}`);
      await this.apiClient.createNamespacedService(namespace, newService);
    } else {
      if (!isManagedByMe(service.metadata)) {
        this.warn(`Service ${serviceName} is managed by ${getManagedBy(service.metadata)}`)
      }
    }
  }

  protected abstract electAddresses(allAddreses: V1EndpointAddress[], previousElectedAddresses: ElectedAddresses): ElectedAddresses;


  public error(message: any, ...optionalParams: any[]) {
    if (message instanceof FriendlyError) {
      message = message.message;
    }
    console.error(`[${new Date().toISOString()}] [ERROR] [${this.id}]`, message, ...optionalParams.map(param => {
      if (param instanceof FriendlyError) {
        return param.message;
      }
      return param;
    }));
  }

  public info(message: any, ...optionalParams: any[]) {
    console.error(`[${new Date().toISOString()}] [INFO] [${this.id}]`, message, ...optionalParams);
  }

  public warn(message: any, ...optionalParams: any[]) {
    console.error(`[${new Date().toISOString()}] [WARN] [${this.id}]`, message, ...optionalParams);
  }

}

export interface ElectedAddresses {

  writer: V1EndpointAddress[];
  reader: V1EndpointAddress[];

}