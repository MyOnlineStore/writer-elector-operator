
import * as fs from "fs";
import * as yaml from "yaml";

export const Config = {

  info: {
    name: "writer-elector-operator"
  },

  logging: {
    level: "info"
  },

  config: {
    file: "config/application.yml"
  },

  server: {
    port: 8080
  },

  watch: {
    namespaces: "*",
    selector: "myonlinestore.com/writer-elector=writer-elector-operator",
    ignore: "-unready"
  },
  writer: {
    suffix: "-writer",
    overwrite: {
      labels: ""
    }
  }

};

/**
 * Load environment variables
 */
export function loadEnvs() {
  for(let key in process.env){
    let value = process.env[key];
    let segments = key.toLowerCase().split("_");
    let scope = Config as any;
    for(let i = 0; i < segments.length; i++){
      let isLastSegment = i +1 >= segments.length;
      let segment = segments[i];
      let keyName = segment;
      for(let scopeKey in scope) {
        if(scopeKey.toLowerCase() === segment){
          keyName = scopeKey;
        }
      }

      if(isLastSegment){
        scope[keyName] = value;
      } else {
        if(scope[segment] === undefined || typeof(scope[segment]) !== "object"){
          scope[segment] = {};
        }
        scope = scope[segment];
      }
    }
  }

}

/**
 * Load config from file
 * @param file
 */
export function loadFile(file: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if(err) {
        return reject(err);
      }
      try{
        let loadedConfig = yaml.parse(data.toString());
        mergeConfig(Config, loadedConfig);
        resolve();
      }catch(e){
        reject(e);
      }
    });
  })
}

function mergeConfig(currentConfig: any, newConfig: any) {
  for(let key in newConfig) {
    let currentValue = currentConfig[key]
    let newValue = newConfig[key]
    if(!currentValue || typeof(currentValue) !== "object" || typeof(newValue) !== "object") {
      currentConfig[key] = newConfig[key];
    } else {
      mergeConfig(currentValue, newValue);
    }
  }
}
