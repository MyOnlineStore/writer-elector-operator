import { Watch } from "@kubernetes/client-node";

/**
 * Wrapper around a watch call to retry on failures
 */
export class Watcher<T> {

  private startedWatch = false;
  private callbacks: Array<Callback<T>> = [];

  constructor(private watchClient: Watch, private path: string, private labelSelector: string) {

  }

  public subscribe(callback: Callback<T>): void {
    this.callbacks.push(callback);

    // Start watching when first subscriber is registered
    if (!this.startedWatch) {
      this.startWatch();
      this.startedWatch = true;
    }
  }

  private startWatch() {
    this.watchClient.watch(this.path, {
      watch: true,
      labelSelector: this.labelSelector
    }, (type, obj) => {
      // On event received, call callbacks
      this.callbacks.forEach(callback => {
        callback(type, obj).catch(e => console.error(e));
      });

    }, e => {
      // Handle error when watch is interupted
      console.error(`Watch ended for ${this.path}, retrying in a few seconds...`, e);
      setTimeout(() => {
        this.startWatch();
      }, 2000);
    }).catch(e => {
      // Handle error when api call to kubernetes failes
      console.error(`Failed to start watch on ${this.path}, retrying in a few seconds...`, e);
      setTimeout(() => {
        this.startWatch();
      }, 2000);
    });
  }

}

export type Callback<T> = (type: string, obj: T) => Promise<void>;