import * as vscode from 'vscode';
import { EndpointTreeDataProvider } from "../providers/endpoint-tree-data-provider";
import { MapperTreeDataProvider } from "../providers/mapper-tree-data-provider";

export class ProviderManager implements vscode.Disposable {
  private mapperTreeDataProviderMap = new Map<string, MapperTreeDataProvider>();
  private endpointTreeDataProviderMap = new Map<string, EndpointTreeDataProvider>();

  createMapperTreeDataProvider(workspaceFolder: string, middlewareName: string): MapperTreeDataProvider {
    const existing = this.mapperTreeDataProviderMap.get(middlewareName);
    if (existing) {
      return existing;
    }
    const provider = new MapperTreeDataProvider(workspaceFolder, middlewareName);
    this.mapperTreeDataProviderMap.set(middlewareName, provider);
    return provider;
  }

  createEndpointTreeDataProvider(workspaceFolder: string, middlewareName: string): EndpointTreeDataProvider {
    const existing = this.endpointTreeDataProviderMap.get(middlewareName);
    if (existing) {
      return existing;
    }
    const provider = new EndpointTreeDataProvider(workspaceFolder, middlewareName);
    this.endpointTreeDataProviderMap.set(middlewareName, provider);
    return provider;
  }

  getMapperTreeDataProvider(middlewareName: string): MapperTreeDataProvider | undefined {
    return this.mapperTreeDataProviderMap.get(middlewareName);
  }

  getEndpointTreeDataProvider(middlewareName: string): EndpointTreeDataProvider | undefined {
    return this.endpointTreeDataProviderMap.get(middlewareName);
  }

  dispose(): void {
    this.mapperTreeDataProviderMap.forEach(provider => provider.dispose());
    this.endpointTreeDataProviderMap.forEach(provider => provider.dispose());
    this.mapperTreeDataProviderMap.clear();
    this.endpointTreeDataProviderMap.clear();
  }
}