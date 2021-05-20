
export interface ElectedEndpointModel {

  pods: Array<ElectedPodModel>;
  name: string;
  namespace: string;
  ready: boolean;

}

export interface ElectedPodModel {
  name: string;
  role: ElectedEndpointRole
}

export const ElectedEndpointRoles = [
  "WRITER",
  "READER"
];

export enum ElectedEndpointRole {
  "WRITER" = "WRITER",
  "READER" = "READER"
}