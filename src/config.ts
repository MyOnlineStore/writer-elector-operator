
import * as fs from "fs";
import * as yaml from "yaml";

export const Config = {

  info: {
    name: "percona-writer-elector-operator"
  },

  logging: {
    level: "info"
  },

  config: {
    file: "config/application.yml"
  },

  server: {
    port: 4000
  },

  scrapers: {
    backup: {
      enabled: true,
      bucket: "backup-myonlinestore-eu"
    }
  },

  gcloud: {
    project: "myonlinestore-eu",
    region: "europe-west4",
    serviceAccount: JSON.stringify({
      "type": "service_account",
      "project_id": "myonlinestore-eu",
      "private_key_id": "65d3e6e6c841d3846444c39b1af2c0e4be779b90",
      "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDBRV5+9QrvlHnO\nN6Wx5oWOefKMTktIxLFfKLYJbwK85Qxd1yPUrJ3HW1PABVZjGeQT/W1Q5a6kxgrA\nSKJFRTO9xWDKaQOO0oM/TrxEq6ECDA5dKUdjlA/oL0Lc5nNC9kpubp9Bzp5jsPjI\n/rB53rkTbjPe1aqnuqsHpCCnrJWKCrSbJW7Hcn28tctp/9xDF5t2ol0SzJzArFyN\nNMAFx+cfA3kcw/1xlN+JzS6uoCouNu++cGLG4nD2WKdGZ17S9NsMF+Obn6Dvkok8\nkrRsELDFgzdvwKUyqvzaEPwxnQGcBzEPiPpKl7/IFqUkTAgNfByP5Re+kDG8s/uM\nF0xC5UJ3AgMBAAECggEAUpT0eqTzxkkX/tByQWCxop5i0CbILlC1RWbc2Y0Qi2wH\na7V4vu/+/ub8Eyl0ryWp+gyogA+UHx3sDBs9EwItyKGk6PgUKBu1LwDSmzkGtBw4\nqv/vXBIw9dHz7PWfPHaGeUdVT0YdEZXVx/Rjrb9IL5BAI7ACmma9m6c6uMqanv+S\n59SbrD2ahzvuwYp+gpPV5rZLLOhRtqXPkMKOO2OQADL5EdOrTlqo92Z4nOnDC1Ho\nbwnhSNAiJ5HNBdIivZp0nzD62KD00GVUtEv2h5E1QHDdIGuuQwLuMI8mf7hd9PPT\nEvVLF4XDTwBkpB1Z/Bpa9p52/RbPL3/B+9UViH+YuQKBgQD3BJaTIo/PsYRUOIiO\nMyVBOcf+CaglkZASubWjgbIgcCrIXataOr0/UtpGOr/vL6+HPehFBI2fPKyYg55k\n9GCasSaoFeVVKTttxol3e6AX0VaFM2VAUtRrj9pMRLAI8jjeFf6WqBSeoFZzRcDr\nXWzrVqA4LXXnYg7/S/V5VmQ6pQKBgQDITHeybxLnxrK0VGwbDMoiC/XhUuwJRYMv\n+hL7OMRa4ACn/+DC3PpaV7ydQdbHM9XuF8NOlFy1f3T/9rDyMVII4rPtPnpMfmbI\n4HNZcqi9SW5BsADmyIP1rngwL+1+0UOo7b6EBrMLK9StBie9K1NHxuZ1pzD6YyNG\npp8AFFMp6wKBgQCU6jIwT3StPBJPh6ljOJgsAz56+q1gwKk/cK98+9I71gMkubt0\ncNboFvW5wu80reW+vWaKPR13sudGJorVx7F5cHSifli8B1hpbHgxDNlNoojrUjmn\nFogytA1hT0NkkUoRMOdDQd70ZirX4WRVQARKt/VtCJL8w9PQuqUo2hkgdQKBgAro\nZyhXdi8bGgZKBq0ecC+UeSpxKpuCppdJRhlaSQ8t3btIawQRpqye1I231St5/i9+\nKcuwtq/HpiZ+V7qIxw/m0Ked3GkoBQ7xcjav0NKmGhQHsrTevJj3jGILaiKa4NVl\nRRfJiZyVIXret/FMV7ez9D76AOfR2Ezzq/sEIFdLAoGBAKj7URISMWo+eaybAS9Y\nsNqVEUDR/jIOE0PAat33nBcbUEW2vzGdnF5Wm3uvCxSzj9UhKAWr+yJj4hHHDp2K\nJov5ASBvsdVdFbXC7mTSLVvY7xdTR8qa1sZj0hxWLrPtAGpIs71HNXOTx8mDAx5u\nzElvZn166uYT89luHd1YUhXI\n-----END PRIVATE KEY-----\n",
      "client_email": "metrics-service@myonlinestore-eu.iam.gserviceaccount.com",
      "client_id": "100987982192318509908",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/metrics-service%40myonlinestore-eu.iam.gserviceaccount.com"
    })
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
