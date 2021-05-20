import { V1EndpointAddress } from "@kubernetes/client-node";
import { Config } from "../../config";
import { ElectedAddresses, ElectionHandler } from "./election-handler";
import { Client } from "pg";
import deepEqual from "deep-equal";

export class PostgresElectionHandler extends ElectionHandler {

  private allAddresses: V1EndpointAddress[] = [];
  private postgresNodes: PostgresNode[] = [];

  protected onInit() {
    setInterval(() => {
      this.reloadPostgresNodes().catch(e => {
        this.error(e);
      })
    }, Config.writer.psql.checkInterval)
  }

  protected electAddresses(allAddresses: V1EndpointAddress[], previousElectedAddresses: ElectedAddresses): ElectedAddresses {
    this.allAddresses = allAddresses;
    let writeAddress = this.electWrite(allAddresses, previousElectedAddresses);

    let newAddresses: ElectedAddresses = {
      reader: writeAddress ? [writeAddress] : [],
      writer: writeAddress ? [writeAddress] : []
    }

    if (writeAddress) {
      // Find reader addresses that are a 'sync' replica of the writer
      let postgresNode = this.postgresNodes.find(p => p.ip === writeAddress?.ip);
      if (postgresNode) {
        for (let syncReplica of postgresNode.syncReplicas) {
          let replicaAddr = allAddresses.find(addr => addr.ip === syncReplica);
          if (replicaAddr) {
            newAddresses.reader.push(replicaAddr);
          }
        }
      } else {
        // use previous addresses
        newAddresses.reader = previousElectedAddresses.reader.filter(reader => {
          return !!allAddresses.find(addr => addr.ip === reader.ip);
        })
      }
    } else {
      // use previous addresses
      newAddresses.reader = previousElectedAddresses.reader.filter(reader => {
        return !!allAddresses.find(addr => addr.ip === reader.ip);
      })
    }

    return newAddresses;
  }

  private electWrite(allAddresses: V1EndpointAddress[], previousElectedAddresses: ElectedAddresses): V1EndpointAddress | undefined {
    let electedAddress = previousElectedAddresses && previousElectedAddresses.writer && previousElectedAddresses.writer[0];

    if (allAddresses && allAddresses.length > 0) {
      if (electedAddress) {
        // Check if current address is still available
        let currentAddress = allAddresses.find(a => a.ip === electedAddress?.ip);
        let postgresNode = this.postgresNodes.find(n => n.ip === electedAddress?.ip);

        if (currentAddress && postgresNode && postgresNode.status === PostgresNodeStatus.WRITABLE) {
          // Use current address as writer
          return currentAddress;
        } else if (currentAddress && !this.postgresNodes.find(node => node.status === PostgresNodeStatus.WRITABLE)) {
          // do nothing when no other node is writer
          return previousElectedAddresses.writer[0];
        }
      }

      // Elect writer node with the most replicas
      let address: V1EndpointAddress | undefined;
      let nodeReplicaCount = 0;
      for (let postgresNode of this.postgresNodes) {
        if (postgresNode.status === PostgresNodeStatus.WRITABLE) {
          let replicaCount = postgresNode.asyncReplicas.length + postgresNode.syncReplicas?.length;
          if (replicaCount > nodeReplicaCount) {
            nodeReplicaCount = replicaCount;
            let nodeAddress = allAddresses.find(a => a.ip === postgresNode.ip);
            if (nodeAddress) {
              address = nodeAddress;
            }
          }
        }
      }
      if (address) {
        return address;
      }
    }
    return undefined;
  }

  private async reloadPostgresNodes(): Promise<void> {
    let username = this.getKeyFromSecret(this.metadata?.annotations?.['writer-elector.myonlinestore.com/secret-postgres-username'] || "POSTGRES_USERNAME");
    let password = this.getKeyFromSecret(this.metadata?.annotations?.['writer-elector.myonlinestore.com/secret-postgres-password'] || "POSTGRES_PASSWORD");

    let promisses = [];
    for (let address of this.allAddresses) {
      promisses.push(this.getPostgresNodeReplStat(address, username, password).catch(e => {
        this.warn(`Failed to reload postgres pod ${address.targetRef?.name}: ${e.message}`);
        return {
          ip: address.ip,
          status: PostgresNodeStatus.UNKNOWN,
          asyncReplicas: [],
          syncReplicas: []
        } as PostgresNode;
      }));
    }
    let newPostgresNodes = await Promise.all(promisses);

    if (!deepEqual(this.postgresNodes, newPostgresNodes)) {
      this.postgresNodes = newPostgresNodes;
      this.recoile();
    }
  }

  private async getPostgresNodeReplStat(address: V1EndpointAddress, username: string, password: string): Promise<PostgresNode> {
    let client = new Client({
      host: address.ip,
      user: username,
      password: password,
      port: 5432
    });

    await client.connect();
    try {
      let node: PostgresNode = {
        ip: address.ip,
        status: PostgresNodeStatus.UNKNOWN,
        asyncReplicas: [],
        syncReplicas: []
      };

      let walReceiverResult = await client.query("select conninfo from pg_stat_wal_receiver");
      if (walReceiverResult.rows.length > 0) {
        // is slave
        node.status = PostgresNodeStatus.READ_ONLY;
        return node;
      }

      node.status = PostgresNodeStatus.WRITABLE;

      // Get sync and async replicas
      let replResult = await client.query("select client_addr, sync_state from pg_stat_replication");
      node.syncReplicas = replResult.rows.filter(row => row.sync_state === "sync").map(row => row.client_addr);
      node.asyncReplicas = replResult.rows.filter(row => row.sync_state === "potential").map(row => row.client_addr);

      return node;
    } finally {
      await client.end();
    }
  }

}

export interface PostgresNode {

  ip: string;
  status: PostgresNodeStatus;
  syncReplicas: string[];
  asyncReplicas: string[];

}

export enum PostgresNodeStatus {

  UNKNOWN = "UNKNOWN",
  READ_ONLY = "READ_ONLY",
  WRITABLE = "WRITABLE"

}