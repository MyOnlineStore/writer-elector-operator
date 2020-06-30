import { loadEnvs, loadFile, Config } from "./config";
import * as path from "path";
import { WebServer } from "./services/web.service";
import { Gauge } from "prom-client";
import * as pathUtil from "path";
import { readFile } from "./helpers/file.helper";

async function main(): Promise<void> {
  loadEnvs();
  let configFile = path.join(process.cwd(), Config.config.file);
  console.info(`Load config from ${configFile}`);
  await loadFile(configFile);

  let webServer = new WebServer();

  await webServer.init();

  await setBuildInfo();
}

main().then(() => {
  console.info(`Started ${Config.info.name} in ${process.uptime().toFixed(2)}s`);
}).catch(e => {
  console.error(e);
  process.exit(1);
});

async function setBuildInfo(): Promise<void> {
  let buildInfoGauge = new Gauge({
    name: "build_info",
    help: "Build info",
    labelNames: ["version"]
  });

  let packageJsonFile = pathUtil.join(__dirname, "../package.json");
  let packageJson = JSON.parse(await readFile(packageJsonFile));

  buildInfoGauge.set({version: packageJson.version}, 1);
}