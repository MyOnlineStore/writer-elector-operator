
export interface ElectedEndpointModel {

  pods: Array<{
    name: string;
    role: ElectedEndpointRole
  }>;
  name: string;
  namespace: string;

}

export const ElectedEndpointRoles = [
  "WRITER",
  "READER"
];

export enum ElectedEndpointRole {
  "WRITER" = "WRITER",
  "READER" = "READER"
}