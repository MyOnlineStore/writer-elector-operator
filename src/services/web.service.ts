
import * as express from "express";
import { Config } from "../config";
import { register } from "prom-client";

/**
 * Webserver for health and metrics endpoints
 */
export class WebServer {

  constructor() {

  }

  public async init(): Promise<void> {
    const app = express();

    app.get("/metrics", (req, res, next) => {
      res.status(200).send(register.metrics());
    });

    app.get("/health", (req, res, next) => {
      res.status(200).send("healthy");
    });

    app.use((req, res, next) => {
      res.status(404).send(`
      <html>
      <head>
      <title>${Config.info.name}</title>
      </head>
      <body>
      <h1>${Config.info.name}</h1>
      <ul>
      <li><a href="/metrics">/metrics</a></li>
      <li><a href="/health">/health</a></li>
      </ul>
      </body>
      </html>`);
    });

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error(err);
      res.status(500).send(`Internal server error`);
    });

    await new Promise((resolve, reject) => {
      app.listen(Config.server.port, () => {
        console.info(`🚀  Server ready at http://localhost:` + Config.server.port)
        resolve();
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

}
