export class Node {
  keyToChildNode: Map<string, Node>;
  clusterIds: number[];

  constructor() {
    this.keyToChildNode = new Map();
    this.clusterIds = [];
  }
}
