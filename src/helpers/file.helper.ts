
import * as fs from "fs";

export function readFile(file: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      err ? reject(err) : resolve(data.toString());
    })
  });
}