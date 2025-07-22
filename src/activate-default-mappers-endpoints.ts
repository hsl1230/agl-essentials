import { ProviderManager } from './services/provider-manager';
import { ViewManager } from './services/view-manager';

export function activateDefaultMappersAndEndpoints(viewManager: ViewManager, providerManager: ProviderManager, workspaceFolder: string, middlewareName: string) {
      // Register Mapper Tree
      const defaultMapperTreeDataProvider = providerManager.createMapperTreeDataProvider(workspaceFolder, middlewareName, true);
      viewManager.createView(`aglMappers-${middlewareName}`, defaultMapperTreeDataProvider);

      // Register Endpoint Tree
      const defaultEndpointTreeDataProvider = providerManager.createEndpointTreeDataProvider(workspaceFolder, middlewareName);
      viewManager.createView(`aglEndpoints-${middlewareName}`, defaultEndpointTreeDataProvider);  
}