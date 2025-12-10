
export interface FeatureNode {
  name: string;
  description?: string;
  filePath?: string;
  children: FeatureNode[];
  command?: string;
  arguments?: any[];
  isHighlighted?: boolean;
  contextValue?: string;
  endpointData?: any;
}
