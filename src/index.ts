import { loadEnvs, loadFile, Config } from "./config";
import * as path from "path";
import { WebServer } from "./services/web.service";
import { WatchService } from "./services/watch.service";
import { MetricsService } from "./services/metrics.service";

async function main(): Promise<void> {
  loadEnvs();
  let configFile = path.join(process.cwd(), Config.config.file);
  console.info(`Load config from ${configFile}`);
  await loadFile(configFile);

  let webServer = new WebServer();
  let watchService = new WatchService();
  let metricsService = new MetricsService(watchService);

  await watchService.init();
  await webServer.init(async app => {
    await metricsService.init(app);
  });
}

main().then(() => {
  console.info(`Started ${Config.info.name} in ${process.uptime().toFixed(2)}s`);
}).catch(e => {
  console.error(e);
  process.exit(1);
});