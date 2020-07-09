import { Application } from "express";
import { Gauge, collectDefaultMetrics, register } from "prom-client";
import * as pathUtil from "path";
import { readFile } from "../helpers/file.helper";
import { WatchService } from "./watch.service";
import { ElectedEndpointRoles } from "../models/elected-endpoint.model";

export class MetricsService {

  private buildInfoGauge = new Gauge({
    name: "build_info",
    help: "Build info",
    labelNames: ["version"]
  });

  private endpointGauge = new Gauge({
    name: "percona_writer_elector_endpoints",
    help: "Endpoints managed by the percona-writer-elector-operator",
    labelNames: ["namespace", "endpoint", "pod", "role"]
  });

  constructor(private watchService: WatchService) {

  }

  public async init(app: Application): Promise<void> {
    // Setup metrics
    collectDefaultMetrics();

    // Metrics endpoint
    app.get("/metrics", (req, res, next) => {
      register.resetMetrics();

      // Collect metrics
      this.collectMetrics().then(() => {
        // Send prometheus response
        res.status(200).send(register.metrics());
      }).catch(e => next(e));
    });
  }

  private async collectMetrics(): Promise<void> {
    let packageJsonFile = pathUtil.join(__dirname, "../../package.json");
    let packageJson = JSON.parse(await readFile(packageJsonFile));

    this.buildInfoGauge.set({version: packageJson.version}, 1);

    this.watchService.getEndpoints().forEach(endpoint => {
      endpoint.pods.forEach(pod => {
        ElectedEndpointRoles.forEach(role => {
          this.endpointGauge.set({
            namespace: endpoint.namespace,
            endpoint: endpoint.name,
            pod: pod.name,
            role: role
          }, pod.role === role ? 1 : 0);
        });
      });
    });
  }

}