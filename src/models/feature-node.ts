
export interface FeatureNode {
  name: string;
  filePath?: string;
  children: FeatureNode[];
  command?: string;
  arguments?: any[];
  isHighlighted?: boolean;
}
