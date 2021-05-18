import { V1EndpointAddress } from "@kubernetes/client-node";
import { ElectedAddresses, ElectionHandler } from "./election-handler";

/**
 * The default elector handler will elect 1 endpoint as writer and all as reader
 */
export class DefaultElectionHandler extends ElectionHandler {

  protected electAddresses(allAddreses: V1EndpointAddress[], previousElectedAddresses: ElectedAddresses): ElectedAddresses {
    let electedAddress = previousElectedAddresses && previousElectedAddresses.writer && previousElectedAddresses.writer[0];

    let newAddresses: ElectedAddresses = {
      writer: [],
      reader: allAddreses
    };

    if (allAddreses && allAddreses.length > 0) {
      if (electedAddress) {
        // Check if current address is still available
        let currentAddress = allAddreses.find(a => a.ip === electedAddress?.ip);

        if (currentAddress) {
          // Use current address as writer
          newAddresses.writer = [currentAddress];
          return newAddresses
        }
      }

      // Elect first address as writer
      newAddresses.writer = [allAddreses[0]];
    }

    return newAddresses;
  }

}