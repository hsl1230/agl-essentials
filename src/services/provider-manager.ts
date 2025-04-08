import { EndpointTreeDataProvider } from "../providers/endpoint-tree-data-provider";
import { MapperTreeDataProvider } from "../providers/mapper-tree-data-provider";

export class ProviderManager {
  private mapperTreeDataProviderMap = new Map<string, MapperTreeDataProvider>();
  private endpointTreeDataProviderMap = new Map<string, EndpointTreeDataProvider>();

  createMapperTreeDataProvider(workspaceFolder: string, middlewareName: string, isDefault: boolean) {
    let mapperTreeDataProvider = this.mapperTreeDataProviderMap.get(middlewareName);
    if (mapperTreeDataProvider) {
      return mapperTreeDataProvider;
    }
    mapperTreeDataProvider = new MapperTreeDataProvider(workspaceFolder, middlewareName, isDefault);
    this.mapperTreeDataProviderMap.set(middlewareName, mapperTreeDataProvider);
    return mapperTreeDataProvider;
  }

  createEndpointTreeDataProvider(workspaceFolder: string, middlewareName: string) {
    let endpointTreeDataProvider = this.endpointTreeDataProviderMap.get(middlewareName);
    if (endpointTreeDataProvider) {
      return endpointTreeDataProvider;
    }
    endpointTreeDataProvider = new EndpointTreeDataProvider(workspaceFolder, middlewareName);
    this.endpointTreeDataProviderMap.set(middlewareName, endpointTreeDataProvider);
    return endpointTreeDataProvider;
  }

  getMapperTreeDataProvider(middlewareName: string) {
    return this.mapperTreeDataProviderMap.get(middlewareName);
  }

  getEndpointTreeDataProvider(middlewareName: string) {
    return this.endpointTreeDataProviderMap.get(middlewareName);
  }

  dispose() {
    this.mapperTreeDataProviderMap.forEach(provider => provider.dispose());
    this.endpointTreeDataProviderMap.forEach(provider => provider.dispose());
    this.mapperTreeDataProviderMap.clear();
    this.endpointTreeDataProviderMap.clear();
  }
}